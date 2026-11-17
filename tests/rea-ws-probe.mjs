// Read-only public exchange probe. No Supabase or exchange credentials.
import {PublicTickerCollector} from '../services/rea/streams.mjs';
const result=await new Promise((resolve,reject)=>{let settled=false;const collector=new PublicTickerCollector({onQuote:q=>{if(settled)return;settled=true;clearTimeout(timeout);collector.stop();resolve(q);}});
 const timeout=setTimeout(()=>{if(settled)return;settled=true;collector.stop();reject(Error('No valid public Bitkub WebSocket ticker received in 25 seconds'));},25000);
 collector.select(['BTC_THB','ETH_THB']);
});
console.log(JSON.stringify({probe:'BACKEND_PUBLIC_WEBSOCKET',symbol:result.symbol,source:result.source,receivedAt:result.receivedAt,validPrices:result.bid>0&&result.ask>=result.bid,authenticatedExchangeCalls:0}));
