import test from 'node:test';
import assert from 'node:assert/strict';
import {PublicTickerCollector,parseTicker} from '../services/rea/streams.mjs';
import {createTransport} from '../services/rea/transport.mjs';
import {progressHealth} from '../services/rea/daemon.mjs';
import {createStreamingMarket} from '../services/rea/stream-market.mjs';
import {cycleREA,initialREA} from '../supabase/functions/bitbot-v10/rea-core.mjs';
import {createRiskWatchdog} from '../supabase/functions/bitbot-v10/rea-watchdog.mjs';
const now=1794920000000,quote={stream:'market.ticker.thb_btc',last:100,highestBid:99.9,lowestAsk:100.1,isFrozen:0};
test('ticker parser validates symbol and crossed prices and labels receipt time explicitly',()=>{
 const allowed=new Set(['BTC_THB']),q=parseTicker(quote,allowed,now);assert.equal(q.observedAt,now);assert.equal(q.timestampSource,'LOCAL_RECEIPT');assert.equal(q.source,'BITKUB_PUBLIC_WS');
 for(const bad of [{...quote,stream:'market.trade.thb_btc'},{...quote,stream:'market.ticker.thb_eth'},{...quote,highestBid:101},{...quote,last:NaN}])assert.equal(parseTicker(bad,allowed,now),null);
});
test('backend collector reconnects with backoff, drops disconnected data and ignores late old-socket messages',()=>{
 let clock=now,id=0;const sockets=[],timers=new Map();class Socket{constructor(url){this.url=url;sockets.push(this);}close(){this.onclose?.();}}
 const c=new PublicTickerCollector({Socket,clock:()=>clock,random:()=>0,schedule:(fn,ms)=>{timers.set(++id,{fn,ms});return id;},cancel:k=>timers.delete(k)});
 c.select(['BTC_THB']);assert(sockets[0].url.endsWith('market.ticker.thb_btc'));const old=sockets[0].onmessage;sockets[0].onmessage({data:JSON.stringify(quote)});assert.equal(c.snapshot().length,1);
 c.select(['BTC_THB']);assert.equal(sockets.length,1);sockets[0].close();assert.equal(c.snapshot().length,0);const retry=[...timers.values()].find(t=>t.ms===1000);assert(retry);retry.fn();assert.equal(sockets.length,2);old({data:JSON.stringify(quote)});assert.equal(c.snapshot().length,0);
 sockets[1].onmessage({data:JSON.stringify(quote)});clock+=31000;assert.equal(c.snapshot().length,0);c.stop();assert.equal(c.sessions.length,0);c.select(['BTC_THB']);assert.equal(sockets.length,3);c.stop();
});
test('collector batches at most eight streams per connection and never subscribes deprecated trade streams',()=>{
 const urls=[];class Socket{constructor(u){urls.push(u);}close(){}}const c=new PublicTickerCollector({Socket,schedule:()=>1,cancel:()=>{}});c.select(Array.from({length:40},(_,i)=>'C'+i+'_THB'));assert.equal(urls.length,4);assert(urls.every(u=>!u.includes('market.trade')&&u.split('/').at(-1).split(',').length<=8));c.stop();
});
test('backend exchange transport rejects every non-read endpoint before fetch and never exposes a key',async()=>{
 let requests=0;const io=createTransport({supabaseURL:'https://test.supabase.co',key:'TEST_ONLY',fetchFn:async()=>{requests++;return Response.json({ok:true});}});
 for(const path of ['/api/v3/market/place-bid','/api/v3/market/place-ask','/api/v3/market/cancel-order','/api/v4/crypto/withdraws'])await assert.rejects(io.json('https://api.bitkub.com'+path,{method:'POST'}),/PAPER_ONLY/);
 await assert.rejects(io.json('https://attacker.invalid/'),/DESTINATION/);await assert.rejects(io.json('http://api.bitkub.com/api/v3/market/ticker'),/HTTPS/);assert.equal(requests,0);
});
test('429 enforces a shared cooldown and respects an HTTP-date Retry-After',async()=>{
 let at=now,calls=0;const io=createTransport({supabaseURL:'https://test.supabase.co',key:'TEST_ONLY',clock:()=>at,fetchFn:async()=>{calls++;return new Response('{}',{status:429,headers:{'Retry-After':new Date(now+60000).toUTCString()}});}});
 await assert.rejects(io.json('https://api.bitkub.com/api/v3/market/ticker'));await assert.rejects(io.json('https://api.bitkub.com/api/v3/market/depth?sym=btc_thb'),/COOLDOWN/);assert.equal(calls,1);at+=61000;await assert.rejects(io.json('https://api.bitkub.com/api/v3/market/ticker'));assert.equal(calls,2);
});
test('progress supervisor does not mistake a live HTTP process for completed work',()=>{
 assert.equal(progressHealth({lastWorkAt:0,status:'STARTING',startedAt:now},now+1000).healthy,false);
 assert.equal(progressHealth({lastWorkAt:now,status:'OK',startedAt:now,active:true},now+10000).healthy,true);
 assert.equal(progressHealth({lastWorkAt:now,status:'OK',startedAt:now,active:false},now+10000).healthy,false);
 assert.equal(progressHealth({lastWorkAt:now,status:'OK',startedAt:now},now+130000).restart,true);
 assert.equal(progressHealth({lastWorkAt:now,status:'SAFE_MODE',startedAt:now},now+1000).healthy,false);
});
test('Docker feed never promotes a stale stream quote by giving it a new timestamp',async()=>{
 const wrapper=createStreamingMarket({clock:()=>now,base:{scan:async()=>({markets:[{symbol:'BTC_THB',observedAt:now,bid:100,ask:101}]})},rpc:async()=>[{symbol:'BTC_THB',observedAt:now-31000,bid:99,ask:100}]});
 const out=await wrapper.scan();assert.equal(out.markets[0].wsReady,false);assert.equal(out.markets[0].bid,100);
});
function held(){const s=initialREA(now);s.cash=6000;s.positions=[{symbol:'BTC_THB',qty:40,cost:4000,stop:99,target:110,openedAt:now-10000,positionId:'p',strategy:'test',realized:0}];return s;}
const riskMarket=()=>({symbol:'BTC_THB',last:90,bid:90,ask:90.01,observedAt:now,depth:{at:now,bids:[[90,1000]],asks:[[90.01,1000]]},rules:{qtyScale:8}});
test('independent risk cycle creates a stop exit without candles or news and cannot open a buy',()=>{
 const a=cycleREA(held(),{markets:[riskMarket()]},now,{riskOnly:true});assert.equal(a.state.orders[0].side,'SELL');assert.equal(a.state.orders[0].reason,'STOP_LOSS');assert.equal(a.ranking.length,0);assert(a.state.dailyLocked);
 const flat=cycleREA(initialREA(now),{markets:[riskMarket()]},now,{riskOnly:true});assert.equal(flat.state.orders.length,0);
});
test('risk watchdog cannot claim an accepted checkpoint when its revision became stale',async()=>{
 const names=[],w=createRiskWatchdog({clock:()=>now,quotes:async()=>[riskMarket()],rpc:async(name,args)=>{names.push(name);if(name==='rea_risk_accounts')return[{user_id:'u',state:held(),latest:{at:now-1000,ranking:[{symbol:'BTC_THB'}]},revision:1}];if(name==='rea_risk_checkpoint'){assert.equal(args.p_revision,1);assert.equal(args.p_latest.at,now-1000);return false;}return true;}});
 const r=await w.run();assert.equal(r.results[0].actionable,true);assert.equal(r.results[0].committed,false);assert(!names.some(n=>/key|wallet|live|reserve/.test(n)));
});
test('risk watchdog flat portfolio reports idle and never creates a paper fill',async()=>{
 let checkpoint=false;const w=createRiskWatchdog({clock:()=>now,quotes:async()=>[],rpc:async(name)=>{if(name==='rea_risk_accounts')return[{user_id:'u',state:initialREA(now),latest:{},revision:1}];if(name==='rea_risk_checkpoint')checkpoint=true;return true;}});const r=await w.run();assert.equal(r.results[0].health,'IDLE');assert.equal(checkpoint,false);
});

