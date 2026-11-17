import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
import {webcrypto} from 'node:crypto';
import {livePermission} from '../assets/live-permission.mjs';
function sandbox(file){
 let calls=0;const context={TextEncoder,TextDecoder,URL,Request,Response,AbortSignal,crypto:webcrypto,console,createMarketService:()=>({}),createVerifiedMarketService:()=>({}),createREAService:()=>({}),fetch:()=>{calls++;throw Error('network forbidden');},Deno:{env:{get:n=>n==='BITBOT_LIVE_ENABLED'?'true':undefined},serve:()=>{}}};
 vm.createContext(context);let src=fs.readFileSync(new URL(file,import.meta.url),'utf8').replace(/^import .*;\n/gm,'');
 vm.runInContext(stripTypeScriptTypes(src),context);return{eval:s=>vm.runInContext(s,context),calls:()=>calls};
}
for(const [file,signer] of [['../supabase/functions/bitbot-v10/index.ts','signed'],['../supabase/functions/bitkub-gateway/index.ts','bitkubSigned']]){
 test(file+' rejects both actual order endpoints before any network call even with env=true',async()=>{
  const h=sandbox(file);assert.equal(h.eval('LIVE'),false);
  for(const side of ['bid','ask']){
   const call=signer==='signed'?`signed({apiKey:'test',apiSecret:'test'},'POST','/api/v3/market/place-${side}',{})`:`bitkubSigned('POST','/api/v3/market/place-${side}',{},{apiKey:'test',apiSecret:'test'})`;
   await assert.rejects(h.eval(call),/PAPER_ONLY/);
  }assert.equal(h.calls(),0);
 });
}
test('neither research success nor early owner consent grants live permission',()=>{
 for(const allowed of [true,false])assert.equal(livePermission({allowed},{running:true,evidence_consent:{allowUnvalidated:true}}).allowed,false);
});
