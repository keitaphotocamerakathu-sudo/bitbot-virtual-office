// Development comparison only. No credentials, private API, exchange writes or activation.
import fs from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {config,initial,applyFill,heldSymbol,roundUnit,strategyAgent,trendAgent} from '../assets/engine.mjs';
import {portfolioCycle} from '../assets/selection.mjs';
import {adaptivePortfolioCycle,NET_POLICY} from '../assets/adaptive.mjs';
import {rollDay,performance} from '../assets/intraday.mjs';
import {indicators,resample} from '../assets/technical.mjs';
import {closedStatistics} from '../assets/reporting.mjs';
const protocol=JSON.parse(await fs.readFile('research/protocol-v16.json','utf8'));
const dataset=JSON.parse(gunzipSync(await fs.readFile('research/data-v13.json.gz'))),DAY=86400000,STEP=300000,HOUR=3600000;
const end=dataset.end,start=end-protocol.days*DAY,split=end-protocol.validationDays*DAY;
const indexes=Object.fromEntries(protocol.symbols.map(s=>[s,new Map(dataset.data[s].map((b,i)=>[b.t,i]))]));
const hours=Object.fromEntries(protocol.symbols.map(s=>[s,resample(dataset.data[s],60,end)])),hourCache=new Map();
const rawHash=createHash('sha256').update(JSON.stringify(dataset.data)).digest('hex');if(rawHash!==dataset.digest)throw Error('Historical data digest mismatch');
const roundFee=(n,rate)=>Math.ceil(n*rate*100-1e-10)/100;
function hourly(symbol,at){const key=symbol+':'+Math.floor(at/HOUR);if(hourCache.has(key))return hourCache.get(key);const bars=hours[symbol].filter(b=>b.t+HOUR<=at).slice(-240),f=indicators(bars,60,at);hourCache.set(key,f);return f;}
function quotes(at,costs){const markets=[];for(const symbol of protocol.symbols){const rows=dataset.data[symbol],i=indexes[symbol].get(at);if(i===undefined||i<160)continue;const bars=rows.slice(i-160,i),last=bars.at(-1);if(last.t+STEP!==at||bars.slice(-25).some((b,j,a)=>j&&b.t-a[j-1].t!==STEP))continue;const mid=last.c;
 markets.push({symbol,name:symbol.slice(0,-4),status:'active',last:mid,bid:mid*(1-costs.spread/2),ask:mid*(1+costs.spread/2),observedAt:at,preScore:20,volumeTHB:rows.slice(Math.max(0,i-288),i).reduce((v,b)=>v+b.v*b.c,0),change:0,rules:dataset.rules[symbol],candles:bars,depth:{at,asks:[[mid*(1+costs.spread/2),1e9]],bids:[[mid*(1-costs.spread/2),1e9]]},news:{ready:true,fetchedAt:at,blocked:false,score:0,headlines:[],method:'DEVELOPMENT_NEUTRAL_NEWS'},nextOpen:rows[i].o,hourly:hourly(symbol,at)});
 }return markets;}
