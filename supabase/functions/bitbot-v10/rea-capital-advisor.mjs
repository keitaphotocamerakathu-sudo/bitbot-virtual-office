// Read-only capital readiness advice. No credentials, network, LLM, orders or setting writes.
import {REA_LIMITS,scoreREA,riskSizeREA} from './rea-core.mjs';
import {liveLimits,riskProjection,walletMatches,liveActive,LIMITED_POLICY} from './rea-live-core.mjs';
import {tickPrice} from './engine.mjs';
const finite=Number.isFinite,down=n=>Math.floor((n+1e-9)*100)/100,up=n=>Math.max(0,Math.ceil((n-1e-9)*100)/100);
const remaining=o=>Math.max(0,o.amount-(o.executed||0));
const thb=n=>n.toLocaleString('th-TH',{minimumFractionDigits:2,maximumFractionDigits:2})+' บาท';
function financials(s,w){
 const limits=liveLimits(s),pending=s.orders.filter(o=>liveActive(o)&&o.side==='BUY'),reserved=down(pending.reduce((n,o)=>n+remaining(o),0)),botFree=down(Math.max(0,s.cash-reserved));
 return{...limits,allocatedCapital:s.allocatedCapital,equity:s.equity,dayPnl:s.dayPnl,botFreeTHB:botFree,walletAvailableTHB:finite(w?.THB?.available)?w.THB.available:null,walletReservedTHB:finite(w?.THB?.reserved)?w.THB.reserved:null,usableTHB:finite(w?.THB?.available)?down(Math.max(0,Math.min(botFree,w.THB.available-reserved))):null,reservedTHB:reserved,slots:new Set([...s.positions.map(p=>p.symbol),...pending.map(o=>o.symbol)]).size,policyCap:s.policy===LIMITED_POLICY?100:10000};
}
function gate({state:s,wallet:w,now,mode,health,entriesPermitted}){
 if(!s||mode!=='LIVE_ENABLED')return['WAIT_SETUP','รอจัดสรรทุนและตรวจบัญชี','ยังไม่ประเมินการเติมเงินก่อนเปิดบัญชีบอทที่ได้รับอนุมัติ'];
 if(health!=='OK'||entriesPermitted!==true)return['WAIT_HEALTH','รอตรวจระบบก่อนเติมเงิน','ข้อมูลหรือสิทธิ์การซื้อยังไม่ผ่านการตรวจ เพิ่มเงินยังไม่แก้เงื่อนไขนี้'];
 if(s.dailyLocked||s.buyPaused||s.kill!=='NONE'||s.baselinePending)return['WAIT_RISK_LOCK','ยังไม่ควรเติมเงินเพื่อเปิดไม้ใหม่','บอทพักซื้อหรือถูกล็อกความเสี่ยง การเติมเงินไม่ปลดล็อก'];
 if(s.orders.some(o=>['UNKNOWN','SUBMITTING'].includes(o.status)))return['WAIT_RECONCILIATION','รอกระทบยอดคำสั่งก่อน','ยังไม่ทราบผลคำสั่งเดิม จึงยังไม่แนะนำเติมหรือเพิ่มขนาดไม้'];
 if(!finite(w?.THB?.available)||!finite(w?.THB?.reserved)||w.THB.available<0||w.THB.reserved<0||!walletMatches(s,w,now))return['WAIT_WALLET','รอตรวจยอด Wallet','ยอดหรือเวลาของ Wallet ยังตรวจสอบไม่ได้ จึงยังไม่คำนวณเงินที่ควรเติม'];
 const slots=new Set([...s.positions.map(p=>p.symbol),...s.orders.filter(o=>liveActive(o)&&o.side==='BUY').map(o=>o.symbol)]).size;
 if(slots>=2)return['WAIT_SLOTS','ยังไม่ต้องเติมเงิน','ครบ 2 สถานะรวมคำสั่งซื้อค้างแล้ว ต้องมีช่องว่างก่อนเปิดไม้ใหม่'];
 if(s.orders.some(liveActive))return['WAIT_ORDERS','รอคำสั่งเดิมเสร็จก่อน','รอผลจับคู่หรือยกเลิกให้ชัดก่อนประเมินการเติมเงิน'];
 return null;
}
function sizeEntry(e,{state:s,wallet:w,bundle,now},blocked){
 let reason=blocked||!e.eligible&&e.signalReason||null;
 if(!reason&&(!finite(e.priceAt)||now-e.priceAt>30000||e.priceAt>now+5000))reason='STALE_OR_INVALID_PRICE';
 if(!reason&&s.positions.some(p=>p.symbol===e.symbol))reason='SYMBOL_BUSY';
 if(!reason&&s.seen[e.symbol]===e.signalAt)reason='SIGNAL_ALREADY_USED';
 if(!reason&&e.strategyBlocked)reason='STRATEGY_RESTRICTION';
 const risk=riskProjection(s);if(s.policy===LIMITED_POLICY)risk.dayStart=Math.min(risk.dayStart,s.allocatedCapital);
 const size=riskSizeREA(risk,{stopDistance:e.stopDistance,minQuote:e.minQuote},bundle?.markets||[],now),limits=liveLimits(s),pending=s.orders.filter(o=>liveActive(o)&&o.side==='BUY'),reserved=pending.reduce((n,o)=>n+remaining(o),0),exposure=s.positions.reduce((n,p)=>n+p.cost,0)+reserved;
 const maxByRisk=finite(size.riskFraction)?down(Math.max(0,(size.risk-.10)/size.riskFraction)):0;
 const ceiling=down(Math.max(0,Math.min(maxByRisk,(4000-.10)/(1+REA_LIMITS.fee),(8000-exposure-.10)/(1+REA_LIMITS.fee),limits.maxPosition,limits.maxExposure-exposure)));
 let amount=reason?0:down(Math.max(0,Math.min(size.notional,limits.maxExposure-exposure,limits.maxPosition,(w?.THB?.available||0)-reserved)));
 if(amount<e.minQuote)amount=0;
 if(!reason&&!amount)reason=ceiling<e.minQuote?'BELOW_RISK_MINIMUM':'AVAILABLE_CASH_TOO_SMALL';
 return{...e,amountTHB:amount,riskBudget:finite(size.risk)?size.risk:null,riskFraction:finite(size.riskFraction)?size.riskFraction:null,modeledLoss:amount?up(amount*size.riskFraction+.10):0,riskCeilingTHB:ceiling,minimumCashTHB:up(up(e.minQuote)*(1+REA_LIMITS.fee)+.10),reason:reason||'RISK_APPROVED'};
}
function evaluate(previous,ctx){
 const {state:s,wallet:w,now}=ctx,base={version:'23.0.0',method:'RULE_BASED_CAPITAL_ADVISOR',at:now,analyzedAt:previous?.analyzedAt??null,canTrade:false,canChangeLimits:false,manualBudgetApprovalRequired:true,topUpTHB:0,budgetIncreaseTHB:0,suggestedAllocationTHB:null,recommendedEntryTHB:0,entries:[],positions:[],financials:null};
 if(!s)return{...base,status:'WAIT_SETUP',headline:'รอข้อมูลบัญชีบอท',message:'เข้าสู่ระบบและรอ Backend ประเมินบัญชีของคุณ',nextStep:'รอข้อมูลเงินจริงที่ตรวจสอบได้'};
 base.financials=financials(s,w);base.positions=s.positions.map(p=>({symbol:p.symbol,costTHB:p.cost,addAllowed:false,reason:'SYMBOL_BUSY'}));
 const blocked=gate(ctx),entries=(previous?.entries||[]).slice(0,6).map(e=>sizeEntry(e,ctx,blocked?.[0]));base.entries=entries;
 const finish=(status,headline,message,nextStep)=>({...base,status,headline,message,nextStep});
 if(blocked)return finish(...blocked,'รอให้เงื่อนไขนี้ผ่านก่อน ระบบจะประเมินใหม่อัตโนมัติ');
 if(!previous?.analyzedAt)return finish('WAIT_ANALYSIS','รอวิเคราะห์ขนาดไม้','ยังไม่มีสัญญาณจากรอบ Strategy ที่ตรวจสอบได้','รอรอบวิเคราะห์ถัดไป');
 const ready=entries.find(e=>e.amountTHB>0);
 if(ready)return{...finish('USE_AVAILABLE_CASH','ยังไม่ต้องเติมเงิน','มีเงินรองรับไม้ใหม่ '+ready.symbol+' ได้ไม่เกิน '+thb(ready.amountTHB)+' ตามสัญญาณและความเสี่ยงปัจจุบัน','ใช้เงินที่มีอยู่และตรวจสัญญาณใหม่ก่อนส่งคำสั่งทุกครั้ง'),recommendedEntryTHB:ready.amountTHB};
 if(entries.some(e=>e.eligible&&e.reason==='STALE_OR_INVALID_PRICE'))return finish('WAIT_QUOTES','รอราคาสดก่อนปรับเงิน','แผนรอบล่าสุดเกินอายุราคาแล้ว ยังไม่แนะนำเติมจากสัญญาณเก่า','รอรอบวิเคราะห์ถัดไป');
 const unfunded=entries.find(e=>e.reason==='AVAILABLE_CASH_TOO_SMALL'&&e.riskCeilingTHB>=e.minQuote);
 if(!unfunded){const riskLimited=entries.some(e=>e.reason==='BELOW_RISK_MINIMUM');return finish(riskLimited?'WAIT_BUDGET':'WAIT_SIGNAL','ยังไม่ต้องเติมเงิน',riskLimited?'ขนาดไม้ที่ผ่านวงเงินเสี่ยงยังต่ำกว่าขั้นต่ำตลาด การเติมเงินไม่ข้ามกฎเดิม':'ยังไม่มีสัญญาณเหรียญใหม่ที่ผ่านครบ','รอสัญญาณที่ขนาดไม้ผ่านขั้นต่ำและ Risk Manager');}
 if(s.dayPnl<0)return finish('WAIT_AFTER_LOSS','ยังไม่แนะนำเติมเพิ่มในรอบนี้','วันนี้ติดลบและเงินยังไม่รองรับไม้ขั้นต่ำ จึงไม่เสนอเติมเพื่อไล่คืนขาดทุน','รอทบทวนผลและความเสี่ยงก่อนเพิ่มงบ');
 if(w.THB.reserved>0)return finish('WAIT_RESERVED','ตรวจเงินที่ถูกจองก่อน','มีเงินบาทถูกจองอยู่ใน Bitkub ควรรอผลหรือทบทวนคำสั่งเดิมก่อนเติม','ประเมินอีกครั้งเมื่อเงินจองถูกกระทบยอด');
 const increase=up(Math.max(0,unfunded.minimumCashTHB-base.financials.botFreeTHB)),allocation=up(s.allocatedCapital+increase);
 if(allocation>base.financials.policyCap)return finish('WAIT_POLICY_CAP','ยังเพิ่มงบในโหมดนี้ไม่ได้','ไม้ขั้นต่ำต้องเพิ่มวงเงินบอทเกินเพดานโหมดที่อนุมัติไว้','ทบทวนโหมดและผ่านการอนุมัติงบใหม่ก่อน เงินที่เติมไม่ถูกนำมาใช้เอง');
 const topUp=up(Math.max(0,unfunded.minimumCashTHB-w.THB.available));
 return{...finish(topUp?'CONSIDER_TOP_UP':'REVIEW_ALLOCATION',topUp?'พิจารณาเติมเมื่ออนุมัติงบใหม่':'มีเงินใน Wallet แล้ว รออนุมัติงบเพิ่ม',unfunded.symbol+' มีสัญญาณผ่าน แต่เงินบอทต่ำกว่าไม้ขั้นต่ำ '+thb(unfunded.minQuote)+' รวมเงินเผื่อที่ต้องมี '+thb(unfunded.minimumCashTHB),'ต้องอนุมัติเพิ่มวงเงินบอท '+thb(increase)+' เป็น '+thb(allocation)+' และตรวจสัญญาณใหม่ก่อนใช้'),topUpTHB:topUp,budgetIncreaseTHB:increase,suggestedAllocationTHB:allocation};
}
export function refreshCapitalAdvice(previous,ctx){try{return evaluate(previous,ctx);}catch{return{version:'23.0.0',method:'RULE_BASED_CAPITAL_ADVISOR',at:ctx.now,status:'WAIT_DATA',headline:'รอตรวจข้อมูลก่อนประเมินทุน',message:'ยังคำนวณเงินทุนอย่างตรวจสอบไม่ได้',nextStep:'รอ Backend ตรวจข้อมูลใหม่',canTrade:false,canChangeLimits:false,manualBudgetApprovalRequired:true,topUpTHB:0,budgetIncreaseTHB:0,recommendedEntryTHB:0,entries:[],positions:[],financials:null};}}
export function capitalAdvice(ctx){
 try{
  const decisions=new Map((ctx.decisions||[]).map(d=>[d.symbol,d]));
  const entries=(ctx.bundle?.markets||[]).filter(m=>finite(m.rules?.minQuote)&&m.rules.minQuote>0&&finite(m.ask)&&m.ask>0).map(m=>{const r=scoreREA(m,ctx.now),limit=tickPrice(m.ask*(1+REA_LIMITS.slippage),m.rules,false);return{symbol:r.symbol,strategy:r.strategy,score:r.score,eligible:r.eligible&&limit>=m.ask,signalReason:limit<m.ask?'PRICE_TICK_EXCEEDS_CHASE_LIMIT':r.reasons.join(','),strategyBlocked:decisions.get(m.symbol)?.reason==='CODEX_AVOID_ENTRY',signalAt:r.signalAt,priceAt:r.priceAt,stopDistance:r.stopDistance,minQuote:m.rules.minQuote,roundTripFees:REA_LIMITS.fee*2,slippageAllowance:REA_LIMITS.slippage};}).sort((a,b)=>Number(b.eligible)-Number(a.eligible)||b.score-a.score).slice(0,6);
  return refreshCapitalAdvice({analyzedAt:ctx.now,entries},ctx);
 }catch{return refreshCapitalAdvice(null,{...ctx,health:'SAFE_MODE'});}
}
