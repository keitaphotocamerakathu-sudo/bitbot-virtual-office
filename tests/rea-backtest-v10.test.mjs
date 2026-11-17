import test from 'node:test';
import assert from 'node:assert/strict';
import {replayREA} from '../research/rea-backtest.mjs';
test('backtest rejects reversed timestamps and future quote or order book data',()=>{
 for(const data of [[{at:1000,markets:[]},{at:999,markets:[]}],[{at:1000,markets:[{observedAt:1001}]}],[{at:1000,markets:[{observedAt:1000,depth:{at:1001}}]}]])assert.throws(()=>replayREA(data),/NON_CHRONOLOGICAL|FUTURE_MARKET/);
});
test('missing historical depth remains missing instead of synthesizing trades or returns',()=>{
 const result=replayREA([{at:1794900000000,markets:[]},{at:1794900060000,markets:[]}]);assert.equal(result.state.cash,10000);assert.equal(result.state.fills.length,0);assert.equal(result.summary.winRate,null);assert(result.events.some(e=>e.kind==='SAFE_MODE'));
});
