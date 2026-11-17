import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHistory,parseTrades,recoverHistory,historyQuality,candidateQueue} from '../supabase/functions/bitbot-v10/market-data.mjs';
import {createVerifiedMarketService} from '../supabase/functions/bitbot-v10/market-verified.mjs';
import {runtimeConfig,dataUpgradeBlock} from '../supabase/functions/bitbot-v10/data-policy.mjs';
const NOW=1800000000000,STEP=300000;
const bars=()=>Array.from({length:180},(_,i)=>({t:NOW-(180-i)*STEP,o:100+i*.01,h:101+i*.01,l:99+i*.01,c:100+i*.01,v:10,source:'BITKUB_HISTORY'}));
const raw=a=>Object.fromEntries(['t','o','h','l','c','v'].map(k=>[k,a.map(b=>k==='t'?b.t/1000:b[k])]).concat([['s','ok']]));
const evidence=(a=[],oldest=NOW-30*STEP,newest=NOW)=>parseTrades({error:0,result:[[newest/1000,102,1,'BUY'],...a,[oldest/1000,100,1,'SELL']]},NOW);
test('exchange trades accept documented milliseconds and observed seconds identically',()=>{
 const seconds=parseTrades({error:0,result:[[NOW/1000,100,2,'BUY']]},NOW),ms=parseTrades({error:0,result:[[NOW,100,2,'BUY']]},NOW);assert.deepEqual(seconds,ms);
});
test('malformed prices, null fields, array lengths, ordering and duplicate candles fail closed',()=>{
 for(const mutate of [r=>r.h.pop(),r=>r.v[0]=null,r=>r.l[0]=0,r=>r.c[0]=10000]){const x=raw(bars());mutate(x);assert.throws(()=>parseHistory(x,5,NOW));}
 assert.throws(()=>parseTrades({error:0,result:[[NOW/1000,0,1,'BUY']]},NOW));assert.throws(()=>parseTrades({error:0,result:[[(NOW-1000)/1000,10,1,'BUY'],[NOW/1000,10,1,'BUY']]},NOW));
 const duplicate=bars();duplicate.push({...duplicate[0],c:100.5});assert.throws(()=>parseHistory(raw(duplicate),5,NOW));
});
test('open bars are never admitted as signals',()=>{const x=bars();x.push({...x.at(-1),t:NOW});assert.equal(parseHistory(raw(x),5,NOW).length,180);});
test('a verified no-trade interval gets an explicit zero-volume carried close',()=>{
 const original=bars(),missing=original.filter((_,i)=>i!==170),result=recoverHistory(missing,evidence(),{now:NOW});const b=result.candles.find(b=>b.t===original[170].t);
 assert.equal(result.repair.verifiedEmpty,1);assert.equal(b.v,0);assert.equal(b.o,original[169].c);assert.equal(b.h,b.c);assert.equal(b.l,b.c);assert.equal(b.source,'VERIFIED_NO_TRADES');assert(historyQuality(result.candles,5,NOW).ready);
 assert.equal(original.length,180);assert.equal(missing.length,179);
});
test('actual trades reconstruct missing OHLCV, without pretending the interval was empty',()=>{
 const original=bars(),t=original[170].t,proof=evidence([[(t+120000)/1000,102,2,'BUY'],[(t+10000)/1000,101,3,'SELL']]);const r=recoverHistory(original.filter(b=>b.t!==t),proof,{now:NOW}),b=r.candles.find(b=>b.t===t);
 assert.equal(r.repair.recovered,1);assert.deepEqual([b.o,b.h,b.l,b.c,b.v],[101,102,101,102,5]);assert.equal(b.source,'BITKUB_TRADES');
});
test('missing, stale, truncated and empty trade evidence cannot fill a gap',()=>{
 const original=bars(),t=original[170].t,missing=original.filter(b=>b.t!==t);
 for(const proof of [null,evidence([],t+1),{...evidence(),observedAt:NOW-30001},parseTrades({error:0,result:[]},NOW),evidence([],NOW-30*STEP,t+STEP-1)]){const r=recoverHistory(missing,proof,{now:NOW});assert.equal(r.candles.length,179);assert.equal(historyQuality(r.candles,5,NOW).ready,false);}
});
test('no leading price or future event is manufactured and unresolved gaps remain visible',()=>{
 const first=bars().slice(170),r=recoverHistory(first,evidence(),{now:NOW});assert.equal(r.candles[0].t,first[0].t);assert.equal(r.candles.length,10);assert.throws(()=>parseTrades({error:0,result:[[(NOW+6000)/1000,1,1,'BUY']]},NOW));
});
test('verified historical recovery survives a shorter recent-trades window',()=>{
 const original=bars(),missing=original.filter((_,i)=>i!==170),first=recoverHistory(missing,evidence(),{now:NOW}),second=recoverHistory(missing,null,{now:NOW,previous:first.candles});assert.equal(second.repair.retained,1);assert(historyQuality(second.candles,5,NOW).ready);
 const unproved=first.candles.map(b=>b.source==='VERIFIED_NO_TRADES'?{...b,evidence:null}:b);assert.equal(recoverHistory(missing,null,{now:NOW,previous:unproved}).candles.length,179);
});
test('a real provider candle takes precedence over an earlier recovered candle',()=>{
 const original=bars(),first=recoverHistory(original.filter((_,i)=>i!==170),evidence(),{now:NOW});const second=recoverHistory(original,null,{now:NOW,previous:first.candles});assert.equal(second.candles.find(b=>b.t===original[170].t).source,'BITKUB_HISTORY');assert.equal(second.repair.retained,0);
});
test('hourly gaps are subject to the same full-coverage proof',()=>{
 const a=Array.from({length:60},(_,i)=>({...bars()[0],t:NOW-(60-i)*3600000})),proof=evidence([],NOW-61*3600000),r=recoverHistory(a.filter((_,i)=>i!==50),proof,{minutes:60,now:NOW});assert(historyQuality(r.candles,60,NOW,50,50).ready);
});
test('rotation prefers usable data while always retaining the held asset',()=>{
 const a=Array.from({length:40},(_,i)=>({symbol:'A'+i+'_THB',eligible:true})),health=new Map(a.slice(0,8).map(m=>[m.symbol,{ready:false}]));const r=candidateQueue(a,['A0_THB'],health,NOW);assert.equal(r[0].symbol,'A0_THB');assert(r.slice(1,9).every(m=>Number(m.symbol.match(/A(\d+)/)[1])>=8));assert.equal(r.length,24);assert.notDeepEqual(r,candidateQueue(a,['A0_THB'],health,NOW+60000));
});
test('unknown data policies and upgrades with held, unresolved or locked positions are rejected',()=>{
 assert.throws(()=>runtimeConfig({marketDataPolicy:'force-buy'}));assert(runtimeConfig({marketDataPolicy:'verified-v17'}));
 const b={state:{qty:0},config:{}};assert.equal(dataUpgradeBlock(b),null);assert(dataUpgradeBlock({...b,state:{qty:1}}));assert(dataUpgradeBlock({...b,state:{halted:true}}));assert(dataUpgradeBlock(b,[{settled:false,status:'UNKNOWN'}]));assert(dataUpgradeBlock({...b,config:{marketDataPolicy:'verified-v17'}}));
});
test('history service repairs from public evidence and coalesces concurrent reads',async()=>{
 const original=bars(),missing=original.filter((_,i)=>i!==170),calls=[],cache=new Map();
 const svc=createVerifiedMarketService({base:{},clock:()=>NOW,read:async path=>{const key=decodeURIComponent(path.match(/key=eq.([^&]+)/)[1]);return cache.has(key)?[cache.get(key)]:[];},rpc:async(_name,args)=>{cache.set(args.p_key,{payload:args.p_payload,expires_at:args.p_expires});},json:async url=>{calls.push(url);return url.includes('/trades?')?{error:0,result:[[NOW/1000,102,1,'BUY'],[(NOW-30*STEP)/1000,100,1,'BUY']]}:raw(missing);}});
 const [a,b]=await Promise.all([svc.history('ETH_THB'),svc.history('ETH_THB')]);assert(a.quality.ready);assert.equal(a.repair.verifiedEmpty,1);assert.deepEqual(a,b);assert.equal(calls.length,2);assert(calls.every(u=>!u.includes('place-')&&!u.includes('wallet')));await svc.history('ETH_THB');assert.equal(calls.length,2);
});
test('trade-source failure leaves usable original data and an honest gap reason',async()=>{
 const a=bars().filter((_,i)=>i!==170),svc=createVerifiedMarketService({base:{},clock:()=>NOW,read:async()=>[],rpc:async()=>{},json:async url=>{if(url.includes('/trades?'))throw Error('source timeout');return raw(a);}}),r=await svc.history('ETH_THB');assert.equal(r.quality.ready,false);assert.equal(r.candles.length,179);assert.equal(r.tradeError,'source timeout');
});

