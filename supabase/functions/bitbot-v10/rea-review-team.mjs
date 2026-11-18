// Independent deterministic reviewers share one snapshot; they never call an exchange or LLM.
import {indicators,resample} from './technical.mjs';
import {REA_LIMITS,scoreREA} from './rea-core.mjs';
import {correlationReview,CORRELATION_ROLE} from './rea-correlation.mjs';
import {lossReview,LOSS_ROLE} from './rea-loss-diagnostics.mjs';
export const REVIEW_ROLES=['Data Integrity Auditor','Liquidity Reviewer','Multi-timeframe Analyst','Signal Challenger','Cost & Exit Reviewer','Portfolio Auditor','Performance Monitor',CORRELATION_ROLE,LOSS_ROLE];
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const active=o=>['RESERVED','SUBMITTING','OPEN','PARTIAL','CANCEL_PENDING','UNKNOWN'].includes(o.status);
const round=x=>Math.round(x*10000)/10000;
const sample=xs=>xs.slice(0,4);
function bookRows(rows){return Array.isArray(rows)?rows.map(r=>({price:Number(r?.price??r?.[0]),qty:Number(r?.base_volume??r?.[1])})):[];}
function integrity(m,now){
 const problems=[],bars=Array.isArray(m.candles)?m.candles:[],recent=bars.slice(-50);
 if(!recent.length)problems.push('MISSING_CANDLES');
 if(recent.some(b=>!finite(b.t)||b.t+300000>now||![b.c,b.h,b.l,b.o??b.c].every(finite)||Math.min(b.c,b.l,b.o??b.c)<=0||b.h<Math.max(b.c,b.o??b.c)||b.l>Math.min(b.c,b.o??b.c)||b.h<b.l||b.v!=null&&(!finite(b.v)||b.v<0)))problems.push('INVALID_OR_UNCLOSED_OHLCV');
 if(recent.some((b,i)=>i&&b.t-recent[i-1].t!==300000))problems.push('RECENT_BAR_GAP_OR_DUPLICATE');
 const asks=bookRows(m.depth?.asks),bids=bookRows(m.depth?.bids);
 if(!asks.length||!bids.length||[...asks,...bids].some(r=>!finite(r.price)||!finite(r.qty)||r.price<=0||r.qty<=0))problems.push('INVALID_BOOK_ROWS');
 const last=bars.at(-1)?.c;if(finite(last)&&finite(m.ask)&&last>0&&(m.ask/last>=10||m.ask/last<=.1))problems.push('PRICE_UNIT_OR_EXTREME_GAP');
 return{symbol:m.symbol,problems};
}
export function reviewTeam({bundle,state,wallet=null,now=Date.now(),timings={}}){
 const markets=Array.isArray(bundle?.markets)?bundle.markets:[],checks=markets.map(m=>integrity(m,now)),bad=checks.filter(c=>c.problems.length),badSymbols=new Set(bad.map(c=>c.symbol));
 const guarded=bundle?{...bundle,markets:markets.map(m=>badSymbols.has(m.symbol)?{...m,dataQuality:{...m.dataQuality,ready:false,reviewReasons:checks.find(c=>c.symbol===m.symbol).problems}}:m)}:bundle;
 const review=(role,status,summary,evidence)=>({role,status,summary,reason:summary,evidence,at:now,method:'DETERMINISTIC_SHARED_SNAPSHOT',reviewId:role.replaceAll(' ','_')+':'+now});
 const waiting=markets.length===0,rows=[];
 rows.push(review(REVIEW_ROLES[0],waiting?'WAITING':bad.length?'DEGRADED':'COMPLETED',waiting?'รอข้อมูลตลาด':'ตรวจ '+markets.length+' คู่ · กันข้อมูลผิดรูปแบบ '+bad.length+' คู่',{markets:markets.length,blocked:bad.length,examples:sample(bad)}));
 const liquidity=markets.map(m=>{const asks=bookRows(m.depth?.asks),max=m.ask*(1+REA_LIMITS.slippage),capacity=asks.filter(r=>r.price<=max&&r.qty>0).reduce((v,r)=>v+r.price*r.qty,0),spread=finite(m.bid)&&finite(m.ask)&&m.ask>0?(m.ask-m.bid)/m.ask:null;return{symbol:m.symbol,spread:spread===null?null:round(spread),capacityTHB:finite(capacity)?round(capacity):null,spreadOK:spread!==null&&spread>=0&&spread<=REA_LIMITS.maxSpread,bookAt:m.depth?.at??null};});
 const thin=liquidity.filter(x=>!x.spreadOK||!(x.capacityTHB>0));
 rows.push(review(REVIEW_ROLES[1],waiting?'WAITING':thin.length?'DEGRADED':'COMPLETED',waiting?'รอสมุดคำสั่ง':'ตรวจ Spread และเงินในฝั่งขาย '+markets.length+' คู่ · ต้องระวัง '+thin.length+' คู่',{flagged:thin.length,examples:sample(thin.length?thin:liquidity)}));
 const frames=markets.map(m=>{const five=indicators(m.candles||[],5,now),fifteen=indicators(resample(m.candles||[],15,now),15,now),hour=indicators(resample(m.candles||[],60,now),60,now);return{symbol:m.symbol,five:five.ready?five.regime:'INSUFFICIENT',fifteen:fifteen.ready?fifteen.regime:'INSUFFICIENT',hour:hour.ready?hour.regime:'INSUFFICIENT',comparable:five.ready&&fifteen.ready,conflict:five.ready&&fifteen.ready&&['UPTREND','DOWNTREND'].includes(five.regime)&&['UPTREND','DOWNTREND'].includes(fifteen.regime)&&five.regime!==fifteen.regime};});
 rows.push(review(REVIEW_ROLES[2],frames.some(f=>f.comparable)?'COMPLETED':'WAITING','เทียบกรอบ 5/15 นาทีได้ '+frames.filter(f=>f.comparable).length+'/'+markets.length+' คู่ · เห็นต่าง '+frames.filter(f=>f.conflict).length+' คู่',{source:'RESAMPLED_COMPLETE_5_MINUTE_BARS',conflicts:frames.filter(f=>f.conflict).length,examples:sample(frames)}));
 const signals=markets.map(m=>{try{const r=scoreREA(m,now);return{symbol:m.symbol,strategy:r.strategy,eligible:r.eligible,score:r.score,objections:r.reasons,stopDistance:r.stopDistance};}catch{return{symbol:m.symbol,strategy:null,eligible:false,objections:['ANALYSIS_INVALID'],stopDistance:null};}});
 rows.push(review(REVIEW_ROLES[3],waiting?'WAITING':'COMPLETED','ทักท้วงสัญญาณ '+signals.length+' คู่ · มีชุดสัญญาณสมบูรณ์ '+signals.filter(s=>s.eligible).length+' คู่',{qualified:signals.filter(s=>s.eligible).length,examples:sample(signals.map(s=>({symbol:s.symbol,strategy:s.strategy,objections:s.objections.slice(0,5)})))}));
 const costs=signals.filter(s=>finite(s.stopDistance)).map(s=>{const friction=REA_LIMITS.fee*2+REA_LIMITS.slippage,reward=s.stopDistance*2-friction,risk=s.stopDistance+friction;return{symbol:s.symbol,roundTripFee:REA_LIMITS.fee*2,slippage:REA_LIMITS.slippage,netRewardFraction:round(reward),modeledRiskFraction:round(risk),netRewardToRisk:round(reward/risk)};});
 rows.push(review(REVIEW_ROLES[4],costs.length?'COMPLETED':'WAITING','ตรวจต้นทุนค่าธรรมเนียมและระยะจุดออก '+costs.length+' คู่',{assumption:'MODEL_ALLOWANCE_NOT_A_PROFIT_FORECAST',examples:sample(costs)}));
 const positions=Array.isArray(state?.positions)?state.positions:[],pending=(state?.orders||[]).filter(o=>active(o)&&o.side==='BUY'),slots=new Set([...positions.map(p=>p.symbol),...pending.map(o=>o.symbol)]).size,exposure=positions.reduce((n,p)=>n+(finite(p.cost)?p.cost:0),0)+pending.reduce((n,o)=>n+Math.max(0,finite(o.reserved)?o.reserved:finite(o.remaining)?o.remaining:(o.amount||0)-(o.executed||0)),0);
 rows.push(review(REVIEW_ROLES[5],!state?'WAITING':slots>2?'DEGRADED':'COMPLETED','ตรวจพอร์ต '+positions.length+' สถานะ · รวมซื้อค้าง '+slots+'/2 ช่อง',{positions:positions.length,pendingBuys:pending.length,slots,exposureTHB:round(exposure),botCash:finite(state?.cash)?state.cash:null,walletTHB:finite(wallet?.THB?.available)?wallet.THB.available:null,readOnly:true}));
 const measured=Object.fromEntries(Object.entries(timings).filter(([,v])=>finite(v)&&v>=0)),slow=Object.values(measured).some(v=>v>20000);
 rows.push(review(REVIEW_ROLES[6],Object.keys(measured).length?slow?'DEGRADED':'COMPLETED':'WAITING',Object.keys(measured).length?'วัดเวลา Backend · ก่อนส่งแผน '+Math.round(measured.pipelineMs||0)+' ms · อ่าน Wallet '+(measured.walletReads??'—')+' ครั้ง':'รอเวลาที่วัดจาก Backend',{...measured,privateReadMode:finite(measured.preflightMs)?'PARALLEL_WALLET_AND_OPEN_ORDERS':'NOT_USED',accuracyClaim:'NOT_A_WIN_RATE'}));
 rows.push(correlationReview({bundle:guarded,state,signals,now}),lossReview({bundle:guarded,state,now}));
 return{bundle:guarded,receipt:{version:'24.0.0',at:now,method:'DETERMINISTIC_SHARED_SNAPSHOT',reviewers:rows.length,blockedSymbols:[...badSymbols],reviews:rows,timings:measured}};
}
