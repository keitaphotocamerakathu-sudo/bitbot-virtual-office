// Deterministic experience, with no network, credentials, LLM or authority to raise risk.
export const LEARNING_PROTOCOL='REA-LEARNING-25.0.0';
export const EXPERIENCE_PROTOCOL='REA-EXPERIENCE-25.0.0';
export const LOSS_COOLDOWN_MS=30*60000;
const finite=(v,fallback=null)=>Number.isFinite(v)?v:fallback;
const money=n=>Math.round((n+Number.EPSILON)*100)/100;
const sum=(xs,fn)=>xs.reduce((n,x)=>n+fn(x),0);
const strategies=['TREND_FOLLOWING','BREAKOUT','MEAN_REVERSION'];
export function entryEvidence(signal,market,now){
 const x=signal.indicators||{};
 return{protocol:LEARNING_PROTOCOL,source:'BEFORE_ORDER',at:now,signalAt:finite(signal.signalAt),strategy:signal.strategy,score:finite(signal.score),reference:finite(signal.reference),bid:finite(market.bid),ask:finite(market.ask),spreadFraction:market.last>0?finite((market.ask-market.bid)/market.last):null,quoteAt:finite(market.observedAt),volumeTHB:finite(market.volumeTHB),qualityReady:market.dataQuality?.ready===true,
  indicators:{regime:x.regime||null,rsi:finite(x.rsi),atr:finite(x.atr),volatility:finite(x.volatility),macdHistogram:finite(x.macd?.histogram),ema9:finite(x.ema?.[9]),ema21:finite(x.ema?.[21]),ema50:finite(x.ema?.[50])},
  news:{verified:market.news?.ready===true,blocked:market.news?.blocked===true,fetchedAt:finite(market.news?.fetchedAt)}};
}
export function exitEvidence(position,market,reason,now){
 return{protocol:LEARNING_PROTOCOL,source:'BEFORE_ORDER',at:now,reason,bid:finite(market.bid),ask:finite(market.ask),quoteAt:finite(market.observedAt),stop:finite(position.stop),target:finite(position.target)};
}
export function lossReentryGuard(state,symbol,strategy,now){
 const closed=(Array.isArray(state?.closed)?state.closed:[]).filter(t=>t?.symbol===symbol&&Number.isFinite(t.pnl)&&t.pnl<0&&Number.isFinite(t.closedAt)&&t.closedAt<=now&&now<t.closedAt+LOSS_COOLDOWN_MS).sort((a,b)=>b.closedAt-a.closedAt);
 for(const t of closed){const entry=(Array.isArray(state.orders)?state.orders:[]).find(o=>o?.id===t.id&&o.side==='BUY');if((entry?.strategy||t.strategy)!==strategy)continue;
  return{blocked:true,reason:'LOSS_REENTRY_COOLDOWN',positionId:t.id,symbol,strategy,closedAt:t.closedAt,until:t.closedAt+LOSS_COOLDOWN_MS,pnl:t.pnl,policy:'FIXED_30_MIN_SAME_SYMBOL_AND_STRATEGY'};
 }
 return{blocked:false};
}
export function tradePostmortem(state,closed,now,{simulation=false}={}){
 if(!closed||typeof closed.id!=='string'||!Number.isFinite(closed.pnl)||!Number.isFinite(closed.openedAt)||!Number.isFinite(closed.closedAt)||closed.closedAt>now||closed.closedAt<closed.openedAt)throw Error('INVALID_CLOSED_TRADE');
 const entry=state.orders.find(o=>o.id===closed.id&&o.side==='BUY'&&o.symbol===closed.symbol),exits=state.orders.filter(o=>o.side==='SELL'&&o.symbol===closed.symbol&&o.positionId===closed.id),exitIds=new Set(exits.map(o=>o.id));
 const buys=state.fills.filter(f=>f.orderId===closed.id&&f.side==='BUY'),sells=state.fills.filter(f=>exitIds.has(f.orderId)&&f.side==='SELL'),all=[...buys,...sells];
 const verified=!!entry&&buys.length>0&&sells.length>0&&new Set(all.map(f=>f.id)).size===all.length&&all.every(f=>f.symbol===closed.symbol&&f.simulation===simulation&&[f.qty,f.price,f.fee,f.at].every(Number.isFinite)&&f.qty>0&&f.price>0&&f.fee>=0&&f.at>=closed.openedAt-60000&&f.at<=closed.closedAt);
 const qtyIn=sum(buys,f=>f.qty),qtyOut=sum(sells,f=>f.qty),complete=verified&&Math.abs(qtyIn-qtyOut)<=Math.max(1e-8,qtyIn*1e-7)&&Math.abs(sum(sells,f=>f.realized)-closed.pnl)<=.02;
 const avgEntry=complete?sum(buys,f=>f.qty*f.price)/qtyIn:null,avgExit=complete?sum(sells,f=>f.qty*f.price)/qtyOut:null,fees=complete?money(sum(all,f=>f.fee)):null,gross=complete?money(qtyOut*(avgExit-avgEntry)):null;
 const context=entry?.entryEvidence?.protocol===LEARNING_PROTOCOL?entry.entryEvidence:null,exit=exits.findLast(o=>o.exitEvidence?.protocol===LEARNING_PROTOCOL)?.exitEvidence||null;
 const facts=[],missing=[],hypotheses=[],lessons=[];
 if(!complete)missing.push('COMPLETE_MATCHED_FILL_EVIDENCE');
 if(!context)missing.push('ENTRY_MARKET_CONTEXT_NOT_RECORDED');
 if(!exit)missing.push('EXIT_MARKET_CONTEXT_NOT_RECORDED');
 const reasons=[...new Set(exits.map(o=>o.reason).filter(Boolean))];
 if(reasons.includes('STOP_LOSS'))facts.push('STOP_LOSS_EXIT');
 if(reasons.includes('TAKE_PROFIT'))facts.push('TAKE_PROFIT_EXIT');
 if(reasons.includes('PROFIT_PROTECTION'))facts.push('PROFIT_PROTECTION_EXIT');
 if(gross!==null&&gross<0)facts.push('PRICE_MOVED_AGAINST_ENTRY');
 if(fees>0)facts.push('FEES_REDUCED_NET_RESULT');
 if(gross!==null&&gross>=0&&closed.pnl<0)facts.push('COSTS_AND_ROUNDING_EXCEEDED_GROSS_GAIN');
 if(complete&&entry?.stop>0&&avgExit<entry.stop&&reasons.includes('STOP_LOSS'))facts.push('EXIT_FILL_BELOW_STOP_TRIGGER');
 if(Number.isFinite(entry?.modeledLoss)&&-closed.pnl>entry.modeledLoss+.02)facts.push('LOSS_EXCEEDED_ENTRY_MODEL');
 if(closed.pnl<0){hypotheses.push('ENTRY_TIMING_OR_REGIME_MAY_NEED_REVIEW');lessons.push('WAIT_30_MIN_BEFORE_SAME_SYMBOL_STRATEGY_REENTRY','COMPARE_FORWARD_PAPER_BEFORE_CHANGING_STRATEGY');}
 const summary=!complete?'หลักฐานจับคู่ยังไม่ครบ จึงยังสรุปสาเหตุไม่ได้':closed.pnl<0?(gross<0?'ราคาขายเฉลี่ยต่ำกว่าราคาซื้อ':'ต้นทุนรวมทำให้ผลสุทธิติดลบ')+(reasons.includes('STOP_LOSS')?' · ปิดตาม Stop Loss':''):'บันทึกผลหลังต้นทุนและเงื่อนไขออกแล้ว';
 return{protocol:LEARNING_PROTOCOL,mode:simulation?'PAPER_ONLY':'LIVE',positionId:closed.id,symbol:closed.symbol,strategy:entry?.strategy||null,openedAt:closed.openedAt,closedAt:closed.closedAt,reviewedAt:now,netPnL:closed.pnl,simulation,status:complete?'VERIFIED':'INCOMPLETE',summary,
  metrics:{quantity:complete?qtyOut:null,avgEntry,avgExit,priceReturnPct:complete?(avgExit/avgEntry-1)*100:null,grossPnL:gross,feesPaid:fees,roundingDifference:complete?money(closed.pnl-(gross-fees)):null,feesAlreadyIncluded:true,heldMinutes:(closed.closedAt-closed.openedAt)/60000,modeledLoss:finite(entry?.modeledLoss),stop:finite(entry?.stop),target:finite(entry?.target),entrySlippagePct:complete&&context?.reference>0?(avgEntry/context.reference-1)*100:null,exitSlippagePct:complete&&exit?.bid>0?(exit.bid-avgExit)/exit.bid*100:null,...(closed.protection?{observedProtection:closed.protection}:{})},
  evidence:{entry:context,exit,exitReasons:reasons,buyFillIds:buys.map(f=>f.id),sellFillIds:sells.map(f=>f.id),facts,missing,hypotheses,causalCertainty:'OBSERVED_LEDGER_FACTS_ONLY'},lessons,canChangeLimits:false,canGuaranteeRecovery:false};
}
export function liveLearning(state,previous,now){
 try{
  if(state?.mode!=='LIVE'||!['closed','orders','fills'].every(k=>Array.isArray(state[k])))throw Error('INVALID_LEARNING_LEDGER');
  const old=previous?.protocol===LEARNING_PROTOCOL?previous.reports||[]:[],known=new Map(old.map(r=>[r.positionId,r])),closed=state.closed.filter(t=>t.closedAt<=now).sort((a,b)=>a.closedAt-b.closedAt),reports=closed.slice(-20).map(t=>{const old=known.get(t.id);return old?.netPnL===t.pnl&&old?.closedAt===t.closedAt?old:tradePostmortem(state,t,now);});
  const counts={closed:closed.length,losses:closed.filter(t=>t.pnl<0).length,wins:closed.filter(t=>t.pnl>0).length,netPnL:money(sum(closed,t=>t.pnl))};
  const activeCooldowns=closed.filter(t=>t.pnl<0&&t.closedAt+LOSS_COOLDOWN_MS>now).map(t=>{const o=state.orders.find(o=>o.id===t.id);return lossReentryGuard(state,t.symbol,o?.strategy,now);}).filter(g=>g.blocked);
  return{protocol:LEARNING_PROTOCOL,at:now,status:reports.some(r=>r.status==='INCOMPLETE')?'PARTIAL':'READY',counts,reports,activeCooldowns,policy:{lossCooldownMs:LOSS_COOLDOWN_MS,scope:'SAME_SYMBOL_AND_STRATEGY',canRaiseRisk:false,canDisableStops:false},archive:'APPEND_ONLY_TRADE_LESSONS',canGuaranteeRecovery:false};
 }catch{return{protocol:LEARNING_PROTOCOL,at:now,status:'UNAVAILABLE',reports:[],activeCooldowns:[],reason:'LEARNING_EVIDENCE_UNAVAILABLE',canGuaranteeRecovery:false};}
}
export function experienceAssessment(relay,now){
 const base={at:now,sourceAt:finite(relay?.at),protocol:EXPERIENCE_PROTOCOL,canTrade:false,canChangeLimits:false,canDisableStops:false,policy:'VETO_ONLY_SAME_SYMBOL_STRATEGY_30_MIN',ready:false,minimum:{days:7,closedTradesPerAccount:30,coverage:.9,netImprovementTHB:20}};
 if(relay?.protocol!==EXPERIENCE_PROTOCOL||relay.mode!=='PAPER_ONLY')return{...base,status:'WAITING',reason:'PAPER_EXPERIENCE_NOT_AVAILABLE'};
 if(!Number.isFinite(relay.at)||relay.at>now+5000||now-relay.at>180000)return{...base,status:'STALE',reason:'PAPER_EXPERIENCE_STALE'};
 const a=relay.baseline,b=relay.guarded,c=relay.collection;
 if(!a||!b||!c||a.profile!=='EXPERIENCE_BASELINE'||b.profile!=='EXPERIENCE_GUARDED'||a.startedAt!==c.startedAt||b.startedAt!==c.startedAt||![a.closedTrades,b.closedTrades,a.netPnL,b.netPnL,a.maxDrawdown,b.maxDrawdown,c.startedAt,c.validMinutes,c.expectedMinutes,c.coverage].every(Number.isFinite)||![a.closedTrades,b.closedTrades,c.validMinutes,c.expectedMinutes].every(v=>Number.isInteger(v)&&v>=0)||a.maxDrawdown<0||b.maxDrawdown<0||c.startedAt>relay.at||c.expectedMinutes<1||c.validMinutes>c.expectedMinutes||Math.abs(c.coverage-c.validMinutes/c.expectedMinutes)>1e-6||c.expectedMinutes!==Math.max(1,Math.floor(relay.at/60000)-Math.floor(c.startedAt/60000)+1))return{...base,status:'COLLECTING',reason:'PAPER_EXPERIENCE_INCOMPLETE',collection:c||null,baseline:a||null,guarded:b||null};
 const mature=relay.at-c.startedAt>=7*86400000&&c.coverage>=.9&&a.closedTrades>=30&&b.closedTrades>=30&&a.markVerified===true&&b.markVerified===true;
 const better=b.netPnL>0&&b.netPnL-a.netPnL>=20&&b.maxDrawdown<=a.maxDrawdown&&Number.isFinite(b.profitFactor)&&b.profitFactor>1;
 return{...base,ready:mature&&better,status:!mature?'COLLECTING':better?'CONSERVATIVE_FILTER_READY':'NO_IMPROVEMENT',reason:!mature?'PAPER_MINIMUM_EVIDENCE_NOT_MET':better?'PAPER_COOLDOWN_COMPARE_PASSED':'PAPER_COOLDOWN_NOT_BETTER',collection:c,baseline:a,guarded:b,losses:Array.isArray(relay.losses)?relay.losses.slice(-40):[],limitations:['PAPER_IS_NOT_REAL_EXECUTION','MINIMUM_EVIDENCE_IS_NOT_STATISTICAL_PROOF','VETO_CANNOT_GUARANTEE_PROFIT']};
}
export function paperExperienceGuard(relay,symbol,strategy,now){
 const assessment=experienceAssessment(relay,now);if(!assessment.ready)return{blocked:false,reason:assessment.reason};
 const loss=(assessment.losses||[]).filter(t=>t?.symbol===symbol&&t.strategy===strategy&&strategies.includes(t.strategy)&&Number.isFinite(t.pnl)&&t.pnl<0&&Number.isFinite(t.closedAt)&&t.closedAt<=relay.at&&t.closedAt<=now&&now<t.closedAt+LOSS_COOLDOWN_MS).sort((a,b)=>b.closedAt-a.closedAt)[0];
 return loss?{blocked:true,reason:'PAPER_EXPERIENCE_COOLDOWN',sourceAt:relay.at,symbol,strategy,positionId:loss.positionId,closedAt:loss.closedAt,until:loss.closedAt+LOSS_COOLDOWN_MS,simulation:true,policy:assessment.policy}:{blocked:false,reason:'NO_MATCHING_RECENT_PAPER_LOSS'};
}
