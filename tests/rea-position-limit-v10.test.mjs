import test from 'node:test';
import assert from 'node:assert/strict';
import {initialLive,planLive,liveLimits,liveSummary,livePositionRisk,validateLive,applyExchangeInfo} from '../supabase/functions/bitbot-v10/rea-live-core.mjs';
import {capitalAdvice} from '../supabase/functions/bitbot-v10/rea-capital-advisor.mjs';
import {reviewTeam} from '../supabase/functions/bitbot-v10/rea-review-team.mjs';
import {correlationReview} from '../supabase/functions/bitbot-v10/rea-correlation.mjs';
const now=1795017600000,symbols=['BTC_THB','ETH_THB','SOL_THB','XRP_THB','ADA_THB','XLM_THB'];
function market(symbol){
 const bar=Math.floor(now/300000)*300000,candles=Array.from({length:200},(_,i)=>{const c=100+i*.003+Math.sin(i*.8)*.05;return{t:bar-(200-i)*300000,o:c,h:c+.08,l:c-.08,c,v:100};}),p=candles.at(-1).c;
 return{symbol,status:'active',marketSource:'exchange',last:p,bid:p-.01,ask:p,observedAt:now,candles,volumeTHB:1e7,dataQuality:{ready:true},news:{ready:false},rules:{qtyScale:8,priceStep:.01,priceScale:2,minQuote:10},depth:{at:now,asks:[[p,10000]],bids:[[p-.01,10000]]}};
}
const bundle={markets:symbols.map(market)};
function context(capital=99.97,policy='OWNER_LIMITED_LIVE'){
 const state=initialLive(capital,now,policy);state.maxPositions=5;
 return{state,bundle,wallet:{at:now,THB:{available:capital,reserved:0}},now,mode:'LIVE_ENABLED',health:'OK',entriesPermitted:true};
}
test('five live entries share the original two-trade risk budget at both real allocation scales',()=>{
 for(const [capital,policy] of [[99.97,'OWNER_LIMITED_LIVE'],[10000,'STANDARD']]){
  const c=context(capital,policy),before=structuredClone(c),out=planLive(c.state,bundle,c.wallet,now,{entries:true});
  const buys=out.intents.filter(i=>i.order?.side==='BUY').map(i=>i.order),summary=liveSummary(out.state);
  assert.equal(buys.length,5);assert(out.decisions.some(d=>d.symbol===symbols[5]&&d.reason==='MAX_POSITIONS'));assert.equal(summary.slots,5);assert.equal(summary.maxPositions,5);
  assert(summary.portfolioRiskUsed<=summary.portfolioRiskBudget);assert(summary.portfolioRiskBudget<=capital*.02);assert(summary.riskBudget<=capital*.01*2/5);
  assert(summary.reserved<=summary.maxExposure);assert.equal(summary.dailyLossLimit,liveLimits(initialLive(capital,now,policy)).dailyLossLimit);
  assert(buys.every(o=>o.amount>=10&&o.modeledLoss<=summary.riskBudget));assert.equal(out.state.fills.length,0);assert.deepEqual(c,before);
 }
});
test('five actual receipt-based holdings survive restart; a sixth holding or reservation is rejected',()=>{
 const c=context(10000,'STANDARD');let s=planLive(c.state,bundle,c.wallet,now,{entries:true}).state;
 for(const o of s.orders.slice())s=applyExchangeInfo(s,o.id,{client_id:o.clientId,status:'filled',filled:o.amount,remaining:0,history:[{txn_id:'TEST-'+o.id,amount:o.amount,rate:o.limit,fee:0,credit:0,timestamp:now}]},now).state;
 assert.equal(s.positions.length,5);assert.equal(validateLive(JSON.parse(JSON.stringify(s))).positions.length,5);
 assert.throws(()=>validateLive({...s,positions:[...s.positions,{...s.positions[0],symbol:symbols[5]}]}),/LIVE_POSITION_LIMIT/);
 assert.throws(()=>validateLive({...s,orders:[...s.orders,{...s.orders[0],id:'SIXTH',symbol:symbols[5],status:'CANCEL_PENDING'}]}),/LIVE_POSITION_LIMIT/);
});
test('all unresolved buy states consume slots and risk, while overlap with partial holdings consumes one slot',()=>{
 const c=context(10000,'STANDARD'),statuses=['RESERVED','OPEN','PARTIAL','CANCEL_PENDING','UNKNOWN'];
 c.state.orders=statuses.map((status,i)=>({id:String(i),symbol:symbols[i],side:'BUY',status,amount:100,executed:i===2?50:0,riskFraction:.027,modeledLoss:2.8}));
 c.state.positions=[{symbol:symbols[2],qty:.5,cost:50,stop:98,target:104,positionId:'2'}];
 const summary=liveSummary(c.state);assert.equal(summary.slots,5);assert(summary.portfolioRiskUsed>13.5);
 for(const status of statuses){const s=context().state;s.orders=[{...c.state.orders[0],status}];assert.equal(liveSummary(s).slots,1);assert.equal(livePositionRisk(s).portfolioRiskUsed,2.8);}
});
test('two legacy full-risk holdings keep their stops and exhaust the shared risk envelope despite three vacant slots',()=>{
 const c=context(),positions=symbols.slice(0,2).map((symbol,i)=>({symbol,qty:.32,cost:32.59,stop:98,target:110,positionId:'OLD-'+i}));
 c.state.positions=positions;c.state.cash=34.79;c.state.orders=positions.map(p=>({id:p.positionId,symbol:p.symbol,side:'BUY',status:'FILLED',amount:p.cost,executed:p.cost,riskFraction:.027,modeledLoss:.99}));
 c.wallet.THB.available=c.state.cash;for(const symbol of symbols.slice(0,2))c.wallet[symbol.split('_')[0]]={available:.32,reserved:0};
 const out=planLive(c.state,bundle,c.wallet,now,{entries:true});
 assert.equal(out.intents.length,0);assert(out.decisions.some(d=>d.reason==='PORTFOLIO_RISK_EXHAUSTED'));assert.deepEqual(out.state.positions,positions);
 const advice=capitalAdvice({...c,state:out.state});assert.equal(advice.status,'WAIT_BUDGET');assert.equal(advice.topUpTHB,0);assert.equal(advice.financials.maxPositions,5);
});
test('a stop can still exit with five slots or an exhausted risk envelope',()=>{
 const c=context();c.state.cash=67.38;c.state.positions=[{symbol:'BTC_THB',qty:.32,cost:32.59,stop:101,target:110,positionId:'EXISTING'}];c.wallet.THB.available=67.38;c.wallet.BTC={available:.32,reserved:0};
 const out=planLive(c.state,bundle,c.wallet,now,{entries:false});assert.equal(out.intents.length,1);assert.equal(out.intents[0].order.side,'SELL');assert.equal(out.intents[0].order.reason,'STOP_LOSS');
});
test('advisor uses the same reduced five-slot sizing; extra wallet money cannot increase an approved allocation',()=>{
 const c=context(),a=capitalAdvice(c),o=planLive(c.state,bundle,c.wallet,now,{entries:true}).intents[0].order;
 assert.equal(a.recommendedEntryTHB,o.amount);assert.equal(a.financials.riskBudget,.39);c.wallet.THB.available=100000;assert.equal(capitalAdvice(c).recommendedEntryTHB,o.amount);
});
test('default two-slot live behavior remains unchanged and invalid limits fail closed',()=>{
 const c=context(10000,'STANDARD');delete c.state.maxPositions;assert.equal(liveSummary(c.state).maxPositions,2);assert.equal(planLive(c.state,bundle,c.wallet,now,{entries:true}).intents.length,2);
 for(const maxPositions of [0,6,2.5,'5',NaN,Infinity])assert.throws(()=>validateLive({...c.state,maxPositions}),/INVALID_LIVE_POSITION_LIMIT/);
});
test('reviewers inspect all ten pairs in a five-slot portfolio and report the actual approved cap',()=>{
 const c=context();c.state.orders=symbols.slice(0,5).map((symbol,i)=>({id:String(i),symbol,side:'BUY',status:'RESERVED',amount:10,executed:0,riskFraction:.027}));
 const team=reviewTeam({...c}).receipt,review=team.reviews.find(r=>r.role==='Portfolio Auditor');assert.equal(review.status,'COMPLETED');assert(review.summary.includes('5/5'));assert.equal(review.evidence.maxPositions,5);
 const correlation=correlationReview(c);assert.equal(correlation.evidence.pairs.length,10);assert(correlation.evidence.pairs.every(p=>p.ready));assert.equal(correlation.evidence.canTrade,false);
});
