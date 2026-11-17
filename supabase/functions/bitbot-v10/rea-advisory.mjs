// Public market context only. LLM output is added after orders are computed and never alters them.
export function createAdvisory({rpc,fetchFn=fetch,clock=()=>Date.now()}){
 return async(bundle,ranking)=>{
  const claim=await rpc('rea_advisory_claim',{});if(!claim?.allowed){const c=claim?.cached;return c&&Number.isFinite(c.at)&&clock()-c.at<=3600000&&c.at<=clock()+5000?{...c,status:'CACHED',canTrade:false,canChangeLimits:false}:{status:c?'STALE':claim?.reason||'NOT_CONFIGURED',canTrade:false};}
  if(claim.url!=='https://rea-bitkub-advisor.restartbykeita.workers.dev/analyze')throw Error('ADVISORY_HOST_DENIED');
  const body={mode:'PAPER_ONLY',headlines:(bundle?.news?.items||[]).slice(0,4).map(h=>({title:h.title,source:h.source,publishedAt:h.publishedAt,url:h.url})),markets:ranking.slice(0,3).map(r=>({symbol:r.symbol,score:r.score,regime:r.indicators?.regime}))};
  const r=await fetchFn(claim.url,{method:'POST',headers:{Authorization:'Bearer '+claim.token,'Content-Type':'application/json'},body:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(12000)});
  const data=await r.json();if(!r.ok||data.ok!==true||data.advice?.canTrade!==false)throw Error('ADVISORY_UNAVAILABLE');
  const a=data.advice;if(!['LOW','MEDIUM','HIGH','UNKNOWN'].includes(a.risk)||typeof a.summary!=='string'||!Number.isFinite(a.at)||a.at>clock()+5000||clock()-a.at>60000)throw Error('INVALID_ADVICE');
  const advice={status:'AVAILABLE',risk:a.risk,summary:a.summary.slice(0,600),sourceIds:(a.sourceIds||[]).filter(Number.isInteger).slice(0,4),evidence:(a.evidence||[]).slice(0,4),model:a.model,at:a.at,mode:'PAPER_ONLY',canTrade:false,canChangeLimits:false};
  await rpc('rea_advisory_finish',{p_advice:advice});return advice;
 };
}
