// Independent stop monitor reads quotes and depth only; no candles, news or AI dependency.
export function createRiskQuotes({markets,json,rpc,clock=()=>Date.now(),useStream=false}){
 return async symbols=>{if(!symbols.length)return[];const all=await markets.all(),stream=useStream?await rpc('rea_market_quotes',{p_symbols:symbols}):[],map=new Map(stream.map(q=>[q.symbol,q]));
  const quotes=[];for(const symbol of symbols){const m=all.find(m=>m.symbol===symbol);if(!m)continue;const q=map.get(symbol);let book=null;
   try{const result=await json('https://api.bitkub.com/api/v3/market/depth?sym='+symbol.toLowerCase()+'&lmt=20');if(result.error===0&&Array.isArray(result.result?.asks)&&Array.isArray(result.result?.bids))book={...result.result,at:clock()};}catch{}
   quotes.push({...m,...(q&&clock()-q.observedAt<=30000?q:{}),depth:book});
  }return quotes;
 };
}
