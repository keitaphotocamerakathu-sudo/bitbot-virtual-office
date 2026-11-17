import {PROFILES,profileStrategy} from './strategies.mjs';
import {INTRADAY_DEFAULTS,entryPlan,dailyBlocks,rollDay} from './intraday.mjs';
// Bitbot 12: six independent quantitative agents. No LLM or profit guarantee.
export const DEFAULTS=Object.freeze({...INTRADAY_DEFAULTS,strategyProfile:'legacy-v12',budget:100000,maxOrder:500,dailyBuy:1500,dailySell:5000,allocation:0.2,stopLoss:0.02,takeProfit:0.04,dailyLoss:0.03,maxDrawdown:0.1,fee:0.0025,maxSpread:0.006,buyPaused:false,walletReservePct:0.2,cashReserveTHB:0,riskPerTrade:0.01,minVolumeTHB:250000,maxVolatility:0.06,maxChase:0.025});
export function config(input={},live=false){
 const c={...DEFAULTS,...input};
 const ranges={maxHoldMinutes:[15,240],dailyProfitTarget:[0,.05],maxEntries:[1,20],lossStreakLimit:[1,5],cooldownMinutes:[15,240],minNetRR:[1.2,5],minNetProfit:[.001,.05],slippage:[.0005,.01],maxDepthImpact:[.0001,.005],minRangeCostRatio:[1.5,5],budget:[100,live?100000:10000000],maxOrder:[100,live?1000:100000],dailyBuy:[100,live?5000:1000000],dailySell:[100,live?10000:1000000],allocation:[0.01,0.2],stopLoss:[0.005,0.1],takeProfit:[0.01,0.3],dailyLoss:[0.005,0.05],maxDrawdown:[0.01,0.2],fee:[0.0025,0.01],maxSpread:[0.0001,0.006],walletReservePct:[0,0.8],cashReserveTHB:[0,1000000],riskPerTrade:[0.001,0.02],minVolumeTHB:[100000,1000000000],maxVolatility:[0.005,0.1],maxChase:[0.005,0.05]};
 for(const [k,[lo,hi]] of Object.entries(ranges))if(typeof c[k]!=='number'||!Number.isFinite(c[k])||c[k]<lo||c[k]>hi)throw Error('ค่าตั้งไม่ถูกต้อง: '+k);
 if(c.maxOrder>c.budget||c.maxOrder>c.dailyBuy||c.maxOrder>c.dailySell)throw Error('วงเงินต่อคำสั่งต้องไม่เกินเงินทุนและวงเงินรายวัน');
 for(const k of ['maxEntries','lossStreakLimit','maxHoldMinutes','cooldownMinutes'])if(!Number.isInteger(c[k]))throw Error('ค่าตั้งต้องเป็นจำนวนเต็ม: '+k);
 if(!PROFILES.includes(c.strategyProfile))throw Error('กลยุทธ์ไม่ถูกต้อง');
 c.intraday=c.intraday!==false;c.buyPaused=c.buyPaused===true;return c;
}
export const bangkokDay=ms=>new Date(ms+25200000).toISOString().slice(0,10);
export const floor8=v=>Math.floor((v+Number.EPSILON)*1e8)/1e8;

export const validSymbol=s=>typeof s==='string'&&/^[A-Z0-9]{1,16}_THB$/.test(s);
export const assetOf=s=>validSymbol(s)?s.slice(0,-4):'';
export const heldSymbol=s=>s.qty>0?(s.symbol||'BTC_THB'):null;
export function portfolioValue(s,markets=[]){
 if(!(s.qty>0))return s.cash;
 const quote=markets.find(m=>m.symbol===heldSymbol(s)&&Number.isFinite(m.bid)&&m.bid>0);
 return quote?s.cash+s.qty*quote.bid:null;
}