async function inspectRisk(states,markets, options={}) {
 const observations=[];
 const watchdog=createRiskWatchdog({clock:()=>now,quotes:async()=>markets,rpc:async(name,args)=>{
  if(name==='rea_risk_accounts')return states.map((state,i)=>({user_id:'p'+i,state,latest:{},revision:1}));
  if(name==='rea_risk_checkpoint')return options.commit!==false;
  if(name==='rea_risk_observation'){observations.push(args);if(options.failFirst&&args.p_uid==='p0')throw Error('database unavailable');return true;}
  throw Error('Unexpected RPC '+name);
 }});
 return {results:(await watchdog.run()).results,observations};
}
test('baseline pending produces a fresh, specific reason while an independent protective exit still commits',async()=>{
 const state=held();state.baselinePending=true;
 const {results,observations}=await inspectRisk([state],[riskMarket()]);
 assert.equal(results[0].health,'SAFE_MODE');assert.equal(results[0].committed,true);
 assert.deepEqual(observations[0].p_reasons,['MIDNIGHT_BASELINE_UNVERIFIED']);assert.equal(observations[0].p_at,now);
});
test('an unrelated account cannot lend its good price to a missing pending order or activate an idle watcher',async()=>{
 const quote={...riskMarket(),last:101,bid:101,ask:101.01};
 const pending=initialREA(now);pending.orders=[{id:'buy',symbol:'ETH_THB',side:'BUY',status:'OPEN',limit:5,remaining:10,reserved:10}];
 const {observations}=await inspectRisk([held(),pending,initialREA(now)],[quote]);
 assert.deepEqual(observations.map(x=>x.p_status),['OK','SAFE_MODE','IDLE']);
 assert.deepEqual(observations[1].p_reasons,['WATCHDOG_MARKET_DATA_UNAVAILABLE']);
});
test('missing, stale, future or empty depth cannot look ready and baseline stays blocked on a flat book',async()=>{
 for(const depth of [null,{...riskMarket().depth,at:now-30001},{...riskMarket().depth,at:now+5001},{...riskMarket().depth,bids:[]}]){
  const {observations}=await inspectRisk([held()],[{...riskMarket(),depth}]);
  assert(observations[0].p_reasons.includes('WATCHDOG_DEPTH_UNAVAILABLE'));
 }
 const flat=initialREA(now);flat.baselinePending=true;
 assert.deepEqual((await inspectRisk([flat],[])).observations[0].p_reasons,['MIDNIGHT_BASELINE_UNVERIFIED']);
});
test('invalid individual state, unconfirmed protective checkpoint, and receipt write failure stay fail-closed',async()=>{
 const {results,observations}=await inspectRisk([{...initialREA(now),positions:null},held(),initialREA(now)],[riskMarket()],{commit:false,failFirst:true});
 assert.deepEqual(observations.map(x=>x.p_reasons),[['WATCHDOG_RISK_STATE_UNAVAILABLE'],['WATCHDOG_CHECKPOINT_UNCONFIRMED'],[]]);
 assert.equal(results[0].recorded,false);assert.deepEqual(results.map(r=>r.health),['SAFE_MODE','SAFE_MODE','IDLE']);
});
