import test from 'node:test';
import assert from 'node:assert/strict';
import {capitalAdvice,refreshCapitalAdvice} from '../supabase/functions/bitbot-v10/rea-capital-advisor.mjs';
import {initialLive,planLive} from '../supabase/functions/bitbot-v10/rea-live-core.mjs';
import {createLiveService} from '../supabase/functions/bitbot-v10/rea-live-service.mjs';
const now=1794989700000;
function market(symbol='BTC_THB'){
 const t=Math.floor(now/300000)*300000,candles=Array.from({length:200},(_,i)=>{const c=100+i*.003+Math.sin(i*.8)*.05;return{t:t-(200-i)*300000,o:c,h:c+.08,l:c-.08,c,v:100};}),p=candles.at(-1).c;
 return{symbol,status:'active',marketSource:'exchange',last:p,ask:p,bid:p-.01,observedAt:now,candles,dataQuality:{ready:true},rules:{qtyScale:8,priceStep:.01,minQuote:10},volumeTHB:1e7,news:{ready:false},depth:{at:now,asks:[[p,10000]],bids:[[p-.01,10000]]}};
}
function context(capital=99.97,policy='OWNER_LIMITED_LIVE'){
 return{state:initialLive(capital,now,policy),bundle:{markets:[market()]},wallet:{at:now,THB:{available:capital,reserved:0}},now,mode:'LIVE_ENABLED',health:'OK',entriesPermitted:true};
}
function cashShort(walletCash=5){
 const c=context(1000,'STANDARD'),held=market('ETH_THB');held.candles=[];held.dataQuality.ready=false;held.bid=101;held.ask=101.01;held.last=101;
 Object.assign(c.state,{cash:5,equity:1007.44,dayPnl:7.44,positions:[{symbol:'ETH_THB',qty:9.95,cost:995,stop:100,target:110,positionId:'TEST_HELD',openedAt:now-1000}]});c.bundle.markets.push(held);c.wallet={at:now,THB:{available:walletCash,reserved:0},ETH:{available:9.95,reserved:0}};return c;
}
test('capital advice matches the real numerical entry amount and cannot mutate any input',()=>{
 for(const [capital,policy] of [[99.97,'OWNER_LIMITED_LIVE'],[60,'OWNER_LIMITED_LIVE'],[10000,'STANDARD']]){
  const c=context(capital,policy),before=structuredClone(c),a=capitalAdvice(c),o=planLive(c.state,c.bundle,c.wallet,now,{entries:true,id:()=> 'TEST_PREVIEW_ONLY'}).intents.find(i=>i.order?.side==='BUY')?.order;
  assert(o);assert.equal(a.status,'USE_AVAILABLE_CASH');assert.equal(a.recommendedEntryTHB,o.amount);assert(a.entries[0].modeledLoss<=a.entries[0].riskBudget);assert.equal(a.topUpTHB,0);assert.equal(a.canTrade,false);assert.equal(a.canChangeLimits,false);assert.deepEqual(c,before);
 }
});
test('a reduced reference shrinks the next entry; extra wallet money cannot expand approved limited capital',()=>{
 const a=capitalAdvice(context()),c=context(60),small=capitalAdvice(c);assert(small.recommendedEntryTHB<a.recommendedEntryTHB);c.wallet.THB.available=100000;assert.equal(capitalAdvice(c).recommendedEntryTHB,small.recommendedEntryTHB);assert.equal(capitalAdvice(c).financials.maxPosition,24);
});
test('two occupied slots including pending buys never request more money or a third entry',()=>{
 const c=context();c.state.orders=[{id:'A',symbol:'ETH_THB',side:'BUY',status:'RESERVED',amount:15,executed:0,riskFraction:.027},{id:'B',symbol:'SOL_THB',side:'BUY',status:'CANCEL_PENDING',amount:15,executed:0,riskFraction:.027}];
 const a=capitalAdvice(c);assert.equal(a.status,'WAIT_SLOTS');assert.equal(a.topUpTHB,0);assert(a.entries.every(e=>e.amountTHB===0));assert.equal(a.financials.slots,2);
});
test('a held coin cannot receive an averaging-down recommendation',()=>{
 const c=cashShort(1000);c.bundle.markets=[c.bundle.markets[1]];const a=capitalAdvice(c);assert.equal(a.topUpTHB,0);assert(a.entries.every(e=>e.amountTHB===0));assert.equal(a.positions[0].addAllowed,false);
});
test('missing signals cannot become a request to deposit',()=>{
 const c=context();c.bundle.markets[0].dataQuality.ready=false;const a=capitalAdvice(c);assert.equal(a.status,'WAIT_SIGNAL');assert.equal(a.topUpTHB,0);assert.equal(a.budgetIncreaseTHB,0);
});
test('daily lock, pause, emergency, health, mode and permission checks suppress all funding suggestions',()=>{
 for(const alter of [c=>c.state.dailyLocked=true,c=>c.state.buyPaused=true,c=>c.state.kill='ALL',c=>c.state.kill='ENTRY',c=>c.state.baselinePending=true,c=>c.health='SAFE_MODE',c=>c.entriesPermitted=false,c=>c.mode='LIVE_LOCKED']){
  const c=cashShort();alter(c);const a=capitalAdvice(c);assert(a.status.startsWith('WAIT_'));assert.equal(a.topUpTHB,0);assert.equal(a.budgetIncreaseTHB,0);assert(a.entries.every(e=>e.amountTHB===0));
 }
});
test('unknown exchange orders require reconciliation rather than a top-up',()=>{
 const c=cashShort();c.state.orders=[{id:'UNKNOWN_TEST',symbol:'ETH_THB',status:'UNKNOWN',side:'BUY',amount:1,executed:0,riskFraction:.027}];const a=capitalAdvice(c);assert.equal(a.status,'WAIT_RECONCILIATION');assert.equal(a.topUpTHB,0);
});
test('stale, malformed and mismatched wallets never produce deposit or sizing advice',()=>{
 for(const alter of [c=>c.wallet.at=now-20001,c=>c.wallet.at=now+5001,c=>c.wallet.THB.available=0,c=>c.wallet.THB.reserved=-1,c=>c.wallet.THB.available='5']){
  const c=cashShort();alter(c);const a=capitalAdvice(c);assert.equal(a.status,'WAIT_WALLET');assert.equal(a.topUpTHB,0);assert.equal(a.recommendedEntryTHB,0);
 }
});
test('eligible underfunded entry reports only the minimum external gap, with fees and mandatory new allocation review',()=>{
 const c=cashShort(),a=capitalAdvice(c);assert.equal(a.status,'CONSIDER_TOP_UP');assert.equal(a.topUpTHB,5.13);assert.equal(a.budgetIncreaseTHB,5.13);assert.equal(a.suggestedAllocationTHB,1005.13);assert.equal(a.recommendedEntryTHB,0);assert.equal(a.entries[0].minimumCashTHB,10.13);assert.equal(a.manualBudgetApprovalRequired,true);assert.equal(c.state.cash,5);assert.equal(c.state.allocatedCapital,1000);
});
test('unused money already in Wallet is separated from increasing the bot allocation',()=>{
 const a=capitalAdvice(cashShort(100));assert.equal(a.status,'REVIEW_ALLOCATION');assert.equal(a.topUpTHB,0);assert.equal(a.budgetIncreaseTHB,5.13);
 const b=capitalAdvice(cashShort(9));assert.equal(b.topUpTHB,1.13);assert.equal(b.budgetIncreaseTHB,5.13);
});
test('reserved wallet cash and a losing day do not trigger funding to chase an entry',()=>{
 const c=cashShort();c.wallet.THB.reserved=15;assert.equal(capitalAdvice(c).status,'WAIT_RESERVED');c.wallet.THB.reserved=0;c.state.dayPnl=-.01;const a=capitalAdvice(c);assert.equal(a.status,'WAIT_AFTER_LOSS');assert.equal(a.topUpTHB,0);
});
test('a market minimum beyond current risk never asks to override risk or raise capital automatically',()=>{
 const c=context();c.bundle.markets[0].rules.minQuote=200;const a=capitalAdvice(c);assert.equal(a.status,'WAIT_BUDGET');assert.equal(a.topUpTHB,0);assert.equal(a.suggestedAllocationTHB,null);
});
test('an account at its approved policy ceiling cannot be advised to raise the policy cap',()=>{
 const c=cashShort();Object.assign(c.state,{allocatedCapital:10000,cash:5,dayStart:6049.85,equity:6049.85,dayPnl:0});c.state.positions[0]={...c.state.positions[0],cost:6000,qty:60};c.wallet.ETH.available=60;
 const a=capitalAdvice(c);assert.equal(a.status,'WAIT_POLICY_CAP');assert.equal(a.topUpTHB,0);assert.equal(a.budgetIncreaseTHB,0);
});
test('risk-lane refresh expires old signals without reading candles, news, AI or changing a prior receipt',()=>{
 const c=context(),a=capitalAdvice(c),before=structuredClone(a),later={...c,now:now+31000,wallet:{...c.wallet,at:now+31000},bundle:{markets:[]}};
 const b=refreshCapitalAdvice(a,later);assert.equal(b.status,'WAIT_QUOTES');assert.equal(b.recommendedEntryTHB,0);assert.equal(b.topUpTHB,0);assert.equal(b.analyzedAt,now);assert.deepEqual(a,before);
 c.state.dailyLocked=true;assert.equal(refreshCapitalAdvice(a,c).status,'WAIT_RISK_LOCK');
});
test('sizing remains a cash-bounded alternative even when the theoretical risk budget could buy more',()=>{
 const c=cashShort(20);c.state.cash=20;c.state.equity+=15;c.state.dayPnl+=15;const a=capitalAdvice(c);assert.equal(a.status,'USE_AVAILABLE_CASH');assert(a.recommendedEntryTHB<20);assert.equal(a.topUpTHB,0);assert.equal(a.budgetIncreaseTHB,0);
});
function serviceFixture({locked=false,privateFailure=false}={}){
 const c=context();c.state.dailyLocked=locked;c.bundle.markets[0].dataQuality.ready=false;const saved=[];
 const row={user_id:'11111111-1111-4111-8111-111111111111',mode:'LIVE_ENABLED',state:c.state,latest:{capitalAdvice:{...capitalAdvice(context()),at:now-1000}},preflight:{},lease:'TEST_LEASE',revision:0};
 const service=createLiveService({clock:()=>now,keys:async()=>({apiKey:'TEST_ONLY',apiSecret:'TEST_ONLY'}),brain:async()=>null,scan:async()=>c.bundle,quotes:async()=>[],wallet:async()=>c.wallet,signed:async(_p,method)=>{assert.equal(method,'GET');if(privateFailure)throw Error('BITKUB_HTTP_429');return{result:[]};},rpc:async(name,p)=>{if(name==='rea_live_scan_targets')return[row];if(name==='rea_live_claim')return[row];if(name==='rea_live_ready')return{ready:true,limited:{ready:true}};if(name==='rea_live_checkpoint'){saved.push(p);return{...row,state:p.p_state,latest:p.p_latest,revision:saved.length};}if(['rea_live_release','rea_live_idle'].includes(name))return true;throw Error('Unexpected capability '+name);}});
 return{service,saved};
}
test('strategy checkpoint archives the capital decision with the portfolio reviewer without new exchange writes',async()=>{
 const {service,saved}=serviceFixture();await service.run(false);assert.equal(saved.length,1);const l=saved[0].p_latest;assert.equal(l.capitalAdvice.status,'WAIT_SIGNAL');assert.deepEqual(l.team.capitalAdvice,l.capitalAdvice);assert(l.team.reviews.find(r=>r.role==='Portfolio Auditor').summary.includes(l.capitalAdvice.headline));assert.equal(l.capitalAdvice.canChangeLimits,false);
});
test('the independent risk lane invalidates an old funding suggestion when the daily lock activates',async()=>{
 const {service,saved}=serviceFixture({locked:true});await service.run(true);assert.equal(saved[0].p_latest.capitalAdvice.status,'WAIT_RISK_LOCK');assert.equal(saved[0].p_latest.capitalAdvice.topUpTHB,0);assert.equal(saved[0].p_latest.capitalAdvice.recommendedEntryTHB,0);
});
test('a private API failure cannot leave a previously actionable funding suggestion active',async()=>{
 const {service,saved}=serviceFixture({privateFailure:true});await service.run(true);assert.equal(saved[0].p_latest.health,'SAFE_MODE');assert.equal(saved[0].p_latest.capitalAdvice.status,'WAIT_HEALTH');assert.equal(saved[0].p_latest.capitalAdvice.topUpTHB,0);
});
