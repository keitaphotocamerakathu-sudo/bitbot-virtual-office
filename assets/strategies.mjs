// Three preregistered quantitative hypotheses. Signals are not profit probabilities.
export const PROFILES=Object.freeze(['legacy-v12','trend-confirmed','volume-breakout','range-reversion']);
const mean=x=>x.reduce((a,b)=>a+b,0)/Math.max(1,x.length);
const ema=(xs,p)=>xs.slice(1).reduce((v,x)=>x*2/(p+1)+v*(1-2/(p+1)),xs[0]);
const rsi=xs=>{let up=0,down=0;for(let i=xs.length-14;i<xs.length;i++){const d=xs[i]-xs[i-1];up+=Math.max(0,d);down+=Math.max(0,-d);}return down?100-100/(1+up/down):up?100:50;};
export function profileFeatures(bars){
 if(!Array.isArray(bars)||bars.length<160)return null;
 const xs=bars.map(b=>b.c),last=bars.at(-1),previous=bars.at(-2),fast=ema(xs,21),medium=ema(xs,55),slow=ema(xs,144),priorFast=ema(xs.slice(0,-1),21);
 if(!bars.slice(-25).every((b,i,a)=>Number.isFinite(b.v)&&b.v>=0&&Number.isFinite(b.h)&&Number.isFinite(b.l)&&b.h>=b.c&&b.l<=b.c&&b.l>0&&(!i||b.t-a[i-1].t===300000)))return null;
 const recent=bars.slice(-15);let tr=0,plus=0,minus=0;
 for(let i=1;i<recent.length;i++){const b=recent[i],p=recent[i-1],u=b.h-p.h,d=p.l-b.l;tr+=Math.max(b.h-b.l,Math.abs(b.h-p.c),Math.abs(b.l-p.c));plus+=u>d&&u>0?u:0;minus+=d>u&&d>0?d:0;}
 const direction=plus+minus?Math.abs(plus-minus)/(plus+minus):0,volumeMean=mean(bars.slice(-21,-1).map(b=>b.v)),sigma=Math.sqrt(mean(xs.slice(-20).map(x=>(x-mean(xs.slice(-20)))**2)));
 return{last:last.c,previous:previous.c,fast,priorFast,medium,slow,rsi:rsi(xs),priorRsi:rsi(xs.slice(0,-1)),direction,volumeRatio:volumeMean>0?last.v/volumeMean:0,
 breakout:Math.max(...bars.slice(-21,-1).map(b=>b.h)),z:sigma?(last.c-mean(xs.slice(-20)))/sigma:0,
 priorZ:sigma?(previous.c-mean(xs.slice(-21,-1)))/sigma:0,atrPct:tr/14/last.c,
 up:medium>slow&&medium>ema(xs.slice(0,-3),55),down:medium<slow&&last.c<medium,
 belowFast:last.c<fast&&previous.c<priorFast};
}
const cache=new WeakMap();
export function profileStrategy(m,s,profile){
 let f=cache.get(m.candles);if(f===undefined){f=profileFeatures(m.candles);cache.set(m.candles,f);}
 if(!f)return{agent:'strategy',signal:'HOLD',strategy:profile,candidates:[],reason:'รอแท่งปิด High/Low และ Volume ต่อเนื่องสำหรับกลยุทธ์ใหม่'};
 let buy=false,exit=false;
 if(profile==='trend-confirmed'){
  buy=f.up&&f.direction>=.25&&f.rsi>=48&&f.rsi<=65&&f.previous<=f.priorFast*1.002&&f.last>f.fast&&f.last<f.fast*1.004&&f.volumeRatio>=1.2;
  exit=f.belowFast&&f.rsi<45;
 }else if(profile==='volume-breakout'){
  buy=f.up&&f.last>f.breakout&&f.rsi>=55&&f.rsi<=75&&f.volumeRatio>=1.5;
  exit=f.belowFast&&f.rsi<45;
 }else if(profile==='range-reversion'){
  buy=!f.down&&f.direction<.25&&f.priorZ<=-1.8&&f.priorRsi<35&&f.rsi>=35&&f.last>f.previous&&(f.fast/f.last-1)>=.012;
  exit=f.last>=f.fast||f.down;
 }
 const holding=s.qty>0,canTrendExit=holding&&(!s.entryAt||m.observedAt-s.entryAt>=900000);
 return{agent:'strategy',signal:holding?(exit&&canTrendExit?'SELL':'HOLD'):buy?'BUY':'HOLD',strategy:profile,
 candidates:[{name:profile,buy,score:0,samples:0}],features:f,
 reason:holding&&exit&&canTrendExit?'สัญญาณออกของ '+profile:buy?'ผ่านแนวโน้ม ปริมาณซื้อขาย และจังหวะ '+profile:'รอจังหวะที่ผ่านเกณฑ์ '+profile};
}
