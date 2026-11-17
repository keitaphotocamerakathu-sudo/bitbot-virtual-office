// Explicitly selected planner. The archived v13 engine remains unchanged.
import {config,cycle,executionAgent,heldSymbol,roundUnit,rules,tickPrice} from './engine.mjs';
import {bookImpact,STABLE_ASSETS} from './intraday.mjs';
export const PLANNERS=Object.freeze(['legacy-v13','net-v16']);
export const NET_POLICY=Object.freeze({version:'16.0.0',minimumPriceStop:.0015,atrMultiple:1,rangeQuantile:.6,rangeAllowance:1.5,creditFreshMs:30000});
export function plannerConfig(input={},live=false){const c=config(input,live);if(!PLANNERS.includes(c.entryPlanner??'legacy-v13'))throw Error('สูตรเข้าออกไม่ถูกต้อง');return c;}
const fee=(amount,rate)=>Math.ceil(Math.max(0,amount)*rate*100-1e-10)/100;
function quantile(xs,q){const a=xs.slice().sort((a,b)=>a-b);return a.length?a[Math.floor((a.length-1)*q)]:null;}
export function horizonRanges(bars,minutes,now=Date.now()){
 const size=Math.ceil(minutes/5),closed=(bars||[]).filter(b=>Number.isFinite(b.t)&&b.t+300000<=now),groups=[];
 for(let end=closed.length;end-size>=0;end-=size){const a=closed.slice(end-size,end);if(a.some((b,i)=>![b.h,b.l,b.c].every(Number.isFinite)||b.l<=0||b.h<b.c||b.l>b.c||(i&&b.t-a[i-1].t!==300000)))continue;groups.push(Math.max(...a.map(b=>b.h))/Math.min(...a.map(b=>b.l))-1);}
 return{minutes,samples:groups.length,current:groups[0]??null,benchmark:quantile(groups,NET_POLICY.rangeQuantile),method:'CLOSED_NONOVERLAPPING_HORIZON_RANGES'};
}
export function netEntryPlan(m,c,notional,now=Date.now()){
 notional=Math.floor(Math.max(0,notional)*100)/100;
 const book=bookImpact(m.depth,notional,now),r=rules(m),ask=tickPrice(m.ask,r,true),spread=(m.ask-m.bid)/m.last,reasons=[];
 const credit=m.feeCredits,creditFresh=credit?.ready===true&&Number.isFinite(credit.available)&&credit.available>=0&&Number.isFinite(credit.at)&&now-credit.at<=NET_POLICY.creditFreshMs&&credit.at<=now+5000;
 const buyGrossFee=fee(notional,c.fee),entryCreditUsed=creditFresh?Math.min(buyGrossFee,credit.available):0,buyCashFee=buyGrossFee-entryCreditUsed;
 const qty=notional>buyCashFee&&ask>0?roundUnit((notional-buyCashFee)/ask,r.qtyScale):0;
 // Only entry credit observed NOW is counted. Future exit credit is always zero.
 const friction=(m.bid/m.ask)*(1-c.slippage)**2*(1-(book.buyImpact||0))*(1-(book.sellImpact||0));
 const netAt=g=>{const price=tickPrice(ask*(1+g)*friction,r,false),gross=qty*price;return(gross-fee(gross,c.fee))/notional-1;};
 const cost=notional>0&&qty>0?Math.max(0,-netAt(0)):1;
 const priceStop=Math.min(c.stopLoss,Math.max(NET_POLICY.minimumPriceStop,(m.atrPct||0)*NET_POLICY.atrMultiple));
 const netRisk=qty>0?-netAt(-priceStop):1,netReward=Math.max(c.minNetProfit,netRisk*c.minNetRR);
 let low=0,high=.5;for(let i=0;i<44;i++){const mid=(low+high)/2;if(netAt(mid)>=netReward)high=mid;else low=mid;}
 const grossTarget=high,range=horizonRanges(m.candles,c.maxHoldMinutes,now),effectiveRange=Math.max(range.current||0,range.benchmark||0),rangeBudget=effectiveRange*NET_POLICY.rangeAllowance;
 if(!(notional>=r.minQuote)||qty<=0)reasons.push('วงเงินหรือจำนวนหลังหักค่าธรรมเนียมต่ำกว่าขั้นต่ำตลาด');
 if(!book.ready)reasons.push(book.reason);else if(!book.covered||book.buyImpact>c.maxDepthImpact||book.sellImpact>c.maxDepthImpact)reasons.push('ความลึกซื้อขายไม่พอสำหรับวงเงินนี้');
 if(book.ready&&(Math.abs(book.bestAsk/m.ask-1)>c.maxDepthImpact||Math.abs(book.bestBid/m.bid-1)>c.maxDepthImpact))reasons.push('ราคาสมุดคำสั่งเปลี่ยนจากราคาเสนอ รอตรวจใหม่');
 if(STABLE_ASSETS.has(m.symbol.slice(0,-4)))reasons.push('เหรียญตรึงมูลค่าไม่เหมาะกับรอบเทรดสั้น');
 if(range.samples<3)reasons.push('ข้อมูลช่วงราคาตามเวลาถือยังไม่พอ');
 if((m.candles||[]).slice(-25).some((b,i,a)=>![b.h,b.l,b.c,b.v].every(Number.isFinite)||b.l<=0||b.h<b.c||b.l>b.c||(i&&b.t-a[i-1].t!==300000)))reasons.push('แท่งปิดล่าสุดต้องมี High/Low/Volume ต่อเนื่อง');
 if(!Number.isFinite(netRisk)||netRisk>c.stopLoss+1e-8)reasons.push('ต้นทุนและระยะหยุดเกินเพดานขาดทุนต่อสถานะที่ตั้งไว้');
 if(grossTarget>c.takeProfit+1e-8)reasons.push('เป้าราคาหลังต้นทุนเกินเพดานทำกำไรที่ตั้งไว้');
 if(!Number.isFinite(rangeBudget)||effectiveRange<cost*c.minRangeCostRatio||grossTarget>rangeBudget)reasons.push('ช่วงราคาตามเวลาถือยังไม่พอรองรับเป้าสุทธิ');
 if(netAt(grossTarget)<netReward-1e-7)reasons.push('เป้าสุทธิไม่สามารถคำนวณได้');
 return{notional,planner:'net-v16',version:NET_POLICY.version,stopLoss:netRisk,takeProfit:netReward,priceStop,netRisk,netReward,netRR:netReward/netRisk,grossTarget,cost,range:range.current,rangeBudget,horizon:range,maxHoldMinutes:c.maxHoldMinutes,book,reasons,
  feeModel:{grossEntryFee:buyGrossFee,entryCreditUsed,entryCashFee:buyCashFee,creditVerified:creditFresh,exitCreditAssumed:0,exitFeeAtTarget:fee(qty*tickPrice(ask*(1+grossTarget)*friction,r,false),c.fee),quantity:qty,method:'SATANG_ROUNDING_ENTRY_CREDIT_ONLY_EXIT_FULL_FEE'}};
}
export function adaptiveCycle(m,state,c,now=Date.now()){
 c=plannerConfig(c);const out=cycle(m,state,c,now);if(out.error)return out;
 const old=out.trace.find(t=>t.agent==='risk'),trend=out.trace.find(t=>t.agent==='trend'),proposal=out.trace.find(t=>t.agent==='strategy');
 // All held-position exits keep their frozen policy and existing execution path.
 if(state.qty>0)return out;
 const plan=netEntryPlan({...m,atrPct:trend.atrPct},c,old.wallet.maxBuy,now),economicReasons=new Set(['ช่วงราคา 1 ชั่วโมงไม่พอชดเชยต้นทุนและเป้าขาย','กำไรสุทธิเทียบความเสี่ยงหลังต้นทุนไม่ผ่านเกณฑ์']),blocked=[...new Set([...old.blocked.filter(x=>!economicReasons.has(x)),...plan.reasons])];
 let action=proposal.signal==='BUY'?'BUY':'HOLD',notional=old.wallet.maxBuy;
 const minimum=Math.ceil(rules(m).minQuote*(1+c.stopLoss*2+c.fee*2)*100)/100;
 if(notional<minimum)blocked.push('วงเงินหลังสำรองต่ำกว่าขั้นต่ำที่ขายออกได้: '+minimum+' บาท');
 if(blocked.length||state.halted||spreadInvalid(m,c))action='HOLD';if(action==='HOLD')notional=0;
 const risk={...old,action,notional,plan,blocked,reason:blocked.join(' • ')||'ผ่านกระเป๋า ข่าว สัญญาณ และเป้าสุทธิที่คำนวณตามเวลาถือ'};
 const execution=executionAgent(m,out.state,risk);out.order=execution.order?{...execution.order,strategy:proposal.strategy,reason:proposal.reason}:null;
 out.trace=out.trace.map(t=>t.agent==='risk'?risk:t.agent==='execution'?execution:t);return out;
}
const spreadInvalid=(m,c)=>(m.ask-m.bid)/m.last>c.maxSpread;
export function adaptivePortfolioCycle(bundle,state,c,now=Date.now()){
 const held=heldSymbol(state),pool=(bundle?.markets||[]).filter(m=>!held||m.symbol===held),ranked=pool.map(m=>{const out=adaptiveCycle(m,state,c,now),risk=out.trace.find(t=>t.agent==='risk'),trend=out.trace.find(t=>t.agent==='trend');const score=(m.preScore||0)+(trend?.bias==='UP'?35:0)+(out.order?.side==='BUY'?15:0);return{m,out,risk,score};}).sort((a,b)=>Number(b.out.order?.side==='BUY')-Number(a.out.order?.side==='BUY')||b.score-a.score),chosen=ranked[0];
 if(!chosen)return{state:structuredClone(state),order:null,error:'ไม่มีข้อมูลตลาดพร้อมวิเคราะห์',trace:[],market:null,ranking:[]};
 const ranking=ranked.slice(0,12).map(x=>({symbol:x.m.symbol,score:x.score,signal:x.out.order?.side||'HOLD',reasons:x.risk?.blocked?.length?x.risk.blocked:[x.out.error||x.out.trace.find(t=>t.agent==='strategy')?.reason||'รอจังหวะ']}));
 const coordinator={agent:'coordinator',reason:'สูตรสุทธิตามเวลาถือ • คัดกรอง '+(bundle.universeCount||pool.length)+' คู่ / วิเคราะห์ '+pool.length+' คู่ / เลือก '+chosen.m.symbol,selected:chosen.m.symbol,ranking,universeCount:bundle.universeCount||pool.length};
 return{...chosen.out,market:chosen.m,ranking,trace:chosen.out.trace.map(t=>t.agent==='coordinator'?coordinator:t)};
}
