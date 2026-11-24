// Paper market discovery. Filtering never grants permission to trade.
import {MASTER_DEFAULTS} from './master-config.mjs';
import {quoteOK} from './rea-core.mjs';
import {validSymbol} from './engine.mjs';
export function candidateQuality(m,config=MASTER_DEFAULTS,now=Date.now()){
 const reasons=[],spread=m?.last>0?(m.ask-m.bid)/m.last:null;
 if(!m||!validSymbol(m.symbol)||m.marketSource!=='exchange'||m.status!=='active'||m.buyFrozen||m.sellFrozen||m.frozen)reasons.push('MARKET_UNAVAILABLE');
 if(!quoteOK(m,now))reasons.push('STALE_PRICE');
 if(!Number.isFinite(m?.volumeTHB)||m.volumeTHB<config.minVolumeTHB)reasons.push('LOW_LIQUIDITY');
 if(!Number.isFinite(spread)||spread<0||spread>config.maxSpread)reasons.push('WIDE_SPREAD');
 return{ready:reasons.length===0,reasons,spread};
}
export function selectMasterMarkets(bundle,held=[],config=MASTER_DEFAULTS,now=Date.now(),quotes=[]){
 const pool=new Map();for(const m of [...(bundle?.watchlist||[]),...(bundle?.markets||[]),...quotes])if(m?.symbol)pool.set(m.symbol,{...pool.get(m.symbol),...m});
 const assessed=[...pool.values()].map(m=>({m,q:candidateQuality(m,config,now)})),eligible=assessed.filter(x=>x.q.ready).map(x=>x.m).sort((a,b)=>Number(a.dataQuality?.ready===false)-Number(b.dataQuality?.ready===false)||b.volumeTHB-a.volumeTHB||a.symbol.localeCompare(b.symbol));
 const heldSet=new Set(held),core=['BTC_THB','ETH_THB'].filter(s=>!heldSet.has(s)&&eligible.some(m=>m.symbol===s)),rest=eligible.filter(m=>!heldSet.has(m.symbol)&&!core.includes(m.symbol));
 const offset=rest.length?Math.floor(now/60000)%rest.length:0,ids=[...new Set([...held,...core,...[...rest.slice(offset),...rest.slice(0,offset)].map(m=>m.symbol)])],selected=ids.map(id=>pool.get(id)).filter(Boolean).slice(0,6),rejectedCounts={};
 for(const {q}of assessed)for(const reason of q.reasons)rejectedCounts[reason]=(rejectedCounts[reason]||0)+1;
 return{selected,receipt:{protocol:'PAPER_SCAN_31.0.2',at:now,universe:pool.size,eligible:eligible.length,held:held.length,selected:selected.map(m=>m.symbol),rejectedCounts,unscannedEligible:eligible.filter(m=>!selected.some(s=>s.symbol===m.symbol)).length,limits:{minVolumeTHB:config.minVolumeTHB,maxSpread:config.maxSpread,maxDetailed:6},policy:'FILTER_THEN_ROTATE_QUALIFIED',heldExceptions:selected.filter(m=>heldSet.has(m.symbol)&&!candidateQuality(m,config,now).ready).map(m=>m.symbol),canTrade:false}};
}
