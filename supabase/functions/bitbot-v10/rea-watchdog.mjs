import {cycleREA,analyticsREA} from './rea-core.mjs';
export function createRiskWatchdog({rpc,quotes,clock=()=>Date.now()}){
 async function run(){
  const accounts=await rpc('rea_risk_accounts',{}),results=[];
  const symbols=[...new Set(accounts.flatMap(a=>[...a.state.positions.map(p=>p.symbol),...a.state.orders.filter(o=>['OPEN','PARTIAL'].includes(o.status)).map(o=>o.symbol)]))];
  let markets=[],error=null;try{markets=await quotes(symbols);}catch(e){error=String(e.message||'QUOTE_UNAVAILABLE').slice(0,120);}
  for(const account of accounts){const now=clock(),out=cycleREA(account.state,{markets},now,{riskOnly:true,operationalLock:account.operational_lock===true});
   const actionable=out.fills.length>0||out.events.some(e=>['ORDER','CANCEL','DAILY_LOSS_LOCK'].includes(e.kind))||out.events.some(e=>e.kind==='EMERGENCY_STOP')&&account.state.orders.some(o=>['OPEN','PARTIAL'].includes(o.status));
   const health=!symbols.length?'IDLE':error?'SAFE_MODE':out.health;
   let committed=false;if(actionable){const latest={...account.latest,summary:analyticsREA(out.state),watchdog:{at:now,health,events:out.events},quotes:markets.map(m=>({symbol:m.symbol,bid:m.bid,ask:m.ask,at:m.observedAt,source:m.source})),lane:'risk-watchdog'};
    committed=await rpc('rea_risk_checkpoint',{p_uid:account.user_id,p_revision:account.revision,p_state:out.state,p_latest:latest,p_events:out.events,p_fills:out.fills,p_at:now});}
   await rpc('rea_risk_heartbeat',{p_uid:account.user_id,p_at:now,p_status:health});results.push({actionable,committed,health});
  }
  return{mode:'PAPER_ONLY',accounts:accounts.length,results};
 }
 return{run};
}
