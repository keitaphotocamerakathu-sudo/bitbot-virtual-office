import fs from 'node:fs/promises';
import {gzipSync,gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
export const protocol=JSON.parse(await fs.readFile(new URL('./protocol-v13.json',import.meta.url),'utf8'));
export const DAY=86400000,STEP=300000;
const end=Date.parse(protocol.researchEnd),start=end-protocol.dataDays*DAY;
const cache=new URL('./data-v13.json.gz',import.meta.url);
export async function request(url){
 for(let attempt=0;attempt<3;attempt++){
  try{const r=await fetch(url,{signal:AbortSignal.timeout(25000)});if(!r.ok)throw Error('Public API HTTP '+r.status);return await r.json();}
  catch(e){if(attempt===2)throw e;await new Promise(r=>setTimeout(r,1000*(attempt+1)));}
 }
}
export async function loadData(){
 try{const cached=JSON.parse(gunzipSync(await fs.readFile(cache)));if(cached.start===start&&cached.end===end)return cached;}catch{}
 const data={};
 for(let i=0;i<protocol.symbols.length;i+=2){await Promise.all(protocol.symbols.slice(i,i+2).map(async symbol=>{
  const map=new Map();
  for(let from=start;from<end;from+=5*DAY){
   const to=Math.min(end,from+5*DAY),raw=await request('https://api.bitkub.com/tradingview/history?symbol='+symbol+'&resolution=5&from='+from/1000+'&to='+to/1000);
   if(raw.s!=='ok'||!Array.isArray(raw.v))throw Error('Missing OHLCV '+symbol);
   for(let j=0;j<raw.t.length;j++){
    const b={t:Number(raw.t[j])*1000,o:Number(raw.o[j]),h:Number(raw.h[j]),l:Number(raw.l[j]),c:Number(raw.c[j]),v:Number(raw.v[j])};
    if(!Object.values(b).every(Number.isFinite)||b.o<=0||b.l<=0||b.c<b.l||b.c>b.h||b.o<b.l||b.o>b.h||b.v<0)throw Error('Malformed historical candle '+symbol);
    if(b.t>=start&&b.t<end)map.set(b.t,b);
   }
  }
  data[symbol]=[...map.values()].sort((a,b)=>a.t-b.t);console.log('Downloaded '+symbol+': '+data[symbol].length+' closed bars');
 }));}
 const meta=await request('https://api.bitkub.com/api/v3/market/symbols');if(meta.error!==0)throw Error('Missing symbol rules');
 const rules=Object.fromEntries(protocol.symbols.map(s=>{const m=meta.result.find(x=>x.symbol===s);if(!m)throw Error('Missing '+s);return[s,{minQuote:Number(m.min_quote_size),priceStep:Number(m.price_step),priceScale:Number(m.price_scale),qtyScale:Number(m.base_quantity_scale??m.base_asset_scale)}];}));
 const result={start,end,data,rules,digest:createHash('sha256').update(JSON.stringify(data)).digest('hex'),downloadedAt:new Date().toISOString()};
 await fs.writeFile(cache,gzipSync(JSON.stringify(result)));return result;
}
if(process.argv[1]===new URL(import.meta.url).pathname)await loadData();
