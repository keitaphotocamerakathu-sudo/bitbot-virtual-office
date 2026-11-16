// Bitbot 10: five independent quantitative agents. No LLM or profit guarantee.
export const DEFAULTS=Object.freeze({budget:100000,maxOrder:500,dailyBuy:1500,dailySell:5000,allocation:0.2,stopLoss:0.02,takeProfit:0.04,dailyLoss:0.03,maxDrawdown:0.1,fee:0.0025,maxSpread:0.006,buyPaused:false});
export function config(input={},live=false){
 const c={...DEFAULTS,...input};
 const ranges={budget:[100,live?100000:10000000],maxOrder:[100,live?1000:100000],dailyBuy:[100,live?5000:1000000],dailySell:[100,live?10000:1000000],allocation:[0.01,0.2],stopLoss:[0.005,0.1],takeProfit:[0.01,0.3],dailyLoss:[0.005,0.05],maxDrawdown:[0.01,0.2],fee:[0.0025,0.01],maxSpread:[0.0001,0.006]};
 for(const [k,[lo,hi]] of Object.entries(ranges))if(typeof c[k]!=='number'||!Number.isFinite(c[k])||c[k]<lo||c[k]>hi)throw Error('ค่าตั้งไม่ถูกต้อง: '+k);
 if(c.maxOrder>c.budget||c.maxOrder>c.dailyBuy||c.maxOrder>c.dailySell)throw Error('วงเงินต่อคำสั่งต้องไม่เกินเงินทุนและวงเงินรายวัน');
 c.buyPaused=c.buyPaused===true;return c;
}
export const bangkokDay=ms=>new Date(ms+25200000).toISOString().slice(0,10);
export const floor8=v=>Math.floor((v+Number.EPSILON)*1e8)/1e8;
export function initial(c=DEFAULTS){return{cash:c.budget,qty:0,cost:0,realized:0,fees:0,peak:c.budget,day:'',dayStart:c.budget,dayPnl:0,bought:0,sold:0,lastCandle:0,trades:0,halted:false,lessons:{},entryStrategy:null,positionRealized:0};}
export function ema(values,period){if(!values.length)return NaN;const k=2/(period+1);return values.slice(1).reduce((v,x)=>x*k+v*(1-k),values[0]);}
export function rsi(values,p=14){if(values.length<p+1)return NaN;let gain=0,loss=0;for(let i=values.length-p;i<values.length;i++){const d=values[i]-values[i-1];gain+=Math.max(d,0);loss+=Math.max(-d,0);}return loss===0?(gain===0?50:100):100-100/(1+gain/loss);}
export function validMarket(m,now=Date.now()){
 if(!m||m.symbol!=='BTC_THB')throw Error('คู่เหรียญไม่ถูกต้อง');
 for(const k of ['last','bid','ask','observedAt'])if(typeof m[k]!=='number'||!Number.isFinite(m[k])||m[k]<=0)throw Error('ข้อมูลตลาดไม่ครบ');
 if(m.ask<m.bid||now-m.observedAt>30000||m.observedAt>now+5000||m.frozen)throw Error('ราคาหมดอายุหรือตลาดหยุด');
 if(!Array.isArray(m.candles)||m.candles.length<60)throw Error('รอแท่งเทียนปิดอย่างน้อย 60 แท่ง');
 let prev=0;for(const b of m.candles){if(!Number.isFinite(b.t)||b.t<=prev||b.t+300000>now||!Number.isFinite(b.c)||b.c<=0)throw Error('แท่งเทียนผิดรูปแบบหรือยังไม่ปิด');prev=b.t;}
 if(now-(prev+300000)>900000)throw Error('แท่งเทียนเก่าเกิน 15 นาที');
 return m;
}
export function trendAgent(m){const closes=m.candles.map(x=>x.c),fast=ema(closes,9),slow=ema(closes,21),strength=rsi(closes),slope=fast/ema(closes.slice(0,-1),9)-1;return{agent:'trend',fast,slow,rsi:strength,slope,bias:fast>slow&&slope>0?'UP':fast<slow?'DOWN':'FLAT',reason:'EMA9 / EMA21 และ RSI14 จากแท่งปิด 5 นาที'};}
export function strategyAgent(m,t,s){const c=m.candles.map(x=>x.c),last=c.at(-1),breakout=last>Math.max(...c.slice(-21,-1));const candidates=[{name:'trend-pullback',buy:t.bias==='UP'&&t.rsi>=45&&t.rsi<=68&&last>=t.fast*.998&&last<=t.fast*1.006},{name:'breakout',buy:t.bias==='UP'&&breakout&&t.rsi>=50&&t.rsi<=72}];const ranked=candidates.map(x=>{const l=s.lessons[x.name]||{wins:0,losses:0};return{...x,score:(l.wins+2)/(l.wins+l.losses+4),samples:l.wins+l.losses};}).sort((a,b)=>b.score-a.score);const picked=ranked.find(x=>x.buy);return{agent:'strategy',signal:picked?'BUY':t.bias==='DOWN'?'SELL':'HOLD',strategy:picked?.name||s.entryStrategy||'trend-pullback',candidates:ranked,reason:picked?'ผ่านเงื่อนไข '+picked.name:'รอสัญญาณที่ผ่าน EMA และ RSI'};}
export function riskAgent(m,s,c,proposal,now){
 const reasons=[],equity=s.cash+s.qty*m.bid,drawdown=s.peak>0?1-equity/s.peak:0;
 const positionPnl=s.qty>0?m.bid/(s.cost/s.qty)-1:0;
 const exit=s.qty>0&&(positionPnl<=-c.stopLoss?'STOP_LOSS':positionPnl>=c.takeProfit?'TAKE_PROFIT':proposal.signal==='SELL'?'TREND_EXIT':null);
 let action=exit?'SELL':proposal.signal==='BUY'&&s.qty===0?'BUY':'HOLD';
 if((m.ask-m.bid)/m.last>c.maxSpread)reasons.push('ส่วนต่างซื้อขายสูงเกินกำหนด');
 if(s.halted||drawdown>=c.maxDrawdown)reasons.push('ถึงเพดานขาดทุนจากจุดสูงสุด');
 if(s.dayPnl<=-s.dayStart*c.dailyLoss||equity<=s.dayStart*(1-c.dailyLoss))reasons.push('ถึงเพดานขาดทุนรายวัน');
 if(c.buyPaused)reasons.push('พักการซื้อใหม่');
 if(m.candles.at(-1).t<=s.lastCandle)reasons.push('แท่งนี้ประเมินแล้ว');
 if(action==='BUY'&&reasons.length)action='HOLD';
 // Wide spread blocks all new orders, including exits; no fills are invented.
 if((m.ask-m.bid)/m.last>c.maxSpread)action='HOLD';
 let notional=action==='BUY'?Math.min(c.maxOrder,c.dailyBuy-s.bought,s.cash/(1+c.fee),Math.max(0,equity*c.allocation-s.qty*m.ask)/(1+c.fee)):action==='SELL'?Math.min(s.qty*m.bid,c.maxOrder,c.dailySell-s.sold):0;
 if(notional<100){if(action!=='HOLD')reasons.push('วงเงินหรือมูลค่าคงเหลือต่ำกว่าขั้นต่ำ 100 บาท');action='HOLD';notional=0;}
 return{agent:'risk',action,notional,exit,drawdown,equity,positionPnl,blocked:reasons,reason:exit||reasons.join(' • ')||'ผ่านขีดจำกัดความเสี่ยง'};
}
export function executionAgent(m,s,r){
 const side=r.action;if(side==='HOLD')return{agent:'execution',order:null,reason:'ไม่มีคำสั่งส่ง'};
 const price=Math.round((side==='BUY'?m.ask:m.bid)*100)/100;
 const amount=side==='BUY'?Math.floor(r.notional*100)/100:floor8(Math.min(s.qty,r.notional/price));
 if((side==='BUY'?amount:amount*price)<100)return{agent:'execution',order:null,reason:'จำนวนหลังปัดเศษต่ำกว่าขั้นต่ำ'};
 return{agent:'execution',order:{side,price,amount,notional:side==='BUY'?amount:amount*price,type:'limit'},reason:'LIMIT • ซื้อเป็น THB • ขายเป็น BTC'};
}
export function applyFill(state,fill,c){
 const s=structuredClone(state),{side,qty,price,fee=0}=fill;
 if(!['BUY','SELL'].includes(side)||![qty,price,fee].every(Number.isFinite)||qty<=0||price<=0||fee<0)throw Error('ข้อมูลการจับคู่ไม่ถูกต้อง');
 if(side==='BUY'){const debit=qty*price+fee;if(debit>s.cash+0.02)throw Error('ยอดซื้อเกินเงินที่จัดสรร');s.cash-=debit;s.qty+=qty;s.cost+=debit;s.bought+=qty*price;s.entryStrategy=fill.strategy||s.entryStrategy||'trend-pullback';}
 else{if(qty>s.qty+1e-10)throw Error('ขายเกินจำนวน BTC ที่บอทถือ');const basis=s.qty? s.cost*Math.min(1,qty/s.qty):0,net=qty*price-fee,pnl=net-basis;s.cash+=net;s.qty=Math.max(0,s.qty-qty);s.cost=Math.max(0,s.cost-basis);s.realized+=pnl;s.dayPnl+=pnl;s.positionRealized=(s.positionRealized||0)+pnl;s.sold+=qty*price;
 if(s.qty<1e-10){s.qty=0;s.cost=0;const key=s.entryStrategy||'trend-pullback',l=s.lessons[key]||{wins:0,losses:0};if(s.positionRealized>0)l.wins++;else l.losses++;s.positionRealized=0;s.lessons[key]=l;s.entryStrategy=null;}}
 s.fees+=fee;s.trades++;return s;
}
export function cycle(m,state,c,now=Date.now()){
 c=config(c);let s=structuredClone(state);try{validMarket(m,now);}catch(e){return{state:s,order:null,trace:[{agent:'coordinator',reason:e.message},{agent:'trend',reason:'หยุด: ข้อมูลตลาดไม่พร้อม'},{agent:'strategy',reason:'HOLD'},{agent:'risk',reason:'ปิดการส่งคำสั่งเมื่อข้อมูลผิดปกติ'},{agent:'execution',reason:'ไม่ส่งคำสั่ง'}],error:e.message};}
 const day=bangkokDay(now),equity=s.cash+s.qty*m.bid;if(day!==s.day){s.day=day;s.dayPnl=0;s.bought=0;s.sold=0;s.dayStart=equity;}
 s.peak=Math.max(s.peak,equity);if(1-equity/s.peak>=c.maxDrawdown)s.halted=true;
 const trend=trendAgent(m),strategy=strategyAgent(m,trend,s),risk=riskAgent(m,s,c,strategy,now),execution=executionAgent(m,s,risk);
 s.lastCandle=Math.max(s.lastCandle,m.candles.at(-1).t);
 return{state:s,order:execution.order?{...execution.order,strategy:strategy.strategy,reason:risk.exit||strategy.reason}:null,trace:[{agent:'coordinator',reason:'รอบวิเคราะห์แท่งปิด '+new Date(m.candles.at(-1).t).toISOString(),mode:'QUANTITATIVE'},trend,strategy,risk,execution]};
}
export function paperCycle(m,s,c,now=Date.now()){
 const out=cycle(m,s,c,now);if(!out.order)return out;const o=out.order,price=o.side==='BUY'?m.ask*1.0005:m.bid*.9995;
 const qty=o.side==='BUY'?floor8(o.amount/price):Math.min(o.amount,out.state.qty),fee=qty*price*c.fee;
 try{out.state=applyFill(out.state,{side:o.side,qty,price,fee,strategy:o.strategy},c);out.fill={side:o.side,qty,price,fee,at:now,reason:o.reason};}
 catch(e){out.error=e.message;out.order=null;}return out;
}