test('scanner replaces unusable candidates up to its cap and refreshes quotes after recovery',async()=>{
 const all=Array.from({length:40},(_,i)=>({symbol:'A'+i+'_THB',name:'Asset '+i,status:'active',last:100,bid:99.99,ask:100,volumeTHB:10000000-i*10000,change:1,observedAt:NOW,rules:{minQuote:10,priceStep:.01,qtyScale:8,priceScale:2}})),feed={ready:true,fetchedAt:NOW,items:[],sources:[{ok:true,name:'QA'}]};
 let quoteCalls=0;const seen=[],svc=createVerifiedMarketService({clock:()=>NOW,read:async()=>[],rpc:async()=>{},base:{all:async()=>{quoteCalls++;return all;},news:async()=>feed},json:async url=>{
 const u=new URL(url),symbol=u.searchParams.get('symbol')||u.searchParams.get('sym');seen.push(symbol.toUpperCase());
 if(u.pathname.endsWith('/depth'))return{error:0,result:{asks:[[100,1000]],bids:[[99.99,1000]]}};
 if(u.pathname.endsWith('/trades'))return{error:0,result:[]};
 return raw(Number(symbol.match(/A(\d+)/)[1])<8?bars().filter((_,i)=>i!==170):bars());
 }});
 const scan=await svc.scan(['A0_THB']);assert(scan.markets.length>12);assert(scan.markets.length<=24);assert(scan.readyCount>=12);assert.equal(scan.markets[0].symbol,'A0_THB');assert.equal(scan.markets[0].dataQuality.ready,false);assert.equal(quoteCalls,2);assert(seen.length>0);
});

