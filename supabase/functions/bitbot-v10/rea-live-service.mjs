import {initialLive,planLive,applyExchangeInfo,liveActive,liveSummary,exchangeBody,LIVE_CONFIRM,LIMITED_POLICY} from './rea-live-core.mjs';
import {codexPlan} from './rea-codex-policy.mjs';
import {reviewTeam} from './rea-review-team.mjs';
import {capitalAdvice,refreshCapitalAdvice} from './rea-capital-advisor.mjs';
import {lossReview} from './rea-loss-diagnostics.mjs';
import {liveLearning,experienceAssessment} from './rea-learning.mjs';
import {liveProfitReview} from './rea-position-policy.mjs';
const symbols=s=>[...new Set([...(s?.positions||[]).map(p=>p.symbol),...(s?.orders||[]).filter(liveActive).map(o=>o.symbol)])];
const hash=async v=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(v)))].map(x=>x.toString(16).padStart(2,'0')).join('');
const safeError=e=>e.exchangeRejected?'BITKUB_REJECTED_'+String(e.message).slice(0,80):String(e.message||'LIVE_SERVICE_UNAVAILABLE').slice(0,160);
export function createLiveService({rpc,keys,wallet,signed,scan,quotes,brain=async()=>null,clock=()=>Date.now()}){
 async function preflight(uid,pair){
  // Independent authenticated reads share the same executor lease.
  const [ordersResult,walletResult]=await Promise.allSettled([signed(pair,'GET','/api/v3/market/my-open-orders?sym=btc_thb'),wallet(pair)]);
  if(ordersResult.status==='rejected')throw ordersResult.reason;
  if(walletResult.status==='rejected')throw walletResult.reason;
  const open=ordersResult.value,w=walletResult.value;
  if(!Array.isArray(open.result))throw Error('PRIVATE_ORDERS_UNVERIFIED');
  return{ok:true,at:clock(),keyFingerprint:await hash(pair.apiKey),wallet:w,privateReads:true,tradePermission:'REQUIRES_KEY_SCOPE_REVIEW',withdrawPermission:'NOT_REQUESTED'};
 }
 async function recover(pair,o){
  const open=await signed(pair,'GET','/api/v3/market/my-open-orders?sym='+o.symbol.toLowerCase());
  if(!Array.isArray(open.result))throw Error('OPEN_ORDERS_INVALID');
  const matches=open.result.filter(x=>(x.client_id||x.ci)===o.clientId);
  if(matches.length>1)throw Error('DUPLICATE_CLIENT_ORDER_ON_EXCHANGE');
  if(matches.length)return String(matches[0].id);
  let cursor=null;for(let page=0;page<5;page++){
   const path='/api/v3/market/my-order-history?sym='+o.symbol.toLowerCase()+'&lmt=100&pagination_type=keyset&start='+(o.createdAt-60000)+'&end='+clock()+(cursor?'&cursor='+encodeURIComponent(cursor):'');
   const data=await signed(pair,'GET',path);if(!Array.isArray(data.result))throw Error('EXCHANGE_HISTORY_INVALID');
   const found=data.result.find(x=>x.client_id===o.clientId);
   if(found)return String(found.super_order_id||found.order_id||'')||null;
   if(!data.pagination?.has_next)break;
   if(!data.pagination.cursor||data.pagination.cursor===cursor)throw Error('EXCHANGE_HISTORY_CURSOR_INVALID');
   cursor=data.pagination.cursor;
  }return null;
 }
 async function run(riskOnly=false,uid=null){
  const began=clock();
  const lane=riskOnly?'risk':'strategy';if(riskOnly)await rpc('rea_live_idle',{});
  // Candle/news scanning runs outside the executor lease. A stalled scanner cannot
  // hold the independent stop worker's execution lock.
  let prepared=null,scanError=null,scanMs=0;const brains=new Map(),experiences=new Map(),studies=new Map();
  if(!riskOnly){const targets=await rpc('rea_live_scan_targets',{p_uid:uid});if(!Array.isArray(targets))throw Error('LIVE_SCAN_TARGETS_INVALID');
   for(const t of targets){experiences.set(t.paper_user_id||t.user_id,t.paper_experience||null);studies.set(t.paper_user_id||t.user_id,t.position_study||null);}
   await Promise.all(targets.map(async t=>{try{brains.set(t.user_id,await brain(t.user_id));}catch{brains.set(t.user_id,null);}}));
   if(targets.length){const scanAt=clock();try{prepared=await scan([...new Set(targets.flatMap(x=>symbols(x.state)))]);}catch(e){scanError=safeError(e);}finally{scanMs=clock()-scanAt;}}
  }
  const rows=await rpc('rea_live_claim',{p_lane:lane,p_uid:uid}),results=[];
  for(let row of rows){
   let state=structuredClone(row.state),pf=row.preflight||{},latest={...row.latest},fills=[],intents=[],pair=null,error=null;
   const timings={scanMs,walletReads:0};
   const checkpoint=async()=>{const saved=await rpc('rea_live_checkpoint',{p_uid:row.user_id,p_lease:row.lease,p_revision:row.revision,p_state:state,p_preflight:pf,p_latest:latest,p_fills:fills,p_lane:lane,p_error:error});if(saved){row=saved;fills=[];}return saved;};
   try{
    try{pair=await keys(row.user_id);}catch(e){throw Error('EXCHANGE_KEY_STORE: '+safeError(e));}
    const privateAt=clock();
    try{pf=await preflight(row.user_id,pair);timings.walletReads++;timings.preflightMs=clock()-privateAt;}catch(e){throw Error('BITKUB_PRIVATE_READ: '+safeError(e));}
    if(row.approval&&row.approval.keyFingerprint!==pf.keyFingerprint)throw Error('APPROVED_EXCHANGE_KEY_CHANGED');
    if(state){
     const reconciliationAt=clock(),hadActiveOrders=state.orders.some(liveActive);
     // RESERVED has no dispatch receipt. A recovered old signal is abandoned, never replayed.
     for(const orderId of state.orders.filter(liveActive).map(o=>o.id)){
      const o=state.orders.find(o=>o.id===orderId);
      if(o.status==='RESERVED'){o.status='REJECTED';o.rejectReason='UNDISPATCHED_RESERVATION_RECOVERED';continue;}
      if(!o.exchangeId){o.status='UNKNOWN';o.exchangeId=await recover(pair,o);if(!o.exchangeId)continue;}
      const info=(await signed(pair,'GET','/api/v3/market/order-info?sym='+o.symbol.toLowerCase()+'&id='+encodeURIComponent(o.exchangeId)+'&sd='+(o.side==='BUY'?'buy':'sell'))).result;
      const pendingCancel=o.status==='CANCEL_PENDING',lastCancelAt=o.lastCancelAt;
      const settled=applyExchangeInfo(state,o.id,info,clock());state=settled.state;fills.push(...settled.fills);
      const refreshed=state.orders.find(x=>x.id===o.id);
      if(pendingCancel&&['OPEN','PARTIAL'].includes(refreshed.status)&&clock()-(lastCancelAt||0)<30000)refreshed.status='CANCEL_PENDING';
     }
     // Re-read after any potentially unsettled order. An idle account can reuse
     // its fresh, timestamped preflight wallet; unknown or old data always refreshes.
     if(hadActiveOrders||!Number.isFinite(pf.wallet?.at)||clock()-pf.wallet.at>5000||pf.wallet.at>clock()+5000){pf={...pf,wallet:await wallet(pair),at:clock()};timings.walletReads++;}
     timings.reconciliationMs=clock()-reconciliationAt;
     let bundle=riskOnly||!prepared?{markets:await quotes(symbols(state))}:prepared;
     let team=null;
     if(!riskOnly){timings.pipelineMs=clock()-began;const analysis=reviewTeam({bundle,state,wallet:pf.wallet,now:clock(),timings});bundle=analysis.bundle;team=analysis.receipt;}
     const ready=await rpc('rea_live_ready',{p_uid:row.user_id});
     const permitted=state.policy===LIMITED_POLICY?ready.limited?.ready===true:ready.ready===true;
     const experience=experiences.get(row.user_id)||null;
     const out=planLive(state,bundle,pf.wallet,clock(),{entries:!riskOnly&&!scanError&&!!prepared&&row.mode==='LIVE_ENABLED'&&permitted,operationalLock:!permitted||!!scanError,brain:brains.get(row.user_id),experience});
     state=out.state;intents=out.intents;
     latest={...latest,at:clock(),[riskOnly?'riskAt':'strategyAt']:clock(),mode:row.mode,health:out.healthy&&!scanError?'OK':'SAFE_MODE',summary:liveSummary(state),reason:scanError||out.reason,
      quotes:(bundle.markets||[]).filter(m=>state.positions.some(p=>p.symbol===m.symbol)).map(m=>({symbol:m.symbol,bid:m.bid,ask:m.ask,last:m.last,at:m.observedAt})),
      ...(riskOnly?{}:{team,codex:codexPlan(brains.get(row.user_id),clock()),decisions:out.decisions,marketCount:bundle.universeCount??bundle.markets?.length??0,analyzedCount:bundle.markets?.length??0,news:{at:clock(),readyMarkets:(bundle.markets||[]).filter(m=>m.news?.ready===true).length,blockedMarkets:(bundle.markets||[]).filter(m=>m.news?.blocked===true).length}}),performance:{...timings,pipelineMs:clock()-began,lane},accounting:'EXCHANGE_RECEIPTS',runtime:'SUPABASE_CRON',lane};
     const capitalContext={state,bundle,wallet:pf.wallet,now:clock(),mode:row.mode,health:latest.health,entriesPermitted:permitted&&!scanError,decisions:out.decisions};
     latest.lossDiagnostics=lossReview(capitalContext);
     latest.learning=liveLearning(state,latest.learning,clock());
     latest.profitReview=liveProfitReview(state,bundle,clock(),riskOnly?latest.profitReview?.study||null:studies.get(row.user_id)||null);
     if(!riskOnly){latest.paperExperience=experienceAssessment(experience,clock());if(team)team.learning={paperExperience:latest.paperExperience,liveLessons:latest.learning.counts,entryRestrictions:out.decisions.filter(d=>['LOSS_REENTRY_COOLDOWN','PAPER_EXPERIENCE_COOLDOWN'].includes(d.reason)).map(d=>({symbol:d.symbol,strategy:d.strategy,reason:d.reason,learning:d.learning}))};}
     latest.capitalAdvice=riskOnly?refreshCapitalAdvice(latest.capitalAdvice,capitalContext):capitalAdvice(capitalContext);
     if(!riskOnly&&team){team.capitalAdvice=latest.capitalAdvice;const reviewer=team.reviews.find(r=>r.role==='Portfolio Auditor');if(reviewer)reviewer.summary=reviewer.reason=reviewer.summary+' · '+latest.capitalAdvice.headline;}
    }else latest={...latest,at:clock(),mode:'LIVE_LOCKED',health:'OK',reason:'AWAITING_LIVE_ACCEPTANCE_AND_OWNER_ACTIVATION',accounting:'NO_LIVE_CAPITAL_ALLOCATED',lane};
    if(!await checkpoint()){results.push({committed:false,reason:'REVISION_CHANGED'});continue;}
    for(const intent of intents){
     const o=state.orders.find(x=>x.id===(intent.order?.id||intent.id));
     const ticket={uid:row.user_id,lease:row.lease,revision:row.revision,id:o.id,action:intent.action,dispatched:false};
     try{
      if(intent.action==='PLACE'){
       const answer=await signed(pair,'POST',o.side==='BUY'?'/api/v3/market/place-bid':'/api/v3/market/place-ask',exchangeBody(o),ticket);
       const id=String(answer.result?.id||'');if(!id||id.length>128)throw Error('EXCHANGE_ACK_WITHOUT_ORDER_ID');
       o.exchangeId=id;o.status='OPEN';o.acceptedAt=clock();
      }else{
       await signed(pair,'POST','/api/v3/market/cancel-order',{sym:o.symbol.toLowerCase(),id:o.exchangeId,sd:o.side==='BUY'?'buy':'sell'},ticket);
       o.status='CANCEL_PENDING';o.lastCancelAt=clock();
      }
     }catch(e){
      if(intent.action==='PLACE')o.status=ticket.dispatched&&!e.exchangeRejected?'UNKNOWN':'REJECTED';
      else if(ticket.dispatched){o.status='CANCEL_PENDING';o.lastCancelAt=clock();}
      o.lastError=safeError(e);error=o.lastError;latest.health='SAFE_MODE';latest.reason=error;
     }
     if(ticket.dispatched)row.revision=ticket.revision;
     latest.at=clock();if(!await checkpoint())break;
     if(error)break;
    }
    results.push({committed:true,mode:row.mode,ordersAttempted:intents.length,health:latest.health,reason:latest.reason});
   }catch(e){
    error=safeError(e);pf={...pf,ok:false,reason:error,at:clock()};
    latest={...latest,at:clock(),mode:row.mode,health:'SAFE_MODE',reason:error,lane,accounting:state?'EXCHANGE_RECEIPTS':'NO_LIVE_CAPITAL_ALLOCATED'};
    latest.capitalAdvice=refreshCapitalAdvice(latest.capitalAdvice,{state,wallet:pf.wallet,bundle:null,now:clock(),mode:row.mode,health:'SAFE_MODE',entriesPermitted:false});
    await checkpoint();results.push({committed:false,health:'SAFE_MODE',reason:error});
   }finally{await rpc('rea_live_release',{p_uid:row.user_id,p_lease:row.lease});}
  }return{service:'REA_LIVE',lane,processed:rows.length,results};
 }
 async function activate(uid,{confirm,acceptRisk,noWithdraw,budget,policy='STANDARD',acceptIncomplete=false}){
  if(confirm!==LIVE_CONFIRM||acceptRisk!==true||noWithdraw!==true)throw Error('OWNER_LIVE_CONFIRMATION_REQUIRED');
  const limited=policy===LIMITED_POLICY;
  if(!['STANDARD',LIMITED_POLICY].includes(policy)||limited&&acceptIncomplete!==true||!Number.isFinite(budget)||budget<10||budget>(limited?100:10000))throw Error('INVALID_LIVE_BUDGET_OR_ACKNOWLEDGEMENT');
  const pair=await keys(uid),pf=await preflight(uid,pair),view=await rpc('rea_live_view',{p_uid:uid});
  if(!(limited?view?.readiness?.limited?.ready:view?.readiness?.ready))return{activated:false,readiness:view?.readiness};
  if(pf.at-clock()>5000||clock()-pf.at>20000||pf.keyFingerprint!==view.preflight.keyFingerprint)throw Error('LIVE_PREFLIGHT_CHANGED');
  if(budget>pf.wallet.THB.available)throw Error('INSUFFICIENT_REAL_THB');
  const state=initialLive(budget,clock(),policy);
  if(limited)state.ownerAcknowledgement={acceptIncomplete:true,noWithdraw:true,acceptRisk:true};
  return rpc('rea_live_control',{p_uid:uid,p_action:'activate',p_confirm:confirm,p_state:state});
 }
 return{run,activate,view:uid=>rpc('rea_live_view',{p_uid:uid}),control:(uid,action,confirm='')=>rpc('rea_live_control',{p_uid:uid,p_action:action,p_confirm:confirm,p_state:null})};
}
