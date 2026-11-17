import {validSymbol} from './engine.mjs';
import {rankUniverse,assessNews} from './selection.mjs';
import {VERIFIED_DATA_POLICY,parseHistory,parseTrades,recoverHistory,historyQuality,candidateQueue} from './market-data.mjs';
export {VERIFIED_DATA_POLICY};
export function createVerifiedMarketService({base,json,read,rpc,clock=()=>Date.now()}){
 const local=new Map(),pending=new Map();
 async function cached(key,ttl,fn){
  const current=local.get(key);if(current&&current.expires>clock())return current.payload;if(pending.has(key))return pending.get(key);
  const job=(async()=>{const rows=await read('bitbot_v11_cache?key=eq.'+encodeURIComponent(key)+'&limit=1'),old=rows[0];if(old&&Date.parse(old.expires_at)>clock()){local.set(key,{expires:Date.parse(old.expires_at),payload:old.payload});return old.payload;}
   const payload=await fn(old?.payload),expires=clock()+ttl;await rpc('bitbot_v11_cache_put',{p_key:key,p_payload:payload,p_expires:new Date(expires).toISOString()});local.set(key,{expires,payload});return payload;})();pending.set(key,job);try{return await job;}finally{pending.delete(key);}
 }
 async function trades(symbol){return cached('trades-v17-'+symbol,15000,async()=>parseTrades(await json('https://api.bitkub.com/api/v3/market/trades?sym='+symbol.toLowerCase()+'&lmt=1000'),clock()));}
 async function history(symbol,minutes=5){
  if(!validSymbol(symbol))throw Error('คู่เหรียญไม่ถูกต้อง');const minimum=minutes===5?160:50,window=minutes===5?25:50;
  return cached('history-v17-'+minutes+'-'+symbol,minutes===5?45000:240000,async old=>{
   const now=clock(),end=Math.floor(now/1000),from=end-minutes*60*360;
   let bars=parseHistory(await json('https://api.bitkub.com/tradingview/history?symbol='+symbol+'&resolution='+minutes+'&from='+from+'&to='+end),minutes,now);
   let repaired=recoverHistory(bars,null,{minutes,now,previous:old?.candles||[]}),quality=historyQuality(repaired.candles,minutes,now,minimum,window),tradeError=null;
   if(!quality.ready){try{repaired=recoverHistory(bars,await trades(symbol),{minutes,now:clock(),previous:old?.candles||[]});}catch(e){tradeError=String(e.message).slice(0,120);}}
   quality=historyQuality(repaired.candles,minutes,clock(),minimum,window);return{...repaired,quality,tradeError,policy:VERIFIED_DATA_POLICY};
  });
 }
 async function depth(symbol){return cached('depth-v17-'+symbol,10000,async()=>{const d=await json('https://api.bitkub.com/api/v3/market/depth?sym='+symbol.toLowerCase()+'&lmt=20');if(d?.error!==0||!Array.isArray(d.result?.asks)||!Array.isArray(d.result?.bids))throw Error('อ่านสมุดคำสั่งไม่ได้');return{...d.result,at:clock()};});}
 async function detail(m){const [h,book]=await Promise.all([history(m.symbol),depth(m.symbol).catch(()=>null)]);return{...m,candles:h.candles,depth:book,dataQuality:{...h.quality,repair:h.repair,tradeError:h.tradeError,policy:VERIFIED_DATA_POLICY}};}
 async function scan(held=[]){
  const start=clock(),[all,feed]=await Promise.all([base.all(),base.news()]),ranked=rankUniverse(all,{budget:100000,maxOrder:500,dailyBuy:1500,dailySell:5000,minVolumeTHB:100000},feed,start);
  const saved=await read('bitbot_v11_cache?key=eq.scan-health-v17&limit=1'),health=new Map((saved[0]&&Date.parse(saved[0].expires_at)>clock()?saved[0].payload:[]).filter(x=>Number.isFinite(x.checkedAt)&&clock()-x.checkedAt<300000).map(x=>[x.symbol,x]));
  const queue=candidateQueue(ranked,held,health,start),rows=[],failures=[];
  for(let i=0;i<queue.length;i+=4){
   if(i&&(clock()-start>16000||rows.filter(m=>m.dataQuality.ready).length>=12))break;
   const batch=queue.slice(i,i+4),results=await Promise.allSettled(batch.map(detail));
   results.forEach((r,k)=>{if(r.status==='fulfilled'){rows.push(r.value);health.set(batch[k].symbol,{symbol:batch[k].symbol,ready:r.value.dataQuality.ready,reason:r.value.dataQuality.reason,checkedAt:clock()});}else{const failure={symbol:batch[k].symbol,ready:false,reason:String(r.reason?.message||'ข้อมูลตลาดไม่พร้อม'),checkedAt:clock()};failures.push(failure);health.set(batch[k].symbol,failure);}});
  }
  await rpc('bitbot_v11_cache_put',{p_key:'scan-health-v17',p_payload:[...health.values()].slice(-400),p_expires:new Date(clock()+300000).toISOString()});
  // Quotes are refreshed after history recovery, so processing time cannot silently age an entry quote.
  const latest=await base.all(),map=new Map(latest.map(m=>[m.symbol,m])),detailed=rows.map(m=>({...m,...(map.get(m.symbol)||{})}));
  return{version:'17.0.0',policy:VERIFIED_DATA_POLICY,observedAt:clock(),universeCount:all.filter(m=>m.status==='active').length,scannedCount:detailed.length,readyCount:detailed.filter(m=>m.dataQuality.ready).length,durationMs:clock()-start,failures,
   markets:detailed.sort((a,b)=>Number(held.includes(b.symbol))-Number(held.includes(a.symbol))||Number(b.dataQuality.ready)-Number(a.dataQuality.ready)),watchlist:ranked.map(({news,...m})=>({...m,dataQuality:health.get(m.symbol)||null,news:{ready:news?.ready,blocked:news?.blocked}})),
   news:{...feed,items:feed.items.slice(0,12).map(({body,...item})=>item)}};
 }
 async function single(symbol='BTC_THB'){const [all,feed]=await Promise.all([base.all(),base.news()]),m=all.find(x=>x.symbol===symbol);if(!m)throw Error('ไม่มีคู่เหรียญนี้ใน Bitkub');return{...await detail(m),news:assessNews(m,feed,clock())};}
 async function analysis(symbol){const result=await base.analysis(symbol);try{const hourly=await history(symbol,60);result.frames['60']=hourly.candles;result.hourlyQuality=hourly.quality;}catch(e){result.errors['60']=String(e.message);}return result;}
 return{scan,single,analysis,history};
}