export function rules(m){const r=m.rules||{};return{minQuote:Number(r.minQuote)||10,priceStep:Number(r.priceStep)||.01,priceScale:Number.isInteger(r.priceScale)?r.priceScale:2,qtyScale:Number.isInteger(r.qtyScale)?r.qtyScale:8};}
export function roundUnit(v,scale=8){const p=10**scale;return Math.floor(v*p+1e-8)/p;}
export function tickPrice(v,r,buy){const q=v/r.priceStep;return Number(((buy?Math.ceil(q-1e-8):Math.floor(q+1e-8))*r.priceStep).toFixed(r.priceScale));}
export function newsAgent(m,now=Date.now()){
 const n=m.news;
 const ready=n?.ready===true&&Number.isFinite(n.fetchedAt)&&now-n.fetchedAt<=1800000&&n.fetchedAt<=now+5000;
 return{agent:'news',ready,blocked:!ready||n?.blocked===true,score:ready?Number(n.score)||0:0,
 headlines:ready?(n.headlines||[]).slice(0,5):[],method:n?.method||'HEADLINE_KEYWORD_FILTER',model:'NO_LLM',contentRead:n?.contentRead||0,sourceCount:n?.sourceCount||0,reason:!ready?'ข่าวไม่พร้อมหรือเก่าเกินกำหนด งดซื้อใหม่':n.blocked?'พบข่าวเสี่ยงที่เกี่ยวข้อง งดซื้อใหม่':n.headlines?.length?'ประเมินแหล่งข่าว เวลา และบริบทที่อ่านได้แล้ว ใช้ร่วมกับสัญญาณราคา':'แหล่งข่าวอัปเดต แต่ไม่มีหัวข่าวตรงเหรียญ ไม่ถือเป็นข่าวบวก'};
}
export function fundingAmount(c,w){
 const available=w?.THB?.available;
 if(typeof available!=='number'||!Number.isFinite(available)||available<0)throw Error('ยอดเงินบาทใช้ได้ไม่ถูกต้อง');
 return Math.max(0,Math.min(c.budget,available*(1-c.walletReservePct)-c.cashReserveTHB));
}

export function sizing(m,s,c,now=Date.now()){
 const q=m.wallet?.THB?.available??s.cash;
 const walletOK=typeof q==='number'&&Number.isFinite(q)&&q>=0&&(!m.wallet||Number.isFinite(m.wallet.at)&&now-m.wallet.at<=30000&&m.wallet.at<=now+5000);
 const available=walletOK?q:0,reserve=available*c.walletReservePct+c.cashReserveTHB;
 const spendable=Math.max(0,available-reserve),equity=s.cash+s.qty*m.bid;
 const stopDistance=Math.max(c.stopLoss,(m.atrPct||0)*2)+c.fee*2+(m.ask-m.bid)/m.last;
 const riskNotional=equity*c.riskPerTrade/stopDistance;
 const existing=(m.wallet?.[assetOf(m.symbol)]?.available||0)+(m.wallet?.[assetOf(m.symbol)]?.reserved||0);
 const concentrationRoom=m.wallet?Math.max(0,Math.min(c.budget,m.wallet.equityTHB??(available+existing*m.bid))*c.allocation-existing*m.bid):Infinity;
 const liquidityCap=m.volumeTHB?m.volumeTHB*.001:Infinity;
 const exitRoom=Math.max(0,(c.dailySell-s.sold)/(1+c.takeProfit+.01));
 return{walletOK,available,reserve,spendable,riskNotional,concentrationRoom,liquidityCap,exitRoom,
 maxBuy:Math.max(0,Math.min(c.maxOrder,c.dailyBuy-s.bought,s.cash,spendable,equity*c.allocation,riskNotional,concentrationRoom,liquidityCap,exitRoom))};
}

