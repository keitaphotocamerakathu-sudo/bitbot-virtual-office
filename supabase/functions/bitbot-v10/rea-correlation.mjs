// Descriptive co-movement only; no order, risk-limit or LLM capabilities.
export const CORRELATION_ROLE='Correlation Risk Analyst';
export const CORRELATION_PROTOCOL=Object.freeze({stepMs:300000,maxReturns:288,minReturns:60,highPositive:.8});
const finite=Number.isFinite,round=n=>{const r=Math.round(n*10000)/10000;return Object.is(r,-0)?0:r;};
const active=o=>['RESERVED','SUBMITTING','OPEN','PARTIAL','UNKNOWN','CANCEL_PENDING'].includes(o.status);
function returnsOf(m,now){
 if(!m||m.dataQuality?.ready!==true||!Array.isArray(m.candles))return{reason:'DATA_QUALITY',values:new Map()};
 const step=CORRELATION_PROTOCOL.stepMs,bars=m.candles.filter(b=>b&&finite(b.t)&&b.t+step<=now).sort((a,b)=>a.t-b.t).slice(-289),values=new Map();
 if(bars.some((b,i)=>!finite(b.c)||b.c<=0||b.t%step!==0||i&&b.t===bars[i-1].t))return{reason:'INVALID_OR_DUPLICATE_BAR',values};
 if(!bars.length||now-(bars.at(-1).t+step)>step*2)return{reason:'STALE_CANDLES',values};
 for(let i=1;i<bars.length;i++)if(bars[i].t-bars[i-1].t===step)values.set(bars[i].t+step,Math.log(bars[i].c)-Math.log(bars[i-1].c));
 return{values};
}
export function correlateMarkets(a,b,now=Date.now()){
 const x=returnsOf(a,now),y=returnsOf(b,now),pairs=[...x.values].filter(([t])=>y.values.has(t)).map(([t,v])=>({t,x:v,y:y.values.get(t)})).slice(-288),n=pairs.length;
 const base={a:a?.symbol??null,b:b?.symbol??null,n,r:null,from:pairs[0]?.t??null,to:pairs.at(-1)?.t??null,method:'PEARSON_5M_LOG_RETURNS',jointDownCount:pairs.filter(p=>p.x<0&&p.y<0).length};
 if(x.reason||y.reason||n<CORRELATION_PROTOCOL.minReturns)return{...base,ready:false,reason:x.reason||y.reason||'INSUFFICIENT_ALIGNED_RETURNS'};
 const mx=pairs.reduce((s,p)=>s+p.x,0)/n,my=pairs.reduce((s,p)=>s+p.y,0)/n;let xx=0,yy=0,xy=0;
 for(const p of pairs){const dx=p.x-mx,dy=p.y-my;xx+=dx*dx;yy+=dy*dy;xy+=dx*dy;}
 if(xx<=n*1e-24||yy<=n*1e-24)return{...base,ready:false,reason:'CONSTANT_RETURNS'};
 const r=round(Math.max(-1,Math.min(1,xy/Math.sqrt(xx*yy))));
 return{...base,ready:true,r,highPositive:r>=CORRELATION_PROTOCOL.highPositive,reason:r>=.8?'HIGH_POSITIVE_CO_MOVEMENT':'MEASURED_NOT_A_HEDGE_GUARANTEE'};
}
export function correlationReview({bundle,state,signals=[],now=Date.now()}){
 const markets=bundle?.markets||[],held=[...new Set([...(state?.positions||[]).map(p=>p.symbol),...(state?.orders||[]).filter(o=>active(o)&&o.side==='BUY').map(o=>o.symbol)])],requests=[];
 if(held.length>=2){for(let i=0;i<held.length;i++)for(let j=i+1;j<held.length;j++)requests.push({a:held[i],b:held[j],kind:'HELD_OR_PENDING'});}
 else{const candidates=signals.filter(s=>s.eligible&&!held.includes(s.symbol)).sort((a,b)=>b.score-a.score).slice(0,3).map(s=>s.symbol);
  if(held.length)for(const b of candidates)requests.push({a:held[0],b,kind:'CANDIDATE_COMPARISON'});
  else for(let i=0;i<candidates.length;i++)for(let j=i+1;j<candidates.length;j++)requests.push({a:candidates[i],b:candidates[j],kind:'CANDIDATE_COMPARISON'});
 }
 const pairs=requests.map(p=>({...correlateMarkets(markets.find(m=>m.symbol===p.a),markets.find(m=>m.symbol===p.b),now),a:p.a,b:p.b,kind:p.kind})),ready=pairs.filter(p=>p.ready),flagged=ready.filter(p=>p.highPositive),status=!ready.length?'WAITING':flagged.length?'DEGRADED':'COMPLETED';
 const summary=!requests.length?'รอคู่เหรียญที่ถือหรือสัญญาณสำหรับเปรียบเทียบ':!ready.length?'ข้อมูลผลตอบแทนที่ตรงเวลากันยังไม่พอ · ต้องมีอย่างน้อย 60 ช่วง':flagged.length?'พบเคลื่อนไหวทางเดียวกันสูง '+flagged.length+' คู่ · เป็นข้อสังเกต ไม่สั่งซื้อขาย':'วัดความสัมพันธ์ได้ '+ready.length+' คู่จากผลตอบแทน 5 นาที';
 return{role:CORRELATION_ROLE,at:now,status,summary,reason:summary,method:'PEARSON_5M_LOG_RETURNS',evidence:{protocol:CORRELATION_PROTOCOL,pairs,heldSymbols:held,readOnly:true,canTrade:false,canChangeLimits:false}};
}
