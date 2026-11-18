// Diagnoses observed net losses; never promises recovery or changes a real trade.
import {markREA,quoteOK,dayKey,REA_LIMITS} from './rea-core.mjs';
export const LOSS_ROLE='Loss Diagnostics Analyst';
const money=n=>Math.round((n+Number.EPSILON)*100)/100;
function analyzeLoss({bundle,state:s,now=Date.now()}){
 const base={role:LOSS_ROLE,at:now,method:'NET_LEDGER_LOSS_DIAGNOSTICS'};
 if(!s)return{...base,status:'WAITING',summary:'รอสมุดบัญชีเพื่อวิเคราะห์ผลขาดทุน',reason:'รอสมุดบัญชีเพื่อวิเคราะห์ผลขาดทุน',evidence:{canTrade:false,canChangeLimits:false}};
 const markets=bundle?.markets||[],equity=markREA(s,markets,now),cost=s.positions.reduce((v,p)=>v+p.cost,0),unrealized=equity===null?null:money(equity-s.cash-cost),net=unrealized===null?null:money(s.realized+unrealized),day=s.day===dayKey(now)&&!s.baselinePending&&equity!==null?money(equity-s.dayStart-s.dayFlows):null;
 const closed=(s.closed||[]).filter(t=>Number.isFinite(t.pnl)&&t.closedAt<=now).sort((a,b)=>b.closedAt-a.closedAt);let streak=0;for(const t of closed){if(t.pnl>=0)break;streak++;}
 const facts=[],hypotheses=[],actions=[];
 if(equity===null){facts.push('POSITION_MARK_UNVERIFIED');actions.push('WAIT_FOR_FRESH_QUOTES');}
 if(s.fees>0)facts.push('FEES_ALREADY_INCLUDED_IN_NET_PNL');
 if(unrealized<0)facts.push('OPEN_POSITIONS_BELOW_COST_AFTER_MODELED_EXIT_FEE');
 if(s.realized<0)facts.push('REALIZED_TRADING_LOSS');
 if(s.orders.some(o=>['UNKNOWN','SUBMITTING'].includes(o.status))){facts.push('ORDER_RECONCILIATION_PENDING');actions.push('RECONCILE_BEFORE_NEW_ENTRIES');}
 const stops=s.positions.filter(p=>{const m=markets.find(m=>m.symbol===p.symbol);return quoteOK(m,now)&&m.bid<=p.stop;}).map(p=>p.symbol);
 if(stops.length){facts.push('STOP_LEVEL_REACHED');actions.push('KEEP_EXISTING_BACKEND_STOP_POLICY');}
 if(s.dailyLocked){facts.push('DAILY_LOSS_LOCK');actions.push('KEEP_DAILY_LOSS_LOCK');}
 if(streak>=3){facts.push('THREE_OR_MORE_CLOSED_LOSSES');hypotheses.push('REVIEW_ENTRY_QUALITY_AND_MARKET_REGIME');}
 if((net!==null&&net<0)||(day!==null&&day<0)){
  hypotheses.push('TEST_STRATEGY_FIT_AND_COST_IMPACT_IN_PAPER');actions.push('COMPARE_MIXED_WITH_CAUTION_SCORE_80_IN_PAPER','REQUIRE_EVIDENCE_BEFORE_LIVE_STRATEGY_CHANGE');
 }
 const losing=net!==null&&net<0||day!==null&&day<0,summary=equity===null?'รอราคาสดเพื่อแยกสาเหตุขาดทุน':losing?'พบผลติดลบ · แยกค่าธรรมเนียม/สถานะค้าง และเทียบแนวทางแก้ใน Paper':'ตรวจผลสุทธิแล้ว · ยังไม่พบผลติดลบในรอบนี้';
 return{...base,status:equity===null?'WAITING':losing||streak>=3?'DEGRADED':'COMPLETED',summary,reason:summary,evidence:{netTradingPnL:net,dayPnL:day,realized:s.realized,unrealized,feesPaid:s.fees,feesAlreadyIncluded:true,modeledExitFee:REA_LIMITS.fee,closedTrades:closed.length,consecutiveLosses:streak,stopSymbols:stops,facts,hypotheses:[...new Set(hypotheses)],actions:[...new Set(actions)],canTrade:false,canChangeLimits:false,canGuaranteeRecovery:false}};
}
export function lossReview(ctx){try{return analyzeLoss(ctx);}catch{return{role:LOSS_ROLE,at:ctx.now,status:'WAITING',method:'NET_LEDGER_LOSS_DIAGNOSTICS',summary:'รอข้อมูลบัญชีที่ตรวจสอบได้',reason:'รอข้อมูลบัญชีที่ตรวจสอบได้',evidence:{canTrade:false,canChangeLimits:false,canGuaranteeRecovery:false}};}}