export function initial(c=DEFAULTS){return{cash:c.budget,qty:0,cost:0,realized:0,fees:0,peak:c.budget,day:'',dayStart:c.budget,dayPnl:0,bought:0,sold:0,lastCandle:0,trades:0,halted:false,lessons:{},entryStrategy:null,positionRealized:0,symbol:null,lastCandles:{},startCapital:c.budget,qtyScale:8,entryAt:null,entryPolicy:null,entriesToday:0,lossStreak:0,cooldownUntil:0,daily:{}};}
export function ema(values,period){if(!values.length)return NaN;const k=2/(period+1);return values.slice(1).reduce((v,x)=>x*k+v*(1-k),values[0]);}
export function rsi(values,p=14){if(values.length<p+1)return NaN;let gain=0,loss=0;for(let i=values.length-p;i<values.length;i++){const d=values[i]-values[i-1];gain+=Math.max(d,0);loss+=Math.max(-d,0);}return loss===0?(gain===0?50:100):100-100/(1+gain/loss);}
export function validMarket(m,now=Date.now()){
 if(!m||!validSymbol(m.symbol))throw Error('คู่เหรียญไม่ถูกต้อง');
 for(const k of ['last','bid','ask','observedAt'])if(typeof m[k]!=='number'||!Number.isFinite(m[k])||m[k]<=0)throw Error('ข้อมูลตลาดไม่ครบ');
 if(m.ask<m.bid||now-m.observedAt>30000||m.observedAt>now+5000||m.frozen)throw Error('ราคาหมดอายุหรือตลาดหยุด');
 if(!Array.isArray(m.candles)||m.candles.length<60)throw Error('รอแท่งเทียนปิดอย่างน้อย 60 แท่ง');
 let prev=0;for(const b of m.candles){if(!Number.isFinite(b.t)||b.t<=prev||b.t+300000>now||!Number.isFinite(b.c)||b.c<=0)throw Error('แท่งเทียนผิดรูปแบบหรือยังไม่ปิด');prev=b.t;}
 if(now-(prev+300000)>900000)throw Error('แท่งเทียนเก่าเกิน 15 นาที');
 return m;
}
export function trendAgent(m){
 const bars=m.candles,closes=bars.map(x=>x.c),fast=ema(closes,9),slow=ema(closes,21),strength=rsi(closes),slope=fast/ema(closes.slice(0,-1),9)-1;
 const returns=closes.slice(1).map((p,i)=>Math.log(p/closes[i])),recent=returns.slice(-24);
 const volatility=Math.sqrt(recent.reduce((sum,r)=>sum+r*r,0)/Math.max(1,recent.length))*Math.sqrt(12);
 const atrPct=bars.slice(-14).reduce((sum,b,i)=>sum+(Number.isFinite(b.h)&&Number.isFinite(b.l)?(b.h-b.l)/b.c:Math.abs(returns.slice(-14)[i]||0)),0)/14;
 return{agent:'trend',fast,slow,rsi:strength,slope,volatility,atrPct,bias:fast>slow&&slope>0?'UP':fast<slow?'DOWN':'FLAT',reason:'EMA9/21, RSI14, ATR และความผันผวนจากแท่งปิด 5 นาที'};
}
export function strategyAgent(m,t,s,cfg={strategyProfile:'legacy-v12'}){if(cfg.strategyProfile!=='legacy-v12')return profileStrategy(m,s,cfg.strategyProfile);const c=m.candles.map(x=>x.c),last=c.at(-1),breakout=last>Math.max(...c.slice(-21,-1));const candidates=[{name:'trend-pullback',buy:t.bias==='UP'&&t.rsi>=45&&t.rsi<=68&&last>=t.fast*.998&&last<=t.fast*1.006},{name:'breakout',buy:t.bias==='UP'&&breakout&&t.rsi>=50&&t.rsi<=72}];const ranked=candidates.map(x=>{const l=s.lessons[x.name]||{wins:0,losses:0};return{...x,score:(l.wins+2)/(l.wins+l.losses+4),samples:l.wins+l.losses};}).sort((a,b)=>b.score-a.score);const picked=ranked.find(x=>x.buy);return{agent:'strategy',signal:picked?'BUY':t.bias==='DOWN'?'SELL':'HOLD',strategy:picked?.name||s.entryStrategy||'trend-pullback',candidates:ranked,reason:picked?'ผ่านเงื่อนไข '+picked.name:'รอสัญญาณที่ผ่าน EMA และ RSI'};}
export function riskAgent(m,s,c,proposal,now){
 const reasons=[],equity=s.cash+s.qty*m.bid,drawdown=s.peak>0?1-equity/s.peak:0;
 const positionPnl=s.qty>0?m.bid/(s.cost/s.qty)-1:0;
 const policy=s.entryPolicy||{stopLoss:c.stopLoss,takeProfit:c.takeProfit,maxHoldMinutes:0};
 const netPositionPnl=s.qty>0?(s.qty*m.bid-Math.ceil(s.qty*m.bid*c.fee*100)/100)/s.cost-1:0;
 const exitPnl=policy.legacy===true?positionPnl:netPositionPnl;
 const exit=s.qty>0&&(exitPnl<=-policy.stopLoss?'STOP_LOSS':exitPnl>=policy.takeProfit?'TAKE_PROFIT':policy.maxHoldMinutes>0&&s.entryAt&&now-s.entryAt>=policy.maxHoldMinutes*60000?'TIME_EXIT':proposal.signal==='SELL'?'TREND_EXIT':null);
 let action=exit?'SELL':proposal.signal==='BUY'&&s.qty===0?'BUY':'HOLD';
 const spread=(m.ask-m.bid)/m.last,n=newsAgent(m,now),power=sizing(m,s,c,now),r=rules(m);
 if(spread>c.maxSpread)reasons.push('ส่วนต่างซื้อขายสูงเกินกำหนด');
 if(s.halted||drawdown>=c.maxDrawdown)reasons.push('ถึงเพดานขาดทุนจากจุดสูงสุด');
 if(s.dayPnl<=-s.dayStart*c.dailyLoss||equity<=s.dayStart*(1-c.dailyLoss))reasons.push('ถึงเพดานขาดทุนรายวัน');
 if(c.buyPaused)reasons.push('พักการซื้อใหม่');
 const seen=s.lastCandles?.[m.symbol]??(m.symbol==='BTC_THB'?s.lastCandle:0);
 if(m.candles.at(-1).t<=seen)reasons.push('แท่งนี้ประเมินแล้ว');
 if(n.blocked)reasons.push(n.reason);
 if(!power.walletOK)reasons.push('ยอดกระเป๋าไม่พร้อมหรือหมดอายุ');
 if(m.marketSource==='broker')reasons.push('API ซื้อขายปัจจุบันไม่รองรับเหรียญ broker');
 if(m.buyFrozen)reasons.push('ตลาดระงับการซื้อเหรียญนี้');
 if(m.volumeTHB!==undefined&&m.volumeTHB<c.minVolumeTHB)reasons.push('สภาพคล่องต่ำกว่าเกณฑ์');
 if(m.volatility>c.maxVolatility)reasons.push('ความผันผวนสูงกว่าเกณฑ์');
 const close=m.candles.map(x=>x.c),chase=close.at(-1)/close.at(-4)-1;
 if(chase>c.maxChase)reasons.push('ราคาพุ่งเร็วเกินไป รอจังหวะย่อ');
 const plan=entryPlan(m,c,power.maxBuy,now);reasons.push(...plan.reasons,...dailyBlocks(s,c,now));
 if(action==='BUY'&&reasons.length)action='HOLD';
 if(spread>c.maxSpread||action==='SELL'&&m.sellFrozen)action='HOLD';
 let notional=action==='BUY'?power.maxBuy:action==='SELL'?Math.min(s.qty*m.bid,c.maxOrder,c.dailySell-s.sold):0;
 const minimum=action==='BUY'?Math.ceil(r.minQuote*(1+c.stopLoss*2+c.fee*2)*100)/100:r.minQuote;
 if(notional<minimum){if(action!=='HOLD')reasons.push('วงเงินหลังสำรองต่ำกว่าขั้นต่ำที่ขายออกได้: '+minimum+' บาท');action='HOLD';notional=0;}
 return{agent:'risk',action,notional,exit,drawdown,equity,positionPnl,wallet:power,plan,exitMinimum:Math.ceil(r.minQuote*(1+c.stopLoss*2+c.fee*2)*100)/100,netPositionPnl,blocked:reasons,reason:exit||reasons.join(' • ')||'ผ่านวงเงิน กระเป๋า สภาพคล่อง ข่าว และความเสี่ยง'};
}
export function executionAgent(m,s,r){
 const side=r.action;if(side==='HOLD')return{agent:'execution',order:null,reason:'ไม่มีคำสั่งส่ง'};
 const rule=rules(m),price=tickPrice(side==='BUY'?m.ask:m.bid,rule,side==='BUY');
 if(!Number.isFinite(price)||price<=0||Math.abs(price/(side==='BUY'?m.ask:m.bid)-1)>.015)return{agent:'execution',order:null,reason:'ความละเอียดราคาขัดกับราคาเสนอ งดส่งคำสั่ง'};
 let amount=side==='BUY'?Math.floor(r.notional*100)/100:roundUnit(Math.min(s.qty,r.notional/price),rule.qtyScale);
 // Leave a sellable second slice when a cap prevents closing the entire position.
 if(side==='SELL'&&amount<s.qty-10**-rule.qtyScale/2&&(s.qty-amount)*price<(r.exitMinimum||rule.minQuote*1.05)){
 amount=Math.min(amount,roundUnit(Math.max(0,s.qty-(r.exitMinimum||rule.minQuote*1.05)/price),rule.qtyScale));
 }
 if((side==='BUY'?amount:amount*price)<rule.minQuote)return{agent:'execution',order:null,reason:'จำนวนหลังปัดเศษต่ำกว่าขั้นต่ำตลาด'};
 return{agent:'execution',order:{symbol:m.symbol,side,price,amount,qtyScale:rule.qtyScale,notional:side==='BUY'?amount:amount*price,type:'limit',...(side==='BUY'?{entryPolicy:r.plan}:{})},reason:'LIMIT '+m.symbol+' • ซื้อเป็น THB • ขายเป็น '+assetOf(m.symbol)};
}
export function applyFill(state,fill,c){
 let s=structuredClone(state);const {side,qty,price,fee=0}=fill;
 const at=Number.isFinite(fill.at)?fill.at:Date.now(),isEntry=side==='BUY'&&s.qty===0;
 s=rollDay(s,at,s.cash+s.qty*price);const daily=s.daily[s.day];
 if(!['BUY','SELL'].includes(side)||![qty,price,fee].every(Number.isFinite)||qty<=0||price<=0||fee<0)throw Error('ข้อมูลการจับคู่ไม่ถูกต้อง');
 if(side==='BUY'){if(isEntry){s.entryAt=at;s.entryPolicy=fill.entryPolicy||null;s.entriesToday=(s.entriesToday||0)+1;daily.entries++;}if(s.qty>0&&heldSymbol(s)!==(fill.symbol||'BTC_THB'))throw Error('ห้ามรวมคนละเหรียญในสถานะเดียว');s.symbol=fill.symbol||s.symbol||'BTC_THB';s.qtyScale=fill.qtyScale??s.qtyScale??8;const debit=fill.spend??(qty*price+fee);if(!Number.isFinite(debit)||debit<qty*price+fee-0.000001)throw Error('ยอดใช้ซื้อไม่ถูกต้อง');if(debit>s.cash+0.02)throw Error('ยอดซื้อเกินเงินที่จัดสรร');s.cash-=debit;s.qty+=qty;s.cost+=debit;s.bought+=debit;s.entryStrategy=fill.strategy||s.entryStrategy||'trend-pullback';}
 else{if(fill.symbol&&fill.symbol!==heldSymbol(s))throw Error('เหรียญขายไม่ตรงกับสถานะ');if(qty>s.qty+1e-10)throw Error('ขายเกินจำนวน BTC ที่บอทถือ');const basis=s.qty? s.cost*Math.min(1,qty/s.qty):0,net=qty*price-fee,pnl=net-basis;s.cash+=net;s.qty=Math.max(0,s.qty-qty);s.cost=Math.max(0,s.cost-basis);s.realized+=pnl;s.dayPnl+=pnl;s.positionRealized=(s.positionRealized||0)+pnl;s.sold+=qty*price;daily.realized+=pnl;
 if(s.qty<Math.max(1e-10,10**-(s.qtyScale??8)/2)){s.qty=0;s.symbol=null;s.cost=0;const key=s.entryStrategy||'trend-pullback',l=s.lessons[key]||{wins:0,losses:0};if(s.positionRealized>0)l.wins++;else l.losses++;daily.rounds++;if(s.positionRealized>0){daily.wins++;s.lossStreak=0;}else if(s.positionRealized<0){daily.losses++;s.lossStreak=(s.lossStreak||0)+1;if(s.lossStreak>=c.lossStreakLimit){s.cooldownUntil=at+c.cooldownMinutes*60000;s.lossStreak=0;}}s.entryAt=null;s.entryPolicy=null;s.positionRealized=0;s.lessons[key]=l;s.entryStrategy=null;}}
 s.fees+=fee;daily.fees+=fee;s.trades++;return s;
}
export function cycle(m,state,c,now=Date.now()){
 c=config(c);let s=structuredClone(state);try{validMarket(m,now);if(heldSymbol(s)&&heldSymbol(s)!==m.symbol)throw Error('ต้องดูแลเหรียญที่ถือก่อนเลือกซื้อเหรียญใหม่');}catch(e){return{state:s,order:null,trace:[{agent:'coordinator',reason:e.message},{agent:'trend',reason:'หยุด: ข้อมูลตลาดไม่พร้อม'},{agent:'news',reason:'รอข้อมูลข่าว'},{agent:'strategy',reason:'HOLD'},{agent:'risk',reason:'ปิดการส่งคำสั่งเมื่อข้อมูลผิดปกติ'},{agent:'execution',reason:'ไม่ส่งคำสั่ง'}],error:e.message};}
 const equity=s.cash+s.qty*m.bid;s=rollDay(s,now,equity);
 s.peak=Math.max(s.peak,equity);if(1-equity/s.peak>=c.maxDrawdown)s.halted=true;
 const trend=trendAgent(m);m={...m,volatility:trend.volatility,atrPct:trend.atrPct};const news=newsAgent(m,now),strategy=strategyAgent(m,trend,s,c),risk=riskAgent(m,s,c,strategy,now),execution=executionAgent(m,s,risk);
 s.lastCandle=Math.max(s.lastCandle,m.candles.at(-1).t);s.lastCandles={...s.lastCandles,[m.symbol]:m.candles.at(-1).t};
 return{state:s,order:execution.order?{...execution.order,strategy:strategy.strategy,reason:risk.exit||strategy.reason}:null,trace:[{agent:'coordinator',reason:'รอบวิเคราะห์แท่งปิด '+new Date(m.candles.at(-1).t).toISOString(),mode:'QUANTITATIVE'},trend,news,strategy,risk,execution]};
}
export function paperCycle(m,s,c,now=Date.now()){
 const out=cycle(m,s,c,now);if(!out.order)return out;const o=out.order,price=o.side==='BUY'?m.ask*(1+c.slippage):m.bid*(1-c.slippage);
 const fee=o.side==='BUY'?Math.ceil(o.amount*c.fee*100)/100:Math.ceil(o.amount*price*c.fee*100)/100;
 const qty=o.side==='BUY'?roundUnit((o.amount-fee)/price,o.qtyScale):Math.min(o.amount,out.state.qty);
 try{out.state=applyFill(out.state,{symbol:o.symbol,qtyScale:o.qtyScale,side:o.side,qty,price,fee,strategy:o.strategy,at:now,entryPolicy:o.entryPolicy,...(o.side==='BUY'?{spend:o.amount}:{})},c);out.fill={symbol:o.symbol,side:o.side,qty,price,fee,at:now,reason:o.reason};}
 catch(e){out.error=e.message;out.order=null;}return out;
}
