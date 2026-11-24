// Additional public frames are loaded only by the Paper worker, outside live execution.
import {quarantineHistory,verifiedDailyHistory} from './master-history.mjs';
import {parseRSS} from './selection.mjs';
const MACRO=Object.freeze([{name:'Federal Reserve',host:'federalreserve.gov',url:'https://www.federalreserve.gov/feeds/press_all.xml'},{name:'US Bureau of Labor Statistics',host:'bls.gov',url:'https://www.bls.gov/feed/bls_latest.rss'}]);
export function createMasterData({base,json,read,rpc,verified=null,fetchFn=fetch,clock=()=>Date.now()}){
 const local=new Map(),pending=new Map(),quality=new Map();
 async function cached(key,ttl,fn){const now=clock(),own=local.get(key);if(own&&own.expires>now)return own.payload;if(pending.has(key))return pending.get(key);const job=(async()=>{const rows=await read('bitbot_v11_cache?key=eq.'+encodeURIComponent(key)+'&limit=1'),old=rows[0];if(old&&Date.parse(old.expires_at)>clock()){const v={payload:old.payload,expires:Date.parse(old.expires_at)};local.set(key,v);return v.payload;}const payload=await fn(),expires=clock()+ttl;await rpc('bitbot_v11_cache_put',{p_key:key,p_payload:payload,p_expires:new Date(expires).toISOString()});local.set(key,{payload,expires});return payload;})();pending.set(key,job);try{return await job;}finally{pending.delete(key);}}
 async function frame(symbol,minutes){const key='master31b-frame-'+minutes+'-'+symbol;const out=await cached(key,minutes===1?45000:minutes===60?240000:21600000,async()=>{
  if(minutes===1&&verified?.history){const h=await verified.history(symbol,1);return{candles:h.candles,quality:{provider:'VERIFIED_BITKUB_TRADES_AND_HISTORY',repair:h.repair,reason:h.quality.reason}};}
  const n=minutes===1440?780:360,end=Math.floor(clock()/1000),from=end-minutes*60*n,raw=await json('https://api.bitkub.com/tradingview/history?symbol='+symbol+'&resolution='+(minutes===1440?'1D':minutes)+'&from='+from+'&to='+end);
  return minutes===1440?verifiedDailyHistory(raw,{json,symbol,now:clock()}):quarantineHistory(raw,minutes,clock());
 });quality.set(symbol+':'+minutes,out.quality);return out.candles;}
 async function macro(){return cached('master31-macro-news',1800000,async()=>{const out=await Promise.allSettled(MACRO.map(async s=>{const r=await fetchFn(s.url,{redirect:'error',signal:AbortSignal.timeout(5000),headers:{Accept:'application/rss+xml,application/xml,text/xml'}});if(!r.ok)throw Error('MACRO_FEED_HTTP_'+r.status);const text=await r.text();if(text.length>1000000)throw Error('MACRO_FEED_TOO_LARGE');return parseRSS(text,s,clock());}));return{items:out.flatMap(r=>r.status==='fulfilled'?r.value:[]),sources:MACRO.map((s,i)=>({name:s.name,url:s.url,status:out[i].status==='fulfilled'?'READ':'UNAVAILABLE'})),at:clock()};});}
 async function enrich(bundle,held=[]){
  const began=clock(),ranked=(bundle?.markets||[]).slice().sort((a,b)=>b.volumeTHB-a.volumeTHB),core=['BTC_THB','ETH_THB'],rest=ranked.filter(m=>!held.includes(m.symbol)&&!core.includes(m.symbol)),offset=rest.length?Math.floor(clock()/60000)%rest.length:0;
  // Rotate bounded public histories so they cannot monopolize a worker lease.
  const selected=[...new Set([...held,...core,...[...rest.slice(offset),...rest.slice(0,offset)].map(m=>m.symbol)])].map(s=>ranked.find(m=>m.symbol===s)).filter(Boolean).slice(0,6),results=[],failures=[];
  for(let i=0;i<selected.length;i+=2){if(i&&clock()-began>24000)break;const batch=await Promise.all(selected.slice(i,i+2).map(async m=>{const frames={},errors={},frameQuality={};await Promise.all([1,60,1440].map(async n=>{try{frames[n]=await frame(m.symbol,n);frameQuality[n]=quality.get(m.symbol+':'+n);}catch(e){frames[n]=[];errors[n]=String(e.message).slice(0,100);}}));return{...m,masterFrames:frames,masterFrameErrors:errors,masterFrameQuality:frameQuality};}));results.push(...batch);}
  let macroFeed={items:[],sources:[],at:clock()};try{macroFeed=await macro();}catch{failures.push('MACRO_NEWS_UNAVAILABLE');}
  const quotes=await base.all(),map=new Map(quotes.map(m=>[m.symbol,m]));
  const markets=await Promise.all(results.map(async m=>{try{const d=await json('https://api.bitkub.com/api/v3/market/depth?sym='+m.symbol.toLowerCase()+'&lmt=20');if(d.error!==0||!d.result?.asks||!d.result?.bids)throw Error('DEPTH_UNAVAILABLE');return{...m,...map.get(m.symbol),depth:{...d.result,at:clock()}};}catch{return{...m,...map.get(m.symbol),depth:null};}}));
  const originalNews=[...(bundle?.news?.items||[]),...(bundle?.markets||[]).flatMap(m=>m.news?.headlines||[])],dedup=new Map();for(const n of originalNews){const previous=dedup.get(n.url);if(!previous||n.contentRead)dedup.set(n.url,n);}
  return{...bundle,markets,observedAt:clock(),masterData:{at:clock(),durationMs:clock()-began,selected:selected.map(m=>m.symbol),loaded:markets.length,failures,macroSources:macroFeed.sources,historyErrorCount:markets.reduce((s,m)=>s+Object.keys(m.masterFrameErrors).length,0)},news:{...bundle?.news,items:[...dedup.values(),...macroFeed.items]}};
 }
 return{enrich,frame};
}
