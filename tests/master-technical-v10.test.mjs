import test from 'node:test';import assert from 'node:assert/strict';
import {advancedTechnical,weeklyFromDaily,technicalFrames} from '../supabase/functions/bitbot-v10/master-technical.mjs';
import {newsIntelligence} from '../supabase/functions/bitbot-v10/master-news.mjs';
import {marketIntelligence} from '../supabase/functions/bitbot-v10/master-market.mjs';
import {MASTER_DEFAULTS,STRATEGIES,validateMasterConfig} from '../supabase/functions/bitbot-v10/master-config.mjs';
import {strategySignal} from '../supabase/functions/bitbot-v10/master-strategies.mjs';
import {NOW,bars,market} from './master-fixtures.mjs';
test('Wilder RSI/ADX, SMA, OBV, ATR and Fibonacci have numerical meaning on known closed bars',()=>{
 const a=Array.from({length:80},(_,i)=>({t:NOW-(80-i)*300000,o:100+i,h:101+i,l:99+i,c:100+i,v:10})),t=advancedTechnical(a,5,NOW);
 assert.equal(t.ready,true);assert.equal(t.rsi,100);assert.equal(t.adx,100);assert.equal(t.atrWilder,2);assert.equal(t.sma[50],154.5);assert.equal(t.obv,790);assert.equal(t.fibonacci.levels[.5],149.5);assert.equal(t.ema[200],null);assert.equal(t.support,158);assert.equal(t.resistance,179);
 const flat=a.map(b=>({...b,o:100,h:100,l:100,c:100})),f=advancedTechnical(flat,5,NOW);assert.equal(f.rsi,50);assert.equal(f.adx,0);assert.equal(f.atrWilder,0);assert.equal(f.obv,0);assert.equal(f.fibonacci,null);
});
test('future candles cannot change an indicator and conflicting or unordered source bars are rejected',()=>{
 const a=bars(100,5),t=advancedTechnical(a,5,NOW),future={t:NOW,o:1,h:1e9,l:1,c:1e9,v:1e9};assert.deepEqual(advancedTechnical([...a,future],5,NOW),t);
 assert.equal(advancedTechnical([...a,a.at(-1)],5,NOW).ready,false);assert.equal(advancedTechnical([...a].reverse(),5,NOW).ready,false);assert.equal(advancedTechnical(a.slice(0,-2),5,NOW+900000).ready,false);
});
test('weekly candles require seven complete UTC-aligned daily records and never fill a missing day',()=>{
 const start=Date.parse('2026-11-02T00:00:00Z'),day=86400000,a=Array.from({length:14},(_,i)=>({t:start+i*day,o:100+i,h:102+i,l:99+i,c:101+i,v:10})),now=start+14*day;
 const w=weeklyFromDaily(a,now);assert.equal(w.length,2);assert.deepEqual(w[0],{t:start,o:100,h:108,l:99,c:107,v:70,source:'COMPLETE_BITKUB_DAYS'});
 assert.equal(weeklyFromDaily(a.filter((_,i)=>i!==3),now).length,1);assert.equal(weeklyFromDaily([...a,{...a[0]}],now).length,1);assert.equal(weeklyFromDaily(a,start+13*day).length,1);
});
test('seven frames use actual resolution sources; a 5-minute bar is never split into fabricated minutes',()=>{
 const m=market(),f=technicalFrames(m,NOW);assert.equal(Object.keys(f).length,7);assert(f[1440].ema[200]>0);assert.equal(f[10080].ready,true);
 delete m.masterFrames['1'];assert.equal(technicalFrames(m,NOW)[1].ready,false);assert.equal(technicalFrames(m,NOW)[1].barCount,0);
});
test('market intelligence rejects spread, clock, frozen market, anomaly and missing depth independently',()=>{
 const m=market(),f=technicalFrames(m,NOW);assert.equal(marketIntelligence(m,f,MASTER_DEFAULTS,NOW).ready,true);
 for(const [patch,reason] of [[{observedAt:NOW-31000},'STALE_PRICE'],[{depth:null},'INVALID_OR_STALE_DEPTH'],[{marketSource:'external'},'MARKET_UNAVAILABLE'],[{ask:m.bid*1.02},'WIDE_SPREAD'],[{last:m.last*1.3},'PRICE_ANOMALY']])assert(marketIntelligence({...m,...patch},f,MASTER_DEFAULTS,NOW).reasons.includes(reason));
});
test('news rejects old/future/untrusted/duplicate stories and rumors cannot trigger buys or a confirmed-event veto',()=>{
 const item={title:'Bitcoin hack rumored',url:'https://www.coindesk.com/story',source:'CoinDesk',publishedAt:NOW-1000,contentRead:true},out=newsIntelligence({news:{items:[item,item,{...item,url:'https://evil.test/story'},{...item,url:'https://www.coindesk.com/future',publishedAt:NOW+1},{...item,url:'https://www.coindesk.com/old',publishedAt:NOW-21600001}]}},NOW);
 assert.equal(out.items.length,1);assert.equal(out.items[0].verification,'RUMOR');assert.equal(out.items[0].canVeto,false);assert.equal(out.items[0].canTriggerBuy,false);assert.equal(out.rejected.length,4);
 const confirmed=newsIntelligence({news:{items:[{...item,title:'Bitcoin network exploit confirmed'}]}},NOW);assert.equal(confirmed.items[0].canVeto,true);assert.equal(confirmed.canTrade,false);
});
test('config changes cannot enable live mode, exceed risk ceilings or reserve the same cash twice',()=>{
 assert.doesNotThrow(()=>validateMasterConfig(MASTER_DEFAULTS));for(const patch of [{mode:'LIVE_ENABLED'},{riskPerTrade:.02},{portfolioRiskCap:.04},{maxPositions:6},{fee:0},{cashReserve:.9},{strategies:['LLM_FORCE_BUY']},{liveApproved:true}])assert.throws(()=>validateMasterConfig({...MASTER_DEFAULTS,...patch}));
});
test('all seven fixed strategy versions can express a valid plan, with a separately labeled confidence and no invented expectancy',()=>{
 const m=market(),base={ready:true,regime:'UPTREND',ema:{9:100.1,21:100,50:99,200:98},macd:{line:1,histogram:1},rsi:55,lastClose:100.15,lastClosedAt:NOW,atrWilder:1,adx:30,breakout:true,falseBreakout:false,pullbackReclaim:true,volumeSpike:true,resistance:120,patterns:['BULLISH_HAMMER'],bollinger:{lower:98,middle:104}},intel={ready:true,regime:'BULLISH',spread:.001};m.ask=100.2;m.last=100.2;
 for(const s of STRATEGIES){const a=structuredClone(base),b=structuredClone(base),i=structuredClone(intel);if(s.id==='MEAN_REVERSION_SHORT'){a.adx=10;a.rsi=35;a.lastClose=100;i.regime='SIDEWAY';}const f={[s.frame]:a,[s.confirm]:b},r=strategySignal(s,m,f,i,{items:[]},MASTER_DEFAULTS,NOW);assert.equal(r.eligible,true,s.id+':'+r.reasons);assert(r.entry>r.stop&&r.target>r.entry);assert.equal(r.horizon,s.horizon);assert.equal(r.confidence.method,'RULE_COMPLETENESS_NOT_WIN_PROBABILITY');assert.equal(r.expectedNetReturn,null);assert.equal(r.canActivateLive,false);}
});
