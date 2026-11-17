// Resource-bounded department workers. Structured hand-offs describe actual calculations.
import {portfolioValue,newsAgent} from './engine.mjs';
import {multiTimeframe} from './technical.mjs';
export const DEPARTMENTS=Object.freeze([
 {id:'ceo',name:'CEO',room:'Command',color:'#b7a4ff',tools:['mandate']},
 {id:'cio',name:'CIO',room:'Strategy',color:'#ffcd88',tools:['policy']},
 {id:'market',name:'MARKET',room:'Market',color:'#8bc8ff',tools:['technical']},
 {id:'news',name:'NEWS',room:'News',color:'#78e4e7',tools:['news']},
 {id:'quant',name:'QUANT',room:'Research',color:'#cdb9ff',tools:['strategy']},
 {id:'portfolio',name:'PORTFOLIO',room:'Portfolio',color:'#91ded0',tools:['sizing']},
 {id:'risk',name:'RISK',room:'Risk',color:'#9af5c7',tools:['risk']},
 {id:'execution',name:'EXECUTION',room:'Execution',color:'#ffacbe',tools:['order-plan']},
 {id:'audit',name:'AUDIT',room:'Audit',color:'#a5b4cc',tools:['accounting']},
 {id:'learning',name:'LEARNING',room:'Learning',color:'#f6cc84',tools:['lessons']}
]);
export class ToolRouter{
 constructor(registry){this.registry=new Map(Object.entries(registry));}
 call(role,name,context){const d=DEPARTMENTS.find(x=>x.id===role);if(!d?.tools.includes(name))throw Error('Tool permission denied: '+role+'/'+name);const tool=this.registry.get(name);if(!tool)throw Error('Tool unavailable: '+name);return tool(context);}
}
const compactRisk=r=>r?{action:r.action,blocked:r.blocked,notional:r.notional,exit:r.exit,netRR:r.plan?.netRR,cost:r.plan?.cost,drawdown:r.drawdown,wallet:r.wallet}:null;
export function assessCompany({bundle,plans,records,configs,advanced={},mode='PAPER',now=Date.now(),evidence=null,maxWorkers=16}){
 const tasks=[],messages=[],workers=[],outputs={},next=structuredClone(plans),clock=()=>Date.now();let sequence=0;
 const list=Object.entries(next),markets=[...new Map(list.filter(([,p])=>p.market).map(([,p])=>[p.market.symbol,p.market])).values()];
 const registry={
  mandate:()=>({mode,liveEnabled:mode==='LIVE',universe:bundle.universeCount||0,candidates:list.length,model:'QUANTITATIVE_NO_LLM'}),
  policy:()=>Object.fromEntries(Object.entries(configs).map(([key,c])=>[key,{strategy:c.strategyProfile,budget:c.budget,riskPerTrade:c.riskPerTrade,dailyLoss:c.dailyLoss,ownerLimits:true}])),
  technical:(ctx)=>Object.fromEntries((ctx.markets||markets).map(m=>[m.symbol,multiTimeframe(m,advanced[m.symbol]||{},now)])),
  news:()=>Object.fromEntries(list.map(([key,p])=>[key,p.market?newsAgent(p.market,now):{ready:false,reason:'ไม่มีข่าวพร้อมประเมิน'}])),
  strategy:(ctx)=>({evidence,signals:Object.fromEntries((ctx.plans||list).map(([key,p])=>[key,p.trace?.find(x=>x.agent==='strategy')||{signal:'HOLD'}]))}),
  sizing:()=>Object.fromEntries(list.map(([key,p])=>[key,p.trace?.find(x=>x.agent==='risk')?.wallet||null])),
  risk:()=>Object.fromEntries(list.map(([key,p])=>{
   const risk=p.trace?.find(x=>x.agent==='risk'),hourly=outputs.market?.[p.market?.symbol]?.['60'],reasons=[];
   if(p.error)reasons.push(p.error);
   if(p.order?.side==='BUY'&&!hourly?.ready)reasons.push('รอข้อมูลแท่งปิด 1 ชั่วโมงให้เพียงพอ');
   if(p.order?.side==='BUY'&&hourly?.ready&&hourly.regime==='DOWNTREND')reasons.push('แนวโน้ม 1 ชั่วโมงเป็นขาลง');
   if(mode==='LIVE'&&p.order?.side==='BUY'&&evidence?.allowed!==true)reasons.push('หลักฐานกลยุทธ์หรือการอนุมัติยังไม่ผ่าน');
   if(p.order&&(!risk||risk.action!==p.order.side))reasons.push('แผนคำสั่งไม่ตรงผลตรวจความเสี่ยง');
   if(mode==='OBSERVE')reasons.push('รอบวิเคราะห์เท่านั้น ไม่ส่งคำสั่ง');
   if(reasons.length)p.order=null;
   return[key,{...compactRisk(risk),companyVeto:reasons,approved:p.order!==null}];
  })),
  'order-plan':()=>Object.fromEntries(Object.entries(next).map(([key,p])=>[key,{stage:p.order?'PLANNED':'NO_ORDER',mode,order:p.order||null,exchangeSubmitted:false}])),
  accounting:()=>Object.fromEntries(Object.entries(records).map(([key,r])=>{const s=r.state||r,c=configs[key],baseline=s.startCapital??c.budget,difference=(s.cash+s.cost)-(baseline+s.realized);return[key,{cash:s.cash,cost:s.cost,realized:s.realized,accountingDifference:difference,consistent:Math.abs(difference)<.03,equity:portfolioValue(s,bundle.markets||[]),scope:'BOT_ALLOCATED_PORTFOLIO'}];})),
  lessons:()=>Object.fromEntries(Object.entries(records).map(([key,r])=>[key,{closedRounds:(r.roundPnls||[]).length,strategies:(r.state||r).lessons||{},method:'OBSERVED_CLOSED_RESULTS',autoChanges:false}]))
 };
 const router=new ToolRouter(registry),work=[['ceo','mandate'],['cio','policy'],['market','technical'],['news','news'],['quant','strategy'],['portfolio','sizing'],['risk','risk'],['execution','order-plan'],['audit','accounting'],['learning','lessons']];
 const chunks=(values,size)=>Array.from({length:Math.ceil(values.length/size)},(_,i)=>values.slice(i*size,(i+1)*size));
 for(const [role,tool] of work){
 const units=role==='market'?chunks(markets,4).map(markets=>({markets})):role==='quant'?chunks(list,3).map(plans=>({plans})):[{}];if(!units.length)units.push({});
 for(const [unit,context] of units.entries()){
 const started=clock(),worker=role+'-'+(unit+1);let result,status='DONE',error=null;
 try{result=router.call(role,tool,context);
 if(role==='market')outputs[role]={...outputs[role],...result};else if(role==='quant')outputs[role]={evidence,signals:{...outputs[role]?.signals,...result.signals}};else outputs[role]=result;
 if(role==='audit'&&Object.values(result).some(x=>!x.consistent)){for(const p of Object.values(next))p.order=null;outputs.execution=Object.fromEntries(Object.keys(next).map(key=>[key,{stage:'NO_ORDER',reason:'ACCOUNTING_MISMATCH',exchangeSubmitted:false}]));}}
 catch(e){status='FAILED';error=String(e.message).slice(0,180);result={error};outputs[role]={...outputs[role],error};if(['market','news','quant','portfolio','risk','audit'].includes(role))for(const p of Object.values(next))if(p.order?.side==='BUY')p.order=null;}
 const finished=clock(),task={id:++sequence,worker,role,tool,status,startedAt:started,finishedAt:finished,durationMs:finished-started,error,output:result};tasks.push(task);
 workers.push({id:worker,role,status:lastStatus(status),lastSeenAt:finished,completed:status==='DONE'?1:0,failed:status==='FAILED'?1:0,tools:DEPARTMENTS.find(x=>x.id===role).tools});
 const nextRole=work[work.findIndex(x=>x[0]===role)+1]?.[0];
 if(nextRole)messages.push({seq:sequence,from:worker,to:nextRole+'-1',at:finished,kind:'RESULT_HANDOFF',taskId:task.id,text:status==='FAILED'?'งาน '+tool+' ไม่สำเร็จ: '+error:'ส่งผล '+tool+' จาก '+list.length+' ชุดวิเคราะห์',evidence:{tool,status,taskId:task.id}});
 }
 }

 if(workers.length>maxWorkers)throw Error('Worker resource cap exceeded');
 return{plans:next,archive:{version:'14.0.0',mode,startedAt:tasks[0]?.startedAt||now,finishedAt:clock(),tasks,messages,workers,outputs,snapshots:markets.map(m=>({symbol:m.symbol,last:m.last,bid:m.bid,ask:m.ask,observedAt:m.observedAt,volumeTHB:m.volumeTHB,candles:(m.candles||[]).slice(-60),news:m.news})),executionReceipts:[],riskLimitsEditableByAgents:false},workers};
}
function lastStatus(status){return status==='DONE'?'IDLE':'FAILED';}
export function attachReceipts(archive,events,states){
 const a=structuredClone(archive);a.executionReceipts=events.map(x=>({...x,source:'ACTUAL_PAPER_EXECUTOR'}));
 a.postExecution=Object.fromEntries(Object.entries(states).map(([key,r])=>[key,{cash:r.state.cash,qty:r.state.qty,symbol:r.state.symbol,realized:r.state.realized,fees:r.state.fees,rounds:r.roundPnls?.length||0}]));return a;
}
