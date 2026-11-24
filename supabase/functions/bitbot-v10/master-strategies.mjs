import {STRATEGIES,MASTER_SPEC} from './master-config.mjs';
import {tickPrice} from './engine.mjs';
const aligned=t=>t.ema?.[9]>t.ema?.[21]&&t.ema?.[21]>t.ema?.[50],up=t=>t.regime==='UPTREND',between=(n,a,b)=>Number.isFinite(n)&&n>=a&&n<=b;
export function strategySignal(spec,m,frames,intelligence,news,config,now){
 const a=frames[spec.frame],b=frames[spec.confirm],why=[],checks=[];
 const check=(ok,reason)=>{checks.push(!!ok);if(!ok)why.push(reason);};
 check(a?.ready&&b?.ready,'TIMEFRAME_DATA_INSUFFICIENT');check(config.frames.includes(spec.frame)&&config.frames.includes(spec.confirm),'TIMEFRAME_DISABLED');check(config.strategies.includes(spec.id)&&config.horizons.includes(spec.horizon),'STRATEGY_DISABLED');check(intelligence.ready,'MARKET_NOT_READY');
 if(a&&b)switch(spec.id){
  case'TREND_SHORT':check(up(a)&&up(b)&&aligned(a),'TREND_NOT_ALIGNED');check(a.macd?.line>0&&a.macd?.histogram>0,'MOMENTUM_NOT_CONFIRMED');check(between(a.rsi,45,62)&&a.lastClose<=a.ema?.[9]*1.006,'WAIT_TREND_ENTRY');break;
  case'BREAKOUT_SHORT':check(a.breakout&&!a.falseBreakout&&up(b),'WAIT_CONFIRMED_BREAKOUT');check(a.adx>=20&&between(a.rsi,45,70),'BREAKOUT_STRENGTH_INSUFFICIENT');break;
  case'PULLBACK_MEDIUM':check(up(a)&&up(b)&&a.pullbackReclaim&&a.ema?.[9]>a.ema?.[21],'WAIT_PULLBACK_RECLAIM');check(between(a.rsi,45,62)&&a.macd?.histogram>0&&a.adx>=18,'PULLBACK_MOMENTUM_INSUFFICIENT');break;
  case'MEAN_REVERSION_SHORT':check(intelligence.regime==='SIDEWAY'&&a.adx<20&&b.regime!=='DOWNTREND','RANGE_REGIME_REQUIRED');check(between(a.rsi,25,42)&&a.bollinger&&a.lastClose>a.bollinger.lower&&a.lastClose<a.bollinger.middle&&a.patterns.some(p=>['BULLISH_HAMMER','BULLISH_ENGULFING'].includes(p)),'WAIT_RANGE_REVERSAL');break;
  case'MOMENTUM_SHORT':check(up(a)&&up(b)&&aligned(a)&&a.volumeSpike,'WAIT_VOLUME_MOMENTUM');check(a.adx>=25&&a.macd?.histogram>0&&between(a.rsi,50,68),'MOMENTUM_STRENGTH_INSUFFICIENT');break;
  case'SWING_MEDIUM':check(up(a)&&up(b)&&a.ema?.[21]>a.ema?.[50]&&a.lastClose<=a.ema?.[21]*1.02,'WAIT_SWING_PULLBACK');check(a.adx>=20&&between(a.rsi,45,65)&&a.macd?.histogram>0,'SWING_MOMENTUM_INSUFFICIENT');break;
  case'POSITION_LONG':check(a.ema?.[200]>0&&a.ema?.[50]>a.ema?.[200]&&b.ema?.[9]>b.ema?.[21]&&up(a)&&up(b),'HIGHER_TIMEFRAME_TREND_REQUIRED');check(a.macd?.line>0&&between(a.rsi,45,65),'POSITION_MOMENTUM_INSUFFICIENT');break;
  default:throw Error('UNKNOWN_MASTER_STRATEGY');
 }
 const related=(news?.items||[]).filter(n=>new RegExp('\\b'+m.symbol.replace('_THB','')+'\\b','i').test(n.title));check(!related.some(n=>n.canVeto),'VERIFIED_NEWS_RISK');
 const entry=m.rules?tickPrice(m.ask*(1+config.slippage),m.rules,false):null,atr=a?.atrWilder,minStop={SHORT:.008,MEDIUM:.02,LONG:.04}[spec.horizon],distance=entry>0&&atr>0?Math.max(minStop,atr*spec.stopATR/entry):null;
 const stop=entry>0&&distance>0&&m.rules?tickPrice(entry*(1-distance),m.rules,false):null;
 let target=entry>0&&stop>0?entry+(entry-stop)*spec.targetR:null;
 if(['TREND_SHORT','PULLBACK_MEDIUM','SWING_MEDIUM'].includes(spec.id)&&a?.resistance>entry)target=Math.min(target,a.resistance-(atr||0)*.1);
 if(spec.id==='MEAN_REVERSION_SHORT')target=a?.bollinger?.middle??null;
 if(m.rules&&target>0)target=tickPrice(target,m.rules,false);
 check(Number.isFinite(distance)&&distance<=.15&&entry>=m.ask&&stop>0&&stop<entry&&target>entry,'INVALID_ENTRY_EXIT_STRUCTURE');
 const completeness=checks.length?checks.filter(Boolean).length/checks.length:0,momentum=a?.rsi>=45&&a?.rsi<=65?20:5,liquidity=Math.min(20,Math.max(0,Math.log10(Math.max(1,m.volumeTHB)/250000+1)*10)),score=Math.round((25*Number(up(a||{}))+momentum+liquidity+15*(1-Math.min(1,(intelligence.spread||0)/config.maxSpread))+15*completeness+5*Number(related.some(n=>n.contentRead)))*100)/100;
 return{protocol:MASTER_SPEC,id:'master31:'+m.symbol+':'+spec.id+':'+(a?.lastClosedAt||Math.floor(now/3600000)*3600000),signalId:'master31:'+m.symbol+':'+spec.id+':'+(a?.lastClosedAt||Math.floor(now/3600000)*3600000),at:now,symbol:m.symbol,strategyId:spec.id,strategyVersion:spec.version,horizon:spec.horizon,timeframe:spec.frame,confirmationTimeframe:spec.confirm,signalAt:a?.lastClosedAt??null,quoteAt:m.observedAt,exitPolicy:config.exitPolicy,entry,stop,target,stopDistance:entry>0?(entry-stop)/entry:null,score,eligible:!why.length,action:why.length?'WAIT':'REVIEW_BUY',reasons:[...new Set(why)],entryReason:spec.id,exitRules:{fixedStop:stop,atrStopMultiple:spec.stopATR,target,maxHoldMs:spec.maxHoldMs,trailActivationR:1,trailATR:2,partialAtR:1.5,partialFraction:.5,lockedHorizon:spec.horizon},confidence:{value:completeness,method:'RULE_COMPLETENESS_NOT_WIN_PROBABILITY',empiricalWinProbability:null},expectedNetReturn:null,expectedReturnReason:'PROSPECTIVE_VALIDATION_REQUIRED',regime:intelligence.regime,indicators:{rsi:a?.rsi??null,adx:a?.adx??null,atr:a?.atrWilder??null,macd:a?.macd??null,ema:a?.ema??null},canTrade:false,canActivateLive:false};
}
export function rankMasterSignals(markets,analyses,news,config,now){return markets.flatMap(m=>STRATEGIES.map(s=>strategySignal(s,m,analyses[m.symbol].frames,analyses[m.symbol].intelligence,news,config,now))).sort((a,b)=>Number(b.eligible)-Number(a.eligible)||b.score-a.score||a.signalId.localeCompare(b.signalId));}
