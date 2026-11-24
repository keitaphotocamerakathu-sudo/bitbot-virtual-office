import test from 'node:test';
import assert from 'node:assert/strict';
import {settleSellTHB,feeAfterCreditTHB,walletReconciliation,THB_SETTLEMENT} from '../supabase/functions/bitbot-v10/rea-thb-settlement.mjs';
import {walletView} from '../assets/rea-view-model.mjs';
import {initialLive,applyExchangeInfo,walletMatches,planLive} from '../supabase/functions/bitbot-v10/rea-live-core.mjs';
const now=1795500000000;
test('THB settlement truncates each sell receipt instead of rounding to nearest satang',()=>{
 assert.equal(settleSellTHB('1','10.079996'),10.07);assert.equal(settleSellTHB('1','10.179999'),10.17);
 assert.equal(settleSellTHB('0.29','1'),.29);assert.equal(settleSellTHB('3.456789','2.34567'),8.1);
 assert.equal(settleSellTHB('100','1','.07','.01'),99.94);assert.equal(settleSellTHB('1','1','.07','.01'),.94);
 assert.equal(settleSellTHB('1','1','.07','.07'),1);assert.equal(settleSellTHB('1e-8','1e8'),1);
 assert.equal(feeAfterCreditTHB('.07','.01'),.06);assert.equal(settleSellTHB(1,1,feeAfterCreditTHB('.07','.01')),.94);
});
test('malformed, negative, excessive credit and overflowing settlements fail closed',()=>{
 for(const args of [['',1],[-1,1],[1,Infinity],[1,1,2],[1,1,.01,.02],['1e100',1],['999999999999999999999',1],[0,1]])assert.throws(()=>settleSellTHB(...args));
});
function held(){const s=initialLive(100,now,'OWNER_LIMITED_LIVE');s.cash=80;s.equity=100;s.positions=[{symbol:'BTC_THB',qty:2,cost:20,stop:9,target:11,positionId:'entry',openedAt:now-20000,realized:0}];s.orders=[{id:'sell',clientId:'client',exchangeId:'ex',symbol:'BTC_THB',side:'SELL',status:'OPEN',amount:2,executed:0,remaining:2,qtyScale:8,createdAt:now-10000,positionId:'entry',appliedTxnIds:[]}];return s;}
const info=history=>({client_id:'client',status:history.length===2?'filled':'unfilled',filled:history.length,remaining:2-history.length,history});
const fill=(id,at)=>({txn_id:id,amount:'1',rate:'10.079996',fee:'0.03',credit:'0.03',timestamp:at});
test('partial sell settlement posts truncated proceeds and survives retries and restart without a duplicate correction',()=>{
 const one=fill('one',now-1000),two=fill('two',now),s=held(),first=applyExchangeInfo(s,'sell',info([one]),now);
 assert.equal(first.state.cash,90.07);assert.equal(first.state.realized,.07);assert.equal(first.fills[0].settlement.cashDeltaTHB,10.07);assert.equal(first.fills[0].settlement.protocol,THB_SETTLEMENT);
 const final=applyExchangeInfo(JSON.parse(JSON.stringify(first.state)),'sell',info([one,two]),now);
 assert.equal(final.state.cash,100.14);assert.equal(final.state.realized,.14);assert.equal(final.state.closed[0].pnl,.14);assert.equal(final.state.positions.length,0);
 const retry=applyExchangeInfo(final.state,'sell',info([one,two]),now+1);assert.deepEqual(retry.state.fills,final.state.fills);assert.equal(retry.state.cash,100.14);assert.equal(retry.fills.length,0);assert.equal(s.cash,80);
});
test('per-fill truncation is not replaced by truncating the order total',()=>{
 const s=held(),out=applyExchangeInfo(s,'sell',info([fill('one',now-1000),fill('two',now)]),now);
 assert.equal(out.state.cash,100.14);assert.notEqual(out.state.cash,80+settleSellTHB(2,'10.079996'));
});
test('wallet comparison uses exact satang and never conceals an unexplained deficit with a larger tolerance',()=>{
 const s=held();s.cash=74.87;const w={at:now,THB:{available:74.77,reserved:0},BTC:{available:2,reserved:0}};
 assert.equal(walletMatches(s,w,now),false);assert.equal(walletReconciliation(s,w,now).differenceTHB,-.1);
 s.cash=74.77;assert.equal(walletMatches(s,w,now),true);w.THB.available=74.76;assert.equal(walletMatches(s,w,now),false);
 s.cash=74.76;w.THB.available=74.66;w.THB.reserved=.1;assert.equal(walletMatches(s,w,now),true);
});
test('unallocated THB and external coins cannot inflate bot allocation or count as a bot receipt',()=>{
 const s=held(),before=structuredClone(s),w={at:now,THB:{available:100,reserved:0},BTC:{available:2,reserved:0},ZIL:{available:100,reserved:0}},r=walletReconciliation(s,w,now);
 assert.equal(r.status,'READY');assert.equal(r.unallocatedTHB,20);assert.equal(r.botCashTHB,80);assert.equal(r.walletAvailableTHB,100);assert.equal(r.canTrade,false);assert.deepEqual(s,before);
});
test('stale, future, missing, negative or incomplete asset balances do not pass reconciliation',()=>{
 const s=held(),w={at:now,THB:{available:80,reserved:0},BTC:{available:2,reserved:0}};
 for(const patch of [{at:now-20001},{at:now+5001},{THB:{available:-1,reserved:81}},{THB:null},{BTC:{available:1,reserved:0}}])assert.equal(walletMatches(s,{...w,...patch},now),false);
});
test('an unexplained cash discrepancy cannot open a buy or create a sell intent',()=>{
 const s=held(),m={symbol:'BTC_THB',status:'active',bid:8,ask:8.01,last:8,observedAt:now,rules:{qtyScale:8,minQuote:10,priceStep:.01}};s.orders=[];
 const out=planLive(s,{markets:[m]},{at:now,THB:{available:79.99,reserved:0},BTC:{available:2,reserved:0}},now,{entries:true});assert.equal(out.reason,'WALLET_RECONCILIATION_REQUIRED');assert.equal(out.intents.length,0);assert.equal(out.state.cash,80);assert.deepEqual(out.state.positions,s.positions);
});
test('wallet display reads available from the exchange, separates bot cash and expires the actual wallet timestamp',()=>{
 const live={state:{cash:80},preflight:{at:now,wallet:{at:now,THB:{available:73.41,reserved:6.59}}},latest:{at:now}};
 const v=walletView(live,null,now);assert.equal(v.available,73.41);assert.equal(v.total,80);assert.equal(v.botCash,80);assert.equal(v.difference,0);
 live.preflight.wallet.at=now-30001;assert.equal(walletView(live,null,now).available,null);assert.equal(walletView(live,null,now).ready,false);assert.equal(walletView(null,null,now).botCash,null);
});
