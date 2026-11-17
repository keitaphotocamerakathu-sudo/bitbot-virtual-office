// Always-on Node 24 paper host. Reuses the deployed scanner, risk model and SQL leases.
// No Bitkub credentials or exchange-writing transport is implemented.
import fs from 'node:fs';
import http from 'node:http';
import {createMarketService} from '../../supabase/functions/bitbot-v10/market.mjs';
import {createVerifiedMarketService} from '../../supabase/functions/bitbot-v10/market-verified.mjs';
import {createREAService} from '../../supabase/functions/bitbot-v10/rea-service.mjs';
const url=process.env.SUPABASE_URL,secretPath=process.env.REA_SUPABASE_SERVICE_KEY_FILE||'/run/secrets/supabase_service_key';
if(!url||!/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(url))throw Error('SUPABASE_URL required');
const key=fs.readFileSync(secretPath,'utf8').trim();if(!key)throw Error('Backend key file required');
let stopping=false,lastCycle=0,lastOK=0,health='STARTING',lastError=null;
let rateLimitUntil=0;
const headers={apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'};
async function json(target,options={},timeout=15000){
 const u=new URL(target);
 if(u.hostname==='api.bitkub.com'&&Date.now()<rateLimitUntil)throw Object.assign(Error('BITKUB_RATE_LIMIT_COOLDOWN'),{status:429});
 if(u.hostname==='api.bitkub.com'&&((options.method||'GET')!=='GET'||!/^\/(api\/v3\/market\/(symbols|ticker|depth|trades)|tradingview\/history)$/.test(u.pathname)))throw Error('PAPER_ONLY_EXCHANGE_WRITE_DENIED');
 if(u.origin!==url&&u.hostname!=='api.bitkub.com')throw Error('HTTP_DESTINATION_DENIED');
 const r=await fetch(u,{...options,signal:AbortSignal.timeout(timeout)});if(r.status===429&&u.hostname==='api.bitkub.com')rateLimitUntil=Date.now()+Math.max(30000,(Number(r.headers.get('retry-after'))||30)*1000);if(!r.ok)throw Object.assign(Error('HTTP '+r.status),{status:r.status});return r.json();
}
const db=(path,body,method='POST')=>json(url+'/rest/v1/'+path,{method,headers:{...headers,Prefer:'return=representation'},...(body!==undefined?{body:JSON.stringify(body)}:{})});
const read=path=>db(path,undefined,'GET'),rpc=(name,args={})=>db('rpc/'+name,args);
async function newsFetch(target,options={}){const u=new URL(target);if(u.protocol!=='https:'||!['coindesk.com','cointelegraph.com'].some(h=>u.hostname===h||u.hostname.endsWith('.'+h)))throw Error('NEWS_HOST_DENIED');return fetch(u,{...options,redirect:'error'});}
const market=createMarketService({json,db,read,rpc,fetchFn:newsFetch}),verified=createVerifiedMarketService({base:market,json,read,rpc}),rea=createREAService({rpc,marketService:verified});
let sleepWake=null;
const sleep=ms=>new Promise(resolve=>{const timer=setTimeout(()=>{sleepWake=null;resolve();},ms);sleepWake=()=>{clearTimeout(timer);sleepWake=null;resolve();};});
http.createServer((req,res)=>{const healthy=lastOK&&Date.now()-lastOK<180000;res.writeHead(healthy?200:503,{'Content-Type':'application/json'});res.end(JSON.stringify({mode:'PAPER_ONLY',healthy,health,lastCycle,lastOK,lastError}));}).listen(8080,'0.0.0.0');
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{stopping=true;sleepWake?.();});
while(!stopping){try{const result=await rea.run();lastCycle=Date.now();if(result.results.every(r=>r.committed&&r.health==='OK')){lastOK=lastCycle;health='OK';lastError=null;}else if(result.processed){health='SAFE_MODE';lastError='CYCLE_NOT_COMMITTED_OR_DATA_UNAVAILABLE';}console.log(JSON.stringify({at:lastCycle,mode:'PAPER_ONLY',processed:result.processed,health}));}catch(e){health='SAFE_MODE';lastError=String(e.message).slice(0,120);console.error(JSON.stringify({at:Date.now(),mode:'PAPER_ONLY',health,error:lastError}));}await sleep(15000);}
process.exit(0);
