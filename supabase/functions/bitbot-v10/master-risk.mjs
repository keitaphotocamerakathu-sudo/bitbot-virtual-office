// Sole entry approval for the new Paper engine. No LLM or private API dependency.
import {correlatedExposure} from './master-market.mjs';
import {quoteOK} from './rea-core.mjs';
import {roundUnit} from './engine.mjs';
import {settleSellTHB} from './rea-thb-settlement.mjs';
export const down=n=>Math.floor((n+1e-10)*100)/100,up=n=>Math.ceil((n-1e-10)*100)/100,money=n=>Math.round((n+Number.EPSILON)*100)/100;
export const activeMaster=o=>['RESERVED','SUBMITTING','OPEN','PARTIAL','CANCEL_PENDING','UNKNOWN'].includes(o.status);
export function bracketCost({amount,entry,stop,target,qtyScale=8,fee=.0025,slippage=.002}){
 if(![amount,entry,stop,target,fee,slippage].every(Number.isFinite)||amount<=0||entry<=stop||stop<=0||target<=entry)return null;
 const entryFee=up(amount*fee),qty=roundUnit((amount-entryFee)/entry,qtyScale),value=price=>{const rate=price*(1-slippage),gross=qty*rate;return settleSellTHB(qty,rate,up(gross*fee));};
 if(qty<=0)return null;
 const stopGross=down(qty*stop*(1-slippage)),stopNet=value(stop),targetNet=value(target),risk=up(amount-stopNet+.10),reward=down(targetNet-amount-.10);
 return{amountTHB:amount,qty,entryFeeTHB:entryFee,modeledRiskTHB:risk,modeledTargetProfitTHB:reward,netRewardRisk:risk>0?reward/risk:null,stopGrossTHB:stopGross,feePerSide:fee,slippageAllowance:slippage,roundingReserveTHB:.10,expectedReturn:null};
}
export function masterRiskState(book,config,now){
 if(book?.mode!=='PAPER_ONLY')throw Error('MASTER_CANNOT_ACCESS_LIVE_LEDGER');
 const pending=book.orders.filter(o=>activeMaster(o)&&o.side==='BUY'),reserved=pending.reduce((s,o)=>s+o.remaining,0),exposure=book.positions.reduce((s,p)=>s+p.cost,0)+reserved,base=Math.max(0,Math.min(book.initialCapital,book.dayStart,book.equity));
 const heldRisk=book.positions.reduce((s,p)=>s+up(Math.max(p.initialRiskTHB*(p.cost/p.initialCost),Math.max(0,p.cost-p.qty*p.stop*(1-config.fee-config.slippage))+.10)),0),pendingRisk=pending.reduce((s,o)=>s+up(o.riskTHB*o.remaining/o.amount),0);
 const losses=book.closed.filter(t=>t.closedAt<=now&&t.closedAt>now-86400000).sort((a,b)=>b.closedAt-a.closedAt);let streak=0;for(const t of losses){if(t.pnl>=0)break;streak++;}
 const cooldownUntil=streak>=3?losses[0].closedAt+3600000:null,scale=book.dayPnl<=-book.dayStart*.015?.5:1;
 return{at:now,capitalBase:down(base),riskPerTradeTHB:down(Math.min(100,base*config.riskPerTrade)*scale),portfolioRiskCapTHB:down(Math.min(book.initialCapital*config.portfolioRiskCap,base*config.portfolioRiskCap)),openRiskTHB:up(heldRisk+pendingRisk),dailyLossLimitTHB:down(Math.min(book.initialCapital*config.dailyLossLimit,book.dayStart*config.dailyLossLimit)),reservedTHB:money(reserved),exposureTHB:money(exposure),maxExposureTHB:down(base*config.maxExposureFraction),maxPositionTHB:down(base*config.maxPositionFraction),cashReserveTHB:up(base*config.cashReserve),riskScale:scale,consecutiveLosses:streak,cooldownUntil,cooldownActive:cooldownUntil!==null&&now<cooldownUntil,slots:new Set([...book.positions.map(p=>p.symbol),...pending.map(p=>p.symbol)]).size,maxPositions:config.maxPositions};
}
export function approveMasterEntry(book,signal,m,markets,config,now){
 const r=masterRiskState(book,config,now),reasons=[];
 if(!config.enabled||config.buyPaused||config.kill!=='NONE')reasons.push('MASTER_ENTRY_PAUSED');if(book.dailyLocked)reasons.push('DAILY_LOSS_LOCK');if(book.baselinePending)reasons.push('MIDNIGHT_BASELINE_UNVERIFIED');if(book.maxDrawdown>=config.maxDrawdown)reasons.push('MAXIMUM_DRAWDOWN_LOCK');if(r.cooldownActive)reasons.push('LOSS_STREAK_COOLDOWN');
 if(!signal.eligible)reasons.push(...signal.reasons);if(!quoteOK(m,now)||!m.depth||now-m.depth.at>30000||m.depth.at>now||m.marketSource!=='exchange'||m.status!=='active')reasons.push('STALE_OR_INVALID_MARKET');
 if(r.slots>=config.maxPositions)reasons.push('MAX_POSITIONS');if(book.positions.some(p=>p.symbol===signal.symbol)||book.orders.some(o=>activeMaster(o)&&o.symbol===signal.symbol))reasons.push('SYMBOL_ALREADY_OWNED_OR_PENDING');if(book.seen[signal.signalId])reasons.push('SIGNAL_ALREADY_USED');
 const empirical=book.strategyStats[signal.strategyId],expectedMinutes=Math.max(1,Math.floor(now/60000)-Math.floor(book.startedAt/60000)+1);if(now-book.startedAt>=7*86400000&&book.validMinutes/expectedMinutes>=.9&&empirical?.closedTrades>=30&&empirical.grossGains<=empirical.grossLosses)reasons.push('STRATEGY_NEGATIVE_FORWARD_EXPECTANCY');
 const loss=book.closed.findLast(p=>p.symbol===signal.symbol&&p.strategyId===signal.strategyId&&p.pnl<0&&now-p.closedAt<1800000);if(loss)reasons.push('LOSS_REENTRY_COOLDOWN');
 const correlation=correlatedExposure(signal.symbol,book.positions,markets,now,config.correlationThreshold);if(correlation.unknown)reasons.push('CORRELATION_DATA_INSUFFICIENT');
 const group=book.positions.filter(p=>correlation.high.includes(p.symbol)).reduce((s,p)=>s+p.initialRiskTHB*p.cost/p.initialCost,0);if(group>=r.portfolioRiskCapTHB*.5)reasons.push('CORRELATED_RISK_LIMIT');
 const stats=book.strategyStats[signal.strategyId],performanceScale=now-book.startedAt>=7*86400000&&stats?.closedTrades>=30&&stats.grossGains<=stats.grossLosses?.5:1,scale=(signal.strategyId==='MEAN_REVERSION_SHORT'?.5:1)*performanceScale,risk=down(Math.max(0,Math.min(r.riskPerTradeTHB*scale,r.portfolioRiskCapTHB-r.openRiskTHB,r.dailyLossLimitTHB+book.dayPnl-r.openRiskTHB))),fraction=signal.stopDistance+config.fee*2+config.slippage;
 let amount=down(Math.max(0,Math.min((risk-.10)/fraction,r.maxPositionTHB,r.maxExposureTHB-r.exposureTHB,book.cash-r.reservedTHB-r.cashReserveTHB))),cost=null;
 if(!(risk>0))reasons.push('PORTFOLIO_RISK_EXHAUSTED');
 if(!reasons.length){for(let i=0;i<8&&amount>=m.rules.minQuote;i++){cost=bracketCost({amount,entry:signal.entry,stop:signal.stop,target:signal.target,qtyScale:m.rules.qtyScale,fee:config.fee,slippage:config.slippage});if(!cost||cost.modeledRiskTHB<=risk)break;amount=down(amount-Math.max(.01,(cost.modeledRiskTHB-risk)/fraction+.01));}
  if(!cost||amount<m.rules.minQuote||cost.stopGrossTHB<m.rules.minQuote)reasons.push('ENTRY_OR_STOP_EXIT_BELOW_MINIMUM');else if(cost.modeledRiskTHB>risk)reasons.push('RISK_BUDGET_EXCEEDED');else if(cost.netRewardRisk<config.minNetRewardRisk||cost.modeledTargetProfitTHB<=0)reasons.push('NET_REWARD_AFTER_COST_TOO_SMALL');
  const depth=(m.depth.asks||[]).reduce((s,x)=>{const p=Number(x.price??x[0]),q=Number(x.base_volume??x[1]);return s+(p<=signal.entry&&p>0&&q>0?p*q:0);},0);if(depth<amount*10)reasons.push('INSUFFICIENT_DEPTH_FOR_ORDER');
 }
 return{approved:reasons.length===0,reasons:[...new Set(reasons)],riskBudgetTHB:risk,economics:cost,amountTHB:reasons.length?0:amount,portfolio:r,correlation,canTrade:false};
}
