// Codex can prioritize or avoid entries; numerical strategy and risk gates are final.
export function codexPlan(result,now=Date.now()){
 const unavailable={state:'WAITING',priority:[],avoid:[],actions:[],sessionId:null};
 if(!result||result.provider!=='OPENAI_CODEX_MANAGED_AGENT'||result.model!=='gpt-6.1-sol'||result.canTrade!==false||result.canChangeLimits!==false||!Number.isFinite(result.at)||!Number.isFinite(result.sourceAt)||result.at>now+5000||result.sourceAt>result.at||now-result.sourceAt>10800000||result.dataFresh!==true||!Array.isArray(result.actions)||result.actions.length>6||!/^sess_[A-Za-z0-9_-]{6,180}$/.test(result.sessionId||''))return unavailable;
 const actions=result.actions.filter(a=>/^[A-Z0-9]{1,20}_THB$/.test(a?.symbol)&&['WATCH','HOLD','REVIEW_ENTRY','REVIEW_EXIT'].includes(a.action)).map(a=>({symbol:a.symbol,action:a.action,reason:String(a.reason||'').slice(0,250)}));
 return{state:'ACTIVE',priority:[...new Set(actions.filter(a=>a.action==='REVIEW_ENTRY').map(a=>a.symbol))],avoid:[...new Set(actions.filter(a=>a.action==='REVIEW_EXIT').map(a=>a.symbol))],actions,sessionId:result.sessionId,at:result.at,sourceAt:result.sourceAt,summary:String(result.summary||'').slice(0,600),regime:result.regime,canTrade:false};
}
