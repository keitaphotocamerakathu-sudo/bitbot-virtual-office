export function createStreamingMarket({base,rpc,clock=()=>Date.now()}){
 return{...base,async scan(held=[]){const bundle=await base.scan(held),quotes=await rpc('rea_market_quotes',{p_symbols:bundle.markets.map(m=>m.symbol)}),map=new Map(quotes.map(q=>[q.symbol,q]));
  return{...bundle,markets:bundle.markets.map(m=>{const q=map.get(m.symbol),ready=!!q&&clock()-q.observedAt<=30000&&q.observedAt<=clock()+5000;
   return{...m,...(ready?q:{}),wsReady:ready};}),feed:'BACKEND_WEBSOCKET_WITH_REST_DEPTH'};
 }};
}
