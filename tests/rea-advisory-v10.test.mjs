import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import worker,{cleanInput,parseAdvice} from '../cloudflare/rea-advisor/worker.mjs';
import {createAdvisory} from '../supabase/functions/bitbot-v10/rea-advisory.mjs';
const now=Date.now(),input={mode:'PAPER_ONLY',headlines:[{title:'Bitcoin market update',source:'CoinDesk',publishedAt:now-1000}],markets:[{symbol:'BTC_THB',score:70,regime:'UPTREND'}]};
test('LLM input excludes all account data and rejects future or unverified headlines',()=>{
 const x=cleanInput({...input,wallet:10000,apiKey:'SECRET',user_id:'PRIVATE',headlines:[...input.headlines,{title:'future',source:'CoinDesk',publishedAt:now+1},{title:'unknown',source:'attacker',publishedAt:now}]},now);
 assert.equal(x.headlines.length,1);assert(!JSON.stringify(x).includes('SECRET'));assert.equal(x.wallet,undefined);assert.equal(x.user_id,undefined);
});
test('LLM attempts to add trade commands or raise risk limits are discarded',()=>{
 const a=parseAdvice(JSON.stringify({risk:'HIGH',summary:'ข่าวมีความเสี่ยง',sourceIds:[1,99],riskPerTrade:1,action:'BUY',maxPositions:100,canTrade:true}),cleanInput(input,now));
 assert.equal(a.canTrade,false);assert.equal(a.canChangeLimits,false);assert.equal(a.action,undefined);assert.equal(a.riskPerTrade,undefined);assert.deepEqual(a.sourceIds,[1]);
 assert.throws(()=>parseAdvice('BUY EVERYTHING',input),/INVALID_MODEL/);
});
test('AI Worker does not invoke a model without its backend token',async()=>{
 let runs=0;const env={AUTH_TOKEN:'TEST_TOKEN',AI:{run:async()=>{runs++;return{response:'{}'};}}};
 const r=await worker.fetch(new Request('https://worker.test/analyze',{method:'POST',body:JSON.stringify(input)}),env);assert.equal(r.status,401);assert.equal(runs,0);
 const h=await worker.fetch(new Request('https://worker.test/health'),env);assert.equal((await h.json()).canTrade,false);
});
test('backend advisor transmits only public context and keeps a verified cache',async()=>{
 const calls=[];let body;const advisor=createAdvisory({clock:()=>now,rpc:async(name,args)=>{calls.push({name,args});return name==='rea_advisory_claim'?{allowed:true,url:'https://rea-bitkub-advisor.restartbykeita.workers.dev/analyze',token:'TEST_TOKEN'}:true;},fetchFn:async(url,options)=>{body=JSON.parse(options.body);return Response.json({ok:true,advice:{risk:'LOW',summary:'บริบทตลาด',sourceIds:[1],model:'test',at:now,canTrade:false,action:'BUY',riskPerTrade:1}});}});
 const out=await advisor({news:{items:input.headlines},cash:10000,user_id:'PRIVATE'},[{symbol:'BTC_THB',score:70,indicators:{regime:'UPTREND'}}]);assert.equal(out.canTrade,false);assert.equal(out.action,undefined);assert.equal(body.cash,undefined);assert.equal(body.user_id,undefined);assert.equal(calls[1].name,'rea_advisory_finish');
});
test('unknown AI host is rejected before transmitting its backend token',async()=>{
 const advisor=createAdvisory({rpc:async()=>({allowed:true,url:'https://attacker.invalid',token:'secret'}),fetchFn:()=>{throw Error('must not send');}});await assert.rejects(advisor({},[]),/HOST_DENIED/);
});
