// Fixed, owner-approved capital protection. No LLM, network or trade authority.
export const CAPITAL_GUARD='CAPITAL_GUARD_28';
export const RISK_POLICY_SPEC='REA-RISK-28.0';
export const GUARD_RULES=Object.freeze({lossThreshold:.015,cautiousScale:.5,cashReserve:.30,positionFraction:.20,exposureFraction:.70,lossesBeforePause:3,lossWindowMs:86400000,cooldownMs:3600000,fee:.0025,slippage:.002,roundingReserve:.10});
const down=n=>Math.floor((n+1e-9)*100)/100,up=n=>Math.ceil((n-1e-9)*100)/100;
export function guardedRisk(s){
 if(![undefined,null,'LEGACY',CAPITAL_GUARD].includes(s?.riskProfile))throw Error('INVALID_LIVE_RISK_PROFILE');
 return s?.riskProfile===CAPITAL_GUARD;
}
export function guardScale(s){return guardedRisk(s)&&s.dayPnl<=-s.dayStart*GUARD_RULES.lossThreshold?GUARD_RULES.cautiousScale:1;}
export function capitalGuard(s,now=Date.now()){
 if(!guardedRisk(s))return null;
 if(![s.dayStart,s.equity,s.dayPnl,s.dayFlows,s.allocatedCapital].every(Number.isFinite)||s.dayStart<=0||s.equity<0||Math.abs(s.dayPnl-(s.equity-s.dayStart-s.dayFlows))>.020000001||!Number.isFinite(now))throw Error('INVALID_LIVE_GUARD_STATE');
 const base=Math.max(0,Math.min(10000,s.allocatedCapital,s.dayStart,s.equity));
 const closed=(s.closed||[]).filter(t=>Number.isFinite(t.pnl)&&Number.isFinite(t.closedAt)&&t.closedAt<=now&&t.closedAt>now-GUARD_RULES.lossWindowMs).sort((a,b)=>b.closedAt-a.closedAt||String(b.id||'').localeCompare(String(a.id||'')));let consecutiveLosses=0;
 for(const t of closed){if(t.pnl>=0)break;consecutiveLosses++;}
 const cooldownUntil=consecutiveLosses>=GUARD_RULES.lossesBeforePause?closed[0].closedAt+GUARD_RULES.cooldownMs:null;
 return{profile:CAPITAL_GUARD,spec:RISK_POLICY_SPEC,at:now,capitalBase:down(base),riskScale:guardScale(s),cautious:s.dayPnl<=-s.dayStart*GUARD_RULES.lossThreshold,cautiousThresholdTHB:up(s.dayStart*GUARD_RULES.lossThreshold),cashReserveTHB:up(base*GUARD_RULES.cashReserve),consecutiveLosses,cooldownUntil,cooldownActive:cooldownUntil!==null&&now<cooldownUntil,rules:GUARD_RULES};
}
export function stopExitEstimate({amount,limit,stop,qtyScale},minQuote){
 if(![amount,limit,stop,minQuote].every(Number.isFinite)||amount<=0||limit<=0||stop<=0||stop>=limit||minQuote<10||!Number.isInteger(qtyScale)||qtyScale<0||qtyScale>8)return{allowed:false,reason:'INVALID_EXIT_ESTIMATE',stopExitQuote:null};
 const entryFee=up(amount*GUARD_RULES.fee)+GUARD_RULES.roundingReserve,scale=10**qtyScale;
 const quantity=Math.max(0,Math.floor(((amount-entryFee)/limit+1e-12)*scale)/scale),stopExitQuote=down(quantity*stop*(1-GUARD_RULES.slippage));
 return{allowed:stopExitQuote>=minQuote,reason:stopExitQuote>=minQuote?'RISK_APPROVED':'STOP_EXIT_BELOW_MINIMUM',stopExitQuote,minQuote,entryFeeReserve:up(entryFee),assumption:'FULL_FILL_AT_LIMIT_WITH_FEE_SLIPPAGE_AND_ROUNDING_RESERVES'};
}
export function minimumExitSafeEntry({limit,stop,qtyScale},minQuote){
 if(![limit,stop,minQuote].every(Number.isFinite)||limit<=0||stop<=0||stop>=limit||minQuote<10||!Number.isInteger(qtyScale)||qtyScale<0||qtyScale>8)return null;
 const scale=10**qtyScale,neededQty=Math.ceil(minQuote/(stop*(1-GUARD_RULES.slippage))*scale)/scale;
 // Extra satang covers the ceiling of the entry fee. This is an advice estimate,
 // never permission to raise an actual order above its risk budget.
 return up((neededQty*limit+GUARD_RULES.roundingReserve+.01)/(1-GUARD_RULES.fee));
}
