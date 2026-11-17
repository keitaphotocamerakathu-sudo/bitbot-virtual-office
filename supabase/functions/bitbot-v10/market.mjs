// Public market and RSS sources only. No exchange credentials are accepted here.
import {extractArticle} from './intraday.mjs';
import {validSymbol} from './engine.mjs';
import {parseRSS,rankUniverse,assessNews} from './selection.mjs';
export const NEWS_SOURCES=Object.freeze([
 {name:'CoinDesk',host:'coindesk.com',url:'https://www.coindesk.com/arc/outboundfeeds/rss/'},
 {name:'Cointelegraph',host:'cointelegraph.com',url:'https://cointelegraph.com/rss'}
]);
export function normalizeSymbols(raw,now=Date.now()){
 if(raw?.error!==0||!Array.isArray(raw.result)||raw.result.length<2)throw Error('อ่านรายชื่อคู่เหรียญไม่สำเร็จ');
 return raw.result.filter(x=>validSymbol(x.symbol)&&x.quote_asset==='THB'&&x.market_segment==='SPOT').map(x=>{
 const priceStep=Number(x.price_step),minQuote=Number(x.min_quote_size),priceScale=Number(x.price_scale),qtyScale=Number(x.base_quantity_scale??x.base_asset_scale);
 if(!(priceStep>0&&minQuote>0&&Number.isInteger(priceScale)&&priceScale>=0&&priceScale<=8&&Number.isInteger(qtyScale)&&qtyScale>=0&&qtyScale<=8))return null;
 return{symbol:x.symbol,name:String(x.name||x.base_asset).slice(0,100),status:x.status,source:x.source,
 buyFrozen:x.freeze_buy===true,sellFrozen:x.freeze_sell===true,
 frozen:x.status!=='active'||x.freeze_buy===true&&x.freeze_sell===true,
 rules:{minQuote,priceStep,priceScale,qtyScale},updatedAt:now};
 }).filter(Boolean);
}
export function mergeTickers(symbols,raw,now=Date.now()){
 const tickers=Array.isArray(raw)?raw:raw?.result;if(!Array.isArray(tickers))throw Error('อ่านราคาตลาดไม่สำเร็จ');
 const map=new Map(tickers.map(t=>[t.symbol,t]));
 return symbols.map(meta=>{const t=map.get(meta.symbol);if(!t)return null;
 const last=Number(t.last),bid=Number(t.highest_bid),ask=Number(t.lowest_ask),volumeTHB=Number(t.quote_volume_self??t.quote_volume),change=Number(t.percent_change);
 if(![last,bid,ask,volumeTHB,change].every(Number.isFinite)||last<=0||bid<=0||ask<bid)return null;
 return{...meta,last,bid,ask,volumeTHB,change,observedAt:now,source:'BITKUB_LIVE',marketSource:meta.source};
 }).filter(Boolean);
}
export function candlesFrom(raw,now=Date.now()){
 if(raw?.s!=='ok'||!Array.isArray(raw.t)||!Array.isArray(raw.c))throw Error('อ่านแท่งเทียนไม่ได้');
 return raw.t.map((t,i)=>({t:Number(t)*1000,c:Number(raw.c[i]),o:Number(raw.o?.[i]),v:Number(raw.v?.[i]),h:Number(raw.h?.[i]),l:Number(raw.l?.[i])})).filter(x=>x.t+300000<=now);
}

export function shortlist(ranked,held=[],now=Date.now()){
 const eligible=ranked.filter(x=>x.eligible),picked=eligible.slice(0,8),rest=eligible.slice(8);
 const offset=rest.length?Math.floor(now/60000)*4%rest.length:0;
 for(let i=0;i<Math.min(4,rest.length);i++)picked.push(rest[(offset+i)%rest.length]);
 for(const symbol of [...held,'BTC_THB']){const m=ranked.find(x=>x.symbol===symbol);if(m&&!picked.some(x=>x.symbol===symbol))picked.push(m);}
 if(!picked.length)picked.push(...ranked.filter(x=>x.status==='active').slice(0,3));return picked;
}

