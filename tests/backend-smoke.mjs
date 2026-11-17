import assert from 'node:assert/strict';
const base='https://lrxrigimdaedfemqheug.supabase.co/functions/v1/bitbot-v10';
const request=async(action,options={})=>{const r=await fetch(base+'?action='+action,{...options,signal:AbortSignal.timeout(30000)});return{r,data:await r.json()};};
const health=await request('health');assert.equal(health.r.status,200);assert.equal(health.data.version,'13.0.0');
assert.equal((await request('state')).r.status,401);
assert.equal((await request('run',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).r.status,401);
const market=await request('market');assert.equal(market.r.status,200,JSON.stringify(market.data));assert(market.data.market.bid>0);assert(market.data.market.ask>=market.data.market.bid);assert(market.data.market.candles.length>=60,'Need real closed candles');console.log('Health, auth, scheduler, Bitkub prices and closed candles passed. No trades submitted.');

const scan=await request('scan');assert.equal(scan.r.status,200,JSON.stringify(scan.data));assert(scan.data.scan.universeCount>2);assert(scan.data.scan.markets.length>0);assert(scan.data.scan.watchlist.some(x=>x.symbol!=='BTC_THB'));assert(scan.data.scan.markets.every(x=>x.symbol.endsWith('_THB')));assert(scan.data.scan.news.sources.length===2);console.log('Multi-asset scan, market metadata and news-source statuses passed.');
