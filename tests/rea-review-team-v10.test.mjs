import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewTeam,REVIEW_ROLES} from '../supabase/functions/bitbot-v10/rea-review-team.mjs';
import {REA_TEAM,buildREAOffice} from '../assets/rea-view-model.mjs';
import {initialLive,planLive} from '../supabase/functions/bitbot-v10/rea-live-core.mjs';
import {createLiveService} from '../supabase/functions/bitbot-v10/rea-live-service.mjs';
const now=1794921000000,uid='11111111-1111-4111-8111-111111111111';
function market(){const t=Math.floor(now/300000)*300000,candles=Array.from({length:200},(_,i)=>{const c=100+i*.003+Math.sin(i*.8)*.05;return{t:t-(200-i)*300000,o:c,h:c+.08,l:c-.08,c,v:100};}),p=candles.at(-1).c;return{symbol:'BTC_THB',status:'active',marketSource:'exchange',last:p,ask:p,bid:p-.01,observedAt:now,candles,dataQuality:{ready:true},rules:{qtyScale:8,priceStep:.01,minQuote:10},volumeTHB:1e7,news:{ready:false},depth:{at:now,asks:[[p,10000]],bids:[[p-.01,10000]]}};}
const wallet=at=>({at,THB:{available:10000,reserved:0}});
test('seven new reviewers use one immutable snapshot and all fourteen office identities are distinct',()=>{
 const m=market(),before=structuredClone(m),out=reviewTeam({bundle:{markets:[m]},state:initialLive(10000,now),now,timings:{pipelineMs:100,scanMs:80,walletReads:1}});
 assert.deepEqual(m,before);assert.equal(out.receipt.reviewers,7);assert.equal(REVIEW_ROLES.length,7);assert.deepEqual(REA_TEAM.filter(r=>r.reviewer).map(r=>r.role),REVIEW_ROLES);assert.equal(out.receipt.blockedSymbols.length,0);
 const office=buildREAOffice({live:{state:initialLive(10000,now),preflight:{ok:true},latest:{at:now,health:'OK',team:out.receipt}},now});assert.equal(office.workers.length,14);assert.equal(new Set(office.workers.map(w=>w.worker_id)).size,14);assert.equal(new Set(office.archive.tasks.map(t=>t.id)).size,office.archive.tasks.length);
});
test('malformed OHLC, duplicate time, unclosed bars and invalid book quantities block fresh buys',()=>{
 for(const alter of [m=>m.candles.at(-1).h=m.candles.at(-1).c-1,m=>m.candles.at(-1).t=m.candles.at(-2).t,m=>m.candles.push({...m.candles.at(-1),t:now}),m=>m.depth.asks[0][1]=-1,m=>m.ask=m.candles.at(-1).c*10]){
  const m=market();alter(m);const guarded=reviewTeam({bundle:{markets:[m]},state:initialLive(10000,now),now});assert(guarded.receipt.blockedSymbols.includes('BTC_THB'));assert.equal(guarded.bundle.markets[0].dataQuality.ready,false);
  const planned=planLive(initialLive(10000,now),guarded.bundle,wallet(now),now,{entries:true});assert.equal(planned.intents.filter(i=>i.order?.side==='BUY').length,0);
 }
});
test('review rejection cannot suppress the independent stop or change a position size',()=>{
 const m=market(),s=initialLive(10000,now),qty=4000/m.ask;s.cash=6000;s.positions=[{symbol:'BTC_THB',qty,cost:4000,stop:m.ask*.99,target:m.ask*1.04,positionId:'test-held',strategy:'TEST',openedAt:now-1000}];m.bid=m.ask*.98;m.last=m.bid;m.candles.at(-1).h=0;
 const w={...wallet(now),THB:{available:6000,reserved:0},BTC:{available:qty,reserved:0}},out=reviewTeam({bundle:{markets:[m]},state:s,wallet:w,now});assert(out.receipt.blockedSymbols.length);
 const planned=planLive(s,out.bundle,w,now,{entries:false,id:()=> 'test-stop'});assert.equal(planned.intents.length,1);assert.equal(planned.intents[0].order.reason,'STOP_LOSS');assert.equal(planned.state.positions[0].qty,qty);
});
test('higher timeframes use closed resampled bars and missing evidence stays unavailable',()=>{
 const m=market(),out=reviewTeam({bundle:{markets:[m]},state:initialLive(10000,now),now}),frames=out.receipt.reviews.find(r=>r.role==='Multi-timeframe Analyst');assert.equal(frames.status,'COMPLETED');assert.equal(frames.evidence.examples[0].hour,'INSUFFICIENT');
 m.candles=m.candles.slice(-50);const short=reviewTeam({bundle:{markets:[m]},now});assert.equal(short.receipt.reviews.find(r=>r.role==='Multi-timeframe Analyst').status,'WAITING');assert.equal(short.receipt.blockedSymbols.length,0);
});
test('portfolio reviewer counts unknown and cancel-pending buys as occupied slots',()=>{
 const s=initialLive(10000,now);s.positions=[{symbol:'BTC_THB',cost:1000,qty:10}];s.orders=[{symbol:'ETH_THB',side:'BUY',status:'UNKNOWN',amount:500,executed:100},{symbol:'ETH_THB',side:'BUY',status:'CANCEL_PENDING',amount:100,executed:0}];
 const r=reviewTeam({bundle:{markets:[]},state:s,now}).receipt.reviews.find(r=>r.role==='Portfolio Auditor');assert.equal(r.evidence.slots,2);assert.equal(r.evidence.pendingBuys,2);assert.equal(r.evidence.exposureTHB,1500);
});
test('paper portfolio evidence includes the remaining reserved cash and its fees',()=>{
 const s=initialLive(10000,now);s.orders=[{symbol:'ETH_THB',side:'BUY',status:'PARTIAL',remaining:1000,reserved:1002.60}];
 const r=reviewTeam({bundle:{markets:[]},state:s,now}).receipt.reviews.find(r=>r.role==='Portfolio Auditor');assert.equal(r.evidence.exposureTHB,1002.60);assert.equal(r.evidence.slots,1);
});
test('cost and performance evidence report assumptions and measurements, not an accuracy forecast',()=>{
 const out=reviewTeam({bundle:{markets:[market()]},state:initialLive(10000,now),now,timings:{pipelineMs:4321,walletReads:1}}).receipt;
 assert.equal(out.reviews.find(r=>r.role==='Cost & Exit Reviewer').evidence.assumption,'MODEL_ALLOWANCE_NOT_A_PROFIT_FORECAST');assert.equal(out.reviews.find(r=>r.role==='Performance Monitor').evidence.pipelineMs,4321);assert.equal(out.reviews.find(r=>r.role==='Performance Monitor').evidence.accuracyClaim,'NOT_A_WIN_RATE');
});
function service({clock=()=>now,signed,walletRead,orders=[],brain}={}){
 const state=initialLive(10000,now);state.orders=orders;const row={user_id:uid,mode:'LIVE_ENABLED',state,preflight:{},latest:{},revision:0,lease:'test-lease'},saved=[];
 return{saved,engine:createLiveService({clock,brain,keys:async()=>({apiKey:'TEST',apiSecret:'TEST_ONLY'}),wallet:walletRead,signed,quotes:async()=>[],rpc:async(name,args)=>{if(name==='rea_live_idle'||name==='rea_live_release')return true;if(name==='rea_live_claim')return[row];if(name==='rea_live_ready')return{ready:true};if(name==='rea_live_checkpoint'){saved.push(args);return{...row,state:args.p_state,revision:saved.length};}throw Error('Unexpected capability '+name);}})};
}
test('private wallet and open-order reads start together; idle risk run reads wallet once and never invokes AI',{timeout:2000},async()=>{
 let releaseOrders,releaseWallet,startBoth,reads=0,started=0;const both=new Promise(r=>startBoth=r),mark=()=>{if(++started===2)startBoth();};
 const h=service({brain:()=>{throw Error('AI must not run in stop worker');},signed:()=>{mark();return new Promise(r=>releaseOrders=r);},walletRead:()=>{reads++;mark();return new Promise(r=>releaseWallet=r);}}),pending=h.engine.run(true);
 await both;assert.equal(started,2);releaseOrders({result:[]});releaseWallet(wallet(now));await pending;assert.equal(reads,1);assert.equal(h.saved[0].p_latest.performance.walletReads,1);
});
test('pending exchange orders still require a second wallet read after receipt reconciliation',async()=>{
 let reads=0;const order={id:'test-order',clientId:'test-client',exchangeId:'test-exchange',symbol:'BTC_THB',side:'BUY',type:'limit',status:'OPEN',amount:1000,remaining:1000,executed:0,createdAt:now-1000,qtyScale:8,limit:100,stop:98,target:104,riskFraction:.027,appliedTxnIds:[]};
 const h=service({orders:[order],walletRead:async()=>{reads++;return wallet(now);},signed:async(_p,method,path)=>{assert.equal(method,'GET');return path.includes('order-info')?{result:{status:'unfilled',client_id:'test-client',history:[],filled:0,remaining:1000}}:{result:[]};}});await h.engine.run(true);assert.equal(reads,2);
});
test('a wallet that ages while another API read is pending is refreshed before planning',async()=>{
 let tick=now,reads=0;const h=service({clock:()=>tick,walletRead:async()=>{reads++;return wallet(reads===1?now:tick);},signed:async()=>{tick=now+6000;return{result:[]};}});await h.engine.run(true);assert.equal(reads,2);
});
