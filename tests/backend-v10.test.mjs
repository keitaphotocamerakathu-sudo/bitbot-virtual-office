import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {webcrypto,createHmac} from 'node:crypto';
import * as engine from '../assets/engine.mjs';
import * as shadow from '../assets/shadow.mjs';
import * as evidence from '../assets/evidence.mjs';
import {portfolioCycle} from '../assets/selection.mjs';
import {createMarketService} from '../supabase/functions/bitbot-v10/market.mjs';
const source=fs.readFileSync(new URL('../supabase/functions/bitbot-v10/index.ts',import.meta.url),'utf8').replace(/^import .*;\n/gm,'');
function harness(fetchImpl){let handler;const sandbox={...engine,...shadow,...evidence,portfolioCycle,createMarketService,TextEncoder,TextDecoder,Response,Request,URL,AbortSignal,fetch:fetchImpl,crypto:webcrypto,console,Date,JSON,Math,setTimeout,clearTimeout,Deno:{env:{get:n=>({SUPABASE_URL:'https://test.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'TEST_SERVICE',SUPABASE_ANON_KEY:'TEST_ANON'})[n]},serve:fn=>handler=fn}};vm.createContext(sandbox);vm.runInContext(source,sandbox);return{handler,eval:code=>vm.runInContext(code,sandbox)};}
const ok=d=>new Response(JSON.stringify(d),{headers:{'Content-Type':'application/json'}});
test('health exposes no balances',async()=>{const h=harness(()=>{throw Error('unexpected fetch');});const r=await h.handler(new Request('https://api.test/?action=health'));const x=await r.json();assert.equal(r.status,200);assert.equal(x.version,'13.0.0');assert.equal(x.wallet,undefined);});
test('all private operations require a verified JWT',async()=>{const h=harness(()=>{throw Error('unexpected fetch');});for(const a of ['state','wallet','keys','start','save','stop','tick','remove-key','shadow-toggle']){const r=await h.handler(new Request('https://api.test/?action='+a,{method:'POST',body:'{}'}));assert.equal(r.status,401,a);}});
test('untrusted origins are blocked',async()=>{const h=harness(()=>{throw Error('unexpected fetch');});const r=await h.handler(new Request('https://api.test/?action=health',{headers:{Origin:'https://attacker.invalid'}}));assert.equal(r.status,403);});
test('scheduler needs its Vault token',async()=>{const h=harness(url=>{assert(String(url).includes('bitbot_v10_runner_allowed'));return ok(false);});const r=await h.handler(new Request('https://api.test/?action=run',{method:'POST',body:'{}'}));assert.equal(r.status,401);});
test('expired bearer tokens cannot read private data',async()=>{const h=harness(()=>new Response('{}',{status:401}));const r=await h.handler(new Request('https://api.test/?action=state',{headers:{Authorization:'Bearer expired'}}));assert.equal(r.status,401);});
test('real start always needs typed risk consent',async()=>{const h=harness(url=>String(url).includes('/auth/v1/user')?ok({id:'11111111-1111-4111-8111-111111111111'}):ok(true));const r=await h.handler(new Request('https://api.test/?action=start',{method:'POST',headers:{Authorization:'Bearer valid'},body:'{}'}));assert.equal(r.status,400);});
test('HMAC signs exact query and POST bytes',async()=>{const calls=[],h=harness((url,opts)=>{calls.push({url,opts});return String(url).endsWith('/servertime')?ok(1800000000000):ok({error:0,result:{id:'abc'}});});const pair={apiKey:'test-key',apiSecret:'test-secret'};h.eval('globalThis.testPair='+JSON.stringify(pair));await h.eval("signed(testPair,'POST','/api/v3/market/place-bid',{sym:'btc_thb',amt:100,rat:3000000,typ:'limit'})");const req=calls.at(-1);assert.equal(req.opts.headers['X-BTK-SIGN'],createHmac('sha256',pair.apiSecret).update('1800000000000POST/api/v3/market/place-bid'+req.opts.body).digest('hex'));await h.eval("signed(testPair,'GET','/api/v3/market/order-info?sym=btc_thb&id=abc&sd=buy')");assert.equal(calls.at(-1).opts.headers['X-BTK-SIGN'],createHmac('sha256',pair.apiSecret).update('1800000000000GET/api/v3/market/order-info?sym=btc_thb&id=abc&sd=buy').digest('hex'));});
test('withdrawal and arbitrary proxy paths are forbidden',async()=>{const h=harness(()=>{throw Error('must not fetch');});for(const path of ['/api/v4/crypto/withdraws','/api/v4/fiat/withdraw','https://attacker.invalid','/api/v3/user/limits'])await assert.rejects(h.eval("signed({apiKey:'x',apiSecret:'y'},'POST',"+JSON.stringify(path)+",{})"));});
test('ambiguous exchange write is never retried automatically',async()=>{let writes=0;const h=harness(url=>{if(String(url).endsWith('/servertime'))return ok(1800000000000);writes++;throw Error('response lost');});await assert.rejects(h.eval("signed({apiKey:'x',apiSecret:'y'},'POST','/api/v3/market/place-bid',{sym:'btc_thb',amt:100,rat:3000000,typ:'limit'})"));assert.equal(writes,1);});
test('settlement needs per-fill evidence',()=>{const h=harness(()=>{throw Error('no fetch');});assert.throws(()=>h.eval("filledState(initial(config()),{side:'BUY'},{filled:100,history:[]},config())"));const s=h.eval("filledState(initial(config()),{side:'BUY',strategy:'test'},{filled:100,history:[{amount:100,rate:3000000,fee:.25,credit:0}]},config())");assert(Math.abs(s.qty-99.75/3000000)<1e-12);assert(Math.abs(s.cash-99900)<1e-8);});

test('sub-satoshi buy rounding cannot strand the bot in a phantom position',()=>{const h=harness(()=>{throw Error('no fetch');});const s=h.eval("filledState(initial(config()),{side:'BUY',strategy:'test'},{filled:100,history:[{amount:100,rate:2208122.53,fee:.25,credit:0}]},config())");assert.equal(s.qty,Math.floor(99.75/2208122.53*1e8)/1e8);assert.equal(s.cash,99900);const sold=engine.applyFill(s,{side:'SELL',qty:s.qty,price:2300000,fee:.25},engine.config());assert.equal(sold.qty,0);assert.equal(sold.cost,0);});

test('paper scheduler never reaches authenticated exchange paths',async()=>{
 const h=harness((url,opts)=>{const path=String(url);if(path.includes('bitbot_v10_claim'))return ok([]);if(path.includes('bitbot_v13_shadow_claim'))return ok([]);throw Error('Unexpected private network call '+path);});
 const result=await h.eval('run()');assert.equal(result.processed,0);assert.equal(result.researchProcessed,0);
});

test('real start with valid consent is refused when strategy evidence is missing',async()=>{
 const h=harness(url=>{const path=String(url);if(path.includes('/auth/v1/user'))return ok({id:'11111111-1111-4111-8111-111111111111'});if(path.includes('bitbot_v10_rate'))return ok(true);if(path.includes('bitbot_v10_bots'))return ok([{running:false,config:engine.config(),state:engine.initial()}]);if(path.includes('bitbot_exchange_setup_status'))return ok({configured:true});if(path.includes('bitbot_v10_orders')||path.includes('bitbot_v10_events')||path.includes('bitbot_v13_shadow'))return ok([]);throw Error('Unexpected key or exchange access '+path);});
 const r=await h.handler(new Request('https://api.test/?action=start',{method:'POST',headers:{Authorization:'Bearer valid'},body:JSON.stringify({confirm:'เริ่มบอทเงินจริง',acceptRisk:true,noWithdraw:true})}));assert.equal(r.status,409);assert((await r.json()).error.includes('ยังพักเงินจริง'));
});
test('nonempty paper scheduler checkpoints six portfolios without reading exchange keys',async()=>{
 let checkpoint;
 const h=harness((url,opts)=>{const path=String(url);if(path.includes('rpc/bitbot_v10_claim'))return ok([]);if(path.includes('rpc/bitbot_v13_shadow_claim'))return ok([{user_id:'11111111-1111-4111-8111-111111111111',lease:'test',capital:80,states:{}}]);if(path.includes('bitbot_v10_bots'))return ok([{config:engine.config({budget:100,maxOrder:100,dailyBuy:100,dailySell:100})}]);if(path.includes('bitbot_v13_shadow_finish')){checkpoint=JSON.parse(opts.body);return ok(true);}throw Error('Paper attempted private access '+path);});
 h.eval('markets.scan=async()=>({markets:[{symbol:"ETH_THB"}]})');const result=await h.eval('run()');assert.equal(result.researchProcessed,1);assert.equal(Object.keys(checkpoint.p_states).length,6);assert.equal(checkpoint.p_events.length,0);
});