export function createMarketService({json:requestJSON,db,read,rpc,fetchFn=fetch}){
 async function json(url){for(let attempt=0;attempt<3;attempt++){try{return await requestJSON(url);}catch(e){if(attempt===2)throw e;await new Promise(r=>setTimeout(r,Math.min(2000,400*2**attempt)));}}}
 const local=new Map(),pending=new Map();
 async function cached(key,ttl,fn){
 const own=local.get(key);if(own&&Date.now()<own.expires)return own.value;if(pending.has(key))return pending.get(key);
 const job=(async()=>{const rows=await read('bitbot_v11_cache?key=eq.'+encodeURIComponent(key)+'&limit=1');
 if(rows[0]&&Date.parse(rows[0].expires_at)>Date.now()){local.set(key,{expires:Date.parse(rows[0].expires_at),value:rows[0].payload});return rows[0].payload;}
 const value=await fn(),expires=Date.now()+ttl;
 await rpc('bitbot_v11_cache_put',{p_key:key,p_payload:value,p_expires:new Date(expires).toISOString()});local.set(key,{expires,value});return value;})();
 pending.set(key,job);try{return await job;}finally{pending.delete(key);}
 }
 async function symbols(){return cached('symbols',900000,async()=>{const data=normalizeSymbols(await json('https://api.bitkub.com/api/v3/market/symbols'));
 await rpc('bitbot_v11_sync_markets',{p_rows:data});return data;});}
 async function quotes(){return cached('quotes',12000,async()=>({raw:await json('https://api.bitkub.com/api/v3/market/ticker'),at:Date.now()}));}
 async function textFeed(source){
 const r=await fetchFn(source.url,{headers:{Accept:'application/rss+xml,application/xml,text/xml','User-Agent':'Bitbot/11 (+market risk research)'},signal:AbortSignal.timeout(10000)});
 if(!r.ok)throw Error('RSS HTTP '+r.status);
 const reader=r.body.getReader(),chunks=[];let size=0;
 while(true){const p=await reader.read();if(p.done)break;size+=p.value.byteLength;if(size>1000000){await reader.cancel();throw Error('RSS ใหญ่เกินกำหนด');}chunks.push(p.value);}
 const bytes=new Uint8Array(size);let off=0;for(const ch of chunks){bytes.set(ch,off);off+=ch.byteLength;}
 return parseRSS(new TextDecoder().decode(bytes),source);
 }
 async function article(item){
 const source=NEWS_SOURCES.find(x=>x.name===item.source);let url;
 try{url=new URL(item.url);}catch{return item;}
 if(!source||url.protocol!=='https:'||!(url.hostname===source.host||url.hostname.endsWith('.'+source.host)))return item;
 try{
 const r=await fetchFn(url.href,{headers:{Accept:'text/html','User-Agent':'Bitbot/12 market research'},redirect:'error',signal:AbortSignal.timeout(4000)});
 if(!r.ok)return{...item,method:'HEADLINE_ONLY'};
 const reader=r.body.getReader(),chunks=[];let size=0;
 while(true){const x=await reader.read();if(x.done)break;size+=x.value.byteLength;if(size>1500000){await reader.cancel();return{...item,method:'HEADLINE_ONLY'};}chunks.push(x.value);}
 const bytes=new Uint8Array(size);let offset=0;for(const x of chunks){bytes.set(x,offset);offset+=x.length;}
 return{...item,...extractArticle(new TextDecoder().decode(bytes)),readAt:Date.now()};
 }catch{return{...item,method:'HEADLINE_ONLY'};}
 }
 async function news(){return cached('news-v12',300000,async()=>{
 const results=await Promise.allSettled(NEWS_SOURCES.map(textFeed)),items=[],sources=[];
 results.forEach((r,i)=>{const list=r.status==='fulfilled'?r.value:[],latestAt=Math.max(0,...list.map(x=>x.publishedAt)),ok=list.length>0&&Date.now()-latestAt<21600000;
 sources.push({name:NEWS_SOURCES[i].name,url:NEWS_SOURCES[i].url,ok,latestAt});items.push(...list);});
 const unique=[...new Map(items.map(x=>[x.url,x])).values()].sort((a,b)=>b.publishedAt-a.publishedAt);
 const sample=NEWS_SOURCES.flatMap(src=>unique.filter(x=>x.source===src.name).slice(0,2));
 const enriched=await Promise.all(sample.map(article)),map=new Map(enriched.map(x=>[x.url,x]));
 return{ready:sources.some(x=>x.ok),fetchedAt:Date.now(),sources,items:unique.slice(0,100).map(x=>map.get(x.url)||x),contentRead:enriched.filter(x=>x.body?.length>=200).length,method:'ENTITY_CONTEXT_RULES_WITH_CONTENT',model:'NO_LLM'};
 });}
 async function history(symbol){
 if(!validSymbol(symbol))throw Error('คู่เหรียญไม่ถูกต้อง');
 return cached('bars-v13-'+symbol,60000,async()=>{const end=Math.floor(Date.now()/1000),from=end-300*240;
 return candlesFrom(await json('https://api.bitkub.com/tradingview/history?symbol='+symbol+'&resolution=5&from='+from+'&to='+end));});
 }
 async function depth(symbol){
 return cached('depth-'+symbol,12000,async()=>{
 const d=await json('https://api.bitkub.com/api/v3/market/depth?sym='+symbol.toLowerCase()+'&lmt=20');
 if(d?.error!==0||!Array.isArray(d.result?.asks)||!Array.isArray(d.result?.bids))throw Error('อ่านความลึกตลาดไม่ได้');
 return{asks:d.result.asks,bids:d.result.bids,at:Date.now()};
 });
 }
 async function detail(m){const [candles,book]=await Promise.all([history(m.symbol),depth(m.symbol).catch(()=>null)]);return{...m,candles,depth:book};}
 async function analysis(symbol){
 if(!validSymbol(symbol))throw Error('คู่เหรียญไม่ถูกต้อง');
 const frames={},errors={};
 await Promise.all([1,60,1440].map(async resolution=>{try{
 frames[String(resolution)]=await cached('frame-v14b-'+resolution+'-'+symbol,resolution===1?60000:resolution===60?300000:3600000,async()=>{
 const end=Math.floor(Date.now()/1000),from=end-resolution*60*240;
 const raw=await json('https://api.bitkub.com/tradingview/history?symbol='+symbol+'&resolution='+(resolution===1440?'1D':resolution)+'&from='+from+'&to='+end);
 if(raw?.s!=='ok'||!Array.isArray(raw.t))throw Error('ไม่มีข้อมูล Timeframe '+resolution);
 return raw.t.map((t,i)=>({t:Number(t)*1000,o:Number(raw.o?.[i]),h:Number(raw.h?.[i]),l:Number(raw.l?.[i]),c:Number(raw.c?.[i]),v:Number(raw.v?.[i])})).filter(b=>b.t+resolution*60000<=Date.now());
 });}catch(e){errors[String(resolution)]=String(e.message);}}));
 return{frames,errors};
 }
 async function all(){const [meta,q]=await Promise.all([symbols(),quotes()]);return mergeTickers(meta,q.raw,q.at);}
 async function single(symbol='BTC_THB'){
 if(!validSymbol(symbol))throw Error('คู่เหรียญไม่ถูกต้อง');const list=await all(),m=list.find(x=>x.symbol===symbol);
 if(!m)throw Error('ไม่มีคู่เหรียญนี้ใน Bitkub');const [detailRow,feed]=await Promise.all([detail(m),news()]);return{...detailRow,news:assessNews(m,feed)};
 }
 async function scan(held=[]){
 const [markets,feed]=await Promise.all([all(),news()]),ranked=rankUniverse(markets,{budget:100000,maxOrder:500,dailyBuy:1500,dailySell:5000,minVolumeTHB:100000},feed);
 const picked=shortlist(ranked,held);
 const detailed=[];
 for(let i=0;i<picked.length;i+=4){if(i)await new Promise(r=>setTimeout(r,600));const rows=await Promise.allSettled(picked.slice(i,i+4).map(detail));for(const r of rows)if(r.status==='fulfilled')detailed.push(r.value);}
 return{version:'12.0.0',observedAt:Date.now(),universeCount:markets.filter(x=>x.status==='active').length,
 scannedCount:detailed.length,markets:detailed,watchlist:ranked.map(({candles,news,...m})=>({...m,news:{ready:news?.ready,blocked:news?.blocked}})),
 news:{...feed,items:feed.items.slice(0,12).map(({body,...item})=>item)}};
 }
 return{single,scan,all,news,symbols,analysis};
}
