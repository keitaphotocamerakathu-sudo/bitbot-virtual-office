import test from 'node:test';import assert from 'node:assert/strict';
import {runMaster} from '../supabase/functions/bitbot-v10/master-orchestrator.mjs';
import {MASTER_DEFAULTS,MASTER_SPEC} from '../supabase/functions/bitbot-v10/master-config.mjs';
import {initialMasterBook,manageMasterExits,fillMasterOrders,markMaster} from '../supabase/functions/bitbot-v10/master-execution.mjs';
import {masterRiskState,bracketCost} from '../supabase/functions/bitbot-v10/master-risk.mjs';
import {performanceMetrics,monteCarlo,validationAssessment} from '../supabase/functions/bitbot-v10/master-validation.mjs';
import {masterJournal} from '../supabase/functions/bitbot-v10/master-service.mjs';
import {NOW,market,quote,heldPosition} from './master-fixtures.mjs';
test('a complete multi-horizon Paper cycle creates seven task receipts and can reserve a long strategy without a private order',()=>{
 const m=market(),before=structuredClone(m),out=runMaster(null,{markets:[m]},NOW),buy=out.decisions.find(d=>d.action==='BUY');assert(buy);assert.equal(out.latest.skills.length,7);assert.equal(out.latest.advancedCapabilities.length,8);assert.equal(out.fills.length,0);assert.equal(out.book.mode,'PAPER_ONLY');assert.equal(out.latest.canActivateLive,false);assert.equal(out.latest.summary.maxPositions,5);assert(out.latest.summary.openRiskTHB<=300);assert(out.latest.summary.reservedTHB<=7000);assert.deepEqual(m,before);assert.equal(buy.horizon,'LONG');assert(masterJournal(out).some(e=>e.type==='DECISION'&&e.payload.signal==='WAIT'));
 const repeated=runMaster(out.book,{markets:[m]},NOW);assert.equal(repeated.replayed,true);assert.deepEqual(repeated.book,out.book);assert.equal(repeated.fills.length,0);
});
test('Paper buys only fill from newer depth, account for fees, preserve horizon across restart and cannot be promoted to Live',()=>{
 const first=runMaster(null,{markets:[market()]},NOW),old=runMaster(first.book,{markets:[market()]},NOW+1000);assert.equal(old.fills.length,0);
 const later=market('BTC_THB',NOW+1000),out=runMaster(first.book,{markets:[later]},NOW+1000);assert(out.fills.length>0);assert(out.fills.every(f=>f.simulation&&f.fillModel==='LATER_OBSERVED_DEPTH_MAX_10_PERCENT'));assert(out.book.fees>0);assert(out.book.equity<10000);assert.equal(out.book.positions[0].horizon,'LONG');
 const restarted=runMaster(JSON.parse(JSON.stringify(out.book)),{markets:[market('BTC_THB',NOW+2000)]},NOW+2000);assert.equal(restarted.book.positions[0].horizon,'LONG');assert.equal(restarted.fills.filter(f=>f.side==='BUY').length,0);assert.throws(()=>runMaster({...out.book,mode:'LIVE'},{markets:[later]},NOW+2000));
});
test('combined horizons and pending orders share five slots, three percent open risk and an actual cash reserve',()=>{
 const markets=['BTC','ETH','XRP','ADA','KUB','SOL'].map(s=>market(s+'_THB')),out=runMaster(null,{markets},NOW),r=masterRiskState(out.book,MASTER_DEFAULTS,NOW);assert(r.slots<=5);assert(r.openRiskTHB<=r.portfolioRiskCapTHB);assert(out.book.cash-r.reservedTHB>=r.cashReserveTHB);assert(r.exposureTHB<=r.maxExposureTHB);assert(out.book.orders.filter(o=>o.side==='BUY').every(o=>o.riskTHB<=100));
 const small=initialMasterBook(NOW,100),s=runMaster(small,{markets:[market()]},NOW);assert(s.book.orders.every(o=>o.riskTHB<=1));assert(s.latest.summary.portfolioRiskCapTHB<=3);assert(s.latest.summary.maxPositionTHB<=40);
});
test('risk-cost sizing includes both fees, exit slippage, precision and minimum executable stop value',()=>{
 const a=bracketCost({amount:100,entry:100,stop:98,target:106}),b=bracketCost({amount:10,entry:100,stop:98,target:106});assert(a.modeledRiskTHB>2);assert(a.modeledTargetProfitTHB<6);assert(b.stopGrossTHB<10);assert.equal(a.expectedReturn,null);
});
test('daily-loss latch includes marked holdings and does not reset after a rebound or a config pause/resume',()=>{
 const b=initialMasterBook(NOW);b.positions=[heldPosition()];b.cash=9000;const events=[];markMaster(b,[quote(60)],MASTER_DEFAULTS,NOW,events);assert(b.dayPnl<=-300);assert.equal(b.dailyLocked,true);markMaster(b,[quote(110)],MASTER_DEFAULTS,NOW+1000,events);assert.equal(b.dailyLocked,true);assert.equal(events.filter(e=>e.kind==='DAILY_LOSS_LOCK').length,1);
 const out=runMaster(b,{markets:[quote(110,NOW+2000)]},NOW+2000);assert(!out.decisions.some(d=>d.action==='BUY'));assert.equal(out.book.dailyLocked,true);
});
test('three losses pause entries for one hour, and lower limits cancel pending buys before they fill',()=>{
 const first=runMaster(null,{markets:[market()]},NOW),b=first.book;b.closed=Array.from({length:3},(_,i)=>({id:String(i),pnl:-1,closedAt:NOW-1000-i*1000}));const out=runMaster(b,{markets:[market('BTC_THB',NOW+1000)]},NOW+1000);assert.equal(out.fills.length,0);assert(out.book.orders.every(o=>o.status==='CANCELED'));assert(out.decisions.some(d=>d.reasons.includes('LOSS_STREAK_COOLDOWN')));
 const lower=runMaster(first.book,{markets:[market('BTC_THB',NOW+1000)]},NOW+1000,{config:{...MASTER_DEFAULTS,riskPerTrade:.001}});assert.equal(lower.fills.length,0);assert(lower.book.orders.filter(o=>o.side==='BUY').every(o=>o.riskTHB<=10||o.status==='CANCELED'));
});
test('protective exits do not depend on a browser, and a gap loss is recorded without a fabricated profitable fill',()=>{
 const b=initialMasterBook(NOW);b.positions=[heldPosition()];b.cash=9000;const events=[],decisions=manageMasterExits(b,[quote(97.5)],{},MASTER_DEFAULTS,NOW,events);assert.equal(decisions[0].reasons[0],'FIXED_STOP');assert.equal(fillMasterOrders(b,[quote(97.5)],MASTER_DEFAULTS,NOW,events).length,0);
 const fills=fillMasterOrders(b,[quote(97.5,NOW+1000)],MASTER_DEFAULTS,NOW+1000,events);assert.equal(fills.length,1);assert.equal(b.positions.length,0);assert(b.closed[0].pnl<0);assert.equal(b.realized,b.closed[0].pnl);assert.equal(b.cash,10000+b.realized);assert.equal(b.closed[0].horizon,'SHORT');
});
test('partial profit exits require both remaining and exit quantities to clear the minimum and keep the entry horizon',()=>{
 const b=initialMasterBook(NOW);b.positions=[heldPosition()];b.cash=9000;const analyses={BTC_THB:{frames:{5:{ready:true,atrWilder:1,reversalDown:false}},intelligence:{regime:'BULLISH'}}},events=[];
 const d=manageMasterExits(b,[quote(103)],analyses,MASTER_DEFAULTS,NOW,events);assert.equal(d[0].reasons[0],'PARTIAL_TAKE_PROFIT');assert.equal(d[0].qty,5);const fills=fillMasterOrders(b,[quote(103,NOW+1000)],MASTER_DEFAULTS,NOW+1000,events);assert.equal(fills.length,1);assert.equal(b.positions[0].qty,5);assert.equal(b.positions[0].partialTaken,true);assert.equal(b.positions[0].horizon,'SHORT');assert(b.positions[0].stop>=98);
 const tiny=initialMasterBook(NOW);tiny.cash=9980;tiny.positions=[{...heldPosition(),qty:.19,cost:19,initialCost:19,initialRiskTHB:.7}];assert.equal(manageMasterExits(tiny,[quote(103)],analyses,MASTER_DEFAULTS,NOW,[]).length,0);
});
test('missing prices prevent new risk and cannot silently verify a missed midnight baseline',()=>{
 const b=initialMasterBook(NOW);b.cash=9000;b.positions=[heldPosition()];b.lastAt=NOW-3600000;b.day='2000-01-01';assert.equal(markMaster(b,[],MASTER_DEFAULTS,NOW,[]),false);assert.equal(markMaster(b,[quote(100)],MASTER_DEFAULTS,NOW,[]),true);assert.equal(b.baselinePending,true);
 const noData=runMaster(null,{markets:[]},NOW);assert.equal(noData.latest.health,'SAFE_MODE');assert.equal(noData.book.validMinutes,0);assert.equal(noData.decisions.length,0);
});
test('retrying a minute cannot inflate forward evidence or authorize a live strategy',()=>{
 const a=runMaster(null,{markets:[market()]},NOW),b=runMaster(a.book,{markets:[market('BTC_THB',NOW+1000)]},NOW+1000);assert.equal(b.book.validMinutes,1);assert.equal(b.latest.validation.forward.coverage,1);assert.equal(b.latest.validation.canActivateLive,false);assert.equal(b.latest.validation.forward.daysObserved<7,true);
});
test('metrics preserve losses, disclose insufficient Sharpe samples and seeded Monte Carlo is descriptive',()=>{
 const trades=Array.from({length:40},(_,i)=>({pnl:i%2?2:-3})),m=performanceMetrics(trades);assert.equal(m.netProfit,-20);assert.equal(m.profitFactor,2/3);assert.equal(m.expectancy,-.5);assert.equal(m.winRate,.5);assert.equal(m.sharpe,null);assert(m.winRateWilson95[0]<.5&&m.winRateWilson95[1]>.5);
 const a=monteCarlo(trades),b=monteCarlo(trades);assert.deepEqual(a,b);assert.equal(a.canTrade,false);assert.equal(monteCarlo(trades.slice(0,2)).status,'INSUFFICIENT_TRADES');
});
