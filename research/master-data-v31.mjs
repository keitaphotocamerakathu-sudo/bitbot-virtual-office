import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
export const DATA_PROTOCOL=Object.freeze({version:'31.0.0',symbols:['BTC_THB','ETH_THB','XRP_THB','ADA_THB'],end:'2026-11-23T00:00:00Z',days:120,trainDays:60,foldDays:20,selection:'FOUR_FIXED_CURRENT_LIQUID_SURVIVORS_NOT_HISTORICAL_UNIVERSE',noFuture:true});
const DAY=86400000;
export async function loadMasterHistory(cache='/tmp/rea31-history.json'){
 const end=Date.parse(DATA_PROTOCOL.end),start=end-DATA_PROTOCOL.days*DAY;
 try{const x=JSON.parse(await fs.readFile(cache,'utf8'));if(x.start===start&&x.end===end&&JSON.stringify(Object.keys(x.data))===JSON.stringify(DATA_PROTOCOL.symbols))return x;}catch{}
 async function get(url){for(let i=0;i<3;i++){try{const r=await fetch(url,{signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error('BITKUB_PUBLIC_HTTP_'+r.status);return await r.json();}catch(e){if(i===2)throw e;await new Promise(r=>setTimeout(r,500*(i+1)));}}}
 const data={},anomalies={};for(const symbol of DATA_PROTOCOL.symbols){data[symbol]={};anomalies[symbol]={};}
 for(let si=0;si<DATA_PROTOCOL.symbols.length;si+=2)await Promise.all(DATA_PROTOCOL.symbols.slice(si,si+2).map(async symbol=>{
  for(const [frame,warmup,chunk] of [[5,3,5],[60,20,30],[1440,780,390]]){
   const frameCache=cache+"."+symbol+"."+frame;try{const cached=JSON.parse(await fs.readFile(frameCache,"utf8"));if(cached.start===start&&cached.end===end){data[symbol][frame]=cached.bars;anomalies[symbol][frame]=cached.anomalies;continue;}}catch{}
   const map=new Map(),rejected=new Set(),issues=[],begin=start-warmup*DAY;
   for(let from=begin;from<end;from+=chunk*DAY){const to=Math.min(end,from+chunk*DAY),r=await get('https://api.bitkub.com/tradingview/history?symbol='+symbol+'&resolution='+(frame===1440?'1D':frame)+'&from='+from/1000+'&to='+to/1000);if(r.s==='no_data')continue;if(r.s!=='ok'||!Array.isArray(r.t)||!['o','h','l','c','v'].every(k=>Array.isArray(r[k])&&r[k].length===r.t.length))throw Error('INVALID_PUBLIC_HISTORY_'+symbol);
    for(let i=0;i<r.t.length;i++){const b={t:Number(r.t[i])*1000,o:Number(r.o[i]),h:Number(r.h[i]),l:Number(r.l[i]),c:Number(r.c[i]),v:Number(r.v[i])};if(!Object.values(b).every(Number.isFinite)||b.t%(frame*60000)||b.t<from||b.t>=to||Math.min(b.o,b.c,b.l)<=0||b.v<0||b.h<Math.max(b.o,b.c)||b.l>Math.min(b.o,b.c))continue;if(rejected.has(b.t))continue;const old=map.get(b.t);if(old&&JSON.stringify(old)!==JSON.stringify(b)){issues.push({at:b.t,reason:'CONFLICTING_SOURCE_BARS_QUARANTINED',first:old,second:b});rejected.add(b.t);map.delete(b.t);continue;}map.set(b.t,b);}
    await new Promise(r=>setTimeout(r,200));
   }
   data[symbol][frame]=[...map.values()].sort((a,b)=>a.t-b.t);anomalies[symbol][frame]={count:issues.length,examples:issues.slice(0,5)};await fs.writeFile(frameCache,JSON.stringify({start,end,bars:data[symbol][frame],anomalies:anomalies[symbol][frame]}));console.log('PUBLIC_HISTORY '+symbol+' '+frame+'m '+data[symbol][frame].length+' bars');
  }
 }));
 const metadata=await get('https://api.bitkub.com/api/v3/market/symbols');if(metadata.error!==0)throw Error('CURRENT_RULES_UNAVAILABLE');const rules=Object.fromEntries(DATA_PROTOCOL.symbols.map(s=>{const m=metadata.result.find(m=>m.symbol===s);if(!m)throw Error('CURRENT_MARKET_MISSING');return[s,{qtyScale:Number(m.base_quantity_scale??m.base_asset_scale),priceScale:Number(m.price_scale),priceStep:Number(m.price_step),minQuote:Number(m.min_quote_size)}];}));
 const x={protocol:DATA_PROTOCOL,start,end,data,rules,anomalies,dataDigest:createHash('sha256').update(JSON.stringify(data)).digest('hex'),downloadedAt:new Date().toISOString(),assumptions:['CURRENT_MARKET_RULES_NOT_HISTORICAL_METADATA','NO_HISTORICAL_ORDER_BOOK_OR_NEWS','MISSING_BARS_NOT_FABRICATED']};await fs.writeFile(cache,JSON.stringify(x));return x;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await loadMasterHistory(process.argv[2]);
