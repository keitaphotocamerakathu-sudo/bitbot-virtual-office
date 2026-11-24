// Quarantine conflicting public OHLC; never pick the more profitable duplicate.
import {parseHistory} from './market-data.mjs';import {resample} from './technical.mjs';
export function quarantineHistory(raw,minutes,now){
 if(raw?.s==='no_data')return{candles:[],quality:{inputRows:0,conflictingTimes:[],invalidTimes:[],recoveredDays:[]}};
 if(raw?.s!=='ok'||!['t','o','h','l','c','v'].every(k=>Array.isArray(raw[k])&&raw[k].length===raw.t.length))throw Error('MASTER_HISTORY_SHAPE_INVALID');
 const map=new Map(),bad=new Set(),conflicting=new Set(),invalid=new Set(),width=minutes*60000,num=x=>x!==null&&x!==''&&['number','string'].includes(typeof x)?Number(x):NaN;
 for(let i=0;i<raw.t.length;i++){const b={t:num(raw.t[i])*1000,o:num(raw.o[i]),h:num(raw.h[i]),l:num(raw.l[i]),c:num(raw.c[i]),v:num(raw.v[i]),source:'BITKUB_HISTORY'};if(b.t+width>now)continue;
  const valid=Object.values({t:b.t,o:b.o,h:b.h,l:b.l,c:b.c,v:b.v}).every(Number.isFinite)&&b.t>0&&b.t%width===0&&b.l>0&&b.o>=b.l&&b.c>=b.l&&b.h>=Math.max(b.o,b.c)&&b.v>=0;
  if(!valid){if(Number.isFinite(b.t)){bad.add(b.t);invalid.add(b.t);map.delete(b.t);}continue;}if(bad.has(b.t))continue;const old=map.get(b.t);if(old&&['o','h','l','c','v'].some(k=>old[k]!==b[k])){bad.add(b.t);conflicting.add(b.t);map.delete(b.t);continue;}map.set(b.t,b);
 }
 return{candles:[...map.values()].sort((a,b)=>a.t-b.t),quality:{inputRows:raw.t.length,conflictingTimes:[...conflicting],invalidTimes:[...invalid],recoveredDays:[]}};
}
export async function verifiedDailyHistory(raw,{json,symbol,now,maxRepairs=4}){
 const out=quarantineHistory(raw,1440,now),missing=[...new Set([...out.quality.conflictingTimes,...out.quality.invalidTimes])].filter(t=>t%86400000===0).sort((a,b)=>b-a).slice(0,maxRepairs);
 await Promise.all(missing.map(async t=>{try{const r=await json('https://api.bitkub.com/tradingview/history?symbol='+symbol+'&resolution=60&from='+t/1000+'&to='+(t+86400000)/1000),hour=parseHistory(r,60,now).filter(b=>b.t>=t&&b.t<t+86400000),day=resample(hour,1440,now,60).find(b=>b.t===t);if(!day)return;out.candles.push({...day,source:'COMPLETE_BITKUB_HOURS',evidence:{sourceMinutes:60,bars:24,from:t,to:t+86400000}});out.quality.recoveredDays.push(t);}catch{/* Remains quarantined and unavailable to strategies requiring continuity. */}}));
 out.candles.sort((a,b)=>a.t-b.t);out.quality.recoveredDays.sort((a,b)=>a-b);out.quality.unresolvedTimes=[...new Set([...out.quality.conflictingTimes,...out.quality.invalidTimes])].filter(t=>!out.quality.recoveredDays.includes(t));return out;
}
