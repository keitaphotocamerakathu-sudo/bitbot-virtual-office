// Forward simulation with later, observed Bitkub depth. No private API imports.
import {MASTER_SPEC} from './master-config.mjs';
import {masterRiskState,activeMaster,down,up,money} from './master-risk.mjs';
import {quoteOK,dayKey} from './rea-core.mjs';
import {roundUnit} from './engine.mjs';
import {settleSellTHB} from './rea-thb-settlement.mjs';
export function initialMasterBook(now=Date.now(),capital=10000){
 if(!Number.isFinite(capital)||capital<10||capital>10000)throw Error('INVALID_MASTER_PAPER_CAPITAL');
 return{protocol:MASTER_SPEC,mode:'PAPER_ONLY',startedAt:now,lastAt:null,initialCapital:capital,cash:capital,equity:capital,day:dayKey(now),dayStart:capital,dayFlows:0,dayPnl:0,dailyLocked:false,baselinePending:false,positions:[],orders:[],fills:[],closed:[],days:{},seen:{},fees:0,realized:0,peak:capital,maxDrawdown:0,ticks:0,validTicks:0,validMinutes:0,lastMinute:null,lastMinuteValid:false,stats:{closedTrades:0,wins:0,grossGains:0,grossLosses:0},strategyStats:{}};
}
export function markMaster(book,markets,config,now,events=[]){
 let equity=book.cash;for(const p of book.positions){const m=markets.find(m=>m.symbol===p.symbol);if(!quoteOK(m,now)){book.markVerified=false;return false;}const gross=p.qty*m.bid;equity+=settleSellTHB(p.qty,m.bid,up(gross*config.fee));}
 const today=dayKey(now);equity=money(equity);
 if(today!==book.day){book.days[book.day]={start:book.dayStart,equity:book.equity,flows:book.dayFlows,pnl:book.dayPnl,locked:book.dailyLocked};book.day=today;book.dayStart=equity;book.dayFlows=0;book.baselinePending=book.positions.length>0&&(!book.lastAt||now-book.lastAt>90000);if(!book.baselinePending)book.dailyLocked=false;}
 book.equity=equity;book.dayPnl=money(equity-book.dayStart-book.dayFlows);book.peak=Math.max(book.peak,equity);book.maxDrawdown=Math.max(book.maxDrawdown,1-equity/book.peak);book.markVerified=true;
 if(book.dayPnl<=-down(book.dayStart*config.dailyLossLimit)&&!book.dailyLocked){book.dailyLocked=true;events.push({at:now,kind:'DAILY_LOSS_LOCK',reason:'MARKED_DAILY_LOSS',pnl:book.dayPnl});}return true;
}
function closeStats(book,p,now,events){
 const closed={id:p.positionId,symbol:p.symbol,strategyId:p.strategyId,strategyVersion:p.strategyVersion,horizon:p.horizon,regime:p.regime,openedAt:p.openedAt,closedAt:now,pnl:money(p.realized),initialCost:p.initialCost,netReturn:p.realized/p.initialCost,simulation:true};book.closed.push(closed);events.push({kind:'CLOSED_TRADE',...closed});
 for(const stats of [book.stats,book.strategyStats[p.strategyId]??= {closedTrades:0,wins:0,grossGains:0,grossLosses:0}]){stats.closedTrades++;stats.sumNetReturn=(stats.sumNetReturn||0)+closed.netReturn;stats.sumSquaredReturn=(stats.sumSquaredReturn||0)+closed.netReturn**2;if(closed.pnl>0){stats.wins++;stats.grossGains=money(stats.grossGains+closed.pnl);}else stats.grossLosses=money(stats.grossLosses-closed.pnl);}
}
export function cancelMasterBuys(book,now,reason,events){for(const o of book.orders)if(o.side==='BUY'&&activeMaster(o)){o.status='CANCELED';o.remaining=0;events.push({at:now,kind:'ORDER_CANCELED',orderId:o.id,reason});}}
export function fillMasterOrders(book,markets,config,now,events){
 const fills=[];if(config.kill==='ALL')return fills;
 for(const o of book.orders.filter(activeMaster)){
  if(now-o.createdAt>=120000||o.fillCount>=10){o.status='CANCELED';o.remaining=0;events.push({at:now,kind:'ORDER_TIMEOUT',orderId:o.id});continue;}if(o.createdAt>=now)continue;
  const m=markets.find(m=>m.symbol===o.symbol);if(!quoteOK(m,now)||m.observedAt<=o.createdAt||!m.depth||m.depth.at<=o.createdAt||now-m.depth.at>30000||m.depth.at>now)continue;
  const price=o.side==='BUY'?m.ask*(1+config.slippage/2):m.bid*(1-config.slippage/2);if(o.side==='BUY'?price>o.limit:o.type!=='market'&&price<o.limit)continue;
  const rows=o.side==='BUY'?m.depth.asks:m.depth.bids,capacity=(rows||[]).reduce((n,x)=>{const p=Number(x.price??x[0]),q=Number(x.base_volume??x[1]);return n+(p>0&&q>0&&(o.side==='BUY'?p<=o.limit:o.type==='market'||p>=o.limit)?q:0);},0)*.1;
  let qty,paid,fee,cashDelta,realized=0;
  if(o.side==='BUY'){
   paid=down(Math.min(o.remaining,capacity*price,book.cash));fee=up(paid*config.fee);qty=roundUnit((paid-fee)/price,o.qtyScale);if(!(qty>0&&paid>0))continue;cashDelta=-paid;
   book.cash=money(book.cash-paid);let p=book.positions.find(p=>p.symbol===o.symbol);
   if(!p){p={symbol:o.symbol,positionId:o.id,qty:0,cost:0,initialCost:o.amount,initialRiskTHB:o.riskTHB,entryReference:o.limit,initialStop:o.stop,stop:o.stop,target:o.target,openedAt:now,strategyId:o.strategyId,strategyVersion:o.strategyVersion,horizon:o.horizon,timeframe:o.timeframe,exitPolicy:o.exitPolicy,exitRules:o.exitRules,regime:o.regime,realized:0,partialTaken:false,protectionArmed:false};book.positions.push(p);}
   p.qty=roundUnit(p.qty+qty,o.qtyScale);p.cost=money(p.cost+paid);o.remaining=money(Math.max(0,o.remaining-paid));
  }else{
   const p=book.positions.find(p=>p.positionId===o.positionId);if(!p){o.status='CANCELED';o.remaining=0;continue;}
   qty=roundUnit(Math.min(o.remaining,p.qty,capacity),o.qtyScale);if(!(qty>0))continue;paid=qty*price;fee=up(paid*config.fee);cashDelta=settleSellTHB(qty,price,fee);const basis=p.cost*qty/p.qty;realized=money(cashDelta-basis);
   book.cash=money(book.cash+cashDelta);book.realized=money(book.realized+realized);p.realized=money(p.realized+realized);p.qty=roundUnit(Math.max(0,p.qty-qty),o.qtyScale);p.cost=money(Math.max(0,p.cost-basis));o.remaining=roundUnit(Math.max(0,o.remaining-qty),o.qtyScale);
   if(o.reason==='PARTIAL_TAKE_PROFIT')p.partialTaken=true;
   if(p.qty<10**-o.qtyScale){closeStats(book,p,now,events);book.positions=book.positions.filter(v=>v!==p);}
  }
  const f={id:o.id+':'+o.fillCount,orderId:o.id,symbol:o.symbol,side:o.side,qty,price,fee,cashDeltaTHB:cashDelta,realized,at:now,simulation:true,strategyId:o.strategyId,strategyVersion:o.strategyVersion,horizon:o.horizon,reason:o.reason,quoteAt:m.observedAt,bookAt:m.depth.at,signalAt:o.signalAt,decisionAt:o.createdAt,spreadFraction:(m.ask-m.bid)/m.last,reference:o.side==='BUY'?o.reference:m.bid,slippageFraction:o.reference>0?(o.side==='BUY'?price/o.reference-1:1-price/o.reference):null,executionDelayMs:now-o.createdAt,fillModel:'LATER_OBSERVED_DEPTH_MAX_10_PERCENT'};
  o.fillCount++;book.fees=money(book.fees+fee);book.fills.push(f);fills.push(f);if(o.remaining<(o.side==='BUY'?.01:10**-o.qtyScale)){o.status='FILLED';o.remaining=0;}else o.status='PARTIAL';
 }
 return fills;
}
export function manageMasterExits(book,markets,analyses,config,now,events){
 if(config.kill==='ALL')return[];const decisions=[];
 for(const p of book.positions){const m=markets.find(m=>m.symbol===p.symbol);if(!quoteOK(m,now)||m.status!=='active'||m.sellFrozen)continue;
  // Stop protection takes precedence over the unfilled remainder of an entry.
  if(m.bid<=p.stop)for(const o of book.orders)if(activeMaster(o)&&o.side==='BUY'&&o.symbol===p.symbol){o.status='CANCELED';o.remaining=0;events.push({at:now,kind:'ORDER_CANCELED',orderId:o.id,reason:'STOP_PROTECTION_PRECEDENCE'});}
  if(book.orders.some(o=>activeMaster(o)&&o.symbol===p.symbol))continue;
  const exitPolicy=p.exitPolicy||config.exitPolicy;
  const t=analyses[m.symbol]?.frames?.[p.timeframe],intel=analyses[m.symbol]?.intelligence,initialDistance=p.entryReference-p.initialStop,r=initialDistance>0?(m.bid-p.entryReference)/initialDistance:0,age=now-p.openedAt;
  if(exitPolicy==='BALANCED_VALIDATION'&&r>=p.exitRules.trailActivationR&&t?.atrWilder>0){const breakeven=(p.cost+.10)/(p.qty*(1-config.fee-config.slippage)),candidate=Math.min(p.target*(1-1e-9),m.bid*(1-1e-9),Math.max(breakeven,m.bid-t.atrWilder*p.exitRules.trailATR));if(candidate>p.stop){p.stop=candidate;p.protectionArmed=true;events.push({at:now,kind:'PAPER_TRAILING_STOP_RAISED',positionId:p.positionId,symbol:p.symbol,stop:p.stop});}}
  let fraction=1,reason=m.bid<=p.stop?(p.protectionArmed?'TRAILING_STOP':'FIXED_STOP'):m.bid>=p.target?'TAKE_PROFIT':null;
  if(!reason&&exitPolicy==='BALANCED_VALIDATION'){
   if(intel?.regime==='ABNORMAL')reason='RISK_REDUCTION_EXIT';else if(intel?.regime==='HIGH_VOLATILITY'&&age>p.timeframe*60000*3)reason='VOLATILITY_EXIT';else if(t?.ready&&t.reversalDown&&age>p.timeframe*60000*3)reason='TREND_REVERSAL_EXIT';else if(age>=p.exitRules.maxHoldMs)reason='TIME_EXIT';
   else if(!p.partialTaken&&r>=p.exitRules.partialAtR){const half=p.qty*p.exitRules.partialFraction;if(half*m.bid*(1-config.slippage)>=m.rules.minQuote&&(p.qty-half)*m.bid*(1-config.slippage)>=m.rules.minQuote){reason='PARTIAL_TAKE_PROFIT';fraction=p.exitRules.partialFraction;}}
  }
  if(!reason)continue;const qty=roundUnit(p.qty*fraction,m.rules.qtyScale);
  if(qty*m.bid*(1-config.slippage)<m.rules.minQuote){decisions.push({at:now,action:'WAIT',symbol:p.symbol,strategyId:p.strategyId,horizon:p.horizon,reasons:['EXIT_BELOW_MARKET_MINIMUM'],triggeredExit:reason});continue;}
  const id='master31:exit:'+p.positionId+':'+now+':'+reason,o={id,symbol:p.symbol,side:'SELL',status:'OPEN',createdAt:now,signalAt:now,positionId:p.positionId,amount:qty,remaining:qty,limit:m.bid*(1-config.slippage),reference:m.bid,type:['RISK_REDUCTION_EXIT','FIXED_STOP','TRAILING_STOP'].includes(reason)?'market':'limit',qtyScale:m.rules.qtyScale,fillCount:0,strategyId:p.strategyId,strategyVersion:p.strategyVersion,horizon:p.horizon,reason};book.orders.push(o);decisions.push({id,signalId:id,at:now,action:'SELL',symbol:p.symbol,strategyId:p.strategyId,horizon:p.horizon,reasons:[reason],qty,entry:p.entryReference,stop:p.stop,target:p.target,simulation:true});
 }
 return decisions;
}
export function reserveMasterEntry(book,signal,risk,m,now){
 if(!risk.approved)throw Error('MASTER_RISK_APPROVAL_REQUIRED');if(book.mode!=='PAPER_ONLY'||signal.canTrade!==false)throw Error('MASTER_PAPER_AUTHORITY_REQUIRED');
 const order={id:signal.signalId,symbol:signal.symbol,side:'BUY',type:'limit',status:'OPEN',amount:risk.amountTHB,remaining:risk.amountTHB,limit:signal.entry,stop:signal.stop,target:signal.target,reference:m.ask,createdAt:now,quoteAt:m.observedAt,bookAt:m.depth.at,signalAt:signal.signalAt,fillCount:0,qtyScale:m.rules.qtyScale,minQuote:Math.max(10,m.rules.minQuote),riskTHB:risk.economics.modeledRiskTHB,riskEvidence:{budgetTHB:risk.riskBudgetTHB,economics:risk.economics,correlation:risk.correlation},strategyId:signal.strategyId,strategyVersion:signal.strategyVersion,horizon:signal.horizon,timeframe:signal.timeframe,exitPolicy:signal.exitPolicy,exitRules:signal.exitRules,regime:signal.regime,reason:signal.entryReason};book.orders.push(order);book.seen[signal.signalId]=now;return order;
}
export function compactMaster(book,now){
 const held=new Set(book.positions.map(p=>p.positionId)),keep=o=>activeMaster(o)||held.has(o.id);book.orders=[...book.orders.filter(o=>!keep(o)).slice(-100),...book.orders.filter(keep)];book.fills=book.fills.slice(-200);book.closed=[...book.closed.filter(p=>p.closedAt<now-86400000).slice(-100),...book.closed.filter(p=>p.closedAt>=now-86400000)];book.seen=Object.fromEntries(Object.entries(book.seen).filter(([,at])=>now-at<7*86400000));book.days=Object.fromEntries(Object.entries(book.days).sort(([a],[b])=>a.localeCompare(b)).slice(-400));
 if(JSON.stringify(book).length>700000)throw Error('MASTER_BOOK_SIZE_LIMIT');
 if(book.positions.length>5||book.cash<0||new Set(book.positions.map(p=>p.symbol)).size!==book.positions.length||new Set(book.orders.map(o=>o.id)).size!==book.orders.length)throw Error('INVALID_MASTER_LEDGER');return book;
}
