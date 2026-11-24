// Observations only. Never changes orders, stops, permissions, wallet or risk limits.
import {quoteOK} from './rea-core.mjs';
export function executionDiagnostics(state,bundle,now){
 const positions=(state?.positions||[]).map(p=>{const m=bundle?.markets?.find(m=>m.symbol===p.symbol),fresh=quoteOK(m,now),minimum=m?.rules?.minQuote,knownMinimum=Number.isFinite(minimum)&&minimum>0,value=fresh?p.qty*m.bid:null,belowMinimum=fresh&&knownMinimum?value<minimum:null,stopTriggered=fresh?m.bid<=p.stop:null,pending=(state.orders||[]).filter(o=>o.symbol===p.symbol&&['RESERVED','SUBMITTING','OPEN','PARTIAL','UNKNOWN','CANCEL_PENDING'].includes(o.status));
  return{symbol:p.symbol,at:now,quoteAt:m?.observedAt??null,fresh,valueTHB:value,minimumQuoteTHB:knownMinimum?minimum:null,belowMinimum,stopTriggered,pending:pending.map(o=>({id:o.id,status:o.status,ageMs:now-o.createdAt})),reason:!fresh?'EXIT_QUOTE_STALE':!knownMinimum?'EXIT_MINIMUM_UNVERIFIED':belowMinimum?'EXIT_BELOW_MARKET_MINIMUM':pending.length?'EXISTING_ORDER_PENDING':'EXIT_MARKET_VALUE_SUFFICIENT',requiresOwnerReview:belowMinimum===true&&stopTriggered===true,policyChanged:false};
 });return{at:now,positions,issues:positions.filter(p=>p.reason!=='EXIT_MARKET_VALUE_SUFFICIENT'),method:'READ_ONLY_EXIT_FEASIBILITY',canTrade:false,policyChanged:false};
}
