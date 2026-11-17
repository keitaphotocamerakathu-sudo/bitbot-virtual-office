import test from 'node:test';
import assert from 'node:assert/strict';
import {initialREA,cycleREA,riskSizeREA,slotCount,reservedCash,cashflowREA,rollREA,analyticsREA} from '../supabase/functions/bitbot-v10/rea-core.mjs';
const now=Date.UTC(2026,10,17,5),bar=Math.floor(now/300000)*300000;
function market(symbol='BTC_THB',at=now){
 const candles=Array.from({length:200},(_,i)=>{const c=100+i*.003+Math.sin(i*.8)*.05;return{t:bar-(200-i)*300000,o:c,h:c+.08,l:c-.08,c,v:100};});
 const price=candles.at(-1).c;return{symbol,status:'active',marketSource:'exchange',ask:price,bid:price-.01,last:price,observedAt:at,volumeTHB:1e7,dataQuality:{ready:true},news:{ready:false},rules:{qtyScale:8,minQuote:10},candles,depth:{at,asks:[[price,10000]],bids:[[price-.01,10000]]}};
}
test('1% risk sizing includes round trip fees and slippage and never exceeds caps',()=>{
 const s=initialREA(now),r=riskSizeREA(s,{stopDistance:.02},[],now);assert(r.notional>3690&&r.notional<3704);assert(r.modeledLoss<=100);
 for(const equity of [50,1000,5000,10000,20000]){s.cash=equity;s.dayStart=equity;s.equity=equity;const n=riskSizeREA(s,{stopDistance:.02},[],now);assert(n.notional*(.02+.005+.002)<=Math.min(100,equity*.01));assert(n.notional*1.0025<=4000);assert(n.risk<=100);}
});
test('pending entries reserve slots/cash; two simultaneous signals cannot admit a third',()=>{
 const out=cycleREA(initialREA(now),{markets:[market('BTC_THB'),market('ETH_THB'),market('SOL_THB')]},now);
 assert.equal(slotCount(out.state),2);assert.equal(out.state.orders.length,2);assert(reservedCash(out.state)<=8000);assert.equal(out.fills.length,0);assert(out.signals.some(s=>s.reason==='MAX_POSITIONS'));
});
test('limit orders fill only on a later quote, preserve fills over restart, and cannot replay a signal',()=>{
 const m=market(),a=cycleREA(initialREA(now),{markets:[m]},now);assert.equal(a.state.orders.length,1);
 const b=cycleREA(JSON.parse(JSON.stringify(a.state)),{markets:[{...m,observedAt:now+60000,depth:{...m.depth,at:now+60000}}]},now+60000);
 assert.equal(b.state.positions.length,1);assert.equal(b.fills.length,1);assert.equal(b.state.orders[0].status,'FILLED');assert(b.state.positions[0].cost<=4000);
 const c=cycleREA(b.state,{markets:[{...m,observedAt:now+61000,depth:{...m.depth,at:now+61000}}]},now+61000);assert.equal(c.state.orders.length,1);assert.equal(c.fills.length,0);
});
test('partial fills reserve their remaining cash and are canceled after timeout without losing holdings',()=>{
 const m=market(),a=cycleREA(initialREA(now),{markets:[m]},now);const thin={...m,observedAt:now+60000,depth:{at:now+60000,asks:[[m.ask,.5]],bids:[[m.bid,1]]}};
 const b=cycleREA(a.state,{markets:[thin]},now+60000);assert.equal(b.state.orders[0].status,'PARTIAL');assert(b.state.positions[0].qty>0);assert(reservedCash(b.state)>0);
 const c=cycleREA(b.state,{markets:[{...thin,observedAt:now+120000,depth:{...thin.depth,at:now+120000}}]},now+120000);assert.equal(c.state.orders[0].status,'CANCELED');assert.equal(reservedCash(c.state),0);assert.equal(c.state.positions[0].qty,b.state.positions[0].qty);
});
test('daily loss locks on net marked equity and cannot unlock on a same-day rebound or resume',()=>{
 const s=initialREA(now);s.cash=9700;let a=cycleREA(s,{markets:[market()]},now);assert(a.state.dailyLocked);assert.equal(a.state.orders.length,0);
 a.state.cash=10000;const b=cycleREA(a.state,{markets:[market()]},now+1000,{buyPaused:false});assert(b.state.dailyLocked);assert.equal(b.state.orders.length,0);
});
test('daily lock cancels pending buys and permits backend risk exits',()=>{
 const s=initialREA(now);s.cash=6000;s.positions=[{symbol:'BTC_THB',qty:40,cost:4000,stop:99,target:110,openedAt:now-1000,positionId:'p',strategy:'TREND_FOLLOWING',realized:0}];
 const m={...market(),ask:90.01,bid:90,last:90};const out=cycleREA(s,{markets:[m]},now);assert(out.state.dailyLocked);assert.equal(out.state.orders[0].side,'SELL');assert.equal(out.state.orders[0].reason,'STOP_LOSS');
});
test('deposits and withdrawals are removed from daily P&L',()=>{
 let s=initialREA(now);s=cashflowREA(s,500);rollREA(s,[],now);assert.equal(s.dayPnl,0);s=cashflowREA(s,-600);rollREA(s,[],now);assert.equal(s.dayPnl,0);
});
test('Bangkok midnight unlocks only after healthy marks and a missed held baseline stays locked',()=>{
 const midnight=Date.UTC(2026,10,17,17),s=initialREA(midnight-60000);s.dailyLocked=true;s.lastAt=midnight-60000;
 const a=cycleREA(s,{markets:[]},midnight);assert.equal(a.state.day,'2026-11-18');assert.equal(a.state.dailyLocked,false);
 s.positions=[{symbol:'BTC_THB',qty:1,cost:100,stop:98,target:105,positionId:'p',openedAt:now,realized:0}];s.lastAt=midnight-300000;
 const b=cycleREA(s,{markets:[market('BTC_THB',midnight)]},midnight);assert.equal(b.state.baselinePending,true);assert.equal(b.health,'SAFE_MODE');
});
test('stale data and LLM-style control injection cannot create entries or change risk caps',()=>{
 const a=cycleREA(initialREA(now),{markets:[market('BTC_THB',now-31000)]},now,{mode:'LIVE_ENABLED',riskPerTrade:1,maxPositions:100});assert.equal(a.state.orders.length,0);assert.equal(a.mode,'PAPER_ONLY');
 assert.throws(()=>cycleREA({...initialREA(now),mode:'LIVE_ENABLED'},{markets:[]},now),/INVALID_RISK_STATE/);
});
test('kill all stops exits as well as entries; entry stop still permits a risk exit',()=>{
 const s=initialREA(now);s.cash=6000;s.positions=[{symbol:'BTC_THB',qty:40,cost:4000,stop:105,target:120,openedAt:now,positionId:'p',strategy:'test',realized:0}];
 assert.equal(cycleREA(s,{markets:[market()]},now,{kill:'ALL'}).state.orders.length,0);
 assert.equal(cycleREA(s,{markets:[market()]},now,{kill:'ENTRY'}).state.orders[0].side,'SELL');
});
test('no-lookahead: current unfinished candle never creates a signal',()=>{
 const m=market();m.candles.push({t:now,o:100,c:1000,h:1000,l:100,v:1e12});const a=cycleREA(initialREA(now),{markets:[m]},now);assert.equal(a.state.orders.length,0);
});
test('analytics distinguishes no losses from a proven profit factor',()=>{const a=analyticsREA(initialREA(now));assert.equal(a.profitFactor,null);assert.equal(a.winRate,null);assert.equal(a.available,10000);});
