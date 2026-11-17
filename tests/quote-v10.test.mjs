import test from 'node:test';
import assert from 'node:assert/strict';
import {QuoteStream} from '../assets/quote-stream.mjs';
test('public ticker accepts only its own validated stream and reconnects without trading capability',()=>{
 const sockets=[],timers=new Map(),events=[];let id=0;
 class Socket{constructor(url){this.url=url;sockets.push(this);}close(){this.onclose?.();}}
 const q=new QuoteStream(x=>events.push(x),{Socket,schedule:(fn,ms)=>{timers.set(++id,{fn,ms});return id;},cancel:n=>timers.delete(n)});
 q.select('ETH_THB');const s=sockets[0];assert.equal(s.url,'wss://api.bitkub.com/websocket-api/market.ticker.thb_eth');
 for(const data of [{stream:'market.ticker.thb_btc',last:100,highestBid:99,lowestAsk:101},{stream:'market.ticker.thb_eth',last:100,highestBid:102,lowestAsk:101}])s.onmessage({data:JSON.stringify(data)});
 assert.equal(events.length,1);s.onmessage({data:JSON.stringify({stream:'market.ticker.thb_eth',last:100,highestBid:99,lowestAsk:101})});assert.equal(events.at(-1).status,'LIVE');assert.equal(events.at(-1).timestampSource,'LOCAL_RECEIPT');
 s.close();assert.equal(events.at(-1).status,'REST_FALLBACK');assert([...timers.values()].some(t=>t.ms===1000));q.stop();assert.equal(timers.size,0);q.select('NOT/AN/EXCHANGE');assert.equal(sockets.length,1);
});
