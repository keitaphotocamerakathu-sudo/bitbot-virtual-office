import test from 'node:test';
import assert from 'node:assert/strict';
import {initialExperimentBook,stepExperiments,experimentHeld,EXPERIMENT_PROFILES,createExperimentStore} from '../supabase/functions/bitbot-v10/rea-experiments.mjs';
import {initialREA,cycleREA,scoreREA} from '../supabase/functions/bitbot-v10/rea-core.mjs';
import {createREAService} from '../supabase/functions/bitbot-v10/rea-service.mjs';
const now=1794996000000;
function market(at=now){const t=Math.floor(at/300000)*300000,candles=Array.from({length:200},(_,i)=>{const c=100+i*.003+Math.sin(i*.8)*.05;return{t:t-(200-i)*300000,o:c,h:c+.08,l:c-.08,c,v:100};}),p=candles.at(-1).c;return{symbol:'BTC_THB',status:'active',marketSource:'exchange',last:p,ask:p,bid:p-.01,observedAt:at,candles,dataQuality:{ready:true},rules:{qtyScale:8,priceStep:.01,minQuote:10},volumeTHB:250000,news:{ready:false},depth:{at,bids:[[p-.01,10000]],asks:[[p,10000]]}};}
test('seven forward trials start equally, reserve only their own strategy and never fill retrospectively',()=>{
 const m=market(),signal=scoreREA(m,now);assert.equal(signal.strategy,'TREND_FOLLOWING');assert.equal(signal.eligible,true);assert(signal.score<80);
 const input={markets:[m]},before=structuredClone(input),first=stepExperiments(null,input,now);assert.equal(EXPERIMENT_PROFILES.length,7);assert.equal(first.summary.accounts.length,7);assert(first.summary.accounts.every(a=>a.initialCapital===10000&&a.closedTrades===0&&a.winRate===null&&a.netPnL===0));assert.equal(first.summary.cycleFills.length,0);
 assert.equal(first.book.accounts.MIXED.state.orders.length,1);assert.equal(first.book.accounts.TREND.state.orders.length,1);for(const key of ['BREAKOUT','MEAN_REVERSION','CAUTIOUS_MIXED'])assert.equal(first.book.accounts[key].state.orders.length,0);
 assert.equal(first.summary.canActivateLive,false);assert.equal(first.summary.winner,null);assert.equal(first.summary.windowCollected,false);assert.deepEqual(input,before);
});
test('paper fills include slippage and fees only on a later market snapshot; restart and replay cannot duplicate them',()=>{
 const first=stepExperiments(null,{markets:[market()]},now),saved=JSON.parse(JSON.stringify(first.book)),later=market(now+60000),second=stepExperiments(saved,{markets:[later]},now+60000);
 const a=second.summary.accounts.find(a=>a.profile==='TREND');assert(a.fees>0);assert(a.netPnL<0);assert.equal(a.fillCount,1);assert(second.summary.cycleFills.every(f=>f.simulation===true&&f.mode==='PAPER_ONLY'));
 const replay=stepExperiments(second.book,{markets:[later]},now+60000);assert.deepEqual(replay.book,second.book);assert.equal(replay.summary.cycleFills.length,0);assert.equal(replay.summary.samples,second.summary.samples);
 const resumed=stepExperiments(JSON.parse(JSON.stringify(second.book)),{markets:[market(now+120000)]},now+120000);assert.equal(resumed.book.accounts.TREND.stats.fillCount,1);assert.equal(saved.accounts.TREND.state.positions.length,0);
});
test('advancing the clock alone or refreshing a ticker over an old book cannot create paper fills',()=>{
 const m=market(),reserved=cycleREA(initialREA(now),{markets:[m]},now).state;
 assert.equal(cycleREA(reserved,{markets:[m]},now+1000).fills.length,0);
 assert.equal(cycleREA(reserved,{markets:[{...m,observedAt:now+1000}]},now+1000).fills.length,0);
 const newer={...m,observedAt:now+1000,depth:{...m.depth,at:now+1000}};assert(cycleREA(reserved,{markets:[newer]},now+1000).fills.length>0);
});
test('older signals cannot be replayed and experiment filters cannot introduce unsupported strategies',()=>{
 const m=market(),s=initialREA(now);s.seen[m.symbol]=scoreREA(m,now).signalAt+300000;const o=cycleREA(s,{markets:[m]},now);assert.equal(o.signals[0].reason,'SIGNAL_ALREADY_USED');assert.equal(o.state.orders.length,0);
 assert.throws(()=>cycleREA(initialREA(now),{markets:[m]},now,{entryStrategies:['LLM_FORCE_BUY']}),/INVALID_EXPERIMENT/);assert.throws(()=>cycleREA(initialREA(now),{markets:[m]},now,{minEntryScore:-1}),/INVALID_EXPERIMENT/);
});
test('valid minute coverage cannot be inflated by retries within one minute and empty feeds do not count',()=>{
 const first=stepExperiments(null,{markets:[market()]},now),second=stepExperiments(first.book,{markets:[market(now+1000)]},now+1000);assert.equal(second.summary.validMinutes,1);assert.equal(second.summary.expectedSamples,1);
 const later=stepExperiments(second.book,{markets:[]},now+120000);assert.equal(later.summary.validMinutes,1);assert.equal(later.summary.expectedSamples,3);assert.equal(later.summary.coverage,1/3);assert.equal(later.summary.windowCollected,false);
});
test('compaction preserves lifetime wins, fees and profit factor instead of resetting a losing history',()=>{
 const b=initialExperimentBook(now),a=b.accounts.MIXED;Object.assign(a.stats,{closedTrades:500,wins:250,grossGains:300,grossLosses:275,fillCount:550});Object.assign(a.state,{cash:10025,equity:10025,realized:25,fees:12});a.state.orders=Array.from({length:250},(_,i)=>({id:'old-order-'+i,status:'FILLED'}));a.state.fills=Array.from({length:250},(_,i)=>({id:'old-fill-'+i}));a.state.closed=Array.from({length:200},(_,i)=>({id:'old-closed-'+i,pnl:i%2?1:-1,closedAt:now-300000-i}));
 const r=stepExperiments(b,{markets:[market()]},now),x=r.summary.accounts.find(x=>x.profile==='MIXED');assert.equal(x.closedTrades,500);assert.equal(x.winRate,.5);assert.equal(x.profitFactor,300/275);assert.equal(x.fees,12);assert.equal(x.fillCount,550);assert.equal(r.book.accounts.MIXED.state.closed.length,50);assert(r.book.accounts.MIXED.state.orders.length<=102);assert.equal(r.book.accounts.MIXED.state.fills.length,100);
});
test('pause and emergency stop apply to Paper trials and cannot be cleared by restarting a trial',()=>{
 const b=stepExperiments(null,{markets:[market()]},now).book,paused=stepExperiments(b,{markets:[market(now+60000)]},now+60000,{buyPaused:true});assert.equal(paused.summary.cycleFills.length,0);assert(Object.values(paused.book.accounts).every(a=>a.state.orders.every(o=>o.status!=='OPEN')));
 const stopped=stepExperiments(b,{markets:[market(now+60000)]},now+60000,{kill:'ALL'});assert(Object.values(stopped.book.accounts).every(a=>a.state.kill==='ALL'));
 const locked=structuredClone(paused.book);for(const a of Object.values(locked.accounts))a.state.dailyLocked=true;const resumed=stepExperiments(locked,{markets:[market(now+120000)]},now+120000);assert(Object.values(resumed.book.accounts).every(a=>a.state.dailyLocked));
});
test('invalid persisted experiments fail closed rather than resetting their history to a new profitable start',()=>{
 const b=initialExperimentBook(now);b.accounts.TREND.state.mode='LIVE';assert.throws(()=>experimentHeld(b),/INVALID_RISK_STATE/);assert.throws(()=>stepExperiments(b,{markets:[market()]},now),/INVALID_RISK_STATE/);
 const ok=stepExperiments(null,{markets:[market()]},now).book;assert.throws(()=>stepExperiments(ok,{markets:[market()]},now-1),/CLOCK_REGRESSION/);
});
test('experiment store uses only the owner-scoped Paper RPCs',async()=>{
 const calls=[],store=createExperimentStore({rpc:async(name,args)=>{calls.push({name,args});return true;}});await store.load('verified-owner');await store.commit({p_uid:'verified-owner',p_lease:'LEASE',p_revision:3},{mode:'PAPER_ONLY'});assert.deepEqual(calls.map(x=>x.name),['rea_experiment_state','rea_experiment_checkpoint']);assert(calls.every(x=>x.args.p_uid==='verified-owner'));
});
test('research state and parent Paper state share one checkpoint, and a storage outage cannot reset trials',async()=>{
 let committed=0,mainSaved;const s=initialREA(now),make=research=>createREAService({clock:()=>now,marketService:{scan:async()=>({markets:[market()]})},research,rpc:async(name,args)=>{if(name==='rea_claim')return[{user_id:'owner',lease:'LEASE',revision:1,state:s}];if(name==='rea_checkpoint'){mainSaved=args;return true;}throw Error('Forbidden '+name);}});
 const service=make({load:async()=>null,commit:async(args,book)=>{committed++;assert.equal(args.p_state.mode,'PAPER_ONLY');assert(!args.p_state.accounts);assert.equal(args.p_latest.experiments.accounts.length,7);assert(Object.values(book.accounts).every(a=>a.state.mode==='PAPER_ONLY'));assert.equal(args.p_fills.length,0);return false;}});assert.equal((await service.run()).results[0].committed,false);assert.equal(committed,1);assert.equal(mainSaved,undefined);
 const unavailable=make({load:async()=>{throw Error('STORAGE_DOWN');},commit:async()=>{throw Error('MUST_NOT_RESET');}});await unavailable.run();assert.equal(mainSaved.p_latest.experiments.status,'UNAVAILABLE');assert.equal(mainSaved.p_state.mode,'PAPER_ONLY');
});
