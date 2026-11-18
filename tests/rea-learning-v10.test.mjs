import test from 'node:test';
import assert from 'node:assert/strict';
import {entryEvidence,exitEvidence,tradePostmortem,liveLearning,lossReentryGuard,experienceAssessment,paperExperienceGuard,LEARNING_PROTOCOL,EXPERIENCE_PROTOCOL,LOSS_COOLDOWN_MS} from '../supabase/functions/bitbot-v10/rea-learning.mjs';
import {initialLive,planLive,liveLimits} from '../supabase/functions/bitbot-v10/rea-live-core.mjs';
import {initialExperimentBook,stepExperiments,experimentHeld,EXPERIMENT_PROTOCOL} from '../supabase/functions/bitbot-v10/rea-experiments.mjs';
import {cycleREA,initialREA,scoreREA} from '../supabase/functions/bitbot-v10/rea-core.mjs';
import {createLiveService} from '../supabase/functions/bitbot-v10/rea-live-service.mjs';
const now=1794996000000,id='11111111-1111-4111-8111-111111111111';
function market(at=now,symbol='BTC_THB'){
 const bar=Math.floor(at/300000)*300000,candles=Array.from({length:200},(_,i)=>{const c=100+i*.003+Math.sin(i*.8)*.05;return{t:bar-(200-i)*300000,o:c,h:c+.08,l:c-.08,c,v:100};}),p=candles.at(-1).c;
 return{symbol,bid:p-.01,ask:p,last:p,observedAt:at,status:'active',marketSource:'exchange',candles,volumeTHB:1e7,dataQuality:{ready:true},rules:{qtyScale:8,priceStep:.01,minQuote:10},depth:{at,bids:[[p-.01,10000]],asks:[[p,10000]]}};
}
function closedState(){
 const s=initialLive(10000,now),m=market(now-3600000),signal=scoreREA(m,now-3600000);Object.assign(s,{cash:9975.3,equity:9975.3,realized:-24.7,fees:3.7});
 const buy={id,symbol:'BTC_THB',side:'BUY',status:'FILLED',strategy:'TREND_FOLLOWING',createdAt:now-3600000,stop:98,target:104,amount:1001.25,remaining:0,qtyScale:8,modeledLoss:25,entryEvidence:entryEvidence(signal,m,now-3600000)};
 s.orders=[buy,{id:'exit',positionId:id,symbol:'BTC_THB',side:'SELL',status:'FILLED',strategy:'TREND_FOLLOWING',reason:'STOP_LOSS',createdAt:now-2000,amount:10,remaining:0,qtyScale:8,exitEvidence:exitEvidence({stop:98,target:104},{...m,bid:98,ask:98.01,observedAt:now-2000},'STOP_LOSS',now-2000)}];
 s.fills=[{id:'buy-fill',orderId:id,symbol:'BTC_THB',side:'BUY',qty:10,price:100,fee:1.25,at:now-3599000,realized:0,simulation:false},{id:'sell-fill',orderId:'exit',symbol:'BTC_THB',side:'SELL',qty:10,price:97.9,fee:2.45,at:now-1000,realized:-24.7,simulation:false}];
 s.closed=[{id,symbol:'BTC_THB',pnl:-24.7,openedAt:now-3599000,closedAt:now-1000}];return s;
}
function relay(at=now){
 const startedAt=at-7*86400000,expectedMinutes=10081;
 return{protocol:EXPERIENCE_PROTOCOL,mode:'PAPER_ONLY',at,collection:{startedAt,validMinutes:expectedMinutes,expectedMinutes,coverage:1},baseline:{profile:'EXPERIENCE_BASELINE',startedAt,closedTrades:30,netPnL:-10,fees:20,maxDrawdown:.03,profitFactor:.9,markVerified:true},guarded:{profile:'EXPERIENCE_GUARDED',startedAt,closedTrades:30,netPnL:25,fees:15,maxDrawdown:.02,profitFactor:1.5,markVerified:true},losses:[{positionId:'paper-loss',symbol:'BTC_THB',strategy:'TREND_FOLLOWING',closedAt:at-1000,pnl:-2}]};
}
test('closed-trade knowledge reconciles actual fills, fees, trigger and negative P&L without inventing a market cause',()=>{
 const s=closedState(),before=structuredClone(s),r=tradePostmortem(s,s.closed[0],now);assert.equal(r.status,'VERIFIED');assert.equal(r.mode,'LIVE');assert.equal(r.netPnL,-24.7);assert.equal(r.metrics.grossPnL,-21);assert.equal(r.metrics.feesPaid,3.7);assert.equal(r.metrics.roundingDifference,0);assert.equal(r.metrics.avgExit,97.9);assert(r.evidence.facts.includes('STOP_LOSS_EXIT'));assert(r.evidence.facts.includes('EXIT_FILL_BELOW_STOP_TRIGGER'));assert(!r.evidence.facts.includes('NEWS_CAUSED_LOSS'));assert.equal(r.evidence.causalCertainty,'OBSERVED_LEDGER_FACTS_ONLY');assert.deepEqual(s,before);
});
test('old entry context stays missing and incomplete, duplicate, mismatched or simulated fills cannot become verified real knowledge',()=>{
 const old=closedState();delete old.orders[0].entryEvidence;const r=tradePostmortem(old,old.closed[0],now);assert.equal(r.evidence.entry,null);assert(r.evidence.missing.includes('ENTRY_MARKET_CONTEXT_NOT_RECORDED'));assert.equal(r.status,'VERIFIED');
 for(const change of [s=>s.fills.pop(),s=>s.fills.push({...s.fills[0]}),s=>s.fills[1].simulation=true,s=>s.fills[1].qty=9,s=>s.closed[0].pnl=-999,s=>s.fills[1].at=now+1000]){const s=closedState();change(s);const x=tradePostmortem(s,s.closed[0],now);assert.equal(x.status,'INCOMPLETE');assert.equal(x.metrics.grossPnL,null);assert.equal(x.metrics.feesPaid,null);}
});
test('one logical trade can include partial fills across multiple exit orders',()=>{
 const s=closedState();s.orders.push({...s.orders[1],id:'exit-2'});const f=s.fills.pop();s.fills.push({...f,id:'part-1',qty:4,fee:.98,realized:-9.88},{...f,id:'part-2',orderId:'exit-2',qty:6,fee:1.47,realized:-14.82});
 const r=tradePostmortem(s,s.closed[0],now);assert.equal(r.status,'VERIFIED');assert.equal(r.netPnL,-24.7);assert.equal(r.evidence.sellFillIds.length,2);assert.equal(r.metrics.feesPaid,3.7);
});
test('restart keeps an immutable postmortem and malformed learning cannot block stop planning',()=>{
 const s=closedState(),first=liveLearning(s,null,now),next=liveLearning(JSON.parse(JSON.stringify(s)),JSON.parse(JSON.stringify(first)),now+1000);assert.equal(next.reports.length,1);assert.deepEqual(next.reports,first.reports);assert.equal(next.reports[0].reviewedAt,now);assert.equal(next.counts.closed,1);assert.equal(next.activeCooldowns.length,1);assert.equal(liveLearning({closed:null,orders:null},{},now).status,'UNAVAILABLE');
 s.positions=[{symbol:'ETH_THB',qty:1,cost:100,stop:99,target:110,positionId:'held',strategy:'TREND_FOLLOWING'}];s.cash-=100;const m={...market(now,'ETH_THB'),bid:98,ask:98.01,last:98};const out=planLive(s,{markets:[m]},{at:now,THB:{available:s.cash,reserved:0},ETH:{available:1,reserved:0}},now,{entries:false,experience:{broken:true},id:()=> 'stop'});assert.equal(out.intents[0].order.reason,'STOP_LOSS');assert.equal(out.intents[0].order.side,'SELL');
});
test('real loss experience blocks only the same symbol and strategy for exactly 30 minutes and keeps risk limits',()=>{
 const s=closedState(),before=liveLimits(s),w={at:now,THB:{available:s.cash,reserved:0}},out=planLive(s,{markets:[market(),market(now,'ETH_THB')]},w,now,{entries:true,id:()=> 'new-order'});
 assert.equal(out.decisions.find(d=>d.symbol==='BTC_THB').reason,'LOSS_REENTRY_COOLDOWN');assert.equal(out.decisions.find(d=>d.symbol==='BTC_THB').learning.restriction.positionId,id);assert.equal(out.intents.filter(i=>i.order?.side==='BUY').length,1);assert.equal(out.intents[0].order.symbol,'ETH_THB');assert(out.intents[0].order.entryEvidence.indicators.regime);assert.deepEqual(liveLimits(out.state),before);
 assert.equal(lossReentryGuard(s,'BTC_THB','BREAKOUT',now).blocked,false);assert.equal(lossReentryGuard(s,'ETH_THB','TREND_FOLLOWING',now).blocked,false);assert.equal(lossReentryGuard(s,'BTC_THB','TREND_FOLLOWING',s.closed[0].closedAt+LOSS_COOLDOWN_MS).blocked,false);assert.equal(lossReentryGuard(s,'BTC_THB','TREND_FOLLOWING',s.closed[0].closedAt-1).blocked,false);
});
test('paper-to-live experience requires fresh matched seven-day evidence, costs, sufficient trades and improvement',()=>{
 assert.equal(experienceAssessment(relay(),now).ready,true);const good=paperExperienceGuard(relay(),'BTC_THB','TREND_FOLLOWING',now);assert.equal(good.blocked,true);assert.equal(good.reason,'PAPER_EXPERIENCE_COOLDOWN');assert.equal(good.simulation,true);
 const changes=[r=>r.mode='LIVE',r=>r.at=now-180001,r=>r.at=now+5001,r=>r.collection.coverage=.8,r=>r.collection.validMinutes=10082,r=>r.collection.expectedMinutes=1,r=>r.collection.startedAt+=60000,r=>r.baseline.closedTrades=29,r=>r.guarded.closedTrades=29,r=>r.guarded.netPnL=0,r=>r.guarded.netPnL=5,r=>r.guarded.maxDrawdown=.04,r=>r.guarded.profitFactor=1,r=>r.guarded.markVerified=false,r=>r.guarded.startedAt-=60000,r=>r.baseline.profile='MIXED'];
 for(const change of changes){const r=relay();change(r);assert.equal(paperExperienceGuard(r,'BTC_THB','TREND_FOLLOWING',now).blocked,false);}
 assert.equal(paperExperienceGuard(relay(),'ETH_THB','TREND_FOLLOWING',now).blocked,false);assert.equal(paperExperienceGuard(relay(),'BTC_THB','BREAKOUT',now).blocked,false);const future=relay();future.losses[0].closedAt=now+1;assert.equal(paperExperienceGuard(future,'BTC_THB','TREND_FOLLOWING',now).blocked,false);
 const malformed=relay();malformed.losses={invalid:true};assert.equal(paperExperienceGuard(malformed,'BTC_THB','TREND_FOLLOWING',now).blocked,false);malformed.losses=[null,{},'invalid'];assert.equal(paperExperienceGuard(malformed,'BTC_THB','TREND_FOLLOWING',now).blocked,false);
});
test('qualified Paper knowledge can only veto an entry; stale Paper falls back to numerical rules and never stops exits',()=>{
 const s=initialLive(99.97,now,'OWNER_LIMITED_LIVE'),w={at:now,THB:{available:99.97,reserved:0}},m=market(),ids=()=> 'new';
 const wait=planLive(s,{markets:[m]},w,now,{entries:true,experience:relay(),id:ids});assert.equal(wait.intents.length,0);assert.equal(wait.decisions[0].reason,'PAPER_EXPERIENCE_COOLDOWN');assert.equal(wait.state.cash,99.97);assert.deepEqual(liveLimits(wait.state),liveLimits(s));
 const old=relay(now-180001),normal=planLive(s,{markets:[m]},w,now,{entries:true,experience:old,id:ids});assert.equal(normal.intents.length,1);assert.equal(normal.intents[0].order.side,'BUY');assert.equal(normal.state.fills.length,0);
});
test('two additional Paper bots learn in parallel: only the guarded account skips a recent losing context',()=>{
 const b=initialExperimentBook(now);for(const key of ['EXPERIENCE_BASELINE','EXPERIENCE_GUARDED']){const a=b.accounts[key];a.state.closed=[{id:'prior',symbol:'BTC_THB',pnl:-2,openedAt:now-400000,closedAt:now-1000}];a.state.orders=[{id:'prior',side:'BUY',symbol:'BTC_THB',strategy:'TREND_FOLLOWING',status:'FILLED'}];a.state.cash=9998;a.state.realized=-2;a.stats.closedTrades=1;a.stats.grossLosses=2;}
 const out=stepExperiments(b,{markets:[market()]},now);assert.equal(out.summary.accounts.length,7);assert.equal(out.book.accounts.EXPERIENCE_BASELINE.state.orders.filter(o=>o.status==='OPEN').length,1);assert.equal(out.book.accounts.EXPERIENCE_GUARDED.state.orders.filter(o=>o.status==='OPEN').length,0);assert.equal(out.summary.relay.guarded.closedTrades,1);assert.equal(experienceAssessment(out.summary.relay,now).ready,false);assert.equal(out.summary.relay.collection.validMinutes,1);
});
test('upgrading five running trials preserves every old loss and starts only the matched experience pair now',()=>{
 const current=stepExperiments(null,{markets:[market()]},now).book,old=structuredClone(current);old.protocol='REA-EXPERIMENT-24.0.0';delete old.experience;delete old.accounts.EXPERIENCE_BASELINE;delete old.accounts.EXPERIENCE_GUARDED;Object.assign(old.accounts.MIXED.state,{cash:9980,realized:-20});old.accounts.MIXED.state.orders=[];old.accounts.MIXED.stats={closedTrades:1,wins:0,grossGains:0,grossLosses:20,fillCount:2};
 const saved=structuredClone(old);assert.doesNotThrow(()=>experimentHeld(old));const at=now+60000,out=stepExperiments(JSON.parse(JSON.stringify(old)),{markets:[market(at)]},at);assert.equal(out.book.protocol,EXPERIMENT_PROTOCOL);assert.equal(out.book.accounts.MIXED.state.realized,-20);assert.equal(out.book.accounts.MIXED.stats.grossLosses,20);assert.equal(out.book.accounts.MIXED.startedAt,now);assert.equal(out.book.accounts.EXPERIENCE_GUARDED.startedAt,at);assert.equal(out.summary.relay.collection.expectedMinutes,1);assert.equal(out.summary.relay.collection.validMinutes,1);assert.equal(out.summary.relay.baseline.closedTrades,0);assert.equal(out.summary.cycleFills.filter(f=>f.profile.startsWith('EXPERIENCE')).length,0);assert.deepEqual(old,saved);
});
test('strategy receives only the owner-scoped Paper relay, saves its assessment and risk lane makes no Paper or market scan request',async()=>{
 let row={user_id:'owner',mode:'LIVE_ENABLED',state:initialLive(99.97,now,'OWNER_LIMITED_LIVE'),preflight:{},latest:{},revision:1,lease:id},scanCount=0,brainCount=0,places=0;
 const service=createLiveService({clock:()=>now,brain:async()=>{brainCount++;return null;},keys:async()=>({apiKey:'TEST',apiSecret:'TEST'}),wallet:async()=>({at:now,THB:{available:99.97,reserved:0}}),scan:async()=>{scanCount++;return{markets:[market()]};},quotes:async()=>[],signed:async(p,method,path)=>{if(method==='POST')places++;assert.equal(method,'GET');return{result:[]};},rpc:async(name,args)=>{
  if(name==='rea_live_scan_targets')return[{paper_user_id:'owner',state:row.state,paper_experience:relay()},{paper_user_id:'another',state:initialLive(10,now),paper_experience:null}];if(name==='rea_live_claim')return[row];if(name==='rea_live_ready')return{limited:{ready:true}};if(name==='rea_live_checkpoint'){row={...row,state:args.p_state,latest:args.p_latest,revision:row.revision+1};return row;}return true;
 }});
 await service.run(false);assert.equal(row.latest.paperExperience.ready,true);assert.equal(row.latest.decisions[0].reason,'PAPER_EXPERIENCE_COOLDOWN');assert.equal(row.latest.learning.protocol,LEARNING_PROTOCOL);assert.equal(places,0);assert.equal(scanCount,1);const brainBefore=brainCount;await service.run(true);assert.equal(scanCount,1);assert.equal(brainCount,brainBefore);assert.equal(places,0);assert.equal(row.latest.paperExperience.ready,true);
});
