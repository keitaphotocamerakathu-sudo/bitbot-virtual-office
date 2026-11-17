// Cost-aware intraday policies, daily accounting and bounded article extraction.
export const INTRADAY_DEFAULTS=Object.freeze({intraday:true,maxHoldMinutes:60,dailyProfitTarget:.01,maxEntries:3,lossStreakLimit:2,cooldownMinutes:60,minNetRR:1.2,minNetProfit:.003,slippage:.0005,maxDepthImpact:.0015,minRangeCostRatio:1.5});
export const STABLE_ASSETS=new Set(['USDT','USDC','DAI','USDS','TUSD','FDUSD','PYUSD','USDE']);
export const dayKey=ms=>new Date(ms+25200000).toISOString().slice(0,10);
export function rollDay(state,now,equity=state.cash){
 const s=structuredClone(state),day=dayKey(now);
 if(day!==s.day){s.day=day;s.dayPnl=0;s.bought=0;s.sold=0;s.entriesToday=0;s.dayStart=equity;}
 s.daily??={};s.daily[day]??={realized:0,fees:0,entries:0,rounds:0,wins:0,losses:0};
 return s;
}
export function bookImpact(book,notional,now){
 if(!book||!Number.isFinite(book.at)||now-book.at>25000||book.at>now+5000)return{ready:false,reason:'ความลึกตลาดไม่พร้อมหรือเก่าเกิน 25 วินาที'};
 function walk(rows,buy){
  if(!Array.isArray(rows)||!rows.length)return null;
  let remaining=notional,qty=0,value=0,prev=buy?0:Infinity;
  for(const row of rows){
   const [p,q]=row;if(!Number.isFinite(p)||!Number.isFinite(q)||p<=0||q<=0||(buy?p<prev:p>prev))return null;prev=p;
   const quote=Math.min(remaining,p*q);qty+=quote/p;value+=quote;remaining-=quote;
   if(remaining<1e-8)break;
  }
  const best=rows[0][0],vwap=value/qty;
  return{covered:remaining<.005,impact:buy?vwap/best-1:1-vwap/best,available:rows.reduce((v,[p,q])=>v+p*q,0)};
 }
 const buy=walk(book.asks,true),sell=walk(book.bids,false);
 if(!buy||!sell)return{ready:false,reason:'สมุดคำสั่งผิดรูปแบบ'};
 return{ready:true,covered:buy.covered&&sell.covered,buyImpact:Math.max(0,buy.impact),sellImpact:Math.max(0,sell.impact),buyDepth:buy.available,sellDepth:sell.available};
}
export function entryPlan(m,c,notional,now=Date.now()){
 const spread=(m.ask-m.bid)/m.last,book=bookImpact(m.depth,notional,now);
 const fee=notional>0?Math.ceil(notional*c.fee*100)/100/notional:c.fee;
 const cost=2*fee+spread+2*c.slippage+(book.ready?book.buyImpact+book.sellImpact:0);
 const bars=m.candles.slice(-12),high=Math.max(...bars.map(b=>Number.isFinite(b.h)?b.h:b.c)),low=Math.min(...bars.map(b=>Number.isFinite(b.l)?b.l:b.c));
 const range=high/low-1,atr=m.atrPct||0;
 const stop=c.intraday?Math.min(c.stopLoss,Math.max(.005,atr*2)):c.stopLoss;
 const target=c.intraday?Math.min(c.takeProfit,Math.max(stop*2,(stop+cost)*c.minNetRR+cost+c.minNetProfit)):c.takeProfit;
 const netReward=target-cost,netRisk=stop+cost,netRR=netReward/netRisk;
 const reasons=[];
 if(c.intraday){
  if(STABLE_ASSETS.has(m.symbol.slice(0,-4)))reasons.push('เหรียญตรึงมูลค่าไม่เหมาะกับรอบเทรดสั้น');
  if(!book.ready)reasons.push(book.reason);
  else if(!book.covered||book.buyImpact>c.maxDepthImpact||book.sellImpact>c.maxDepthImpact)reasons.push('ความลึกซื้อขายไม่พอสำหรับวงเงินนี้');
  if(!Number.isFinite(range)||range<cost*c.minRangeCostRatio||target>range*1.5)reasons.push('ช่วงราคา 1 ชั่วโมงไม่พอชดเชยต้นทุนและเป้าขาย');
 }
 if(!Number.isFinite(netRR)||netRR<c.minNetRR||netReward<c.minNetProfit)reasons.push('กำไรสุทธิเทียบความเสี่ยงหลังต้นทุนไม่ผ่านเกณฑ์');
 return{stopLoss:stop,takeProfit:netReward,grossTarget:target,netReward,netRisk,netRR,cost,range,book,maxHoldMinutes:c.intraday?c.maxHoldMinutes:0,reasons};
}
export function dailyBlocks(s,c,now){
 const reasons=[];
 if(c.dailyProfitTarget>0&&s.dayPnl>=s.dayStart*c.dailyProfitTarget)reasons.push('ถึงเป้ากำไรสุทธิรายวัน พักซื้อใหม่');
 if((s.entriesToday||0)>=c.maxEntries)reasons.push('ครบจำนวนเข้าเทรดสูงสุดต่อวัน');
 if((s.cooldownUntil||0)>now)reasons.push('พักหลังขาดทุนต่อเนื่องถึง '+new Date(s.cooldownUntil).toISOString());
 return reasons;
}
export function performance(s,quotes=[],c={fee:.0025}){
 const symbol=s.qty>0?(s.symbol||'BTC_THB'):null,m=quotes.find(m=>m.symbol===symbol);
 const fee=s.qty>0&&m?Math.ceil(s.qty*m.bid*c.fee*100)/100:0;
 const unrealized=s.qty>0?(m?s.qty*m.bid-fee-s.cost:null):0;
 const equity=s.qty>0?(m?s.cash+s.qty*m.bid:null):s.cash;
 return{realized:s.realized||0,unrealized,estimatedExitFee:fee,fees:s.fees||0,equity,
 totalNet:unrealized===null?null:(s.realized||0)+unrealized,
 daily:Object.entries(s.daily||{}).sort((a,b)=>a[0].localeCompare(b[0])).map(([day,v])=>({day,...v}))};
}
export function extractArticle(html){
 if(typeof html!=='string'||html.length>1500000)return{body:'',method:'UNREADABLE'};
 const clean=s=>s.replace(/<script\b[\s\S]*?<\/script>|<style\b[\s\S]*?<\/style>/gi,' ').replace(/<[^>]*>/g,' ').replace(/&nbsp;|&#160;/g,' ').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/\s+/g,' ').trim();
 let body='';
 function search(x,depth=0){if(!x||depth>8)return;if(Array.isArray(x)){for(const y of x)search(y,depth+1);}else if(typeof x==='object'){if(typeof x.articleBody==='string'&&x.articleBody.length>body.length)body=x.articleBody;for(const [k,v] of Object.entries(x))if(k!=='articleBody'&&typeof v==='object')search(v,depth+1);}}
 for(const match of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)){try{search(JSON.parse(match[1]));}catch{}}
 if(body.length>=200)return{body:clean(body).slice(0,10000),method:'JSON_LD_ARTICLE'};
 for(const match of html.matchAll(/<article\b([^>]*)>([\s\S]*?)<\/article>/gi)){
 if(/article-card|group\/card|related|recommend/i.test(match[1]))continue;
 body=clean(match[2]);if(body.length>=200)return{body:body.slice(0,10000),method:'HTML_ARTICLE'};
 }
 return{body:'',method:'HEADLINE_ONLY'};
}
