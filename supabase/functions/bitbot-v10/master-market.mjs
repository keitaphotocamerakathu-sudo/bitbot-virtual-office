import {quoteOK} from './rea-core.mjs';
import {correlateMarkets} from './rea-correlation.mjs';
export function marketIntelligence(m,frames,config,now){
 const reasons=[],spread=m.last>0?(m.ask-m.bid)/m.last:null,asks=m.depth?.asks||[],bids=m.depth?.bids||[],row=r=>({p:Number(r?.price??r?.[0]),q:Number(r?.base_volume??r?.[1])}),a=asks.map(row),b=bids.map(row),t=frames['5'];
 if(!quoteOK(m,now))reasons.push('STALE_PRICE');if(m.marketSource!=='exchange'||m.status!=='active'||m.buyFrozen||m.sellFrozen)reasons.push('MARKET_UNAVAILABLE');
 if(!m.depth||now-m.depth.at>30000||m.depth.at>now||!a.length||!b.length||[...a,...b].some(x=>!Number.isFinite(x.p)||!Number.isFinite(x.q)||x.p<=0||x.q<=0))reasons.push('INVALID_OR_STALE_DEPTH');
 if(!(m.volumeTHB>=config.minVolumeTHB))reasons.push('LOW_LIQUIDITY');if(spread===null||spread<0||spread>config.maxSpread)reasons.push('WIDE_SPREAD');
 const deviation=t.lastClose>0?Math.abs(m.last/t.lastClose-1):null,abnormal=deviation!==null&&deviation>Math.max(.05,4*(t.atrWilder||0)/t.lastClose);
 if(abnormal)reasons.push('PRICE_ANOMALY');if(!t.ready||m.dataQuality?.ready!==true)reasons.push('CANDLE_QUALITY');
 const capacity=a.filter(r=>r.p<=m.ask*(1+config.slippage)).reduce((s,r)=>s+r.p*r.q,0),sellCapacity=b.filter(r=>r.p>=m.bid*(1-config.slippage)).reduce((s,r)=>s+r.p*r.q,0),imbalance=a.length&&b.length?(b.reduce((s,r)=>s+r.p*r.q,0)-a.reduce((s,r)=>s+r.p*r.q,0))/(b.reduce((s,r)=>s+r.p*r.q,0)+a.reduce((s,r)=>s+r.p*r.q,0)):null;
 const regime=abnormal?'ABNORMAL':t.volatility>.04?'HIGH_VOLATILITY':t.ready&&t.atrWilder/t.lastClose<.001?'LOW_VOLATILITY':t.regime==='UPTREND'?'BULLISH':t.regime==='DOWNTREND'?'BEARISH':'SIDEWAY';
 return{symbol:m.symbol,at:now,quoteAt:m.observedAt,bookAt:m.depth?.at??null,regime,ready:!reasons.length,reasons,spread,volumeTHB:m.volumeTHB,capacityTHB:capacity,sellCapacityTHB:sellCapacity,depthImbalance:imbalance,priceDeviation:deviation,volumeSpike:t.volumeSpike,momentum:t.macd?.histogram??null,volatility:t.volatility};
}
export function correlatedExposure(candidate,positions,markets,now,threshold=.8){
 const peers=positions.map(p=>{const a=markets.find(m=>m.symbol===candidate),b=markets.find(m=>m.symbol===p.symbol),r=correlateMarkets(a,b,now);return{symbol:p.symbol,...r};});
 return{peers,unknown:peers.some(p=>!p.ready),high:peers.filter(p=>p.ready&&p.r>=threshold).map(p=>p.symbol)};
}
