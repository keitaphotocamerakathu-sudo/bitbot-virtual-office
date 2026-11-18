import test from 'node:test';
import assert from 'node:assert/strict';
import {correlateMarkets,correlationReview} from '../supabase/functions/bitbot-v10/rea-correlation.mjs';
import {lossReview} from '../supabase/functions/bitbot-v10/rea-loss-diagnostics.mjs';
import {initialLive,planLive} from '../supabase/functions/bitbot-v10/rea-live-core.mjs';
import {buildREAOffice} from '../assets/rea-view-model.mjs';
const now=1794996000000,step=300000;
function series(symbol,returns,price=100){const end=Math.floor(now/step)*step,n=returns.length+1;let c=price;const candles=Array.from({length:n},(_,i)=>{if(i)c*=Math.exp(returns[i-1]);return{t:end-(n-i)*step,o:c,h:c*1.001,l:c*.999,c,v:100};});return{symbol,candles,dataQuality:{ready:true},bid:c*.9999,ask:c,last:c,observedAt:now,status:'active',marketSource:'exchange',rules:{minQuote:10,qtyScale:8,priceStep:.01},depth:{at:now,bids:[[c*.9999,10000]],asks:[[c,10000]]},volumeTHB:1e7};}
const pattern=(p,n=80)=>Array.from({length:n},(_,i)=>p[i%p.length]);
test('correlation uses aligned log returns: unit changes preserve +1, inverse returns give -1 and orthogonal returns give zero',()=>{
 const r=pattern([.001,-.001,.001,-.001]),a=series('BTC_THB',r),b=series('ETH_THB',r.map(x=>2*x),50000),c=series('SOL_THB',r.map(x=>-x)),d=series('XRP_THB',pattern([.001,.001,-.001,-.001]));
 assert.equal(correlateMarkets(a,b,now).r,1);assert.equal(correlateMarkets(a,c,now).r,-1);assert.equal(correlateMarkets(a,d,now).r,0);assert.equal(correlateMarkets(a,b,now).n,80);
});
test('gaps never turn a ten-minute price change into a five-minute observation',()=>{
 const r=pattern([.001,-.002,.003,-.001]),a=series('BTC_THB',r),b=series('ETH_THB',r);a.candles.splice(10,1);b.candles.splice(20,1);const p=correlateMarkets(a,b,now);assert.equal(p.n,76);assert.equal(p.r,1);
});
test('future candles are excluded and the comparison is bounded to 288 returns',()=>{
 const a=series('BTC_THB',pattern([.001,-.002,.003],400)),b=structuredClone(a);b.symbol='ETH_THB';b.candles.push({...b.candles.at(-1),t:now,c:99999999});const r=correlateMarkets(a,b,now);assert.equal(r.n,288);assert.equal(r.r,1);assert(r.to<=now);
});
test('short, stale, duplicated, invalid or constant series report unavailable rather than fake zero correlation',()=>{
 const a=series('BTC_THB',pattern([.001,-.002])),changes=[b=>b.candles=b.candles.slice(-50),b=>b.candles.at(-1).c=-1,b=>b.candles.at(-1).t=b.candles.at(-2).t,b=>b.candles.forEach(x=>x.c=100),b=>b.candles.forEach(x=>x.t-=3600000),b=>b.dataQuality.ready=false];
 for(const change of changes){const b=series('ETH_THB',pattern([.001,-.002]));change(b);const r=correlateMarkets(a,b,now);assert.equal(r.ready,false);assert.equal(r.r,null);}
});
test('a high correlation warning is read-only and labels held pairs separately from candidates',()=>{
 const a=series('BTC_THB',pattern([.001,-.002])),b=series('ETH_THB',pattern([.002,-.004])),state=initialLive(10000,now);state.positions=[{symbol:'BTC_THB'},{symbol:'ETH_THB'}];const before=structuredClone(state),out=correlationReview({bundle:{markets:[a,b]},state,now});
 assert.equal(out.status,'DEGRADED');assert.equal(out.evidence.pairs[0].kind,'HELD_OR_PENDING');assert.equal(out.evidence.pairs[0].r,1);assert.equal(out.evidence.canTrade,false);assert.deepEqual(state,before);
 state.positions=[{symbol:'BTC_THB'}];const candidate=correlationReview({bundle:{markets:[a,b]},state,signals:[{symbol:'ETH_THB',eligible:true,score:90}],now});assert.equal(candidate.evidence.pairs[0].kind,'CANDIDATE_COMPARISON');
});
test('loss diagnostics preserve negative P&L and do not deduct already included fees twice',()=>{
 const s=initialLive(10000,now);s.cash=9975;s.equity=9975;s.realized=-25;s.fees=25;s.dayPnl=-25;s.closed=[-10,-5,-10].map((pnl,i)=>({id:'C'+i,pnl,closedAt:now-3000+i*1000}));const before=structuredClone(s),r=lossReview({state:s,bundle:{markets:[]},now});
 assert.equal(r.evidence.netTradingPnL,-25);assert.equal(r.evidence.realized,-25);assert.equal(r.evidence.feesPaid,25);assert.equal(r.evidence.feesAlreadyIncluded,true);assert.equal(r.evidence.consecutiveLosses,3);assert(r.evidence.actions.includes('COMPARE_MIXED_WITH_CAUTION_SCORE_80_IN_PAPER'));assert.equal(r.evidence.canGuaranteeRecovery,false);assert.deepEqual(s,before);
});
test('unverified marks remain unknown and a malformed diagnostic cannot stop the independent order planner',()=>{
 const s=initialLive(10000,now);s.positions=[{symbol:'BTC_THB',qty:1,cost:100,stop:98,target:104,positionId:'HELD_TEST'}];s.cash=9900;
 const missing=lossReview({state:s,bundle:{markets:[]},now});assert.equal(missing.evidence.unrealized,null);assert.equal(missing.evidence.netTradingPnL,null);assert.equal(missing.status,'WAITING');assert.equal(lossReview({state:{positions:null},bundle:null,now}).status,'WAITING');
 const m=series('BTC_THB',pattern([.001,-.001]));m.bid=97;m.ask=97.1;m.last=97;const diag=lossReview({state:s,bundle:{markets:[m]},now});assert.deepEqual(diag.evidence.stopSymbols,['BTC_THB']);
 const out=planLive(s,{markets:[m]},{at:now,THB:{available:9900,reserved:0},BTC:{available:1,reserved:0}},now,{entries:false,id:()=> 'STOP_TEST'});assert.equal(out.intents[0].order.reason,'STOP_LOSS');assert.equal(out.intents[0].order.amount,1);
});
test('the experiment worker always uses its Paper source, and stale research is never replayed as fresh work',()=>{
 const s=initialLive(100,now,'OWNER_LIMITED_LIVE'),live={state:s,preflight:{ok:true},latest:{at:now,riskAt:now,strategyAt:now,health:'OK'}},paper={latest:{agents:[{role:'Strategy Experimenter',at:now-200000,status:'COMPLETED',summary:'Paper trial facts'}]}};
 const vm=buildREAOffice({live,paper,now}),r=vm.roles.find(r=>r.role==='Strategy Experimenter');assert.equal(vm.roles.length,17);assert.equal(r.status,'STALE');assert(r.summary.includes('Paper'));assert(!vm.archive?.tasks.some(t=>t.worker==='quant-3'));
});
