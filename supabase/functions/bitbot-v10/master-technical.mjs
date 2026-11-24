// Closed Bitkub OHLCV only. The legacy/live indicator implementation is untouched.
import {indicators,resample,emaSeries} from './technical.mjs';
export const MASTER_FRAMES=Object.freeze([1,5,15,60,240,1440,10080]);
const avg=a=>a.reduce((s,n)=>s+n,0)/a.length;
function wilder(values,n){if(values.length<n)return[];let v=avg(values.slice(0,n));const out=[v];for(const x of values.slice(n)){v=(v*(n-1)+x)/n;out.push(v);}return out;}
function momentum(bars){
 const gains=[],losses=[],tr=[],plus=[],minus=[];
 for(let i=1;i<bars.length;i++){const p=bars[i-1],b=bars[i],d=b.c-p.c,u=b.h-p.h,v=p.l-b.l;gains.push(Math.max(0,d));losses.push(Math.max(0,-d));tr.push(Math.max(b.h-b.l,Math.abs(b.h-p.c),Math.abs(b.l-p.c)));plus.push(u>v&&u>0?u:0);minus.push(v>u&&v>0?v:0);}
 const g=wilder(gains,14).at(-1),l=wilder(losses,14).at(-1),atr=wilder(tr,14),p=wilder(plus,14),m=wilder(minus,14),dx=atr.map((a,i)=>{const up=a>0?100*p[i]/a:0,down=a>0?100*m[i]/a:0;return up+down>0?100*Math.abs(up-down)/(up+down):0;});
 return{rsi:g===undefined?null:l>0?100-100/(1+g/l):g>0?100:50,rsiMethod:'WILDER_14',adx:wilder(dx,14).at(-1)??null,plusDI:atr.at(-1)>0?100*p.at(-1)/atr.at(-1):null,minusDI:atr.at(-1)>0?100*m.at(-1)/atr.at(-1):null,atrWilder:atr.at(-1)??null};
}
export function weeklyFromDaily(bars,now){
 const DAY=86400000,WEEK=7*DAY,MONDAY=4*DAY,map=new Map();
 for(const b of bars||[]){if(b.t+DAY>now)continue;const t=Math.floor((b.t-MONDAY)/WEEK)*WEEK+MONDAY,list=map.get(t)||[];list.push(b);map.set(t,list);}
 return[...map].flatMap(([t,a])=>{a.sort((x,y)=>x.t-y.t);return t+WEEK<=now&&a.length===7&&a.every((b,i)=>b.t===t+i*DAY)?[{t,o:a[0].o,h:Math.max(...a.map(b=>b.h)),l:Math.min(...a.map(b=>b.l)),c:a.at(-1).c,v:a.reduce((s,b)=>s+b.v,0),source:'COMPLETE_BITKUB_DAYS'}]:[];}).sort((a,b)=>a.t-b.t);
}
export function advancedTechnical(source,minutes,now=Date.now()){
 const width=minutes*60000,bars=(source||[]).filter(b=>Number.isFinite(b?.t)&&b.t+width<=now),invalid=bars.some((b,i)=>![b.t,b.o,b.h,b.l,b.c,b.v].every(Number.isFinite)||Math.min(b.o,b.l,b.c)<=0||b.h<Math.max(b.o,b.c)||b.l>Math.min(b.o,b.c)||b.v<0||i&&b.t<=bars[i-1].t);
 const base=indicators(invalid?[]:bars,minutes,now),last=bars.at(-1),prev=bars.at(-2),xs=bars.map(b=>b.c),previous=bars.slice(-21,-1),resistance=previous.length?Math.max(...previous.map(b=>b.h)):null,support=previous.length?Math.min(...previous.map(b=>b.l)):null,volumeAverage=previous.length?avg(previous.map(b=>b.v)):0,volumeRatio=volumeAverage>0?last.v/volumeAverage:null;
 const sma=Object.fromEntries([9,20,21,50,200].map(n=>[n,xs.length>=n?avg(xs.slice(-n)):null])),swing=bars.slice(-60),high=swing.length?Math.max(...swing.map(b=>b.h)):null,low=swing.length?Math.min(...swing.map(b=>b.l)):null;
 let obv=0;for(let i=1;i<bars.length;i++)obv+=(bars[i].c>bars[i-1].c?1:bars[i].c<bars[i-1].c?-1:0)*bars[i].v;
 const patterns=[];if(last){const body=Math.abs(last.c-last.o),range=last.h-last.l,upper=last.h-Math.max(last.o,last.c),lower=Math.min(last.o,last.c)-last.l;if(range>0&&body<=range*.1)patterns.push('DOJI');if(body>0&&lower>=body*2&&upper<=body&&last.c>last.o)patterns.push('BULLISH_HAMMER');if(prev&&prev.c<prev.o&&last.c>last.o&&last.o<=prev.c&&last.c>=prev.o)patterns.push('BULLISH_ENGULFING');if(prev&&prev.c>prev.o&&last.c<last.o&&last.o>=prev.c&&last.c<=prev.o)patterns.push('BEARISH_ENGULFING');}
 const previousEMA=xs.length>21?emaSeries(xs.slice(0,-1),21).at(-1):null,previousEMA9=xs.length>9?emaSeries(xs.slice(0,-1),9).at(-1):null;
 return{...base,...momentum(bars),ready:base.ready&&!invalid,invalid,minutes,sma,obv,obvMethod:'AVAILABLE_CLOSED_BARS',support,resistance,volumeRatio,volumeSpike:volumeRatio!==null&&volumeRatio>=2,patterns,fibonacci:high>low?{high,low,levels:Object.fromEntries([.236,.382,.5,.618,.786].map(r=>[r,high-(high-low)*r])),method:'AVAILABLE_60_CLOSED_BAR_RANGE'}:null,breakout:!!last&&resistance>0&&last.c>resistance&&volumeRatio>=1.5,falseBreakout:!!last&&resistance>0&&last.h>resistance&&last.c<resistance,pullbackReclaim:!!prev&&previousEMA9>0&&prev.c<=previousEMA9&&last.c>base.ema?.[9],reversalDown:!!prev&&previousEMA>0&&prev.c>=previousEMA&&last.c<base.ema?.[21],lastClosedAt:last?last.t+width:null,lastClose:last?.c??null,barCount:bars.length,limitations:['INDICATORS_ARE_NOT_EMPIRICAL_WIN_PROBABILITIES','EMA_USES_FIRST_SAMPLE_SEED',...(base.ema?.[200]===null?['EMA200_INSUFFICIENT_HISTORY']:[])]};
}
export function technicalFrames(market,now){
 const extra=market.masterFrames||{},five=market.candles||[],hour=extra['60']||[],daily=extra['1440']||[];
 const source={'1':extra['1']||[],'5':five,'15':resample(five,15,now),'60':hour,'240':resample(hour,240,now,60),'1440':daily,'10080':weeklyFromDaily(daily,now)};
 return Object.fromEntries(MASTER_FRAMES.map(n=>[n,advancedTechnical(source[n],n,now)]));
}
