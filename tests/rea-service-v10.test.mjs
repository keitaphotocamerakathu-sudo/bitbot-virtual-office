import test from 'node:test';
import assert from 'node:assert/strict';
import {createREAService} from '../supabase/functions/bitbot-v10/rea-service.mjs';
import {initialREA} from '../supabase/functions/bitbot-v10/rea-core.mjs';
test('REA scheduler records seven real task results and never loads an exchange key',async()=>{
 const now=Date.now(),calls=[];let checkpoint;const rea=createREAService({clock:()=>now,marketService:{scan:async held=>{assert.deepEqual(held,[]);return{markets:[],universeCount:347};}},rpc:async(name,args)=>{calls.push(name);if(name==='rea_claim')return[{user_id:'owner',state:initialREA(now),lease:'unique',revision:4}];if(name==='rea_checkpoint'){checkpoint=args;return true;}throw Error('forbidden '+name);}});
 const result=await rea.run();assert.equal(result.processed,1);assert.deepEqual(calls,['rea_claim','rea_checkpoint']);assert.equal(checkpoint.p_latest.agents.length,7);assert.equal(checkpoint.p_state.mode,'PAPER_ONLY');assert.equal(checkpoint.p_latest.health,'SAFE_MODE');assert.equal(checkpoint.p_state.orders.length,0);
});
test('network loss produces a durable safe mode and an expired executor cannot claim success',async()=>{
 const now=Date.now();let checkpoint;const rea=createREAService({clock:()=>now,marketService:{scan:async()=>{throw Error('HTTP 429');}},rpc:async(name,args)=>{if(name==='rea_claim')return[{user_id:'owner',state:initialREA(now),lease:'expired',revision:1}];if(name==='rea_checkpoint'){checkpoint=args;return false;}throw Error('forbidden');}});
 const out=await rea.run();assert.equal(out.results[0].committed,false);assert.equal(checkpoint.p_latest.error,'HTTP 429');assert.equal(checkpoint.p_state.orders.length,0);
});
test('dashboard and controls preserve the server-verified owner scope',async()=>{
 const calls=[],rea=createREAService({rpc:async(name,args)=>{calls.push({name,args});return true;},marketService:{}});await rea.view('verified-owner');await rea.control('verified-owner','pause');assert(calls.every(c=>c.args.p_uid==='verified-owner'));assert.equal(calls[1].args.p_action,'pause');
});