function makeCase(candidate,planner,capital,costs){const small=capital<100,c=config({strategyProfile:candidate.profile,entryPlanner:planner,maxHoldMinutes:candidate.hold,budget:Math.max(100,capital),maxOrder:small?100:500,dailyBuy:small?100:1500,dailySell:small?100:5000,fee:costs.fee,slippage:costs.slippage});return{candidate,planner,capital,costs,c,state:{...initial(c),cash:capital,peak:capital,startCapital:capital,dayStart:capital},credit:costs.entryCredit?1000:0,rounds:[],roundBase:0,buys:0,sells:0,missed:0,valid:0,skipped:0,maxDD:0,peak:capital,blocked:{},lastQuotes:[],feeGross:0,creditUsed:0};}
function step(row,marketRows,at,signals){const held=heldSymbol(row.state),all=marketRows;if(!all.length||(held&&!all.some(m=>m.symbol===held))){row.skipped++;return;}row.valid++;row.lastQuotes=all;
 if(!held&&!all.some(m=>signals.get(m.symbol+':'+row.c.strategyProfile)==='BUY')){row.state=rollDay(row.state,at,row.state.cash);row.blocked.SIGNAL=(row.blocked.SIGNAL||0)+1;return;}
 const markets=all.map(m=>({...m,feeCredits:{ready:true,available:row.credit,at}}));const out=row.planner==='net-v16'?adaptivePortfolioCycle({markets,universeCount:6},row.state,row.c,at):portfolioCycle({markets,universeCount:6},row.state,row.c,at);if(out.error){row.skipped++;return;}
 row.state=out.state;const risk=out.trace.find(x=>x.agent==='risk');for(const reason of risk?.blocked||[])row.blocked[reason]=(row.blocked[reason]||0)+1;
 const order=out.order,m=out.market;
 if(order?.side==='BUY'&&(!m.hourly.ready||m.hourly.regime==='DOWNTREND')){row.blocked.HOURLY=(row.blocked.HOURLY||0)+1;}
 else if(order){const nextAsk=m.nextOpen*(1+row.costs.spread/2),nextBid=m.nextOpen*(1-row.costs.spread/2),fillable=order.side==='BUY'?nextAsk<=order.price+1e-10:nextBid>=order.price-1e-10;
  if(fillable){const gross=roundFee(order.side==='BUY'?order.amount:order.amount*order.price,row.c.fee),credit=order.side==='BUY'?Math.min(gross,row.credit):0,cashFee=gross-credit,qty=order.side==='BUY'?roundUnit((order.amount-cashFee)/order.price,order.qtyScale):order.amount,wasHeld=row.state.qty>0;
   row.state=applyFill(row.state,{at,side:order.side,symbol:order.symbol,qtyScale:order.qtyScale,qty,price:order.price,fee:cashFee,strategy:order.strategy,entryPolicy:order.entryPolicy,...(order.side==='BUY'?{spend:order.amount}:{})},row.c);row.credit-=credit;row.creditUsed+=credit;row.feeGross+=gross;if(order.side==='BUY')row.buys++;else row.sells++;
   if(wasHeld&&row.state.qty===0){row.rounds.push(row.state.realized-row.roundBase);row.roundBase=row.state.realized;}
  }else row.missed++;
 }
 const p=performance(row.state,all,row.c);if(p.equity!==null){row.peak=Math.max(row.peak,p.equity);row.maxDD=Math.max(row.maxDD,1-p.equity/row.peak);}
}
function summary(r){const p=performance(r.state,r.lastQuotes,r.c),s=closedStatistics(r.rounds),coverage=r.valid/Math.max(1,r.valid+r.skipped);return{profile:r.c.strategyProfile,hold:r.c.maxHoldMinutes,planner:r.planner,capital:r.capital,costCase:r.costs.name,coverage,status:coverage>=.9?'DEVELOPMENT_ONLY':'INSUFFICIENT_DATA',net:coverage>=.9?p.totalNet:null,realized:p.realized,unrealized:p.unrealized,cashFees:p.fees,grossFees:r.feeGross,creditUsed:r.creditUsed,rounds:s.rounds,profitFactor:s.profitFactor,noLosingSamples:s.noLosingSamples,winRate:s.winRate,maxDrawdown:r.maxDD,buyFills:r.buys,sellFills:r.sells,unfilledProxy:r.missed,openPosition:heldSymbol(r.state),waitingReasons:r.blocked,days:p.daily.length,profitableDays:p.daily.filter(d=>d.realized>0).length};}
async function phase(from,to){const cases=protocol.costCases.flatMap(costs=>protocol.capitalCases.flatMap(capital=>protocol.candidates.flatMap(candidate=>protocol.planners.map(planner=>makeCase(candidate,planner,capital,costs)))));
 for(let at=from;at<to;at+=STEP){const groups=new Map(protocol.costCases.map(costs=>[costs.name,quotes(at,costs)])),signals=new Map();for(const m of groups.values().next().value){const t=trendAgent(m);for(const candidate of protocol.candidates)signals.set(m.symbol+':'+candidate.profile,strategyAgent(m,t,{qty:0,lessons:{}},{strategyProfile:candidate.profile}).signal);}
  for(const row of cases)step(row,groups.get(row.costs.name),at,signals);
  if((at-from)%(7*DAY)===0)console.log('Development replay '+new Date(at).toISOString().slice(0,10));
 }return cases.map(summary);}
const training=await phase(start,split),eligible=training.filter(r=>r.costCase==='STANDARD_FEES'&&r.capital===protocol.capitalCases[0]&&r.coverage>=.9&&r.rounds>=protocol.selection.minRounds&&r.net>0&&(r.profitFactor>=protocol.selection.profitFactor||r.noLosingSamples)&&r.maxDrawdown<=protocol.selection.maxDrawdown).sort((a,b)=>b.net-a.net);
const selected=eligible[0]?{profile:eligible[0].profile,hold:eligible[0].hold,planner:eligible[0].planner}:null;console.log('Frozen training choice '+JSON.stringify(selected));
const validation=await phase(split,end),sources=['assets/engine.mjs','assets/intraday.mjs','assets/strategies.mjs','assets/selection.mjs','assets/adaptive.mjs','research/compare-v16.mjs','research/protocol-v16.json','assets/technical.mjs'];
const report={version:'16.0.0',generatedAt:new Date().toISOString(),protocol,policy:NET_POLICY,dataDigest:dataset.digest,codeDigest:createHash('sha256').update((await Promise.all(sources.map(p=>fs.readFile(p,'utf8')))).join('\n')).digest('hex'),sourceFiles:sources,from:new Date(start).toISOString(),split:new Date(split).toISOString(),to:new Date(end).toISOString(),training,selected,validation,liveApproved:false,
 decision:selected?'มีตัวเลือกผ่านช่วงฝึก แต่เป็นข้อมูลพัฒนา ต้องประเมินผลเดินหน้าจริง':'ยังไม่มีตัวเลือกผ่านช่วงฝึกที่ทุนเล็ก ไม่ถือว่าพิสูจน์กำไร',
 limitations:['Previously examined dates are development replay, not a new blind holdout or a profit guarantee.','Six surviving coins/current metadata, synthetic spread/ample depth and neutral news do not reproduce the full live universe or historical order books.','Signal uses closed candles; a fill is only allowed at the limit on the next bar open if marketable. Queue position, partial fills and the real two-minute lifetime are unobserved.','Five-minute risk checks can miss intra-candle adverse moves. All exits pay full fees; entry-credit cases start with a hypothetical 1000 THB credit budget.','Gross target is an inferred price move, never a forecast. No account, risk setting or approval is changed by this report.']};
await fs.writeFile('assets/research-v16.json',JSON.stringify(report,null,2)+'\n');console.log('V16_RESULT='+JSON.stringify({selected,decision:report.decision,smallCapitalValidation:validation.filter(r=>r.capital===protocol.capitalCases[0]).map(({profile,hold,planner,costCase,net,rounds,buyFills,maxDrawdown})=>({profile,hold,planner,costCase,net,rounds,buyFills,maxDrawdown}))}));
