// Forward paper execution only. This module has no credential, HTTP, or exchange-write capability.
import {config,initial,applyFill,roundUnit,validMarket} from './engine.mjs';
import {portfolioCycle} from './selection.mjs';
export const SHADOW_CANDIDATES=Object.freeze(['trend-confirmed','volume-breakout','range-reversion'].flatMap(profile=>[60,120].map(hold=>({key:profile+':'+hold,profile,hold}))));
export function shadowConfig(base,candidate){return config({...base,buyPaused:false,strategyProfile:candidate.profile,maxHoldMinutes:candidate.hold});}
export function shadowInitial(c,capital){return{state:{...initial(c),cash:capital,peak:capital,dayStart:capital,startCapital:capital},pending:null,lastAt:0,roundPnls:[],fillCount:0};}
function fillable(order,market,now){
 const rows=order.side==='BUY'?market.depth?.asks:market.depth?.bids;
 if(!rows?.length||!Number.isFinite(market.depth.at)||now-market.depth.at>25000||market.depth.at>now+5000)return false;
 let capacity=0;
 for(const [price,qty] of rows){if(![price,qty].every(Number.isFinite)||price<=0||qty<=0)return false;
 if(order.side==='BUY'?price<=order.price:price>=order.price)capacity+=order.side==='BUY'?price*qty:qty;}
 return capacity>=(order.side==='BUY'?order.amount:order.amount)-1e-10;
}
export function shadowStep(bundle,record,c,now=Date.now()){
 const r=structuredClone(record),events=[];r.lastAt=now;
 if(r.pending){
  const p=r.pending,m=bundle.markets?.find(x=>x.symbol===p.order.symbol),age=now-p.at;
  if(age>=120000){r.pending=null;events.push({kind:'CANCELED',reason:'คำสั่งจำลองไม่จับคู่ภายใน 2 นาที',at:now,symbol:p.order.symbol});return{record:r,events};}
  if(age<=0||!m)return{record:r,events};
  try{validMarket(m,now);r.lastMarketAt=m.observedAt;r.error=null;}catch{r.error='ราคาหรือแท่งเทียนหมดอายุ';return{record:r,events};}
  const order=p.order,marketable=order.side==='BUY'?m.ask<=order.price:m.bid>=order.price;
  if(!marketable||!fillable(order,m,now))return{record:r,events};
  const fee=Math.ceil((order.side==='BUY'?order.amount:order.amount*order.price)*c.fee*100)/100;
  const qty=order.side==='BUY'?roundUnit((order.amount-fee)/order.price,order.qtyScale):Math.min(order.amount,r.state.qty);
  const oldRealized=r.state.realized,oldQty=r.state.qty;
  r.state=applyFill(r.state,{side:order.side,symbol:order.symbol,qtyScale:order.qtyScale,qty,price:order.price,fee,at:now,strategy:order.strategy,entryPolicy:order.entryPolicy,...(order.side==='BUY'?{spend:order.amount}:{})},c);
  if(order.side==='BUY'&&oldQty===0)r.roundStart=oldRealized;
  if(order.side==='SELL'&&r.state.qty===0){r.roundPnls=[...(r.roundPnls||[]),r.state.realized-(r.roundStart??0)].slice(-2000);r.roundStart=r.state.realized;}
  r.pending=null;r.fillCount=(r.fillCount||0)+1;
  events.push({kind:'FILL',at:now,symbol:order.symbol,side:order.side,qty,price:order.price,fee,realized:r.state.realized-oldRealized,reason:order.reason,execution:'NEXT_SNAPSHOT_LIMIT_PROXY'});
  return{record:r,events};
 }
 const out=portfolioCycle(bundle,r.state,c,now);r.state=out.state;r.trace=out.trace;r.error=out.error||null;if(!out.error&&out.market)r.lastMarketAt=out.market.observedAt;
 if(out.order){r.pending={order:out.order,at:now};events.push({kind:'ORDER',at:now,...out.order,execution:'PAPER_ONLY'});}
 return{record:r,events};
}
