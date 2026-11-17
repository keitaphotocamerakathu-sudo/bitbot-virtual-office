import test from 'node:test';
import assert from 'node:assert/strict';
import {config,initial,cycle,applyFill,bangkokDay} from '../assets/engine.mjs';
import {entryPlan,bookImpact,performance,extractArticle} from '../assets/intraday.mjs';
import {assessNews,rankUniverse} from '../assets/selection.mjs';
const now=1800000000000;
function market(){return{symbol:'ETH_THB',name:'Ethereum',status:'active',last:3000,ask:3000,bid:2999,volumeTHB:10000000,change:1,observedAt:now,
 depth:{at:now,asks:[[3000,100]],bids:[[2999,100]]},news:{ready:true,fetchedAt:now,blocked:false,headlines:[]},
 candles:Array.from({length:80},(_,i)=>({t:now-(80-i)*300000,c:2950+i*.5+(i%2)*2,h:(2950+i*.5)*1.025,l:(2950+i*.5)*.975}))};}
test('intraday entries require real depth and enough movement after all costs',()=>{
 const c=config(),m=market();assert.equal(cycle(m,initial(c),c,now).order?.side,'BUY');
 for(const mutate of [x=>x.depth=null,x=>x.depth.at=now-26000,x=>{x.depth.asks=[[3000,.0001]];},x=>{x.candles=x.candles.map(b=>({...b,h:3000,l:2999,c:2999.5}));}]){
 const x=market();mutate(x);assert.equal(cycle(x,initial(c),c,now).order,null);
 }
});
test('stablecoin entries are excluded while held stablecoin exits remain available',()=>{
 const m={...market(),symbol:'USDT_THB'},c=config();assert.equal(cycle(m,initial(c),c,now).order,null);
 const s={...initial(c),symbol:'USDT_THB',cash:95000,qty:1,cost:3500};
 assert.equal(cycle(m,s,c,now).order?.side,'SELL');
});
test('net RR subtracts fees, spread, slippage and rounded satang costs',()=>{
 const m=market(),c=config(),p=entryPlan({...m,atrPct:.01},c,16,now);
 assert(p.cost>=.006);assert(p.netReward<p.grossTarget);assert.equal(p.netRR,p.netReward/p.netRisk);
 const bad=entryPlan({...m,atrPct:.01},config({takeProfit:.01}),100,now);assert(bad.reasons.length);
});
test('daily profit target and entry count block only new entries',()=>{
 const c=config(),s={...initial(c),day:bangkokDay(now),dayPnl:1000,dayStart:100000};
 assert.equal(cycle(market(),s,c,now).order,null);
 s.dayPnl=0;s.entriesToday=3;assert.equal(cycle(market(),s,c,now).order,null);
 const held={...s,qty:1,cost:3500,symbol:'ETH_THB',cash:96500};assert.equal(cycle(market(),held,c,now).order?.side,'SELL');
});
test('max holding time is frozen on entry and survives partial exits',()=>{
 const c=config(),m=market(),buy=applyFill(initial(c),{side:'BUY',symbol:m.symbol,qty:1,price:3000,fee:7.5,at:now-3600001,entryPolicy:{stopLoss:.02,takeProfit:.04,maxHoldMinutes:60}},c);
 const out=cycle(m,buy,config({maxHoldMinutes:240}),now);assert.equal(out.order?.reason,'TIME_EXIT');
 const partial=applyFill(buy,{side:'SELL',symbol:m.symbol,qty:.5,price:3000,fee:3.75,at:now},c);assert.equal(partial.entryAt,buy.entryAt);assert.equal(partial.entryPolicy.maxHoldMinutes,60);
});
test('legacy positions do not acquire a retroactive holding deadline',()=>{
 const c=config(),s={...initial(c),cash:97000,qty:1,cost:3000,symbol:'ETH_THB',entryAt:null,entryPolicy:null};
 assert.notEqual(cycle(market(),s,c,now).order?.reason,'TIME_EXIT');
});
test('losing streak starts cooldown only on a completed position',()=>{
 const c=config();let s=initial(c);
 for(let i=0;i<2;i++){s=applyFill(s,{side:'BUY',symbol:'ETH_THB',qty:1,price:3000,fee:7.5,at:now+i*1000},c);s=applyFill(s,{side:'SELL',symbol:'ETH_THB',qty:1,price:2950,fee:7.38,at:now+i*1000+500},c);}
 assert(s.cooldownUntil>now);assert.equal(cycle(market(),s,c,now+2000).order,null);
});
test('exchange fill timestamps drive Bangkok daily fees and partial realized PnL',()=>{
 const c=config();let s=applyFill(initial(c),{side:'BUY',symbol:'ETH_THB',qty:1,price:3000,fee:7.5,at:Date.parse('2026-11-16T16:59:00Z')},c);
 s=applyFill(s,{side:'SELL',symbol:'ETH_THB',qty:.5,price:3100,fee:3.88,at:Date.parse('2026-11-16T17:01:00Z')},c);
 assert.equal(s.daily['2026-11-16'].fees,7.5);assert.equal(s.daily['2026-11-17'].fees,3.88);assert(Math.abs(s.dayPnl-42.37)<1e-8);
 const p=performance(s,[{symbol:'ETH_THB',bid:3100}],c);assert.equal(p.realized,s.realized);assert.equal(p.fees,11.38);assert(Math.abs(p.totalNet-(p.realized+p.unrealized))<1e-8);
});
test('article extraction reads bounded article text and strips executable content',()=>{
 const body='Ethereum protocol upgraded with new safeguards. '.repeat(10);
 assert.equal(extractArticle('<script type="application/ld+json">'+JSON.stringify({'@type':'NewsArticle',articleBody:body})+'</script>').method,'JSON_LD_ARTICLE');
 const x=extractArticle('<article><script>alert(1)</script>'+body+'</article>');assert(!x.body.includes('alert'));assert.equal(x.method,'HTML_ARTICLE');
 assert.equal(extractArticle('x'.repeat(1500001)).method,'UNREADABLE');
});
test('entity-specific article risks and uncertain denials veto entry',()=>{
 const m=market(),feed={ready:true,fetchedAt:now,items:[{title:'Ethereum update',body:'Ethereum protocol was hacked and funds drained. '.repeat(10),source:'QA',publishedAt:now-1000,method:'HTML_ARTICLE'}]};
 assert(assessNews(m,feed,now).blocked);assert.equal(assessNews(m,feed,now).contentRead,1);
 feed.items[0].body='Ethereum has not been hacked, the team says. '.repeat(10);assert(assessNews(m,feed,now).uncertain);
 feed.items[0].body='Bitcoin was hacked. '.repeat(20);assert.equal(assessNews(m,feed,now).blocked,false);
});
test('single-source positive content cannot promote itself as corroborated',()=>{
 const m=market(),feed={ready:true,fetchedAt:now,items:[{title:'Ethereum upgrade approval',body:'Ethereum upgrade approved. '.repeat(20),source:'QA',publishedAt:now}]};
 assert.equal(assessNews(m,feed,now).score,0);
});
test('malformed depth and unsafe intraday settings fail closed',()=>{
 assert.equal(bookImpact({at:now,asks:[[3000,-1]],bids:[[2999,10]]},100,now).ready,false);
 for(const input of [{maxEntries:1.5},{slippage:0},{maxHoldMinutes:0},{minNetRR:1}])assert.throws(()=>config(input));
});
