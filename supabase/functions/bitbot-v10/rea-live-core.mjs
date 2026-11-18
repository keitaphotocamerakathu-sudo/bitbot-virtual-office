// Live accounting is driven exclusively by exchange per-fill receipts.
// This module never calls the paper fill simulator.
import {codexPlan} from './rea-codex-policy.mjs';
import {initialREA,REA_LIMITS,scoreREA,quoteOK,riskSizeREA,markREA,dayKey,analyticsREA} from './rea-core.mjs';
import {tickPrice,roundUnit,validSymbol,assetOf} from './engine.mjs';
import {entryEvidence,exitEvidence,lossReentryGuard,paperExperienceGuard} from './rea-learning.mjs';
export const LIVE_SPEC='REA-LIVE-19.0';
export const LIVE_CONFIRM='เปิดซื้อขายจริง Bitkub';
export const LIMITED_POLICY='OWNER_LIMITED_LIVE';
export const LIMITED_SPEC='REA-LIMITED-19.1';
export const liveActive=o=>['RESERVED','SUBMITTING','OPEN','PARTIAL','CANCEL_PENDING','UNKNOWN'].includes(o.status);
const money=n=>Math.round((n+Number.EPSILON)*100)/100;
const down=n=>Math.floor((n+1e-9)*100)/100;
const fraction=o=>Math.max(0,o.amount-(o.executed||0));
export function initialLive(capital,now=Date.now(),policy='STANDARD'){
 if(!['STANDARD',LIMITED_POLICY].includes(policy)||!Number.isFinite(capital)||capital<10||capital>(policy===LIMITED_POLICY?100:10000)||Math.abs(capital-down(capital))>1e-7)throw Error('INVALID_LIVE_CAPITAL');
 return{...initialREA(now),mode:'LIVE',policy,cash:capital,equity:capital,dayStart:capital,peak:capital,allocatedCapital:capital,accounting:'EXCHANGE_RECEIPTS',lastAt:now};
}
export function liveLimits(s){
 const limited=s.policy===LIMITED_POLICY,base=Math.min(10000,s.dayStart,s.equity,...(limited?[s.allocatedCapital]:[]));
 return{riskBudget:down(Math.min(100,Math.max(0,base)*.01)),dailyLossLimit:down(Math.min(300,s.dayStart*.03,...(limited?[s.allocatedCapital*.03]:[]))),maxPosition:limited?down(s.allocatedCapital*.4):4000,maxExposure:limited?down(s.allocatedCapital*.8):8000};
}
export function riskProjection(s){
 return{...s,orders:s.orders.map(o=>({...o,status:liveActive(o)?'OPEN':o.status,remaining:fraction(o),reserved:o.side==='BUY'&&liveActive(o)?fraction(o):0}))};
}
export function validateLive(s){
 if(s?.mode!=='LIVE'||s.accounting!=='EXCHANGE_RECEIPTS'||!['STANDARD',LIMITED_POLICY].includes(s.policy||'STANDARD')||!Number.isFinite(s.cash)||s.cash<-.02||!Number.isFinite(s.allocatedCapital)||s.allocatedCapital>10000||s.allocatedCapital<10||s.policy===LIMITED_POLICY&&s.allocatedCapital>100)throw Error('INVALID_LIVE_LEDGER');
 if(new Set(s.orders.map(o=>o.id)).size!==s.orders.length||new Set(s.positions.map(p=>p.symbol)).size!==s.positions.length)throw Error('DUPLICATE_LIVE_STATE');
 if(s.positions.some(p=>!validSymbol(p.symbol)||![p.qty,p.cost,p.stop,p.target].every(Number.isFinite)||p.qty<=0||p.cost<=0))throw Error('INVALID_LIVE_POSITION');
 const slots=new Set([...s.positions.map(p=>p.symbol),...s.orders.filter(o=>liveActive(o)&&o.side==='BUY').map(o=>o.symbol)]);
 if(slots.size>2)throw Error('LIVE_POSITION_LIMIT');
 return s;
}
export function markLive(state,markets,now=Date.now()){
 const s=structuredClone(validateLive(state)),equity=markREA(s,markets,now),today=dayKey(now);
 if(today!==s.day){
  s.days[s.day]={equity:s.equity,start:s.dayStart,flows:s.dayFlows,pnl:s.dayPnl,locked:s.dailyLocked};
  s.day=today;s.dayFlows=0;s.dayStart=equity??s.equity;
  s.baselinePending=equity===null||s.positions.length>0&&(!s.lastAt||now-s.lastAt>90000);
  if(!s.baselinePending&&s.kill==='NONE')s.dailyLocked=false;
 }
 if(equity===null)return{state:s,healthy:false,reason:'LIVE_POSITION_PRICE_STALE'};
 s.equity=equity;s.dayPnl=money(equity-s.dayStart-s.dayFlows);
 s.peak=Math.max(s.peak,equity);s.maxDrawdown=Math.max(s.maxDrawdown,1-equity/s.peak);
 if(s.dayPnl<=-liveLimits(s).dailyLossLimit)s.dailyLocked=true;
 s.lastAt=now;return{state:s,healthy:!s.baselinePending,reason:s.baselinePending?'MIDNIGHT_BASELINE_UNVERIFIED':null};
}
export function walletMatches(s,w,now=Date.now()){
 if(!w||!Number.isFinite(w.at)||now-w.at>20000||w.at>now+5000||!w.THB)return false;
 if(w.THB.available+w.THB.reserved+.1<s.cash)return false;
 return s.positions.every(p=>{const a=w[assetOf(p.symbol)];return a&&a.available+a.reserved+1e-8>=p.qty;});
}
export function liveSummary(s){return s?{...analyticsREA(riskProjection(s)),...liveLimits(s),policy:s.policy||'STANDARD'}:null;}
export function applyExchangeInfo(state,orderId,info,now=Date.now()){
 const s=structuredClone(validateLive(state)),o=s.orders.find(x=>x.id===orderId),fills=[];
 if(!o||!info||!Array.isArray(info.history)||!['filled','unfilled','cancelled','canceled'].includes(String(info.status).toLowerCase()))throw Error('EXCHANGE_ORDER_INFO_INVALID');
 if(info.client_id&&info.client_id!==o.clientId)throw Error('EXCHANGE_CLIENT_ID_MISMATCH');
 const history=info.history.slice().sort((a,b)=>Number(a.timestamp)-Number(b.timestamp));
 const ids=new Set(),sum=history.reduce((total,f)=>{
  const id=String(f.txn_id||''),amount=Number(f.amount),price=Number(f.rate),grossFee=Number(f.fee),credit=Number(f.credit??0),at=Number(f.timestamp);
  if(!id||ids.has(id)||![amount,price,grossFee,credit,at].every(Number.isFinite)||amount<=0||price<=0||grossFee<0||credit<0||credit>grossFee+.000001||at<o.createdAt-60000||at>now+5000)throw Error('EXCHANGE_FILL_INVALID');
  ids.add(id);return total+amount;
 },0);
 const reported=Number(info.filled),remaining=Number(info.remaining);
 if(!Number.isFinite(reported)||!Number.isFinite(remaining)||reported<0||remaining<0||Math.abs(sum-reported)>Math.max(.02,Math.abs(reported)*1e-7)||sum>o.amount+Math.max(.02,o.amount*1e-7))throw Error('EXCHANGE_FILL_TOTAL_MISMATCH');
 // History truncation or replacement cannot erase already applied fills.
 if((o.appliedTxnIds||[]).some(id=>!ids.has(id)))throw Error('EXCHANGE_HISTORY_INCOMPLETE');
 o.appliedTxnIds??=[];
 for(const f of history){
  const id=String(f.txn_id);if(o.appliedTxnIds.includes(id))continue;
  const amount=Number(f.amount),price=Number(f.rate),paidFee=Number(f.fee)-Number(f.credit??0),at=Number(f.timestamp);
  const qty=o.side==='BUY'?roundUnit((amount-paidFee)/price,o.qtyScale):amount;
  if(!(qty>0))throw Error('EXCHANGE_FILL_DUST');
  const receipt={id,orderId:o.id,exchangeId:o.exchangeId,symbol:o.symbol,side:o.side,qty,price,fee:paidFee,at,realized:0,simulation:false};
  if(o.side==='BUY'){
   if(amount>s.cash+.02)throw Error('LIVE_OVERSPEND');
   s.cash=money(s.cash-amount);
   let p=s.positions.find(p=>p.symbol===o.symbol);
   if(!p){p={symbol:o.symbol,qty:0,cost:0,stop:o.stop,target:o.target,positionId:o.id,openedAt:at,strategy:o.strategy,realized:0};s.positions.push(p);}
   p.qty=roundUnit(p.qty+qty,o.qtyScale);p.cost=money(p.cost+amount);
  }else{
   const p=s.positions.find(p=>p.symbol===o.symbol);if(!p||qty>p.qty+1e-8)throw Error('LIVE_OVERSELL');
   const basis=p.cost*qty/p.qty,proceeds=amount*price-paidFee;receipt.realized=money(proceeds-basis);
   s.cash=money(s.cash+proceeds);s.realized=money(s.realized+receipt.realized);
   p.realized=money(p.realized+receipt.realized);p.qty=roundUnit(Math.max(0,p.qty-qty),o.qtyScale);p.cost=money(Math.max(0,p.cost-basis));
   if(p.qty<10**-o.qtyScale){s.closed.push({id:p.positionId,symbol:p.symbol,pnl:p.realized,openedAt:p.openedAt,closedAt:at});s.positions=s.positions.filter(x=>x!==p);}
  }
  o.appliedTxnIds.push(id);s.fees=money(s.fees+paidFee);s.fills.push(receipt);fills.push(receipt);
 }
 o.executed=sum;o.remaining=remaining;o.updatedAt=now;
 const status=String(info.status).toLowerCase();
 o.status=status==='filled'?'FILLED':['cancelled','canceled'].includes(status)?'CANCELED':sum>0?'PARTIAL':'OPEN';
 if(o.status==='FILLED'&&remaining>Math.max(.02,o.amount*1e-7))throw Error('EXCHANGE_TERMINAL_REMAINING');
 validateLive(s);return{state:s,fills};
}
function orderBase(s,m,side,id,now){
 return{id,clientId:'rea19-'+id.replaceAll('-','').slice(0,24),symbol:m.symbol,side,qtyScale:m.rules.qtyScale,status:'RESERVED',createdAt:now,executed:0,appliedTxnIds:[],quoteAt:m.observedAt,exchangeId:null};
}
export function planLive(state,bundle,wallet,now=Date.now(),{entries=false,operationalLock=false,brain=null,experience=null,id=()=>crypto.randomUUID()}={}){
 const marked=markLive(state,bundle?.markets||[],now),s=marked.state,markets=bundle?.markets||[],intents=[],decisions=[];
 const unknown=s.orders.some(o=>['UNKNOWN','SUBMITTING'].includes(o.status)),walletOK=walletMatches(s,wallet,now);
 const healthy=marked.healthy&&walletOK&&!unknown;
 if(s.kill==='ALL')return{state:s,intents,decisions,healthy,reason:'EMERGENCY_STOP'};
 const cancelBuys=s.dailyLocked||s.buyPaused||s.kill==='ENTRY'||!healthy||operationalLock;
 for(const o of s.orders.filter(liveActive)){
  if(o.exchangeId&&o.status!=='CANCEL_PENDING'&&(now-o.createdAt>=120000||o.side==='BUY'&&cancelBuys))intents.push({action:'CANCEL',id:o.id,reason:cancelBuys?'ENTRY_SAFETY_LOCK':'ORDER_TIMEOUT'});
 }
 // Read-only reconciliation can continue under any lock. Unknown writes block new writes.
 if(!walletOK||unknown)return{state:s,intents:unknown?[]:intents,decisions,healthy:false,reason:unknown?'UNKNOWN_ORDER_REQUIRES_RECONCILIATION':'WALLET_RECONCILIATION_REQUIRED'};
 for(const p of s.positions){
  const m=markets.find(m=>m.symbol===p.symbol);
  if(!quoteOK(m,now)||m.sellFrozen||m.status!=='active'||!m.rules||s.orders.some(o=>liveActive(o)&&o.symbol===p.symbol))continue;
  const reason=m.bid<=p.stop?'STOP_LOSS':m.bid>=p.target?'TAKE_PROFIT':null;if(!reason)continue;
  const prior=s.orders.findLast(o=>o.side==='SELL'&&o.symbol===p.symbol&&o.positionId===p.positionId&&o.status==='CANCELED'&&o.reason==='STOP_LOSS');
  const type=reason==='STOP_LOSS'&&(m.bid<=p.stop*.98||prior)?'market':'limit';
  const amount=roundUnit(Math.min(p.qty,wallet[assetOf(p.symbol)]?.available||0),m.rules.qtyScale);
  if(amount<=0||amount*m.bid<m.rules.minQuote)continue;
  const o={...orderBase(s,m,'SELL',id(),now),positionId:p.positionId,amount,remaining:amount,type,limit:type==='market'?0:tickPrice(m.bid*(1-REA_LIMITS.slippage),m.rules,false),reason,strategy:p.strategy,exitEvidence:exitEvidence(p,m,reason,now)};
  s.orders.push(o);intents.push({action:'PLACE',order:o});
 }
 if(entries&&healthy&&!operationalLock&&!s.buyPaused&&!s.dailyLocked&&s.kill==='NONE'){
  const policy=codexPlan(brain,now),priority=s=>policy.priority.includes(s)?policy.priority.length-policy.priority.indexOf(s):0;
  const ranking=markets.map(m=>scoreREA(m,now)).sort((a,b)=>priority(b.symbol)-priority(a.symbol)||b.score-a.score);
  for(const r of ranking){
   const m=markets.find(m=>m.symbol===r.symbol),risk=riskProjection(s),limits=liveLimits(s),slots=new Set([...s.positions.map(p=>p.symbol),...s.orders.filter(o=>liveActive(o)&&o.side==='BUY').map(o=>o.symbol)]);
   if(s.policy===LIMITED_POLICY)risk.dayStart=Math.min(risk.dayStart,s.allocatedCapital);
   const ownLesson=lossReentryGuard(s,r.symbol,r.strategy,now),paperLesson=paperExperienceGuard(experience,r.symbol,r.strategy,now),lesson=ownLesson.blocked?ownLesson:paperLesson;
   let reason=!r.eligible?r.reasons.join(','):slots.has(r.symbol)?'SYMBOL_BUSY':slots.size>=2?'MAX_POSITIONS':s.seen[r.symbol]>=r.signalAt?'SIGNAL_ALREADY_USED':ownLesson.blocked?ownLesson.reason:paperLesson.blocked?paperLesson.reason:policy.avoid.includes(r.symbol)?'CODEX_AVOID_ENTRY':null;
   const size=!reason?riskSizeREA(risk,{stopDistance:r.stopDistance,minQuote:m.rules.minQuote},markets,now):null;
   if(size&&!size.notional)reason=size.reason;
   const decision={symbol:r.symbol,strategy:r.strategy,score:r.score,factors:r.factors,indicators:r.indicators,reference:r.reference,priceAt:r.priceAt,signalId:r.symbol+':'+r.signalAt+':'+r.strategy,at:now,approved:false,reason,learning:{checked:true,...(lesson.blocked?{restriction:lesson}:{paperReason:paperLesson.reason})},...(policy.state==='ACTIVE'?{codex:{sessionId:policy.sessionId,action:policy.actions.find(a=>a.symbol===r.symbol)?.action||'NUMERICAL_FALLBACK',reason:policy.actions.find(a=>a.symbol===r.symbol)?.reason||'ไม่พบข้อเสนอเฉพาะเหรียญ ใช้กลยุทธ์เชิงตัวเลข'}}:{})};decisions.push(decision);
   if(reason)continue;
   const maxPrice=m.ask*(1+REA_LIMITS.slippage),limit=tickPrice(maxPrice,m.rules,false);
   if(limit<m.ask){decision.reason='PRICE_TICK_EXCEEDS_CHASE_LIMIT';continue;}
   const pending=s.orders.filter(o=>liveActive(o)&&o.side==='BUY'),exposure=s.positions.reduce((v,p)=>v+p.cost,0)+pending.reduce((v,o)=>v+fraction(o),0);
   const symbolExposure=s.positions.filter(p=>p.symbol===r.symbol).reduce((v,p)=>v+p.cost,0)+pending.filter(o=>o.symbol===r.symbol).reduce((v,o)=>v+fraction(o),0);
   const amount=down(Math.min(size.notional,limits.maxExposure-exposure,limits.maxPosition-symbolExposure,wallet.THB.available-pending.reduce((a,o)=>a+fraction(o),0)));
   if(amount<m.rules.minQuote){decision.reason='AVAILABLE_WALLET_TOO_SMALL';continue;}
   const o={...orderBase(s,m,'BUY',id(),now),amount,remaining:amount,type:'limit',limit,stop:limit*(1-r.stopDistance),target:limit*(1+r.stopDistance*2),riskFraction:size.riskFraction,modeledLoss:money(amount*size.riskFraction+.10),reason:'RISK_APPROVED',signalId:decision.signalId,strategy:r.strategy,entryEvidence:entryEvidence(r,m,now),learning:decision.learning};
   s.orders.push(o);s.seen[r.symbol]=r.signalAt;decision.reason='RISK_APPROVED';decision.approved=true;intents.push({action:'PLACE',order:o});
  }
 }
 validateLive(s);return{state:s,intents,decisions,healthy,reason:marked.reason||(!walletOK?'WALLET_RECONCILIATION_REQUIRED':null)};
}
export function exchangeBody(o){
 if(!validSymbol(o.symbol)||!['BUY','SELL'].includes(o.side)||!['limit','market'].includes(o.type)||!Number.isFinite(o.amount)||!(o.amount>0)||!Number.isFinite(o.limit)||o.side==='BUY'&&o.type!=='limit')throw Error('INVALID_EXCHANGE_ORDER');
 return{sym:o.symbol.toLowerCase(),amt:o.amount,rat:o.limit,typ:o.type,client_id:o.clientId};
}