test('recovering a confirmed empty interval restores an otherwise valid strategy signal',async()=>{
 const {adaptiveCycle}=await import('../assets/adaptive.mjs'),{config,initial}=await import('../assets/engine.mjs');
 const c=config({entryPlanner:'net-v16',strategyProfile:'trend-confirmed',budget:100,maxOrder:100,dailyBuy:100,dailySell:100}),a=Array.from({length:180},(_,i)=>{const close=100+i*.003+Math.sin(i*.8+3.25)*.05;return{t:NOW-(180-i)*STEP,o:close,h:close*(i<150?1.012:1.0002),l:close*(i<150?.988:.9998),c:close,v:i===179?150:100};}),last=a.at(-1).c;
 const m={symbol:'ETH_THB',last,bid:last-.01,ask:last,observedAt:NOW,volumeTHB:1e7,rules:{minQuote:10,qtyScale:8,priceScale:2,priceStep:.01},depth:{at:NOW,asks:[[last,1000]],bids:[[last-.01,1000]]},news:{ready:true,fetchedAt:NOW,blocked:false},feeCredits:{ready:true,available:100,at:NOW},candles:a.filter((_,i)=>i!==156)};
 assert.equal(adaptiveCycle(m,initial(c),c,NOW).order,null);const recovered=recoverHistory(m.candles,evidence(),{now:NOW});assert.equal(adaptiveCycle({...m,candles:recovered.candles},initial(c),c,NOW).order?.side,'BUY');
});

test('new covering trade evidence supersedes an earlier empty-interval repair',()=>{
 const original=bars(),t=original[170].t,missing=original.filter(b=>b.t!==t),first=recoverHistory(missing,evidence(),{now:NOW});
 const second=recoverHistory(missing,evidence([[(t+1000)/1000,105,2,'BUY']]),{now:NOW,previous:first.candles}),b=second.candles.find(b=>b.t===t);assert.equal(b.source,'BITKUB_TRADES');assert.equal(b.v,2);assert.equal(b.c,105);
});
