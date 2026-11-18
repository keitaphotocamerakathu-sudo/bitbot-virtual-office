import {cycleREA,analyticsREA} from './rea-core.mjs';
import {reviewTeam} from './rea-review-team.mjs';
const ROLES=['Market Scanner','Technical Analyst','News Analyst','Strategy Agent','Risk Manager','Execution Engine','Supervisor & Auditor'];
export function createREAService({rpc,marketService,clock=()=>Date.now(),runtime='SUPABASE_CRON',advisor=null}){
 async function run(uid=null){
  const rows=await rpc('rea_claim',{p_uid:uid});const results=[];
  for(const row of rows){
   let bundle=null,error=null;const began=clock();
   try{const held=[...new Set([...row.state.positions.map(p=>p.symbol),...row.state.orders.filter(o=>['OPEN','PARTIAL'].includes(o.status)).map(o=>o.symbol)])];bundle=await marketService.scan(held);}catch(e){error=String(e.message||'MARKET_UNAVAILABLE').slice(0,160);}
   const now=clock(),analysis=reviewTeam({bundle,state:row.state,now,timings:{pipelineMs:now-began,scanMs:now-began,walletReads:0}});bundle=analysis.bundle;let out;
   try{out=cycleREA(row.state,bundle,now,{operationalLock:row.operational_lock===true});}catch(e){error=String(e.message||'STATE_INVALID').slice(0,160);out={state:row.state,events:[{kind:'SAFE_MODE',reason:error}],signals:[],fills:[],ranking:[],health:'SAFE_MODE'};}
   const latest={at:now,durationMs:now-began,health:error?'SAFE_MODE':out.health,mode:'PAPER_ONLY',error,summary:analyticsREA(out.state),ranking:out.ranking,decisions:out.signals,events:out.events,universe:bundle?.universeCount||0,
    quotes:(bundle?.markets||[]).map(m=>({symbol:m.symbol,bid:m.bid,ask:m.ask,at:m.observedAt,bookAt:m.depth?.at,news:m.news})),
    team:analysis.receipt,
    agents:[...ROLES.map(role=>({role,at:now,status:error||out.health!=='OK'?'DEGRADED':'COMPLETED',method:role==='News Analyst'?'VERIFIED_SOURCE_RULES_NO_LLM':'DETERMINISTIC',reason:role==='Execution Engine'?'PAPER_ONLY · ไม่มี Private Trading API':error||out.health==='SAFE_MODE'?'ตรวจข้อมูลที่ยังไม่พร้อมก่อนเปิดสถานะ':'บันทึกผลรอบวิเคราะห์แล้ว'})),...analysis.receipt.reviews],
    runtime,operationalLock:row.operational_lock===true,operationalReasons:row.operational_reasons||[],
    limitations:['PAPER_SIMULATION_NOT_EXCHANGE_FILL',...(runtime==='DOCKER'?[]:['MINUTE_SCHEDULER_NOT_VPS']),'LIVE_ACTIVATION_NOT_IMPLEMENTED']};
   if(advisor)try{latest.advisory=await advisor(bundle,out.ranking);}catch{latest.advisory={status:'UNAVAILABLE',canTrade:false};}
   const committed=await rpc('rea_checkpoint',{p_uid:row.user_id,p_lease:row.lease,p_revision:row.revision,p_state:out.state,p_latest:latest,p_events:out.events,p_signals:out.signals,p_fills:out.fills,p_at:now,p_error:error});
   results.push({committed,health:latest.health,signals:out.signals.length,fills:out.fills.length});
  }
  return{mode:'PAPER_ONLY',processed:rows.length,results};
 }
 return{run,view:uid=>rpc('rea_view',{p_uid:uid}),control:(uid,action)=>rpc('rea_control',{p_uid:uid,p_action:action})};
}
