// Mutually exclusive evaluation stages; counts are checks, never trades or proof of profit.
import {STRATEGIES} from './master-config.mjs';
const CONFIG=new Set(['STRATEGY_DISABLED','TIMEFRAME_DISABLED','MASTER_ENTRY_PAUSED']);
const DATA=new Set(['MARKET_NOT_READY','TIMEFRAME_DATA_INSUFFICIENT','STALE_OR_INVALID_MARKET','PRICE_ANOMALY','CANDLE_QUALITY']);
export const DIAGNOSTIC_STAGES=Object.freeze(['CONFIG_PAUSED','DATA_BLOCKED','SIGNAL_NOT_TRIGGERED','RISK_BLOCKED','PAPER_BUY_APPROVED']);
const empty=()=>Object.fromEntries(DIAGNOSTIC_STAGES.map(k=>[k,0]));
export function decisionStage(d){
 if(d.action==='BUY'&&d.riskApproval?.approved===true)return'PAPER_BUY_APPROVED';
 const reasons=d.reasons||[];if(reasons.some(r=>CONFIG.has(r)))return'CONFIG_PAUSED';if(reasons.some(r=>DATA.has(r)))return'DATA_BLOCKED';
 return d.eligible===true?'RISK_BLOCKED':'SIGNAL_NOT_TRIGGERED';
}
export function entryEvidence(m,analysis,signal){
 const frames=Object.fromEntries([signal.timeframe,signal.confirmationTimeframe].map(n=>{const f=analysis?.frames?.[n];return[n,{ready:f?.ready===true,bars:f?.barCount??0,at:f?.lastClosedAt??null,regime:f?.regime??null,rsi:f?.rsi??null,adx:f?.adx??null}];}));
 const x=analysis?.intelligence;return{quoteAt:m?.observedAt??null,bookAt:m?.depth?.at??null,bid:m?.bid??null,ask:m?.ask??null,last:m?.last??null,volumeTHB:m?.volumeTHB??null,spread:x?.spread??null,marketReady:x?.ready===true,marketReasons:x?.reasons||[],frames};
}
export function diagnoseEntries(book,decisions,now,scan=null){
 const entries=decisions.filter(d=>d.riskApproval),stages=empty(),byStrategy=STRATEGIES.map(s=>({strategyId:s.id,evaluated:0,...empty()})),nearMisses=[];
 for(const d of entries){d.diagnosticStage=decisionStage(d);stages[d.diagnosticStage]++;const row=byStrategy.find(s=>s.strategyId===d.strategyId);if(row){row.evaluated++;row[d.diagnosticStage]++;}if(d.action==='WAIT'&&d.reasons?.length===1)nearMisses.push({symbol:d.symbol,strategyId:d.strategyId,reason:d.reasons[0],stage:d.diagnosticStage});}
 const source=book.entryDiagnostics,valid=source?.protocol==='PAPER_DIAG_31.0.2'&&[source.since,source.cycles,source.evaluated,...DIAGNOSTIC_STAGES.map(k=>source.stages?.[k])].every(n=>Number.isSafeInteger(n)&&n>=0),prior=valid?source:null,lifetime=prior?structuredClone(prior):{protocol:'PAPER_DIAG_31.0.2',since:now,cycles:0,evaluated:0,stages:empty()};
 lifetime.cycles++;lifetime.evaluated+=entries.length;for(const k of DIAGNOSTIC_STAGES)lifetime.stages[k]+=stages[k];book.entryDiagnostics=lifetime;
 return{at:now,unit:'EVALUATION_CHECKS_NOT_TRADES',evaluated:entries.length,stages,byStrategy,nearMisses:nearMisses.slice(0,12),lifetime,scan,canTrade:false};
}
