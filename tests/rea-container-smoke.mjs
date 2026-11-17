// Executed inside the built image with --network none and no credentials.
import assert from 'node:assert/strict';
import {createTransport} from '/app/services/rea/transport.mjs';
import {parseTicker} from '/app/services/rea/streams.mjs';
import {progressHealth} from '/app/services/rea/daemon.mjs';
let calls=0;const io=createTransport({supabaseURL:'https://test.supabase.co',key:'CI_ONLY_NOT_A_KEY',fetchFn:async()=>{calls++;return Response.json({ok:true});}});
await assert.rejects(io.json('https://api.bitkub.com/api/v3/market/place-bid',{method:'POST'}),/PAPER_ONLY/);
await assert.rejects(io.json('https://api.bitkub.com/api/v3/market/place-ask',{method:'POST'}),/PAPER_ONLY/);assert.equal(calls,0);
const now=Date.now(),quote=parseTicker({stream:'market.ticker.thb_btc',last:100,highestBid:99,lowestAsk:101},new Set(['BTC_THB']),now);assert.equal(quote.source,'BITKUB_PUBLIC_WS');
assert.equal(progressHealth({startedAt:now,lastWorkAt:now,status:'OK'},now+130000).restart,true);
console.log('Container imports, paper-only transport, WebSocket parser and progress supervisor passed without network or secrets.');
