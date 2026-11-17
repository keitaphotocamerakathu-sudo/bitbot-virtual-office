import test from 'node:test';
import assert from 'node:assert/strict';
import {initialLive,applyExchangeInfo,planLive,markLive,exchangeBody,liveSummary,walletMatches} from '../supabase/functions/bitbot-v10/rea-live-core.mjs';
import {createLiveService} from '../supabase/functions/bitbot-v10/rea-live-service.mjs';
const now=1794921000000,uid='11111111-1111-4111-8111-111111111111',id='22222222-2222-4222-8222-222222222222';
const market=()=>({symbol:'BTC_THB',last:100,bid:100,ask:100.01,observedAt:now,status:'active',marketSource:'exchange',rules:{qtyScale:8,priceStep:.01,priceScale:2,minQuote:10}});
const wallet=()=>({at:now,THB:{available:10000,reserved:0},BTC:{available:40,reserved:0}});
function buy(){return{id,clientId:'rea19-test',exchangeId:'ex-1',symbol:'BTC_THB',side:'BUY',status:'OPEN',amount:1000,remaining:1000,executed:0,createdAt:now-1000,qtyScale:8,stop:98,target:104,limit:100,type:'limit',strategy:'TEST',appliedTxnIds:[]};}
function info({status='unfilled',history=[{txn_id:'tx-1',amount:500,rate:100,fee:1.25,credit:0,timestamp:now-100}],filled=500,remaining=500}={}){return{client_id:'rea19-test',status,history,filled,remaining};}
test('Live starts with an actual bounded allocation and no paper holdings or synthetic fills',()=>{
 const s=initialLive(5000,now);assert.equal(s.mode,'LIVE');assert.equal(s.cash,5000);assert.equal(s.positions.length,0);assert.equal(s.fills.length,0);
 for(const n of [0,99,10001,NaN,Infinity])assert.throws(()=>initialLive(n,now));
});
test('partial BUY uses actual THB receipt and fee, and a repeated receipt is idempotent',()=>{
 const s=initialLive(10000,now);s.orders=[buy()];
 const a=applyExchangeInfo(s,id,info(),now);assert.equal(a.state.cash,9500);assert.equal(a.state.positions[0].qty,4.9875);assert.equal(a.state.positions[0].cost,500);assert.equal(a.state.orders[0].status,'PARTIAL');assert.equal(a.fills[0].simulation,false);
 const b=applyExchangeInfo(a.state,id,info(),now);assert.equal(b.fills.length,0);assert.deepEqual(b.state,a.state);
});
test('terminal cancel retains partial holdings and only releases the unmatched order amount',()=>{
 const s=initialLive(10000,now);s.orders=[buy()];const a=applyExchangeInfo(s,id,info({status:'cancelled'}),now);
 assert.equal(a.state.orders[0].status,'CANCELED');assert.equal(a.state.positions[0].cost,500);assert.equal(a.state.cash,9500);assert.equal(liveSummary(a.state).reserved,0);
});
test('missing or inconsistent per-fill evidence cannot become a live fill',()=>{
 const s=initialLive(10000,now);s.orders=[buy()];
 for(const bad of [info({history:[]}),info({filled:600}),{...info(),client_id:'other'},{...info(),history:[{...info().history[0],txn_id:''}]}])assert.throws(()=>applyExchangeInfo(s,id,bad,now));
 const a=applyExchangeInfo(s,id,info(),now);assert.throws(()=>applyExchangeInfo(a.state,id,info({history:[],filled:0,remaining:1000}),now),/INCOMPLETE/);
});
function held(){const s=initialLive(10000,now);s.cash=6000;s.positions=[{symbol:'BTC_THB',qty:40,cost:4000,stop:99,target:110,positionId:id,strategy:'TEST',openedAt:now-10000,realized:0}];return s;}
test('independent live stop needs no candle or news and uses only bot-owned quantity',()=>{
 const m={...market(),bid:98.5,last:98.5,ask:98.51},s=held();
 const out=planLive(s,{markets:[m]},wallet(),now,{entries:false,id:()=>id});
 assert.equal(out.intents.length,1);assert.equal(out.intents[0].order.side,'SELL');assert.equal(out.intents[0].order.amount,40);assert.equal(out.intents[0].order.type,'limit');assert.equal(out.state.positions[0].qty,40);
});
test('severe stop gap selects a real market sell fallback, never a market buy',()=>{
 const m={...market(),bid:90,last:90,ask:90.01};const out=planLive(held(),{markets:[m]},wallet(),now,{entries:false,id:()=>id});
 assert.equal(out.intents[0].order.type,'market');assert.equal(exchangeBody(out.intents[0].order).rat,0);
 assert.throws(()=>exchangeBody({...buy(),type:'market'}));assert.throws(()=>exchangeBody({...buy(),amount:Infinity}));
 const s=held();s.orders=[{...buy(),id:'old-exit',side:'SELL',status:'CANCELED',reason:'STOP_LOSS',positionId:'another-position'}];
 const normal=planLive(s,{markets:[{...market(),bid:98.5,last:98.5,ask:98.51}]},wallet(),now,{entries:false,id:()=>id});
 assert.equal(normal.intents[0].order.type,'limit');assert.equal(normal.intents[0].order.positionId,id);
});
test('live SELL fill applies actual proceeds, net fee credits and realized cost basis',()=>{
 const s=held();s.orders=[{...buy(),side:'SELL',amount:20,remaining:20,stop:undefined,target:undefined}];
 const data=info({status:'filled',history:[{txn_id:'sell-1',amount:20,rate:110,fee:5.5,credit:1.5,timestamp:now-100}],filled:20,remaining:0});
 const out=applyExchangeInfo(s,id,data,now);assert.equal(out.state.cash,8196);assert.equal(out.state.realized,196);assert.equal(out.state.positions[0].qty,20);assert.equal(out.state.positions[0].cost,2000);assert.equal(out.state.fees,4);
});
test('cancel pending and unknown buys continue reserving slots and exposure',()=>{
 for(const status of ['CANCEL_PENDING','UNKNOWN','SUBMITTING','RESERVED']){
  const s=initialLive(10000,now);s.orders=[{...buy(),status}];assert.equal(liveSummary(s).slots,1);assert.equal(liveSummary(s).reserved,1000);
  if(status!=='RESERVED'){const out=planLive(s,{markets:[market()]},wallet(),now,{entries:true});assert.equal(out.state.orders.length,1);}
 }
});
test('daily loss lock is based on marked equity and does not clear on a rebound',()=>{
 let s=held(),m={...market(),bid:90,last:90,ask:90.01};s=markLive(s,[m],now).state;assert.equal(s.dailyLocked,true);
 s=markLive(s,[market()],now+1).state;assert.equal(s.dailyLocked,true);assert.equal(s.dayPnl,-10);
});
test('wallet mismatch and emergency stop prevent new execution intents',()=>{
 const s=held();assert.equal(walletMatches(s,{...wallet(),BTC:{available:0,reserved:0}},now),false);
 assert.equal(planLive(s,{markets:[market()]},{...wallet(),THB:{available:1,reserved:0}},now).intents.length,0);
 s.kill='ALL';assert.equal(planLive(s,{markets:[{...market(),bid:90,last:90,ask:91}]},wallet(),now).intents.length,0);
});
test('paper-age gaps across midnight do not invent a verified live day baseline',()=>{
 const s=held();s.lastAt=now-200000;s.day='2000-01-01';
 const r=markLive(s,[market()],now);assert.equal(r.healthy,false);assert.equal(r.state.baselinePending,true);
});
test('Live activation without explicit owner confirmation does not read credentials',async()=>{
 const service=createLiveService({rpc:()=>{throw Error('no RPC');},keys:()=>{throw Error('no keys');}});
 await assert.rejects(service.activate(uid,{confirm:'wrong',acceptRisk:true,noWithdraw:true,budget:10000}),/CONFIRMATION/);
});
test('locked live preflight uses private reads only, allocates no capital and never places an order',async()=>{
 let saved;const calls=[],row={user_id:uid,mode:'LIVE_LOCKED',state:null,preflight:{},latest:{},revision:0,lease:id};
 const service=createLiveService({clock:()=>now,keys:async()=>({apiKey:'TEST_PUBLIC_KEY_ONLY',apiSecret:'TEST_ONLY'}),wallet:async()=>wallet(),signed:async(p,method,path)=>{calls.push({method,path});assert.equal(method,'GET');return{result:[]};},
 rpc:async(name,args)=>{if(name==='rea_live_scan_targets')return[];if(name==='rea_live_claim')return[row];if(name==='rea_live_checkpoint'){saved=args;return{...row,...args,revision:1};}return true;}});
 await service.run();assert.equal(saved.p_state,null);assert.equal(saved.p_preflight.ok,true);assert(calls.every(x=>!x.path.includes('place-')));
});
test('unknown exchange response is recovered by client ID instead of resubmission',async()=>{
 const s=initialLive(10000,now);s.orders=[{...buy(),status:'UNKNOWN',exchangeId:null}];let saved,places=0;
 const row={user_id:uid,mode:'LIVE_ENABLED',state:s,preflight:{},latest:{},revision:0,lease:id};
 const service=createLiveService({clock:()=>now,keys:async()=>({apiKey:'TEST',apiSecret:'TEST_ONLY'}),wallet:async()=>wallet(),scan:async()=>({markets:[market()]}),quotes:async()=>[market()],
 signed:async(p,method,path)=>{if(path.includes('place-'))places++;if(path.includes('my-open-orders'))return{result:path.includes('btc_thb')?[{id:'recovered',client_id:'rea19-test'}]:[]};if(path.includes('order-info'))return{result:info({status:'filled',history:[{...info().history[0],amount:1000,fee:2.5}],filled:1000,remaining:0})};throw Error(path);},
 rpc:async(name,args)=>{if(name==='rea_live_claim')return[row];if(name==='rea_live_ready')return{ready:false};if(name==='rea_live_checkpoint'){saved=args;return{...row,revision:1};}return true;}});
 await service.run(true);assert.equal(places,0);assert.equal(saved.p_state.orders[0].exchangeId,'recovered');assert.equal(saved.p_state.orders[0].status,'FILLED');assert.equal(saved.p_fills[0].simulation,false);
});
function trend(symbol='BTC_THB'){
 const bar=Math.floor(now/300000)*300000,candles=Array.from({length:200},(_,i)=>{const c=100+i*.003+Math.sin(i*.8)*.05;return{t:bar-(200-i)*300000,o:c,h:c+.08,l:c-.08,c,v:100};}),p=candles.at(-1).c;
 return{...market(),symbol,bid:p-.01,ask:p,last:p,candles,volumeTHB:1e7,dataQuality:{ready:true},news:{ready:false},depth:{at:now,asks:[[p,10000]],bids:[[p-.01,10000]]}};
}
test('live selection reserves at most two buys within actual reduced capital and risk',()=>{
 for(const capital of [5000,10000]){
  let next=0;const out=planLive(initialLive(capital,now),{markets:[trend(),trend('ETH_THB'),trend('SOL_THB')]},wallet(),now,{entries:true,id:()=>String(++next)});
  assert.equal(out.state.orders.length,2);assert(out.decisions.some(x=>x.reason==='MAX_POSITIONS'));
  for(const o of out.state.orders){assert(o.modeledLoss<=capital*.01);assert(o.amount<=4000);assert(o.limit>=trend().ask);assert(o.limit<=trend().ask*1.002);}
  assert(out.state.orders.reduce((n,o)=>n+o.amount,0)<=Math.min(capital,8000));assert.equal(out.state.fills.length,0);
 }
});
test('actual execution persists the order before sending, and acknowledgement cannot fabricate a holding',async()=>{
 let row={user_id:uid,mode:'LIVE_ENABLED',state:initialLive(10000,now),preflight:{},latest:{},revision:0,lease:id},stored=null,writes=0;const calls=[];
 const service=createLiveService({clock:()=>now,keys:async()=>({apiKey:'TEST',apiSecret:'TEST_ONLY'}),wallet:async()=>wallet(),scan:async()=>{calls.push('SCAN');return{markets:[trend()]};},quotes:async()=>[trend()],
 signed:async(p,method,path,body,ticket)=>{if(method==='GET')return{result:[]};assert.equal(path,'/api/v3/market/place-bid');assert.equal(stored.orders[0].status,'RESERVED');writes++;ticket.dispatched=true;ticket.revision=row.revision+1;return{error:0,result:{id:'ACK_TEST_ONLY',rec:100}};},
 rpc:async(name,args)=>{if(name==='rea_live_scan_targets')return[{state:row.state}];if(name==='rea_live_claim'){calls.push('CLAIM');return[row];}if(name==='rea_live_ready')return{ready:true};if(name==='rea_live_checkpoint'){stored=structuredClone(args.p_state);row={...row,state:stored,preflight:args.p_preflight,revision:args.p_revision+1};return row;}return true;}});
 await service.run();assert(calls.indexOf('SCAN')<calls.indexOf('CLAIM'));assert.equal(writes,1);assert.equal(stored.orders[0].status,'OPEN');assert.equal(stored.orders[0].exchangeId,'ACK_TEST_ONLY');assert.equal(stored.positions.length,0);assert.equal(stored.cash,10000);assert.equal(stored.fills.length,0);
});
test('a stalled live scanner does not acquire or block the independent risk execution lane',async()=>{
 let enterScan,release;const entered=new Promise(resolve=>enterScan=resolve),blocked=new Promise(resolve=>release=resolve),claims=[];
 const service=createLiveService({rpc:async(name,args)=>{if(name==='rea_live_scan_targets')return[{state:initialLive(10000,now)}];if(name==='rea_live_claim'){claims.push(args.p_lane);return[];}return true;},scan:async()=>{enterScan();await blocked;return{markets:[]};}});
 const strategy=service.run(false);await entered;assert.deepEqual(claims,[]);await service.run(true);assert.deepEqual(claims,['risk']);release();await strategy;assert.deepEqual(claims,['risk','strategy']);
});
