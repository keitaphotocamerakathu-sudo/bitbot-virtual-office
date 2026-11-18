// Fixed forward-Paper hypotheses. No private API, LLM, live orders or risk-limit changes.
import {indicators,resample} from './technical.mjs';
export const POSITION_PROTOCOL='REA-POSITION-STUDY-26.0.0';
export const POSITION_POLICIES=Object.freeze(['BASELINE','PROTECT','SELECTIVE_PROTECT']);
export const PROFIT_HYPOTHESIS=Object.freeze({activateNet:.01,retainNet:.003,trailFraction:.005,fee:.0025,slippage:.002,roundingReserve:.10});
const money=n=>Math.round((n+Number.EPSILON)*100)/100;
const quote=(m,now)=>!!m&&[m.bid,m.ask,m.observedAt].every(Number.isFinite)&&m.bid>0&&m.ask>=m.bid&&(m.last===undefined||Number.isFinite(m.last)&&m.last>0)&&now-m.observedAt<=30000&&m.observedAt<=now+5000&&!m.frozen;
export function modeledNet(position,bid){
 if(![position?.qty,position?.cost,bid].every(Number.isFinite)||position.qty<=0||position.cost<=0||bid<=0)return null;
 const c=PROFIT_HYPOTHESIS,gross=position.qty*bid*(1-c.slippage),fee=Math.ceil((gross*c.fee-1e-10)*100)/100;
 return money(gross-fee-c.roundingReserve-position.cost);
}
export function profitPrice(position,netFraction=0){
 if(![position?.qty,position?.cost,netFraction].every(Number.isFinite)||position.qty<=0||position.cost<=0||netFraction<0)return null;
 const c=PROFIT_HYPOTHESIS;
 // Extra satang covers fee rounding; a reserve models up to ten partial-fill roundings.
 return(position.cost*(1+netFraction)+c.roundingReserve+.01)/(position.qty*(1-c.fee)*(1-c.slippage));
}
export function qualityEntry(signal,market,now){
 const fifteen=indicators(resample(market?.candles,15,now),15,now),rsi=signal?.indicators?.rsi,spread=(market?.ask-market?.bid)/market?.last;
 const reasons=[];
 if(market?.dataQuality?.ready!==true||!quote(market,now))reasons.push('ENTRY_SOURCE_QUALITY_UNAVAILABLE');
 if(!fifteen.ready||fifteen.lastClosedAt>now)reasons.push('FIFTEEN_MINUTE_DATA_UNAVAILABLE');
 else if(fifteen.regime!=='UPTREND')reasons.push('FIFTEEN_MINUTE_NOT_UPTREND');
 if(!Number.isFinite(rsi)||rsi<45||rsi>62)reasons.push('ENTRY_RSI_OUTSIDE_45_62');
 if(!Number.isFinite(spread)||spread>.003)reasons.push('ENTRY_SPREAD_ABOVE_0_3_PERCENT');
 if(!(market?.volumeTHB>=1000000))reasons.push('ENTRY_VOLUME_BELOW_ONE_MILLION');
 if(!['TREND_FOLLOWING','BREAKOUT'].includes(signal?.strategy))reasons.push('ENTRY_STRATEGY_OUTSIDE_TREND_OR_BREAKOUT');
 return{ready:reasons.length===0,reason:reasons.length?'POSITION_STUDY_ENTRY_FILTER':'POSITION_STUDY_ENTRY_PASSED',reasons,fifteenRegime:fifteen.ready?fifteen.regime:null,fifteenClosedAt:fifteen.lastClosedAt??null,rsi,spread,volumeTHB:market?.volumeTHB??null,policy:'SELECTIVE_PROTECT',hypothesisOnly:true};
}
export function updatePaperPosition(position,market,now,{policy='BASELINE',pendingEntry=false}={}){
 if(!POSITION_POLICIES.includes(policy))throw Error('INVALID_POSITION_STUDY_POLICY');
 const p=structuredClone(position),out={position:p,event:null};
 if(!quote(market,now)||!Number.isFinite(p.openedAt)||market.observedAt<p.openedAt||pendingEntry||![p.qty,p.cost,p.stop,p.target].every(Number.isFinite)||p.qty<=0||p.cost<=0||p.stop<=0||p.target<=p.stop)return out;
 const previous=p.protection;
 if(previous&&(!Number.isFinite(previous.quoteAt)||market.observedAt<=previous.quoteAt))return out;
 const net=modeledNet(p,market.bid);if(net===null)return out;
 const before=p.stop,peakBid=Math.max(previous?.peakBid||0,market.bid),peakNet=Math.max(previous?.peakNet??-Infinity,net),worstNet=Math.min(previous?.worstNet??Infinity,net),c=PROFIT_HYPOTHESIS;
 const activate=policy!=='BASELINE'&&(previous?.armed===true||net/p.cost>=c.activateNet),minimum=profitPrice(p,c.retainNet),breakeven=profitPrice(p,0);
 let next=p.stop;
 if(activate&&minimum!==null){
  // Never loosen a stop, and never put a new stop above the currently observed bid.
  const candidate=Math.max(minimum,peakBid*(1-c.trailFraction)),ceiling=Math.min(market.bid*(1-1e-9),p.target*(1-1e-9));
  if(candidate<=ceiling)next=Math.max(p.stop,candidate);
 }
 p.stop=next;p.protection={protocol:POSITION_PROTOCOL,policy,quoteAt:market.observedAt,observedAt:now,originalStop:previous?.originalStop??before,peakBid,peakNet,worstNet,modeledNet:net,breakevenPrice:breakeven,activationPrice:profitPrice(p,c.activateNet),armed:previous?.armed===true||next>before,armedAt:previous?.armedAt??(next>before?now:null),activeStop:next,canGuaranteeProfit:false};
 if(next>before)out.event={kind:'PROFIT_PROTECTION_RAISED',symbol:p.symbol,positionId:p.positionId,at:now,previousStop:before,stop:next,peakBid,modeledNet:net,simulation:true};
 return out;
}
export function positionStudySummary(book,accounts,now){
 const c=book.positionStudy,pair=accounts.filter(a=>a.cohort==='MATCHED_POSITION_STUDY'),expectedMinutes=Math.max(1,Math.floor(now/60000)-Math.floor(c.startedAt/60000)+1),coverage=c.validMinutes/expectedMinutes,baseline=pair.find(a=>a.profile==='EXIT_BASELINE');
 const mature=now-c.startedAt>=7*86400000&&coverage>=.9&&pair.length===3&&pair.every(a=>a.closedTrades>=30&&a.markVerified===true);
 const candidates=mature?pair.filter(a=>a.profile!=='EXIT_BASELINE'&&a.netPnL>0&&a.netPnL-baseline.netPnL>=20&&a.maxDrawdown<=baseline.maxDrawdown&&Number.isFinite(a.profitFactor)&&a.profitFactor>1).sort((a,b)=>b.netPnL-a.netPnL):[];
 return{protocol:POSITION_PROTOCOL,at:book.lastAt,mode:'PAPER_ONLY',status:!mature?'COLLECTING':candidates.length?'REVIEW_CANDIDATE':'NO_IMPROVEMENT',startedAt:c.startedAt,validMinutes:c.validMinutes,expectedMinutes,coverage,accounts:pair.map(a=>({profile:a.profile,name:a.name,netPnL:a.netPnL,realized:a.realized,fees:a.fees,closedTrades:a.closedTrades,profitFactor:a.profitFactor,maxDrawdown:a.maxDrawdown,protectedCloses:a.protectedCloses,entryFiltered:a.entryFiltered,markVerified:a.markVerified})),candidate:candidates[0]?.profile||null,minimum:{days:7,closedTradesPerAccount:30,coverage:.9,netImprovementTHB:20},hypothesis:PROFIT_HYPOTHESIS,canTrade:false,canActivateLive:false,requiresOwnerReview:true,limitations:['FORWARD_PAPER_NOT_LIVE_RESULTS','MINIMUM_EVIDENCE_IS_NOT_STATISTICAL_PROOF','SHORT_STOPS_MAY_EXIT_BEFORE_A_LATER_RALLY','GAPS_OR_MISSING_LIQUIDITY_CAN_LOSE_MONEY']};
}
export function liveProfitReview(state,bundle,now,study=null){
 try{return{protocol:POSITION_PROTOCOL,at:now,mode:'LIVE_READ_ONLY',study,positions:(state?.positions||[]).map(p=>{const m=bundle?.markets?.find(m=>m.symbol===p.symbol),fresh=quote(m,now);return{symbol:p.symbol,positionId:p.positionId,cost:p.cost,bid:fresh?m.bid:null,quoteAt:fresh?m.observedAt:null,modeledNet:fresh?modeledNet(p,m.bid):null,actualStop:p.stop,actualTarget:p.target,paperBreakeven:profitPrice(p,0),paperActivate:profitPrice(p,PROFIT_HYPOTHESIS.activateNet),entryStrategy:p.strategy,liveExitPolicy:'EXISTING_STOP_AND_TARGET',paperPolicy:'NET_PROFIT_ACTIVATION_AND_TRAILING',canChangeLiveOrders:false};}),canTrade:false,canChangeLimits:false,canGuaranteeProfit:false};}catch{return{protocol:POSITION_PROTOCOL,at:now,mode:'LIVE_READ_ONLY',positions:[],status:'UNAVAILABLE',canTrade:false,canChangeLimits:false};}
}
