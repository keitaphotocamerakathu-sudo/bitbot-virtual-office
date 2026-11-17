// Public-data-only chronological walk-forward research. Never loads credentials or submits orders.
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {config,initial,paperCycle,heldSymbol} from '../assets/engine.mjs';
import {performance} from '../assets/intraday.mjs';
import {portfolioCycle} from '../assets/selection.mjs';
const DAY=86400000,STEP=300000;
const symbols=['BTC_THB','ETH_THB','XRP_THB','ADA_THB','SOL_THB','KUB_THB'];
const end=Math.floor(Date.now()/DAY)*DAY,start=end-20*DAY;
async function request(url){
 for(let attempt=0;attempt<3;attempt++){
  const r=await fetch(url,{signal:AbortSignal.timeout(25000)});
  if(r.status===429||r.status>=500){if(attempt<2){await new Promise(x=>setTimeout(x,1500*(attempt+1)));continue;}}
  if(!r.ok)throw Error('Historical API '+r.status);return r.json();
 }
 throw Error('Historical data unavailable');
}
async function history(symbol){
 const rows=new Map();
 for(let from=start;from<end;from+=5*DAY){
 const to=Math.min(end,from+5*DAY);
 const raw=await request('https://api.bitkub.com/tradingview/history?symbol='+symbol+'&resolution=5&from='+Math.floor(from/1000)+'&to='+Math.floor(to/1000));
 if(raw.s!=='ok'||!Array.isArray(raw.t)||!Array.isArray(raw.v))throw Error('Missing historical OHLCV '+symbol);
 for(let i=0;i<raw.t.length;i++){
 const b={t:Number(raw.t[i])*1000,o:Number(raw.o[i]),h:Number(raw.h[i]),l:Number(raw.l[i]),c:Number(raw.c[i]),v:Number(raw.v[i])};
 if(!Object.values(b).every(Number.isFinite)||b.o<=0||b.c<=0||b.l<=0||b.h<b.l||b.v<0)throw Error('Invalid OHLCV '+symbol);
 if(b.t>=start&&b.t<end)rows.set(b.t,b);
 }
 }
 const data=[...rows.values()].sort((a,b)=>a.t-b.t);
 if(data.length<20*288*.95)throw Error('Historical coverage too low '+symbol+': '+data.length);
 return data;
}
const data={};
for(let i=0;i<symbols.length;i+=2){await Promise.all(symbols.slice(i,i+2).map(async s=>{data[s]=await history(s);}));}
const metadata=await request('https://api.bitkub.com/api/v3/market/symbols');
if(metadata.error!==0)throw Error('Symbol rules unavailable');
const rules=Object.fromEntries(symbols.map(symbol=>{
 const m=metadata.result.find(x=>x.symbol===symbol);if(!m)throw Error('Symbol missing '+symbol);
 return[symbol,{minQuote:Number(m.min_quote_size),priceStep:Number(m.price_step),priceScale:Number(m.price_scale),qtyScale:Number(m.base_quantity_scale??m.base_asset_scale)}];
}));
const index=Object.fromEntries(symbols.map(s=>[s,new Map(data[s].map((b,i)=>[b.t,i]))]));
function quote(symbol,at){
 const i=index[symbol].get(at),rows=data[symbol];if(i===undefined||i<80)return null;
 const previous=rows.slice(Math.max(0,i-160),i),bar=rows[i],closed=previous.at(-1);
 if(closed.t+STEP!==at||previous.some((b,j)=>j&&b.t-previous[j-1].t!==STEP))return null;
 // Only already-closed candles enter indicators; fill proxy is the NEXT bar's open.
 const mid=bar.o,spread=.001;
 return{symbol,name:symbol.slice(0,-4),status:'active',last:mid,bid:mid*(1-spread/2),ask:mid*(1+spread/2),observedAt:at,
 volumeTHB:rows.slice(Math.max(0,i-288),i).reduce((v,b)=>v+b.v*b.c,0),change:0,preScore:20,rules:rules[symbol],
 candles:previous,depth:{at,asks:[[mid*(1+spread/2),1e9]],bids:[[mid*(1-spread/2),1e9]]},
 news:{ready:true,fetchedAt:at,blocked:false,score:0,headlines:[],method:'RESEARCH_NO_HISTORICAL_NEWS'}};
}
function simulate(from,to,maxHoldMinutes){
 const c=config({budget:10000,maxOrder:500,dailyBuy:1500,dailySell:5000,maxHoldMinutes}),capital=c.budget;
 let state=initial(c),peak=capital,drawdown=0,validSteps=0,skippedSteps=0,lastQuotes=[];
 for(let at=from;at<to;at+=STEP){
 const markets=symbols.map(s=>quote(s,at)).filter(Boolean);
 if(markets.length!==symbols.length){skippedSteps++;continue;}validSteps++;lastQuotes=markets;
 const out=portfolioCycle({markets,universeCount:symbols.length},state,c,at,true);
 if(out.error)throw Error(out.error);state=out.state;
 const p=performance(state,markets,c);peak=Math.max(peak,p.equity??state.cash);drawdown=Math.max(drawdown,1-(p.equity??state.cash)/peak);
 }
 if(!validSteps||skippedSteps/(validSteps+skippedSteps)>.05)throw Error('Too many missing simulation intervals');
 const p=performance(state,lastQuotes,c),daily=p.daily;
 return{net:p.totalNet,realized:p.realized,unrealized:p.unrealized,fees:p.fees,rounds:daily.reduce((n,d)=>n+d.rounds,0),
 profitableDays:daily.filter(d=>d.realized>0).length,days:(to-from)/DAY,maxDrawdown:drawdown,
 openPosition:heldSymbol(state),validSteps,skippedSteps};
}
const folds=[];
for(let fold=0;fold<3;fold++){
 const testFrom=end-(6-fold*2)*DAY,testTo=testFrom+2*DAY,trainFrom=testFrom-14*DAY;
 const trained=[60,30,120].map(maxHoldMinutes=>({maxHoldMinutes,metrics:simulate(trainFrom,testFrom,maxHoldMinutes)}));
 trained.sort((a,b)=>b.metrics.net-a.metrics.net||a.metrics.maxDrawdown-b.metrics.maxDrawdown);
 const selected=trained[0],result=simulate(testFrom,testTo,selected.maxHoldMinutes);
 folds.push({from:new Date(testFrom).toISOString().slice(0,10),to:new Date(testTo).toISOString().slice(0,10),
 trainFrom:new Date(trainFrom).toISOString().slice(0,10),trainTo:new Date(testFrom).toISOString().slice(0,10),
 maxHoldMinutes:selected.maxHoldMinutes,trainNet:selected.metrics.net,training:trained.map(x=>({maxHoldMinutes:x.maxHoldMinutes,net:x.metrics.net})),...result});
}
const report={version:'12.0.0',generatedAt:new Date().toISOString(),from:new Date(start).toISOString().slice(0,10),to:new Date(end).toISOString().slice(0,10),
 symbols,capitalPerFold:10000,totalNet:folds.reduce((s,f)=>s+f.net,0),folds,
 dataDigest:createHash('sha256').update(JSON.stringify(data)).digest('hex'),
 coverage:Object.fromEntries(symbols.map(s=>[s,data[s].length])),
 source:'https://api.bitkub.com/tradingview/history',
 assumptions:{feePerSide:.0025,spread:.001,slippagePerSide:.0005,fill:'Next five-minute open after closed-candle signal; immediate fill proxy',depth:'Simulated ample depth; no historical book',news:'Neutral bypass; historical news unavailable',rules:'Current symbol rules, not point-in-time historical rules',universe:'Six coins fixed before the run; excludes delisted assets; not full dynamic universe',evaluation:'Three consecutive two-day holdouts, each after 14-day training; choose holding time only on training',dailyTimezone:'Asia/Bangkok',boundary:'UTC fold boundaries; realized-day counts use Bangkok dates',net:'Includes estimated exit fee for any open position at fold end; no fabricated forced trade'},
 limitations:['No queue position or partial fills; immediate simulated executions may overestimate fill availability','Five-minute stop checks may miss intra-candle adverse moves; live engine checks each minute','Six-asset survivor universe, current rules and synthetic depth do not validate the full production system','Holdout results are never used to retune parameters or to activate live trading']};
await fs.writeFile('assets/backtest-v12.json',JSON.stringify(report,null,2)+'\n');
console.log('BACKTEST_JSON='+JSON.stringify(report));
