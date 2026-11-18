import test from 'node:test';
import assert from 'node:assert/strict';
import {CAPITAL_GUARD,capitalGuard,stopExitEstimate,minimumExitSafeEntry} from '../supabase/functions/bitbot-v10/rea-risk-policy.mjs';
import {initialLive,planLive,liveLimits,livePositionRisk,liveRiskManager,liveSummary,markLive,validateLive} from '../supabase/functions/bitbot-v10/rea-live-core.mjs';
import {capitalAdvice,refreshCapitalAdvice} from '../supabase/functions/bitbot-v10/rea-capital-advisor.mjs';
const now=1795020600000,symbols=['BTC_THB','ETH_THB','SOL_THB','XRP_THB','ADA_THB','XLM_THB'];
function market(symbol){const t=Math.floor(now/300000)*300000,candles=Array.from({length:200},(_,i)=>{const c=100+i*.003+Math.sin(i*.8)*.05;return{t:t-(200-i)*300000,o:c,h:c+.08,l:c-.08,c,v:100};}),p=candles.at(-1).c;return{symbol,status:'active',marketSource:'exchange',ask:p,bid:p-.01,last:p,observedAt:now,candles,dataQuality:{ready:true},rules:{qtyScale:8,priceStep:.01,priceScale:2,minQuote:10},volumeTHB:1e7,depth:{at:now,asks:[[p,10000]],bids:[[p-.01,10000]]},news:{ready:false}};}
const bundle={markets:symbols.map(market)};
function context(capital=99.97,policy='OWNER_LIMITED_LIVE'){return{state:{...initialLive(capital,now,policy),maxPositions:5,riskProfile:CAPITAL_GUARD},bundle,wallet:{at:now,THB:{available:capital,reserved:0}},now,mode:'LIVE_ENABLED',health:'OK',entriesPermitted:true};}
function losses(s,at=now-1000){s.closed=Array.from({length:3},(_,i)=>({id:String(i),symbol:symbols[i],pnl:-.6,closedAt:at-(2-i)*60000}));return s;}
test('normal guard retains five slots within reduced concentration, cash reserve and original total risk',()=>{
 for(const [capital,policy] of [[99.97,'OWNER_LIMITED_LIVE'],[10000,'STANDARD']]){
  const c=context(capital,policy),out=planLive(c.state,bundle,c.wallet,now,{entries:true}),summary=liveSummary(out.state,now),manager=summary.riskManager;
  assert.equal(summary.maxPositions,5);assert.equal(out.state.orders.length,5);assert(summary.reserved<=summary.maxExposure);assert(manager.spendableAfterReserveTHB>=0);assert(summary.maxExposure<=capital*.7);assert(summary.maxPosition<=capital*.2);assert(summary.portfolioRiskUsed<=capital*.02);
  for(const o of out.state.orders){assert(o.modeledLoss<=summary.riskBudget);assert(o.riskEvidence.stopExitQuote>=10);assert.equal(o.riskEvidence.spec,'REA-RISK-28.0');}
 }
});
test('a 1.5 percent marked daily loss halves entry and aggregate risk without raising the daily hard limit',()=>{
 const c=context(),normal=liveLimits(c.state);c.state.cash=98.47;const marked=markLive(c.state,[],now).state,limits=liveLimits(marked),manager=liveRiskManager(marked,now);
 assert.equal(marked.dayPnl,-1.5);assert.equal(limits.riskBudget,.19);assert(limits.riskBudget<=normal.riskBudget/2);assert.equal(manager.tier,'CAUTIOUS');assert.equal(limits.dailyLossLimit,2.99);assert.equal(livePositionRisk(marked).portfolioRiskBudget,.98);
 const out=planLive(marked,bundle,{...c.wallet,THB:{available:98.47,reserved:0}},now,{entries:true});assert.equal(out.intents.length,0);assert(out.decisions.some(d=>d.reason==='BELOW_MARKET_MINIMUM'));
});
test('three confirmed consecutive losses pause all new buys for exactly an hour, including across midnight',()=>{
 const c=context();losses(c.state);const guard=capitalGuard(c.state,now),out=planLive(c.state,bundle,c.wallet,now,{entries:true});
 assert.equal(guard.consecutiveLosses,3);assert.equal(guard.cooldownUntil,now-1000+3600000);assert.equal(out.intents.length,0);assert(out.decisions.every(d=>d.reason==='LOSS_STREAK_COOLDOWN'));
 assert.equal(capitalGuard(c.state,guard.cooldownUntil-1).cooldownActive,true);assert.equal(capitalGuard(c.state,guard.cooldownUntil).cooldownActive,false);
 c.state.day='2000-01-01';const rolled=markLive(c.state,[],now).state;assert.equal(capitalGuard(rolled,now).cooldownActive,true);
});
test('profits and breakeven interrupt the loss streak; stale and future records cannot fabricate a pause',()=>{
 for(const pnl of [0,.1]){const c=context();losses(c.state);c.state.closed.push({id:'win',pnl,closedAt:now});assert.equal(capitalGuard(c.state,now).consecutiveLosses,0);}
 const c=context();losses(c.state,now-86400000-1);c.state.closed.push({id:'future',pnl:-1,closedAt:now+1});assert.equal(capitalGuard(c.state,now).consecutiveLosses,0);
});
test('expiry of the numerical cooldown cannot automatically clear the owner pause',()=>{
 const c=context();losses(c.state,now-3600000);c.state.buyPaused=true;const out=planLive(c.state,bundle,c.wallet,now,{entries:true});assert.equal(out.intents.length,0);assert.equal(out.state.buyPaused,true);assert.equal(liveRiskManager(out.state,now).reason,'OWNER_PAUSED');
});
test('loss pause cancels pending buys while existing stop exits remain independent',()=>{
 const c=context();losses(c.state);c.state.cash=79.97;c.state.positions=[{symbol:'BTC_THB',qty:.2,cost:20,stop:101,target:110,positionId:'HELD',strategy:'TREND_FOLLOWING'}];c.wallet.BTC={available:.2,reserved:0};
 c.state.orders=[{id:'PENDING',symbol:'ETH_THB',side:'BUY',status:'OPEN',amount:10.74,executed:0,riskFraction:.027,modeledLoss:.39,exchangeId:'TEST',createdAt:now-1000}];
 const out=planLive(c.state,bundle,c.wallet,now,{entries:false});assert(out.intents.some(i=>i.action==='CANCEL'&&i.id==='PENDING'));assert(out.intents.some(i=>i.order?.side==='SELL'&&i.order.reason==='STOP_LOSS'));assert.deepEqual(out.state.positions,c.state.positions);
});
test('existing oversized holdings are preserved and cannot receive an averaging-down order',()=>{
 const c=context();c.state.cash=67.38;c.state.positions=[{symbol:'BTC_THB',qty:.3259,cost:32.59,stop:98,target:110,positionId:'OLD'}];c.wallet.BTC={available:.3259,reserved:0};
 const out=planLive(c.state,bundle,c.wallet,now,{entries:true});assert.deepEqual(out.state.positions,c.state.positions);assert(!out.intents.some(i=>i.order?.side==='BUY'&&i.order.symbol==='BTC_THB'));
});
test('new minimum-sized positions must still clear the market sell minimum at the modeled stop',()=>{
 const o={amount:10,limit:100,stop:98,qtyScale:8};assert.equal(stopExitEstimate(o,10).reason,'STOP_EXIT_BELOW_MINIMUM');
 const minimum=minimumExitSafeEntry(o,10);assert(minimum>10);assert.equal(stopExitEstimate({...o,amount:minimum},10).allowed,true);
 const c=context(94);const out=planLive(c.state,bundle,c.wallet,now,{entries:true});assert.equal(out.intents.length,0);assert(out.decisions.some(d=>d.reason==='STOP_EXIT_BELOW_MINIMUM'));
});
test('normal advisor and executor agree; cooldown and risk-minimum failures never suggest depositing to chase losses',()=>{
 const c=context(),advice=capitalAdvice(c),out=planLive(c.state,bundle,c.wallet,now,{entries:true});assert.equal(advice.recommendedEntryTHB,out.intents[0].order.amount);assert.equal(advice.financials.cashReserveTHB,30);
 losses(c.state);const waiting=capitalAdvice(c);assert.equal(waiting.status,'WAIT_COOLDOWN');assert.equal(waiting.topUpTHB,0);assert(waiting.entries.every(e=>e.amountTHB===0));
 const small=context(94),low=capitalAdvice(small);assert.equal(low.status,'WAIT_BUDGET');assert.equal(low.topUpTHB,0);
});
test('risk-lane advice uses the saved price rules and respects the permanent owner pause',()=>{
 const c=context(),advice=capitalAdvice(c);c.state.buyPaused=true;const r=refreshCapitalAdvice(advice,{...c,bundle:null});assert.equal(r.status,'WAIT_RISK_LOCK');assert.equal(r.topUpTHB,0);assert.equal(r.recommendedEntryTHB,0);
});
test('hard daily loss lock remains latched after a rebound and under the new risk profile',()=>{
 const c=context();c.state.cash=96.98;let s=markLive(c.state,[],now).state;assert(s.dailyLocked);s.cash=99.97;s=markLive(s,[],now+1).state;assert(s.dailyLocked);assert.equal(liveLimits(s).dailyLossLimit,2.99);
});
test('unknown profiles and malformed capital inputs fail closed; extra wallet cash cannot increase approved capital',()=>{
 const c=context();assert.throws(()=>validateLive({...c.state,riskProfile:'ALLOW_ALL'}));for(const x of [NaN,Infinity,undefined])assert.throws(()=>validateLive({...c.state,dayPnl:x}));
 assert.throws(()=>validateLive({...c.state,equity:98,dayPnl:0}),/INVALID_LIVE_GUARD_STATE/);
 c.state.equity=200;c.state.dayStart=200;assert.equal(liveLimits(c.state).riskBudget,.39);assert(liveLimits(c.state).maxExposure<=69.98);
});
