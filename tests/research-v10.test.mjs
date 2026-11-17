import test from 'node:test';
import assert from 'node:assert/strict';
import {config,initial} from '../assets/engine.mjs';
import {profileFeatures,profileStrategy,PROFILES} from '../assets/strategies.mjs';
import {shadowInitial,shadowStep,SHADOW_CANDIDATES} from '../assets/shadow.mjs';
import {liveReadiness} from '../assets/evidence.mjs';
import {trainingEligible,selectTraining,lowerDailyMean,historicalGate} from '../research/compare-v13.mjs';
const NOW=1800000000000;
function market(){return{symbol:'ETH_THB',last:3000,bid:2999,ask:3000,observedAt:NOW,volumeTHB:10000000,status:'active',rules:{minQuote:10,priceStep:.01,priceScale:2,qtyScale:8},
 depth:{at:NOW,asks:[[3000,100]],bids:[[2999,100]]},news:{ready:true,fetchedAt:NOW,blocked:false},candles:Array.from({length:180},(_,i)=>({t:NOW-(180-i)*300000,c:2950+i*.5+(i%2)*2,h:(2950+i*.5)*1.025,l:(2950+i*.5)*.975,v:100}))};}
function pending(side='BUY'){
 const c=config(),r=shadowInitial(c,100000);r.pending={at:NOW,order:{symbol:'ETH_THB',side,price:side==='BUY'?3000:2999,amount:side==='BUY'?100:.03,qtyScale:8,strategy:'test',reason:'TEST',entryPolicy:{stopLoss:.02,takeProfit:.03,maxHoldMinutes:60}}};return{c,r};
}
test('paper order cannot fill on its submission snapshot',()=>{const {c,r}=pending();const out=shadowStep({markets:[market()]},r,c,NOW);assert.equal(out.events.length,0);assert.equal(out.record.state.qty,0);assert(out.record.pending);});
test('subsequent marketable limit quote fills once with satang fees and no mutation',()=>{const {c,r}=pending(),m=market();m.observedAt=NOW+60000;m.depth.at=NOW+60000;const out=shadowStep({markets:[m]},r,c,NOW+60000);assert.equal(out.events[0].kind,'FILL');assert.equal(out.record.state.fees,.25);assert.equal(out.record.state.cash,99900);assert.equal(out.record.pending,null);assert.equal(r.state.qty,0);assert(out.record.state.qty>0);});
test('unmarketable, stale or thin depth cannot fabricate a simulated fill',()=>{for(const change of [m=>{m.ask=3001;m.depth.asks=[[3001,100]];},m=>m.depth.at=NOW-26000,m=>m.depth.asks=[[3000,.00001]]]){const {c,r}=pending(),m=market();change(m);const out=shadowStep({markets:[m]},r,c,NOW+1000);assert.equal(out.record.state.qty,0);assert.equal(out.events.length,0);}});
test('paper orders expire after two minutes with no debit',()=>{const {c,r}=pending(),out=shadowStep({markets:[market()]},r,c,NOW+120000);assert.equal(out.events[0].kind,'CANCELED');assert.equal(out.record.pending,null);assert.equal(out.record.state.cash,100000);});
test('sell paper fills never sell a different symbol or more than owned',()=>{const {c,r}=pending('SELL');assert.throws(()=>shadowStep({markets:[{...market(),bid:3000}]},r,c,NOW+1000));});
test('profiles require real volume and contiguous closed-bar history',()=>{const m=market();assert(profileFeatures(m.candles));delete m.candles.at(-1).v;assert.equal(profileFeatures(m.candles),null);for(const profile of PROFILES.slice(1))assert.equal(profileStrategy(m,initial(),profile).signal,'HOLD');});
test('unknown strategy configuration is rejected and six shadow accounts are distinct',()=>{assert.throws(()=>config({strategyProfile:'guaranteed-profit'}));assert.equal(new Set(SHADOW_CANDIDATES.map(x=>x.key)).size,6);});
test('training refuses positive returns without enough samples or sufficient data',()=>{const m={status:'QUALIFIED',rounds:20,net:10,profitFactor:1.3,maxDrawdown:.02};assert(trainingEligible(m));assert(!trainingEligible({...m,rounds:2}));assert(!trainingEligible({...m,status:'INSUFFICIENT_DATA'}));assert.equal(selectTraining([{candidate:'x',metrics:{...m,net:-1}}]),null);});
test('holdout does not count as tested when training selected cash',()=>{const gate=historicalGate(null,null);assert.equal(gate.passed,false);assert(gate.reasons[0].includes('ยังไม่เริ่มช่วงทดสอบ'));assert(lowerDailyMean(Array(14).fill(1))>0);assert(lowerDailyMean(Array(14).fill(-1))<0);});
test('positive-looking forward results cannot grant historical approval or start real buys',()=>{const shadow={started_at:new Date(NOW-30*86400000).toISOString(),states:{'trend-confirmed:60':{roundPnls:Array(30).fill(1),state:{realized:30},lastAt:NOW}}};const result=liveReadiness('trend-confirmed',shadow,NOW);assert.equal(result.allowed,false);assert(result.reasons.some(x=>x.includes('ช่วงฝึก')));});
