// Closed OHLCV only. Insufficient history is represented by null, never invented bars.
const mean=xs=>xs.reduce((a,b)=>a+b,0)/xs.length;
export function emaSeries(xs,period){if(!xs.length)return[];let v=xs[0];return xs.map((x,i)=>i?(v=x*2/(period+1)+v*(1-2/(period+1))):v);}
const lastEMA=(xs,p)=>xs.length>=p?emaSeries(xs,p).at(-1):null;
export function resample(bars,minutes,now=Date.now(),sourceMinutes=5){
 const width=minutes*60000,step=sourceMinutes*60000,map=new Map();
 for(const b of bars||[]){if(b.t+step>now)continue;const key=Math.floor(b.t/width)*width;const a=map.get(key)||[];a.push(b);map.set(key,a);}
 const out=[];for(const [t,rows] of map){rows.sort((a,b)=>a.t-b.t);if(t+width>now||rows.length!==minutes/sourceMinutes||rows[0].t!==t||rows.some((b,i)=>b.t!==t+i*step))continue;
 out.push({t,o:rows[0].o??rows[0].c,h:Math.max(...rows.map(b=>b.h)),l:Math.min(...rows.map(b=>b.l)),c:rows.at(-1).c,v:rows.every(b=>Number.isFinite(b.v))?rows.reduce((v,b)=>v+b.v,0):null});}
 return out.sort((a,b)=>a.t-b.t);
}
export function indicators(bars,minutes=5,now=Date.now()){
 const closed=(bars||[]).filter(b=>b.t+minutes*60000<=now&&[b.c,b.h,b.l].every(Number.isFinite)&&b.c>0&&b.l>0&&b.h>=b.c&&b.l<=b.c).sort((a,b)=>a.t-b.t),xs=closed.map(b=>b.c),last=closed.at(-1);
 if(!last)return{ready:false,bars:0,timeframe:minutes,reason:'ไม่มีแท่งปิดที่ใช้ได้'};
 const emas=Object.fromEntries([9,21,50,200].map(p=>[p,lastEMA(xs,p)]));let strength=null,atr=null;
 if(xs.length>=15){let up=0,down=0,tr=0;for(let i=xs.length-14;i<xs.length;i++){const d=xs[i]-xs[i-1],b=closed[i],prev=closed[i-1];up+=Math.max(0,d);down+=Math.max(0,-d);tr+=Math.max(b.h-b.l,Math.abs(b.h-prev.c),Math.abs(b.l-prev.c));}strength=down?100-100/(1+up/down):up?100:50;atr=tr/14;}
 let macd=null;if(xs.length>=35){const fast=emaSeries(xs,12),slow=emaSeries(xs,26),line=fast.map((v,i)=>v-slow[i]),signal=emaSeries(line,9).at(-1);macd={line:line.at(-1),signal,histogram:line.at(-1)-signal};}
 const recent=xs.slice(-20),center=recent.length===20?mean(recent):null,sigma=center===null?null:Math.sqrt(mean(recent.map(x=>(x-center)**2)));
 const weighted=closed.slice(-288).filter(b=>Number.isFinite(b.v)&&b.v>=0),volume=weighted.reduce((v,b)=>v+b.v,0),vwap=volume>0?weighted.reduce((v,b)=>v+(b.h+b.l+b.c)/3*b.v,0)/volume:null;
 const returns=xs.slice(-25).map((x,i,a)=>i?Math.log(x/a[i-1]):0),volatility=returns.length>1?Math.sqrt(mean(returns.slice(1).map(r=>r*r)))*Math.sqrt(60/minutes):null;
 const bias=emas[21]===null||emas[50]===null?'INSUFFICIENT':last.c>emas[21]&&emas[21]>emas[50]?'UPTREND':last.c<emas[21]&&emas[21]<emas[50]?'DOWNTREND':'SIDEWAYS';
 let volumeProfile=null;if(weighted.length>=60&&volume>0){const lo=Math.min(...weighted.map(b=>b.l)),hi=Math.max(...weighted.map(b=>b.h)),width=(hi-lo)/12;if(width>0){const bins=Array.from({length:12},(_,i)=>({from:lo+i*width,to:lo+(i+1)*width,volume:0}));for(const b of weighted){const index=Math.min(11,Math.floor((((b.h+b.l+b.c)/3)-lo)/width));bins[Math.max(0,index)].volume+=b.v;}volumeProfile={method:'CANDLE_TYPICAL_PRICE_APPROXIMATION',bins};}}
 const recentBars=closed.slice(-50),contiguous=recentBars.every((b,i)=>!i||b.t-recentBars[i-1].t===minutes*60000);
 return{ready:xs.length>=50&&contiguous&&now-(last.t+minutes*60000)<=minutes*120000,contiguous,timeframe:minutes,bars:xs.length,lastClosedAt:last.t+minutes*60000,ema:emas,rsi:strength,rsiMethod:'SIMPLE_14_BAR_GAINS_LOSSES',macd,bollinger:center===null?null:{middle:center,upper:center+2*sigma,lower:center-2*sigma},atr,vwap,vwapMethod:'ROLLING_AVAILABLE_CANDLES',volumeProfile,support:Math.min(...closed.slice(-20).map(b=>b.l)),resistance:Math.max(...closed.slice(-20).map(b=>b.h)),volatility,regime:volatility!==null&&volatility>.06?'HIGH_VOLATILITY':bias,reason:!contiguous?'แท่งราคาไม่ต่อเนื่อง':xs.length<200?'EMA200 ต้องมีแท่งปิดอย่างน้อย 200 แท่ง':'คำนวณจากแท่งปิดจริง'};
}
export function multiTimeframe(m,extra={},now=Date.now()){
 const source=m?.candles||[],hourly=extra['60']||[];
 return Object.fromEntries([['1',extra['1']||[],1],['5',source,5],['15',resample(source,15,now),15],['60',hourly,60],['240',resample(hourly,240,now,60),240],['1440',extra['1440']||[],1440]].map(([key,bars,minutes])=>[key,indicators(bars,minutes,now)]));
}
