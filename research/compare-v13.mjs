// Preregistered research. No credential access, exchange writes, or automatic live activation.
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {loadData,protocol,DAY,STEP} from './data-v13.mjs';
import {config,initial,heldSymbol} from '../assets/engine.mjs';
import {profileStrategy} from '../assets/strategies.mjs';
import {rollDay,performance} from '../assets/intraday.mjs';
import {portfolioCycle} from '../assets/selection.mjs';
const iso=t=>new Date(t).toISOString().slice(0,10);
export function profitFactor(pnls){const gain=pnls.reduce((v,p)=>v+Math.max(0,p),0),loss=pnls.reduce((v,p)=>v+Math.max(0,-p),0);return loss?gain/loss:gain?99:0;}
export function trainingEligible(m){const r=protocol.trainingRequirements;return m.status==='QUALIFIED'&&m.rounds>=r.minRounds&&m.net>0&&m.profitFactor>=r.profitFactor&&m.maxDrawdown<=r.maxDrawdown;}
export function selectTraining(rows){return rows.filter(x=>trainingEligible(x.metrics)).sort((a,b)=>b.metrics.net-a.metrics.net||a.metrics.maxDrawdown-b.metrics.maxDrawdown)[0]||null;}
export function lowerDailyMean(daily){
 if(daily.length<7)return null;
 let seed=13017;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;},estimates=[];
 for(let i=0;i<2000;i++){let sum=0;for(let j=0;j<daily.length;j++)sum+=daily[Math.floor(random()*daily.length)];estimates.push(sum/daily.length);}
 estimates.sort((a,b)=>a-b);return estimates[49];
}
export function historicalGate(base,stress){
 const reasons=[];if(!base&&!stress)return{passed:false,reasons:['ยังไม่มีกลยุทธ์ผ่านช่วงฝึก จึงยังไม่เริ่มช่วงทดสอบสุดท้าย']};if(base.status!=='QUALIFIED')reasons.push('ข้อมูลช่วงทดสอบไม่ครบ');
 if((base?.rounds||0)<protocol.liveRequirements.minHoldoutRounds)reasons.push('จำนวนรอบปิดยังไม่พอ');
 if(!(base?.net>0))reasons.push('กำไรสุทธิช่วงทดสอบไม่เป็นบวก');
 if(!(base?.profitFactor>=1.15))reasons.push('กำไรต่อขาดทุนต่ำกว่าเกณฑ์');
 if(!(base?.lowerDailyMean>0))reasons.push('ผลรายวันยังไม่มั่นคง');
 if(!stress||stress.status!=='QUALIFIED'||!(stress.net>0))reasons.push('ไม่ผ่านต้นทุนสูงกว่าคาด');
 return{passed:reasons.length===0,reasons};
}
export function simulator(dataset){
 const index=Object.fromEntries(protocol.symbols.map(s=>[s,new Map(dataset.data[s].map((b,i)=>[b.t,i]))]));
 const snapshots=new Map();
 function snapshot(at,spread){
  // Only base snapshots are memoized; stress uses a separate bounded run after selection.
  const key=at+':'+spread;if(snapshots.has(key))return snapshots.get(key);
  const markets=[];
  for(const symbol of protocol.symbols){
   const i=index[symbol].get(at),rows=dataset.data[symbol];if(i===undefined||i<160)continue;
   const previous=rows.slice(i-160,i),bar=rows[i];
   if(previous.at(-1).t+STEP!==at||previous.slice(-25).some((b,j,a)=>j&&b.t-a[j-1].t!==STEP))continue;
   const mid=bar.o,bid=mid*(1-spread/2),ask=mid*(1+spread/2);
   const daily=rows.slice(Math.max(0,i-288),i),volumeTHB=daily.reduce((v,b)=>v+b.v*b.c,0);
   markets.push({symbol,name:symbol.slice(0,-4),status:'active',last:mid,bid,ask,volumeTHB,change:0,preScore:20,
    rules:dataset.rules[symbol],observedAt:at,candles:previous,depth:{at,asks:[[ask,1e9]],bids:[[bid,1e9]]},
    news:{ready:true,fetchedAt:at,blocked:false,score:0,headlines:[],method:'RESEARCH_NEUTRAL_NEWS'}});
  }
  snapshots.set(key,markets);return markets;
 }
 function simulate(from,to,candidate,capital=10000,costs=protocol.baseCosts){
  const small=capital<100,c=config({strategyProfile:candidate.profile,maxHoldMinutes:candidate.hold,budget:small?100:capital,maxOrder:small?100:500,dailyBuy:small?100:1500,dailySell:small?100:5000,slippage:costs.slippagePerSide,fee:costs.feePerSide});
  let state={...initial(c),cash:capital,peak:capital,dayStart:capital,startCapital:capital},peak=capital,maxDrawdown=0,validSteps=0,skippedSteps=0,lastQuotes=[],roundBase=0;
  const roundPnls=[],exits={},trades=[];
  for(let at=from;at<to;at+=STEP){
   const markets=snapshot(at,costs.spread),held=heldSymbol(state);
   if(!markets.length||(held&&!markets.some(m=>m.symbol===held))){skippedSteps++;continue;}validSteps++;lastQuotes=markets;
   // Skipping a flat HOLD cannot create a fill or see the next candle's high/low.
   if(!held&&candidate.profile!=='legacy-v12'&&!markets.some(m=>profileStrategy(m,state,candidate.profile).signal==='BUY')){state=rollDay(state,at,state.cash);continue;}
   const out=portfolioCycle({markets,universeCount:protocol.symbols.length},state,c,at,true);
   if(out.error)throw Error(out.error);const wasHolding=state.qty>0;state=out.state;
   if(out.fill){trades.push(out.fill);if(out.fill.side==='SELL')exits[out.fill.reason]=(exits[out.fill.reason]||0)+1;}
   if(wasHolding&&state.qty===0){roundPnls.push(state.realized-roundBase);roundBase=state.realized;}
   const p=performance(state,markets,c);peak=Math.max(peak,p.equity??state.cash);maxDrawdown=Math.max(maxDrawdown,1-(p.equity??state.cash)/peak);
  }
  const p=performance(state,lastQuotes,c),daily=p.daily,coverage=validSteps/Math.max(1,validSteps+skippedSteps),qualified=coverage>=.9;
  return{status:qualified?'QUALIFIED':'INSUFFICIENT_DATA',coverage,net:qualified?p.totalNet:null,realized:p.realized,unrealized:p.unrealized,fees:p.fees,rounds:roundPnls.length,
   wins:roundPnls.filter(x=>x>0).length,profitFactor:profitFactor(roundPnls),lowerDailyMean:lowerDailyMean(daily.map(x=>x.realized)),profitableDays:daily.filter(d=>d.realized>0).length,observedDays:daily.length,
   maxDrawdown,openPosition:heldSymbol(state),validSteps,skippedSteps,exits,daily,roundPnls,trades};
 }
 return{simulate};
}
export async function run(){
 const dataset=await loadData(),sim=simulator(dataset),candidates=protocol.profiles.flatMap(profile=>protocol.holdingMinutes.map(hold=>({profile,hold})));
 const finalFrom=dataset.end-protocol.finalHoldoutDays*DAY,folds=[];
 for(let k=0;k<protocol.validationFolds;k++){
  const to=finalFrom-(protocol.validationFolds-1-k)*protocol.validationDays*DAY,from=to-protocol.validationDays*DAY,trainFrom=from-protocol.trainingDays*DAY;
  const trained=candidates.map(candidate=>({candidate,metrics:sim.simulate(trainFrom,from,candidate)})),selected=selectTraining(trained);
  const validation=selected?sim.simulate(from,to,selected.candidate):null;
  folds.push({from:iso(from),to:iso(to),trainFrom:iso(trainFrom),selected:selected?.candidate||null,training:trained.map(({candidate,metrics})=>({candidate,...omitDetail(metrics)})),validation:validation?omitDetail(validation):{status:'CASH',net:0,rounds:0}});
  console.log('Validation '+(k+1)+'/'+protocol.validationFolds+': '+JSON.stringify({selected:selected?.candidate||'CASH',net:validation?.net||0}));
 }
 const trained=candidates.map(candidate=>({candidate,metrics:sim.simulate(finalFrom-protocol.trainingDays*DAY,finalFrom,candidate)}));
 const smallCapitalTraining=trained.map(({candidate})=>({candidate,...omitDetail(sim.simulate(finalFrom-protocol.trainingDays*DAY,finalFrom,candidate,protocol.capitalCases[0]))}));
 const selected=selectTraining(trained);console.log('Frozen final selection: '+JSON.stringify(selected?.candidate||'CASH'));
 const cases=[];
 for(const capital of protocol.capitalCases){
  const base=selected?sim.simulate(finalFrom,dataset.end,selected.candidate,capital):null,stress=selected?sim.simulate(finalFrom,dataset.end,selected.candidate,capital,protocol.stressCosts):null;
  cases.push({capital,base:base?omitDetail(base):null,stress:stress?omitDetail(stress):null,gate:historicalGate(base,stress)});
 }
 // All candidate holdouts are intentionally NOT evaluated; failed selection remains CASH.
 const report={version:'13.0.0',generatedAt:new Date().toISOString(),protocol,dataDigest:dataset.digest,dataFrom:iso(dataset.start),dataTo:iso(dataset.end),
  coverage:Object.fromEntries(protocol.symbols.map(s=>[s,{bars:dataset.data[s].length,expected:protocol.dataDays*288}])),
  codeDigest:createHash('sha256').update((await Promise.all(['assets/engine.mjs','assets/strategies.mjs','assets/selection.mjs','assets/intraday.mjs','research/protocol-v13.json'].map(p=>fs.readFile(p,'utf8')))).join('\n')).digest('hex'),folds,final:{from:iso(finalFrom),to:iso(dataset.end),selected:selected?.candidate||null,smallCapitalTraining,training:trained.map(({candidate,metrics})=>({candidate,...omitDetail(metrics)})),cases},
  liveApproved:false,decision:selected?'เก็บผลทดลองเดินหน้าก่อนพิจารณาเงินจริง':'ยังไม่มีกลยุทธ์ผ่านช่วงฝึก เก็บเงินสดและทดลองเดินหน้า',
  limitations:['Historical news and order books are unavailable; neutral news and synthetic depth are assumptions, not observed facts.','Only six predeclared surviving assets and current trading rules are used; the full live universe is not validated.','Signals use closed candles; immediate next-open fills are optimistic proxies, with explicit fees/spread/slippage and no partial fill queue model.','Five-minute research checks can miss intra-candle losses. Missing held quotes delay evaluation and must pass 90% coverage.','The daily bootstrap is an uncertainty diagnostic and does not prove independent samples or future returns.','No strategy is activated in real money automatically, and no daily profit is promised.']};
 await fs.writeFile('assets/research-v13.json',JSON.stringify(report,null,2)+'\n');
 await fs.writeFile('research/research-v13-details.json',JSON.stringify({report,selectedTraining:selected||null},null,2)+'\n');
 console.log('V13_RESULT='+JSON.stringify({selected:report.final.selected,cases:report.final.cases,decision:report.decision}));return report;
}
function omitDetail({trades,roundPnls,daily,...row}){return row;}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await run();
