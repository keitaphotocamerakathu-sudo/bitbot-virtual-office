// REA SRS v1.0. Pure deterministic paper accounting; no fetch, credentials or LLM.
import {indicators} from './technical.mjs';
import {entryEvidence,exitEvidence,lossReentryGuard} from './rea-learning.mjs';
import {updatePaperPosition,qualityEntry,POSITION_POLICIES} from './rea-position-policy.mjs';
export const REA_LIMITS=Object.freeze({capital:10000,riskPerTrade:.01,maxTradeRisk:100,maxPositions:2,dailyLoss:.03,maxDailyLoss:300,maxPosition:4000,maxExposure:8000,fee:.0025,slippage:.002,maxSpread:.006,minVolume:250000,maxVolatility:.06,staleMs:30000,orderTTL:120000});
export const dayKey=ms=>new Date(ms+25200000).toISOString().slice(0,10);
const money=n=>Math.round((n+Number.EPSILON)*100)/100;
const down=n=>Math.floor((n+1e-10)*100)/100;
const fee=n=>Math.ceil((n*REA_LIMITS.fee-1e-10)*100)/100;
const floorQty=(n,scale=8)=>Math.floor((n+1e-12)*10**scale)/10**scale;
const active=o=>['OPEN','PARTIAL'].includes(o.status);
export function initialREA(now=Date.now()){
 return{version:1,mode:'PAPER_ONLY',initialCapital:10000,cash:10000,positions:[],orders:[],fills:[],closed:[],days:{},day:dayKey(now),dayStart:10000,dayFlows:0,realized:0,fees:0,peak:10000,maxDrawdown:0,dailyLocked:false,buyPaused:false,kill:'NONE',seen:{},equity:10000,dayPnl:0,lastAt:null,baselinePending:false};
}
export function validateREA(s){
 if(s?.version!==1||s.mode!=='PAPER_ONLY'||s.initialCapital!==10000||!Number.isFinite(s.cash)||s.cash<-.001||!Array.isArray(s.positions)||!Array.isArray(s.orders))throw Error('INVALID_RISK_STATE');
 if(s.positions.some(p=>![p.qty,p.cost,p.stop,p.target].every(Number.isFinite)||p.qty<=0||p.cost<=0||p.stop<=0||p.target<=p.stop))throw Error('INVALID_POSITION');
 if(new Set(s.orders.map(o=>o.id)).size!==s.orders.length||new Set(s.positions.map(p=>p.symbol)).size!==s.positions.length)throw Error('DUPLICATE_STATE');
 if(s.orders.filter(active).some(o=>!['BUY','SELL'].includes(o.side)||![o.limit,o.remaining,o.reserved].every(Number.isFinite)||o.remaining<0||o.reserved<0))throw Error('INVALID_ORDER');
 if(slotCount(s)>2)throw Error('POSITION_LIMIT_BREACHED');
 return s;
}
export function slotCount(s){return new Set([...s.positions.map(p=>p.symbol),...s.orders.filter(o=>active(o)&&o.side==='BUY').map(o=>o.symbol)]).size;}
export function reservedCash(s){return money(s.orders.filter(o=>active(o)&&o.side==='BUY').reduce((a,o)=>a+o.reserved,0));}
export function quoteOK(m,now){return !!m&&[m.ask,m.bid,m.last,m.observedAt].every(Number.isFinite)&&m.bid>0&&m.ask>=m.bid&&m.last>0&&now-m.observedAt<=30000&&m.observedAt<=now+5000&&!m.frozen;}
export function markREA(s,markets,now){
 let value=s.cash;for(const p of s.positions){const m=markets.find(m=>m.symbol===p.symbol);if(!quoteOK(m,now))return null;value+=p.qty*m.bid-fee(p.qty*m.bid);}return money(value);
}
function event(out,kind,reason,extra={}){out.events.push({kind,reason,...extra});}
function cancelBuys(s,out,reason){for(const o of s.orders.filter(o=>active(o)&&o.side==='BUY')){o.status='CANCELED';o.reserved=0;event(out,'CANCEL',reason,{orderId:o.id});}}
export function rollREA(s,markets,now,out={events:[]}){
 const equity=markREA(s,markets,now),today=dayKey(now);
 if(today!==s.day){s.days[s.day]={equity:s.equity,start:s.dayStart,flows:s.dayFlows,pnl:s.dayPnl,locked:s.dailyLocked};s.day=today;s.dayFlows=0;s.dayStart=equity??s.equity;s.baselinePending=equity===null;
  // A missed midnight with holdings cannot create a guessed start-of-day baseline.
  if(s.positions.length&&(!s.lastAt||now-s.lastAt>90000))s.baselinePending=true;
  if(!s.baselinePending&&s.kill==='NONE')s.dailyLocked=false;
 }
 if(equity===null){event(out,'SAFE_MODE','STALE_POSITION_MARK');return false;}
 s.equity=equity;s.dayPnl=money(equity-s.dayStart-s.dayFlows);s.peak=Math.max(s.peak,equity);s.maxDrawdown=Math.max(s.maxDrawdown,1-equity/s.peak);
 const limit=Math.min(300,Math.max(0,s.dayStart)*.03);
 if(s.dayPnl<=-limit&&!s.dailyLocked){s.dailyLocked=true;event(out,'DAILY_LOSS_LOCK','DAILY_EQUITY_LIMIT',{dayPnl:s.dayPnl,limit});}
 if(s.dailyLocked)cancelBuys(s,out,'DAILY_LOSS_LOCK');
 return !s.baselinePending;
}
export function cashflowREA(state,amount){const s=structuredClone(state);if(!Number.isFinite(amount)||s.cash+amount<reservedCash(s))throw Error('INVALID_CASHFLOW');s.cash=money(s.cash+amount);s.dayFlows=money(s.dayFlows+amount);s.equity=money(s.equity+amount);return s;}
export function riskSizeREA(s,{stopDistance,minQuote=10,riskBudgetCap=Infinity,openRiskRoom=Infinity},markets,now){
 const equity=markREA(s,markets,now);if(equity===null||!Number.isFinite(stopDistance)||stopDistance<=0||stopDistance>=1||![riskBudgetCap,openRiskRoom].every(v=>v===Infinity||Number.isFinite(v)&&v>=0))return{notional:0,risk:0,reason:'INVALID_SIZING_INPUT'};
 const risk=Math.min(100,Math.max(0,Math.min(10000,s.dayStart,equity))*.01);
 const heldRisk=s.positions.reduce((a,p)=>a+Math.max(0,p.cost-p.qty*p.stop*(1-REA_LIMITS.fee)),0);
 const pendingRisk=s.orders.filter(o=>active(o)&&o.side==='BUY').reduce((a,o)=>a+o.remaining*o.riskFraction,0);
 const dailyRoom=Math.max(0,Math.min(300,s.dayStart*.03)+s.dayPnl-heldRisk-pendingRisk);
 const budget=down(Math.min(risk,dailyRoom,riskBudgetCap,openRiskRoom)),fraction=stopDistance+REA_LIMITS.fee*2+REA_LIMITS.slippage;
 const exposure=s.positions.reduce((a,p)=>a+p.cost,0)+s.orders.filter(o=>active(o)&&o.side==='BUY').reduce((a,o)=>a+o.reserved,0);
 // At most ten partial fills, reserving a satang for rounding on every fill.
 const netCash=s.cash-reservedCash(s),n=down(Math.min((budget-.10)/fraction,(4000-.10)/(1+REA_LIMITS.fee),(8000-exposure-.10)/(1+REA_LIMITS.fee),(netCash-.10)/(1+REA_LIMITS.fee)));
 return{notional:n>=minQuote?n:0,risk:budget,riskFraction:fraction,modeledLoss:money(Math.max(0,n)*fraction+.10),reason:n>=minQuote?'RISK_APPROVED':'BELOW_MARKET_MINIMUM'};
}
export function scoreREA(m,now){
 const x=indicators(m.candles,5,now),bars=m.candles||[],last=bars.at(-1),prior=bars.slice(-21,-1),prev=bars.at(-2);
 const reasons=[];if(bars.some(b=>!Number.isFinite(b.t)||b.t+300000>now))reasons.push('UNFINISHED_CANDLE');if(!quoteOK(m,now))reasons.push('STALE_OR_INVALID_PRICE');
 if(m.wsReady===false)reasons.push('WEBSOCKET_STALE');
 if(m.status!=='active'||m.buyFrozen||m.sellFrozen||m.marketSource!=='exchange')reasons.push('MARKET_NOT_EXECUTABLE');
 if(m.dataQuality?.ready!==true||!x.ready)reasons.push('CANDLE_QUALITY');
 const spread=(m.ask-m.bid)/m.last;if(!Number.isFinite(spread)||spread>REA_LIMITS.maxSpread)reasons.push('SPREAD');
 if(!(m.volumeTHB>=REA_LIMITS.minVolume))reasons.push('LIQUIDITY');
 if(!(x.volatility<=REA_LIMITS.maxVolatility))reasons.push('VOLATILITY');
 const book=m.depth;if(!book||now-book.at>30000||!Array.isArray(book.asks)||!book.asks.length||!Array.isArray(book.bids)||!book.bids.length)reasons.push('ORDER_BOOK');
 const news=m.news||{};if(news.blocked===true)reasons.push('NEWS_RISK');
 const volumes=prior.map(b=>b.v).filter(Number.isFinite),average=volumes.length?volumes.reduce((a,b)=>a+b,0)/volumes.length:0,vr=average>0?last?.v/average:0;
 let strategy=null;
 if(x.regime==='UPTREND'&&x.rsi>=45&&x.rsi<=68&&x.macd?.histogram>0&&last?.c>=x.ema[9]*.998&&last.c<=x.ema[9]*1.006)strategy='TREND_FOLLOWING';
 if(last?.c>Math.max(...prior.map(b=>b.h))&&vr>=1.5&&x.regime==='UPTREND'&&x.rsi<=75)strategy='BREAKOUT';
 if(x.regime==='SIDEWAYS'&&x.bollinger&&prev?.c<x.bollinger.lower&&last?.c>x.bollinger.lower&&x.rsi>=25&&x.rsi<=45)strategy='MEAN_REVERSION';
 const factors={trend:x.regime==='UPTREND'?25:x.regime==='SIDEWAYS'?10:0,momentum:x.rsi>=45&&x.rsi<=68?20:x.rsi>=25&&x.rsi<=75?8:0,liquidity:Math.min(20,Math.max(0,Math.log10(Math.max(1,m.volumeTHB)/250000+1)*10)),volatility:Number.isFinite(spread)&&x.volatility<=.06?Math.max(0,15*(1-spread/.006)):0,strategy:strategy?15:0,news:news.ready===true&&now-news.fetchedAt<=1800000&&news.fetchedAt<=now+5000&&(news.headlines||[]).some(n=>n.contentRead===true&&n.publishedAt<=now&&now-n.publishedAt<21600000)?5:0};
 if(!strategy)reasons.push('NO_COMPLETE_STRATEGY');
 const stopDistance=Math.max(.02,(x.atr||0)*2/m.ask);
 return{symbol:m.symbol,score:money(Object.values(factors).reduce((a,b)=>a+b,0)),factors,strategy,eligible:reasons.length===0,reasons,indicators:x,stopDistance,signalAt:last?.t+300000,reference:m.ask,priceAt:m.observedAt};
}
function bookQty(m,side,limit){const rows=side==='BUY'?m.depth?.asks:m.depth?.bids;return(rows||[]).reduce((sum,row)=>{const price=Number(row.price??row[0]),qty=Number(row.base_volume??row[1]);return Number.isFinite(price)&&Number.isFinite(qty)&&qty>0&&(side==='BUY'?price<=limit:price>=limit)?sum+qty:sum;},0);}
function fillOrders(s,markets,now,out,riskOnly=false){
 for(const o of s.orders.filter(o=>active(o)&&(!riskOnly||o.side==='SELL'))){
  if(now-o.createdAt>=120000||o.fillCount>=10){o.status='CANCELED';o.reserved=0;event(out,'CANCEL','PAPER_LIMIT_TIMEOUT',{orderId:o.id});continue;}
  if(o.createdAt>=now)continue;const m=markets.find(m=>m.symbol===o.symbol);
  if(!quoteOK(m,now)||m.observedAt<=o.createdAt||!m.depth||m.depth.at<=o.createdAt||now-m.depth.at>30000||m.depth.at>now+5000)continue;
  const price=o.side==='BUY'?m.ask*(1+REA_LIMITS.slippage/2):m.bid*(1-REA_LIMITS.slippage/2);
  if(o.side==='BUY'?price>o.limit:price<o.limit)continue;
  const quantity=floorQty(Math.min(o.side==='BUY'?o.remaining/price:o.remaining,bookQty(m,o.side,o.limit)*.1),o.qtyScale);
  if(quantity<=0)continue;const gross=money(quantity*price),costFee=fee(gross),fillId=o.id+':'+o.fillCount;if(gross<=0)continue;
  const f={id:fillId,orderId:o.id,symbol:o.symbol,side:o.side,qty:quantity,price,fee:costFee,at:now,realized:0,simulation:true};
  if(o.side==='BUY'){
   if(gross+costFee>s.cash+.001)throw Error('PAPER_OVERSPEND');
   s.cash=money(s.cash-gross-costFee);let p=s.positions.find(p=>p.symbol===o.symbol);
   if(!p){p={symbol:o.symbol,qty:0,cost:0,stop:o.stop,target:o.target,strategy:o.strategy,openedAt:now,positionId:o.id,realized:0};s.positions.push(p);}p.qty+=quantity;p.cost+=gross+costFee;
   o.remaining=Math.max(0,o.remaining-gross);o.reserved=money(o.remaining+fee(o.remaining)+(10-o.fillCount)*.01);
  }else{
   const p=s.positions.find(p=>p.symbol===o.symbol);if(!p||quantity>p.qty+1e-9)throw Error('PAPER_OVERSELL');
   const basis=p.cost*quantity/p.qty;f.realized=money(gross-costFee-basis);s.realized=money(s.realized+f.realized);p.realized+=f.realized;s.cash=money(s.cash+gross-costFee);p.qty-=quantity;p.cost-=basis;o.remaining=Math.max(0,o.remaining-quantity);
   if(p.qty<10**-o.qtyScale){s.closed.push({id:p.positionId,symbol:p.symbol,pnl:money(p.realized),openedAt:p.openedAt,closedAt:now,...(p.protection?{protection:p.protection}:{})});s.positions=s.positions.filter(v=>v!==p);}
  }
  s.fees=money(s.fees+costFee);o.fillCount++;s.fills.push(f);out.fills.push(f);
  if(o.remaining<(o.side==='BUY'?Math.max(.01,price*10**-o.qtyScale):10**-o.qtyScale)){o.status='FILLED';o.reserved=0;}else o.status='PARTIAL';
  event(out,'FILL','PAPER_DEPTH_LIMITED_FILL',{orderId:o.id,fillId,status:o.status});
 }
}
export function cycleREA(state,bundle,now=Date.now(),control={}){
 if(control.positionPolicy!==undefined&&!POSITION_POLICIES.includes(control.positionPolicy))throw Error('INVALID_POSITION_STUDY_POLICY');
 if(control.entryStrategies!==undefined&&(!Array.isArray(control.entryStrategies)||!control.entryStrategies.length||control.entryStrategies.some(v=>!['TREND_FOLLOWING','BREAKOUT','MEAN_REVERSION'].includes(v))))throw Error('INVALID_EXPERIMENT_STRATEGIES');
 if(control.minEntryScore!==undefined&&(!Number.isFinite(control.minEntryScore)||control.minEntryScore<0||control.minEntryScore>100))throw Error('INVALID_EXPERIMENT_SCORE');
 const s=structuredClone(validateREA(state)),out={state:s,events:[],signals:[],fills:[],ranking:[],mode:'PAPER_ONLY',health:'OK'};
 if(control.kill!==undefined){if(!['NONE','ENTRY','ALL'].includes(control.kill))throw Error('INVALID_KILL');s.kill=control.kill;}
 if(control.buyPaused!==undefined)s.buyPaused=control.buyPaused===true;
 const markets=bundle?.markets||[],healthy=rollREA(s,markets,now,out);
 if(s.kill==='ALL'){for(const o of s.orders.filter(active)){o.status='CANCELED';o.reserved=0;}event(out,'EMERGENCY_STOP','ALL_ORDERS_STOPPED');s.lastAt=now;return out;}
 if(s.buyPaused||s.kill==='ENTRY'||!healthy)cancelBuys(s,out,s.buyPaused?'PAUSED':s.kill==='ENTRY'?'ENTRY_STOP':'SAFE_MODE');
 fillOrders(s,markets,now,out,control.riskOnly===true);rollREA(s,markets,now,out);
 if(control.positionPolicy)for(let i=0;i<s.positions.length;i++){
  const p=s.positions[i],managed=updatePaperPosition(p,markets.find(m=>m.symbol===p.symbol),now,{policy:control.positionPolicy,pendingEntry:s.orders.some(o=>active(o)&&o.side==='BUY'&&o.symbol===p.symbol)});s.positions[i]=managed.position;if(managed.event)out.events.push(managed.event);
 }
 // Risk exits run independently of entry signals, indicators, news and spread eligibility.
 for(const p of s.positions){
  const m=markets.find(m=>m.symbol===p.symbol);if(!quoteOK(m,now)||s.orders.some(o=>active(o)&&o.side==='SELL'&&o.symbol===p.symbol))continue;
  const reason=m.bid<=p.stop?(p.protection?.armed?'PROFIT_PROTECTION':'STOP_LOSS'):m.bid>=p.target?'TAKE_PROFIT':null;if(!reason)continue;
  cancelBuys(s,out,'POSITION_EXIT');const id='exit:'+p.positionId+':'+Math.floor(now/60000);
  s.orders.push({id,signalId:id,symbol:p.symbol,side:'SELL',status:'OPEN',limit:m.bid*(1-REA_LIMITS.slippage),remaining:p.qty,qtyScale:m.rules?.qtyScale??8,reserved:0,createdAt:now,fillCount:0,reason,strategy:p.strategy,positionId:p.positionId,exitEvidence:exitEvidence(p,m,reason,now)});event(out,'ORDER',reason,{orderId:id});
 }
 out.ranking=control.riskOnly===true?[]:markets.map(m=>scoreREA(m,now)).sort((a,b)=>b.score-a.score);
 const dataHealthy=markets.some(m=>quoteOK(m,now));
 const entryOK=control.riskOnly!==true&&control.operationalLock!==true&&healthy&&dataHealthy&&!s.dailyLocked&&!s.buyPaused&&s.kill==='NONE'&&s.mode==='PAPER_ONLY';
 if(!bundle||!dataHealthy||!healthy){out.health='SAFE_MODE';event(out,'SAFE_MODE',s.baselinePending?'MIDNIGHT_BASELINE_UNVERIFIED':'MARKET_DATA_UNAVAILABLE');}
 for(const r of out.ranking){
  const signalId=r.symbol+':'+(r.signalAt||now)+':'+(r.strategy||'WAIT');const decision={...r,signalId,at:now,approved:false};
  const lesson=control.lossCooldown===true?lossReentryGuard(s,r.symbol,r.strategy,now):{blocked:false};if(lesson.blocked)decision.learning=lesson;
  const gate=control.positionPolicy==='SELECTIVE_PROTECT'?qualityEntry(r,markets.find(m=>m.symbol===r.symbol),now):null;if(gate)decision.positionStudy=gate;
  const reject=!entryOK?'ENTRY_LOCKED':!r.eligible?r.reasons.join(','):control.entryStrategies&&!control.entryStrategies.includes(r.strategy)?'STRATEGY_NOT_IN_EXPERIMENT':r.score<(control.minEntryScore??0)?'EXPERIMENT_SCORE_FILTER':gate&&!gate.ready?gate.reason:slotCount(s)>=2?'MAX_POSITIONS':s.positions.some(p=>p.symbol===r.symbol)||s.orders.some(o=>active(o)&&o.symbol===r.symbol)?'SYMBOL_BUSY':s.seen[r.symbol]>=r.signalAt?'SIGNAL_ALREADY_USED':lesson.blocked?lesson.reason:null;
  if(reject){decision.reason=reject;out.signals.push(decision);continue;}
  const m=markets.find(m=>m.symbol===r.symbol),sizing=riskSizeREA(s,{stopDistance:r.stopDistance,minQuote:m.rules?.minQuote||10},markets,now);
  decision.sizing=sizing;if(!(sizing.notional>0)){decision.reason=sizing.reason;out.signals.push(decision);continue;}
  const id='rea:'+signalId,limit=m.ask*(1+REA_LIMITS.slippage),order={id,signalId,symbol:r.symbol,side:'BUY',status:'OPEN',limit,remaining:sizing.notional,qtyScale:m.rules?.qtyScale??8,reserved:money(sizing.notional+fee(sizing.notional)+.10),createdAt:now,fillCount:0,strategy:r.strategy,stop:limit*(1-r.stopDistance),target:limit*(1+r.stopDistance*2),riskFraction:sizing.riskFraction,modeledLoss:sizing.modeledLoss,reason:'RISK_APPROVED',entryEvidence:entryEvidence(r,m,now)};
  s.orders.push(order);s.seen[r.symbol]=r.signalAt;decision.approved=true;decision.reason='RISK_APPROVED';out.signals.push(decision);event(out,'ORDER','PAPER_ORDER_RESERVED',{orderId:id,risk:sizing.modeledLoss});
 }
 s.lastAt=now;rollREA(s,markets,now,out);validateREA(s);return out;
}
export function analyticsREA(s){
 const wins=s.closed.filter(t=>t.pnl>0),losses=s.closed.filter(t=>t.pnl<0),gain=wins.reduce((a,t)=>a+t.pnl,0),loss=-losses.reduce((a,t)=>a+t.pnl,0);
 return{closedTrades:s.closed.length,winRate:s.closed.length?wins.length/s.closed.length:null,profitFactor:loss>0?gain/loss:null,profitFactorReason:loss>0?null:'NO_REALIZED_LOSSES',maxDrawdown:s.maxDrawdown,fees:s.fees,realized:s.realized,unrealized:money(s.equity-s.cash-s.positions.reduce((a,p)=>a+p.cost,0)),dailyLossLimit:Math.min(300,s.dayStart*.03),riskBudget:Math.min(100,s.dayStart*.01),reserved:reservedCash(s),available:money(s.cash-reservedCash(s)),slots:slotCount(s)};
}
