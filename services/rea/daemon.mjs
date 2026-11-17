import http from 'node:http';
import {randomUUID} from 'node:crypto';
import {createTransport} from './transport.mjs';
import {PublicTickerCollector} from './streams.mjs';
import {createStreamingMarket} from './stream-market.mjs';
import {createMarketService} from '../../supabase/functions/bitbot-v10/market.mjs';
import {createVerifiedMarketService} from '../../supabase/functions/bitbot-v10/market-verified.mjs';
import {createREAService} from '../../supabase/functions/bitbot-v10/rea-service.mjs';
import {createRiskWatchdog} from '../../supabase/functions/bitbot-v10/rea-watchdog.mjs';
import {createRiskQuotes} from '../../supabase/functions/bitbot-v10/rea-risk-quotes.mjs';
import {createAdvisory} from '../../supabase/functions/bitbot-v10/rea-advisory.mjs';
export function progressHealth({lastWorkAt,status,startedAt,active=false},now=Date.now()){
 return{healthy:active&&lastWorkAt>0&&now-lastWorkAt<90000&&['OK','IDLE'].includes(status),restart:now-startedAt>120000&&(!lastWorkAt||now-lastWorkAt>120000)};
}
export async function runDaemon(role=process.env.REA_SERVICE||'strategy-worker'){
 if(!['market-collector','strategy-worker','risk-watchdog','health-monitor'].includes(role))throw Error('UNKNOWN_SERVICE');
 const io=createTransport(),instance=randomUUID(),startedAt=Date.now();let stopped=false,active=false,status='STARTING',lastWorkAt=0,lastError=null,renewBusy=false,wake=null;
 const market=createMarketService({...io,fetchFn:io.newsFetch}),verified=createVerifiedMarketService({base:market,...io});
 const strategy=createREAService({rpc:io.rpc,marketService:createStreamingMarket({base:verified,rpc:io.rpc}),runtime:'DOCKER',advisor:createAdvisory({rpc:io.rpc})});
 const risk=createRiskWatchdog({rpc:io.rpc,quotes:createRiskQuotes({markets:market,json:io.json,rpc:io.rpc,useStream:true})});
 const collector=new PublicTickerCollector();let discoveryAt=0;
 const pause=ms=>new Promise(resolve=>{const t=setTimeout(()=>{wake=null;resolve();},ms);wake=()=>{clearTimeout(t);wake=null;resolve();};});
 async function renew(){if(renewBusy||stopped)return;renewBusy=true;try{active=await io.rpc('rea_service_lease',{p_service:role,p_instance:instance});if(!active){status='IDLE';collector.stop();discoveryAt=0;}else await io.rpc('rea_service_heartbeat',{p_service:role,p_instance:instance,p_status:status,p_detail:{mode:'PAPER_ONLY',workAt:lastWorkAt,runtime:'DOCKER'}});}catch{active=false;status='SAFE_MODE';collector.stop();discoveryAt=0;lastError='BACKEND_HEARTBEAT_FAILED';}finally{renewBusy=false;}}
 const server=http.createServer((req,res)=>{if(req.url!=='/health'){res.writeHead(404);res.end();return;}const h=progressHealth({lastWorkAt,status,startedAt,active});res.writeHead(h.healthy?200:503,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({mode:'PAPER_ONLY',service:role,status,active,healthy:h.healthy,lastWorkAt,lastError}));});server.listen(8080,'0.0.0.0');
 const stop=()=>{stopped=true;collector.stop();wake?.();};for(const signal of ['SIGTERM','SIGINT'])process.once(signal,stop);
 const timer=setInterval(()=>{renew().catch(()=>{});if(progressHealth({lastWorkAt,status,startedAt}).restart){console.error(JSON.stringify({service:role,error:'PROGRESS_TIMEOUT',mode:'PAPER_ONLY'}));process.exitCode=1;stop();}},10000);
 await renew();
 while(!stopped){try{if(!active){await pause(5000);continue;}
   if(role==='market-collector'){
    if(Date.now()-discoveryAt>60000){const [all,accounts]=await Promise.all([market.all(),io.rpc('rea_risk_accounts',{})]);const held=accounts.flatMap(a=>[...a.state.positions.map(p=>p.symbol),...a.state.orders.filter(o=>['OPEN','PARTIAL'].includes(o.status)).map(o=>o.symbol)]);
     const eligible=all.filter(m=>m.status==='active'&&m.marketSource==='exchange'&&!m.frozen&&m.volumeTHB>=250000).sort((a,b)=>b.volumeTHB-a.volumeTHB);
     collector.select([...new Set([...held,...eligible.map(m=>m.symbol)])].slice(0,32));discoveryAt=Date.now();}
    const quotes=collector.snapshot();if(quotes.length){await io.rpc('rea_publish_market',{p_instance:instance,p_quotes:quotes});status='OK';}else status='SAFE_MODE';
   }else if(role==='strategy-worker'){const r=await strategy.run();status=r.processed?r.results.every(x=>x.committed&&x.health==='OK')?'OK':'SAFE_MODE':'IDLE';
   }else if(role==='risk-watchdog'){const r=await risk.run();status=r.results.some(x=>x.health==='SAFE_MODE')?'SAFE_MODE':r.results.some(x=>x.health==='OK')?'OK':'IDLE';
   }else{await io.rpc('rea_monitor',{});status='OK';}
   if(role!=='market-collector'||status==='OK')lastWorkAt=Date.now();lastError=null;
  }catch(e){status='SAFE_MODE';lastError=String(e.message||'WORK_FAILED').slice(0,100);console.error(JSON.stringify({mode:'PAPER_ONLY',service:role,error:lastError}));}
  await renew();await pause(role==='strategy-worker'?15000:5000);
 }
 clearInterval(timer);collector.stop();for(const signal of ['SIGTERM','SIGINT'])process.removeListener(signal,stop);await new Promise(resolve=>server.close(resolve));
}
