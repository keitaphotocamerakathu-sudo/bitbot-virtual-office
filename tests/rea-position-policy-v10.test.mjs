import test from 'node:test';
import assert from 'node:assert/strict';
import {modeledNet,profitPrice,updatePaperPosition,qualityEntry,liveProfitReview,PROFIT_HYPOTHESIS,POSITION_PROTOCOL} from '../supabase/functions/bitbot-v10/rea-position-policy.mjs';
import {initialREA,cycleREA,scoreREA,REA_LIMITS} from '../supabase/functions/bitbot-v10/rea-core.mjs';
import {initialLive,planLive} from '../supabase/functions/bitbot-v10/rea-live-core.mjs';
import {initialExperimentBook,stepExperiments,experimentHeld} from '../supabase/functions/bitbot-v10/rea-experiments.mjs';
import {replayPositionQuotes} from '../research/replay-position-policy.mjs';
const now=1795003200000;
const position=()=>({symbol:'BTC_THB',qty:10,cost:1000,stop:98,target:104,openedAt:now-3600000,positionId:'BUY',strategy:'TREND_FOLLOWING',realized:0});
const quote=(bid,at=now)=>({symbol:'BTC_THB',bid,ask:bid+.01,last:bid,observedAt:at,status:'active',marketSource:'exchange',rules:{qtyScale:8,minQuote:10,priceStep:.01},depth:{at,bids:[[bid,10000]],asks:[[bid+.01,10000]]}});
function market(at=now){const end=Math.floor(at/300000)*300000,candles=Array.from({length:200},(_,i)=>{const c=100+i*.003+Math.sin(i*.8+1.5)*.05;return{t:end-(200-i)*300000,o:c,h:c+.08,l:c-.08,c,v:100};}),p=candles.at(-1).c;return{...quote(p-.01,at),ask:p,last:p,candles,volumeTHB:1e7,dataQuality:{ready:true}};}
test('profit activation includes existing cost basis, exit fees, slippage and rounding rather than arming on a small gross gain',()=>{
 const p=position();assert.equal(PROFIT_HYPOTHESIS.fee,REA_LIMITS.fee);assert.equal(PROFIT_HYPOTHESIS.slippage,REA_LIMITS.slippage);assert(modeledNet(p,100)<0);assert.equal(updatePaperPosition(p,quote(100.6),now,{policy:'PROTECT'}).position.stop,98);
 const activate=profitPrice(p,.01);assert(modeledNet(p,activate)>=10);const out=updatePaperPosition(p,quote(activate),now,{policy:'PROTECT'});assert(out.position.stop>98);assert(modeledNet(p,out.position.stop)>=3);assert.equal(out.position.protection.canGuaranteeProfit,false);assert.equal(p.stop,98);
});
test('raised stops only move up, survive restart and use fresh observed bids without candle-high hindsight',()=>{
 const p=position(),one=updatePaperPosition(p,quote(101.7),now,{policy:'PROTECT'}).position,two=updatePaperPosition(JSON.parse(JSON.stringify(one)),quote(103,now+1000),now+1000,{policy:'PROTECT'}).position;assert(two.stop>one.stop);
 const pullback=updatePaperPosition(two,quote(102.7,now+2000),now+2000,{policy:'PROTECT'}).position;assert.equal(pullback.stop,two.stop);assert.equal(pullback.protection.peakBid,103);
 const fakeHigh={...quote(100.6),candles:[{t:now-300000,h:1000000,c:100.6}]};assert.equal(updatePaperPosition(p,fakeHigh,now,{policy:'PROTECT'}).position.stop,98);
 const repeated=updatePaperPosition(two,{...quote(200),observedAt:two.protection.quoteAt},now+2000,{policy:'PROTECT'});assert.deepEqual(repeated.position,two);
});
test('stale, future, crossed, frozen or pre-entry quotes and unsettled buys cannot raise a protective stop',()=>{
 const p=position();for(const change of [m=>m.observedAt=now-30001,m=>m.observedAt=now+5001,m=>m.ask=m.bid-1,m=>m.frozen=true,m=>m.observedAt=p.openedAt-1]){const m=quote(103);change(m);assert.equal(updatePaperPosition(p,m,now,{policy:'PROTECT'}).position.stop,98);}
 assert.equal(updatePaperPosition(p,quote(103),now,{policy:'PROTECT',pendingEntry:true}).position.stop,98);assert.equal(updatePaperPosition(p,quote(103),now,{policy:'BASELINE'}).position.stop,98);assert.throws(()=>updatePaperPosition(p,quote(103),now,{policy:'LLM_FORCE_PROFIT'}));
});
test('a profit-protection trigger becomes a later depth-limited Paper exit and does not fabricate a same-snapshot fill',()=>{
 let s=initialREA(now);s.positions=[position()];s.cash=9000;s.orders=[{id:'BUY',symbol:'BTC_THB',side:'BUY',status:'FILLED',strategy:'TREND_FOLLOWING'}];s.fills=[{id:'buy-fill',orderId:'BUY',symbol:'BTC_THB',side:'BUY',qty:10,price:100,fee:0,at:now-3599000,realized:0,simulation:true}];
 const one=cycleREA(s,{markets:[quote(101.7)]},now,{positionPolicy:'PROTECT'}),two=cycleREA(one.state,{markets:[quote(103,now+1000)]},now+1000,{positionPolicy:'PROTECT'}),trigger=cycleREA(two.state,{markets:[quote(102.4,now+2000)]},now+2000,{positionPolicy:'PROTECT'});
 assert.equal(trigger.fills.length,0);assert.equal(trigger.state.orders.at(-1).reason,'PROFIT_PROTECTION');assert.equal(trigger.state.positions.length,1);
 const filled=cycleREA(trigger.state,{markets:[quote(102.4,now+3000)]},now+3000,{positionPolicy:'PROTECT'});assert.equal(filled.state.positions.length,0);assert(filled.state.closed[0].pnl>0);assert.equal(filled.state.closed[0].protection.protocol,POSITION_PROTOCOL);assert(filled.fills.every(f=>f.simulation===true));
});
test('a price gap can still lose money after protection arms; the model never changes that loss into zero',()=>{
 const p=updatePaperPosition(position(),quote(102),now,{policy:'PROTECT'}).position,after=updatePaperPosition(p,quote(90,now+1000),now+1000,{policy:'PROTECT'}).position;assert.equal(after.stop,p.stop);assert(modeledNet(after,90)<0);assert.equal(after.protection.canGuaranteeProfit,false);
 const s=initialREA(now);s.positions=[p];s.cash=9000;const out=cycleREA(s,{markets:[quote(90,now+1000)]},now+1000,{positionPolicy:'PROTECT',buyPaused:true});assert.equal(out.state.orders[0].reason,'PROFIT_PROTECTION');assert.equal(out.state.orders[0].side,'SELL');
 s.kill='ALL';assert.equal(cycleREA(s,{markets:[quote(90)]},now,{positionPolicy:'PROTECT'}).state.orders.length,0);
});
test('selective entry waits for aligned closed 15-minute evidence and rejects stretched RSI, spread and volume',()=>{
 const m=market(),signal=scoreREA(m,now);assert.equal(qualityEntry(signal,m,now).ready,true);
 for(const change of [(m,r)=>r.indicators.rsi=68,(m,r)=>m.volumeTHB=250000,(m,r)=>m.ask=m.bid*1.01,(m,r)=>m.candles=m.candles.slice(-50),(m,r)=>m.dataQuality.ready=false]){const q=structuredClone(m),r=structuredClone(signal);change(q,r);assert.equal(qualityEntry(r,q,now).ready,false);}
 const future=structuredClone(m);future.candles.push({t:now,o:1,h:1e8,l:1,c:1e8,v:1e8});assert.deepEqual(qualityEntry(signal,future,now),qualityEntry(signal,m,now));
 const low=structuredClone(m);low.volumeTHB=250000;const normal=cycleREA(initialREA(now),{markets:[low]},now),filtered=cycleREA(initialREA(now),{markets:[low]},now,{positionPolicy:'SELECTIVE_PROTECT'});assert(normal.state.orders.length>0);assert.equal(filtered.state.orders.length,0);assert.equal(filtered.signals[0].reason,'POSITION_STUDY_ENTRY_FILTER');
});
test('new matched three-account study starts now without resetting seven existing portfolios or their experience window',()=>{
 const first=stepExperiments(null,{markets:[market()]},now).book,old=structuredClone(first);old.protocol='REA-EXPERIMENT-25.0.0';delete old.positionStudy;for(const key of ['EXIT_BASELINE','EXIT_PROTECT','ENTRY_PROTECT'])delete old.accounts[key];const snapshot=structuredClone(old),at=now+60000,out=stepExperiments(old,{markets:[market(at)]},at);assert.doesNotThrow(()=>experimentHeld(old));assert.equal(out.summary.accounts.length,10);assert.equal(out.summary.positionStudy.accounts.length,3);assert.equal(out.summary.positionStudy.startedAt,at);assert.equal(out.summary.positionStudy.validMinutes,1);assert.equal(out.book.experience.startedAt,snapshot.experience.startedAt);
 for(const key of Object.keys(snapshot.accounts)){assert.equal(out.book.accounts[key].startedAt,snapshot.accounts[key].startedAt);assert(out.book.accounts[key].state.fees>=snapshot.accounts[key].state.fees);}assert.equal(out.summary.positionStudy.candidate,null);assert.equal(out.summary.positionStudy.canActivateLive,false);assert.deepEqual(old,snapshot);
 const replay=stepExperiments(out.book,{markets:[market(at)]},at);assert.deepEqual(replay.book,out.book);assert.equal(replay.summary.cycleFills.length,0);
});
test('study coverage does not count empty or bad quality data and paused portfolios cannot force a purchase',()=>{
 const first=stepExperiments(null,{markets:[market()]},now),bad=market(now+60000);bad.dataQuality.ready=false;const gap=stepExperiments(first.book,{markets:[bad]},now+60000,{buyPaused:true});assert.equal(gap.summary.positionStudy.validMinutes,1);assert.equal(gap.summary.positionStudy.expectedMinutes,2);assert(gap.summary.positionStudy.accounts.every(a=>a.closedTrades===0));assert.equal(gap.summary.positionStudy.candidate,null);assert.equal(gap.summary.positionStudy.canTrade,false);
});
test('read-only live profit review cannot move actual stops or grant Paper authority to the live executor',()=>{
 const s=initialLive(10000,now);s.cash=9000;s.positions=[position()];const before=structuredClone(s),review=liveProfitReview(s,{markets:[quote(103)]},now,{protocol:POSITION_PROTOCOL,mode:'PAPER_ONLY',at:now,status:'REVIEW_CANDIDATE',candidate:'EXIT_PROTECT'});assert.equal(review.mode,'LIVE_READ_ONLY');assert.equal(review.positions[0].actualStop,98);assert.equal(review.canTrade,false);assert.deepEqual(s,before);
 const out=planLive(s,{markets:[quote(102.4)]},{at:now,THB:{available:9000,reserved:0},BTC:{available:10,reserved:0}},now,{entries:false});assert.equal(out.intents.length,0);assert.equal(out.state.positions[0].stop,98);
 const stop=planLive(s,{markets:[quote(97)]},{at:now,THB:{available:9000,reserved:0},BTC:{available:10,reserved:0}},now,{entries:false,id:()=> 'risk-exit'});assert.equal(stop.intents[0].order.reason,'STOP_LOSS');
});
test('historical quote replay reports triggers only, rejects future lookahead and never claims an executed profit',()=>{
 const p=position(),history=[quote(101.7,now),quote(103,now+60000),quote(102.4,now+120000)].map(q=>({...q,at:q.observedAt})),result=replayPositionQuotes(p,history),base=result.variants.find(v=>v.policy==='BASELINE'),protect=result.variants.find(v=>v.policy==='PROTECT');assert.equal(base.trigger,null);assert.equal(protect.trigger.reason,'PROFIT_PROTECTION');assert.equal(protect.trigger.assumedFilled,false);assert(protect.trigger.modeledNetAtObservedBid>0);assert.equal(result.canTrade,false);
 const future=history.map(q=>({...q,observedAt:q.at+1}));assert.equal(replayPositionQuotes(p,future).variants[1].trigger,null);assert.throws(()=>replayPositionQuotes(p,[history[1],history[0]]));assert.equal(p.stop,98);
});
test('working-book compaction preserves the original fills of long-held positions and every recent cooldown loss',()=>{
 const b=initialExperimentBook(now),a=b.accounts.MIXED,p=position();a.state.positions=[p];a.state.cash=9000;a.state.orders=[{id:'BUY',side:'BUY',symbol:'BTC_THB',strategy:'TREND_FOLLOWING',status:'FILLED'},...Array.from({length:200},(_,i)=>({id:'old'+i,status:'FILLED'}))];a.state.fills=[{id:'basis',orderId:'BUY',qty:10,price:100},...Array.from({length:200},(_,i)=>({id:'oldfill'+i,orderId:'old'+i}))];a.state.closed=Array.from({length:40},(_,i)=>({id:'recent'+i,symbol:'ASSET'+i+'_THB',pnl:-1,closedAt:now-1000-i}));
 const out=stepExperiments(b,{markets:[market()]},now),s=out.book.accounts.MIXED.state;assert(s.orders.some(o=>o.id==='BUY'));assert(s.fills.some(f=>f.id==='basis'));assert.equal(s.closed.length,40);assert(s.orders.length<=51);assert(s.fills.length<=61);
});
