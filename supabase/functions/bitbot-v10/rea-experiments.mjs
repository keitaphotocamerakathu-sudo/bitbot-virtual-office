// Forward paper trials: identical snapshots and financial rules, separate virtual ledgers.
import {initialREA,cycleREA,validateREA,markREA,quoteOK} from './rea-core.mjs';
import {tradePostmortem,EXPERIENCE_PROTOCOL} from './rea-learning.mjs';
import {positionStudySummary} from './rea-position-policy.mjs';
export const EXPERIMENT_ROLE='Strategy Experimenter';
export const EXPERIMENT_PROTOCOL='REA-EXPERIMENT-26.0.0';
const PREVIOUS_PROTOCOL='REA-EXPERIMENT-25.0.0';
const LEGACY_PROTOCOL='REA-EXPERIMENT-24.0.0';
export const EXPERIMENT_PROFILES=Object.freeze([
 Object.freeze({key:'MIXED',name:'กลยุทธ์รวม',minEntryScore:0}),
 Object.freeze({key:'TREND',name:'Trend Following',entryStrategies:Object.freeze(['TREND_FOLLOWING']),minEntryScore:0}),
 Object.freeze({key:'BREAKOUT',name:'Breakout',entryStrategies:Object.freeze(['BREAKOUT']),minEntryScore:0}),
 Object.freeze({key:'MEAN_REVERSION',name:'Mean Reversion',entryStrategies:Object.freeze(['MEAN_REVERSION']),minEntryScore:0}),
 Object.freeze({key:'CAUTIOUS_MIXED',name:'รวมแบบคัดเข้ม ≥80',minEntryScore:80}),
 Object.freeze({key:'EXPERIENCE_BASELINE',name:'ประสบการณ์ · กลยุทธ์เดิม',minEntryScore:0,experience:true}),
 Object.freeze({key:'EXPERIENCE_GUARDED',name:'ประสบการณ์ · พักหลังขาดทุน 30 นาที',minEntryScore:0,experience:true,lossCooldown:true}),
 Object.freeze({key:'EXIT_BASELINE',name:'จุดออก · กฎเดิม',minEntryScore:0,positionStudy:true,positionPolicy:'BASELINE',lossCooldown:true}),
 Object.freeze({key:'EXIT_PROTECT',name:'จุดออก · ป้องกันกำไรสุทธิ',minEntryScore:0,positionStudy:true,positionPolicy:'PROTECT',lossCooldown:true}),
 Object.freeze({key:'ENTRY_PROTECT',name:'คัดจังหวะเข้า + ป้องกันกำไร',minEntryScore:0,positionStudy:true,positionPolicy:'SELECTIVE_PROTECT',lossCooldown:true})
]);
const active=o=>['OPEN','PARTIAL'].includes(o.status),money=n=>Math.round((n+Number.EPSILON)*100)/100;
const emptyStats=()=>({closedTrades:0,wins:0,grossGains:0,grossLosses:0,fillCount:0,protectedCloses:0,entryFiltered:0});
const initialAccount=now=>({startedAt:now,state:initialREA(now),stats:emptyStats(),health:'WAITING',markVerified:false,lessons:[]});
const initialExperience=now=>({startedAt:now,validMinutes:0,lastMinute:null,lastMinuteValid:false});
export function initialExperimentBook(now=Date.now()){
 return{protocol:EXPERIMENT_PROTOCOL,mode:'PAPER_ONLY',startedAt:now,lastAt:null,samples:0,validSamples:0,coveredMinutes:0,validMinutes:0,lastMinute:null,lastMinuteValid:false,experience:initialExperience(now),positionStudy:initialExperience(now),accounts:Object.fromEntries(EXPERIMENT_PROFILES.map(p=>[p.key,initialAccount(now)]))};
}
export function validateExperimentBook(book){
 if(![EXPERIMENT_PROTOCOL,PREVIOUS_PROTOCOL,LEGACY_PROTOCOL].includes(book?.protocol)||book.mode!=='PAPER_ONLY'||!Number.isFinite(book.startedAt)||!Number.isInteger(book.samples)||book.samples<0||!Number.isInteger(book.validSamples)||book.validSamples<0||book.validSamples>book.samples||book.lastAt!==null&&!Number.isFinite(book.lastAt))throw Error('INVALID_EXPERIMENT_BOOK');
 const profiles=book.protocol===LEGACY_PROTOCOL?EXPERIMENT_PROFILES.slice(0,5):book.protocol===PREVIOUS_PROTOCOL?EXPERIMENT_PROFILES.slice(0,7):EXPERIMENT_PROFILES;
 if(Object.keys(book.accounts||{}).sort().join(',')!==profiles.map(p=>p.key).sort().join(','))throw Error('INVALID_EXPERIMENT_ACCOUNTS');
 if(!['coveredMinutes','validMinutes'].every(k=>Number.isInteger(book[k])&&book[k]>=0)||book.validMinutes>book.coveredMinutes)throw Error('INVALID_EXPERIMENT_COVERAGE');
 for(const p of profiles){const a=book.accounts[p.key];validateREA(a.state);if(a.state.lastAt!==book.lastAt||!a.stats||!['closedTrades','wins','grossGains','grossLosses','fillCount'].every(k=>Number.isFinite(a.stats[k])&&a.stats[k]>=0)||!['closedTrades','wins','fillCount'].every(k=>Number.isInteger(a.stats[k]))||a.stats.wins>a.stats.closedTrades)throw Error('INVALID_EXPERIMENT_STATS');}
 if(book.protocol!==LEGACY_PROTOCOL){const e=book.experience;if(!e||!Number.isFinite(e.startedAt)||e.startedAt<book.startedAt||!Number.isInteger(e.validMinutes)||e.validMinutes<0||!profiles.every(p=>Number.isFinite(book.accounts[p.key].startedAt)&&book.accounts[p.key].startedAt>=book.startedAt)||profiles.filter(p=>p.experience).some(p=>book.accounts[p.key].startedAt!==e.startedAt))throw Error('INVALID_EXPERIENCE_COHORT');}
 if(book.protocol===EXPERIMENT_PROTOCOL){const e=book.positionStudy;if(!e||!Number.isFinite(e.startedAt)||e.startedAt<book.startedAt||!Number.isInteger(e.validMinutes)||e.validMinutes<0||profiles.filter(p=>p.positionStudy).some(p=>book.accounts[p.key].startedAt!==e.startedAt))throw Error('INVALID_POSITION_STUDY_COHORT');}
 return book;
}
function upgradeBook(previous,now){
 const b=structuredClone(validateExperimentBook(previous));if(b.protocol===EXPERIMENT_PROTOCOL)return b;
 if(b.protocol===LEGACY_PROTOCOL){b.protocol=PREVIOUS_PROTOCOL;b.experience=initialExperience(now);for(const p of EXPERIMENT_PROFILES.slice(0,7)){if(!b.accounts[p.key]){b.accounts[p.key]=initialAccount(now);b.accounts[p.key].state.lastAt=b.lastAt;}else{b.accounts[p.key].startedAt=b.startedAt;b.accounts[p.key].lessons=[];}}}
 b.protocol=EXPERIMENT_PROTOCOL;b.positionStudy=initialExperience(now);for(const p of EXPERIMENT_PROFILES.filter(p=>p.positionStudy)){b.accounts[p.key]=initialAccount(now);b.accounts[p.key].state.lastAt=b.lastAt;}
 return b;
}
export function experimentHeld(book){
 if(!book)return[];validateExperimentBook(book);return[...new Set(Object.values(book.accounts).flatMap(a=>[...a.state.positions.map(p=>p.symbol),...a.state.orders.filter(active).map(o=>o.symbol)]))];
}
function compact(s,now){
 // Full per-cycle fills and closures are archived in agent_decisions, not lost from lifetime metrics.
 const held=new Set(s.positions.map(p=>p.positionId)),retain=o=>active(o)||held.has(o.id)||held.has(o.positionId),retained=s.orders.filter(retain),orderIds=new Set(retained.map(o=>o.id));
 s.orders=[...s.orders.filter(o=>!retain(o)).slice(-50),...retained];s.fills=[...s.fills.filter(f=>!orderIds.has(f.orderId)).slice(-60),...s.fills.filter(f=>orderIds.has(f.orderId))];
 s.closed=[...s.closed.filter(t=>t.closedAt<now-1800000).slice(-30),...s.closed.filter(t=>t.closedAt>=now-1800000)];
 s.days=Object.fromEntries(Object.entries(s.days).sort(([a],[b])=>a.localeCompare(b)).slice(-30));return s;
}
function summarize(book,now,{cycleFills=[],cycleEvents=[],replayed=false}={}){
 const daysObserved=Math.max(0,(now-book.startedAt)/86400000),expectedSamples=Math.max(1,Math.floor(now/60000)-Math.floor(book.startedAt/60000)+1),coverage=Math.min(1,book.validMinutes/expectedSamples);
 const accounts=EXPERIMENT_PROFILES.map(p=>{const a=book.accounts[p.key],s=a.state,t=a.stats,marked=a.markVerified===true;
  return{profile:p.key,name:p.name,startedAt:a.startedAt,cohort:p.positionStudy?'MATCHED_POSITION_STUDY':p.experience?'MATCHED_EXPERIENCE_PAIR':'STRATEGY_COMPARISON',positionPolicy:p.positionPolicy||null,lossCooldown:p.lossCooldown===true,minEntryScore:p.minEntryScore,strategies:p.entryStrategies||['TREND_FOLLOWING','BREAKOUT','MEAN_REVERSION'],initialCapital:10000,health:a.health,at:s.lastAt,markVerified:marked,equity:marked?s.equity:null,cash:s.cash,netPnL:marked?money(s.equity-10000):null,returnPct:marked?money((s.equity/10000-1)*100):null,realized:s.realized,unrealized:marked?money(s.equity-s.cash-s.positions.reduce((v,x)=>v+x.cost,0)):null,fees:s.fees,closedTrades:t.closedTrades,winRate:t.closedTrades?t.wins/t.closedTrades:null,profitFactor:t.grossLosses>0?t.grossGains/t.grossLosses:null,profitFactorReason:t.grossLosses>0?null:'NO_REALIZED_LOSSES',maxDrawdown:s.maxDrawdown,fillCount:t.fillCount,protectedCloses:t.protectedCloses||0,entryFiltered:t.entryFiltered||0,positions:s.positions.map(x=>({symbol:x.symbol,cost:x.cost,protection:x.protection||null})),openOrders:s.orders.filter(active).length,dailyLocked:s.dailyLocked,recentLessons:(a.lessons||[]).slice(-3)};
 });
 const windowCollected=daysObserved>=7&&coverage>=.9&&accounts.every(a=>a.closedTrades>=30&&a.markVerified&&now-a.startedAt>=7*86400000)&&book.experience.validMinutes/Math.max(1,Math.floor(now/60000)-Math.floor(book.experience.startedAt/60000)+1)>=.9;
 const e=book.experience,expectedMinutes=Math.max(1,Math.floor(now/60000)-Math.floor(e.startedAt/60000)+1),compact=a=>({profile:a.profile,startedAt:a.startedAt,closedTrades:a.closedTrades,netPnL:a.netPnL,fees:a.fees,maxDrawdown:a.maxDrawdown,profitFactor:a.profitFactor,markVerified:a.markVerified});
 const relay={protocol:EXPERIENCE_PROTOCOL,mode:'PAPER_ONLY',at:book.lastAt,collection:{startedAt:e.startedAt,validMinutes:e.validMinutes,expectedMinutes,coverage:e.validMinutes/expectedMinutes},baseline:compact(accounts.find(a=>a.profile==='EXPERIENCE_BASELINE')),guarded:compact(accounts.find(a=>a.profile==='EXPERIENCE_GUARDED')),losses:EXPERIMENT_PROFILES.filter(p=>p.experience).flatMap(p=>(book.accounts[p.key].lessons||[]).filter(t=>t.status==='VERIFIED'&&t.netPnL<0&&t.closedAt+1800000>now).map(t=>({positionId:t.positionId,profile:p.key,symbol:t.symbol,strategy:t.strategy,pnl:t.netPnL,closedAt:t.closedAt}))),canTrade:false,canRaiseRisk:false,canDisableStops:false};
 return{protocol:EXPERIMENT_PROTOCOL,mode:'PAPER_ONLY',status:accounts.every(a=>a.health==='OK')?'OBSERVING':'DEGRADED',at:book.lastAt,startedAt:book.startedAt,daysObserved,samples:book.samples,validSamples:book.validSamples,coveredMinutes:book.coveredMinutes,validMinutes:book.validMinutes,expectedSamples,coverage,windowCollected,minimumDays:7,minimumClosedTrades:30,accounts,relay,positionStudy:positionStudySummary(book,accounts,now),cycleFills,cycleEvents,replayed,canTrade:false,canActivateLive:false,canChangeLimits:false,winner:null,recoveryStudy:{candidate:'CAUTIOUS_MIXED',question:'คะแนนขั้นต่ำ 80 ช่วยลดการขาดทุนหลังต้นทุนหรือไม่',hypothesisOnly:true,liveAdoptionAllowed:false},limitations:['FORWARD_PAPER_NOT_LIVE_RESULTS','NO_RETROSPECTIVE_FILLS','COST_AND_LIQUIDITY_MODEL_NOT_GUARANTEED','MINIMUM_WINDOW_IS_NOT_STATISTICAL_PROOF','EXPERIENCE_PAIR_HAS_SEPARATE_START_AND_COVERAGE','POSITION_STUDY_HAS_SEPARATE_START_AND_COVERAGE']};
}
export function stepExperiments(previous,bundle,now=Date.now(),control={}){
 const book=previous?upgradeBook(previous,now):initialExperimentBook(now);
 if(now<book.startedAt||book.lastAt!==null&&now<book.lastAt)throw Error('EXPERIMENT_CLOCK_REGRESSION');
 if(book.lastAt===now)return{book,summary:summarize(book,now,{replayed:true})};
 const cycleFills=[],cycleEvents=[];
 for(const p of EXPERIMENT_PROFILES){
  const a=book.accounts[p.key],oldClosed=new Set(a.state.closed.map(t=>t.id)),out=cycleREA(a.state,bundle,now,{entryStrategies:p.entryStrategies,minEntryScore:p.minEntryScore,lossCooldown:p.lossCooldown===true,positionPolicy:p.positionPolicy,operationalLock:control.operationalLock===true,buyPaused:control.buyPaused===true,kill:control.kill||'NONE'}),closed=out.state.closed.filter(t=>!oldClosed.has(t.id));
  for(const t of closed){a.stats.closedTrades++;if(t.pnl>0){a.stats.wins++;a.stats.grossGains=money(a.stats.grossGains+t.pnl);}else if(t.pnl<0)a.stats.grossLosses=money(a.stats.grossLosses-t.pnl);}
  const lessons=closed.map(t=>tradePostmortem(out.state,t,now,{simulation:true}));a.lessons=[...(a.lessons||[]),...lessons].slice(-8);
  a.stats.protectedCloses=(a.stats.protectedCloses||0)+lessons.filter(t=>t.evidence.exitReasons.includes('PROFIT_PROTECTION')).length;a.stats.entryFiltered=(a.stats.entryFiltered||0)+out.signals.filter(t=>t.reason==='POSITION_STUDY_ENTRY_FILTER').length;
  a.stats.fillCount+=out.fills.length;a.markVerified=markREA(out.state,bundle?.markets||[],now)!==null;a.health=a.markVerified?out.health:'SAFE_MODE';a.state=compact(out.state,now);
  cycleFills.push(...out.fills.map(f=>({...f,profile:p.key,mode:'PAPER_ONLY'})));
  cycleEvents.push(...closed.map(t=>({...t,profile:p.key,kind:'CLOSED_TRADE',simulation:true})),...lessons.map(t=>({kind:'POST_TRADE_LESSON',profile:p.key,at:now,lesson:t,simulation:true})),...out.events.filter(e=>e.kind!=='FILL').slice(0,12).map(e=>({...e,profile:p.key,at:now})));
 }
 book.lastAt=now;book.samples++;const healthy=!!bundle?.markets?.length&&Object.values(book.accounts).every(a=>a.health==='OK');if(healthy)book.validSamples++;
 const minute=Math.floor(now/60000);if(book.lastMinute!==minute){book.coveredMinutes++;book.lastMinute=minute;book.lastMinuteValid=healthy;if(healthy)book.validMinutes++;}else if(healthy&&!book.lastMinuteValid){book.validMinutes++;book.lastMinuteValid=true;}
 const e=book.experience,pairHealthy=!!bundle?.markets?.some(m=>m.dataQuality?.ready===true&&quoteOK(m,now))&&EXPERIMENT_PROFILES.filter(p=>p.experience).every(p=>book.accounts[p.key].health==='OK');if(e.lastMinute!==minute){e.lastMinute=minute;e.lastMinuteValid=pairHealthy;if(pairHealthy)e.validMinutes++;}else if(pairHealthy&&!e.lastMinuteValid){e.validMinutes++;e.lastMinuteValid=true;}
 const p=book.positionStudy,studyHealthy=!!bundle?.markets?.some(m=>m.dataQuality?.ready===true&&quoteOK(m,now))&&EXPERIMENT_PROFILES.filter(p=>p.positionStudy).every(p=>book.accounts[p.key].health==='OK');if(p.lastMinute!==minute){p.lastMinute=minute;p.lastMinuteValid=studyHealthy;if(studyHealthy)p.validMinutes++;}else if(studyHealthy&&!p.lastMinuteValid){p.validMinutes++;p.lastMinuteValid=true;}
 validateExperimentBook(book);if(JSON.stringify(book).length>900000)throw Error('EXPERIMENT_BOOK_SIZE_LIMIT');
 return{book,summary:summarize(book,now,{cycleFills,cycleEvents})};
}
export function experimentReview(summary){
 const ready=!!summary?.accounts?.length,closed=summary?.accounts?.reduce((n,a)=>n+a.closedTrades,0)||0;
 const text=!ready?'รอผลทดลอง Paper จาก Backend':'ทดลอง Paper '+summary.accounts.length+' พอร์ต · ปิดแล้ว '+closed+' รายการ · '+(summary.windowCollected?'ครบช่วงเก็บข้อมูลเบื้องต้น ยังไม่อนุมัติใช้เงินจริง':'ยังเก็บหลักฐานผลหลังต้นทุน');
 return{role:EXPERIMENT_ROLE,at:summary?.at??null,status:!ready?'WAITING':summary.status==='DEGRADED'?'DEGRADED':'COMPLETED',summary:text,reason:text,method:'SHARED_SNAPSHOT_FORWARD_PAPER',evidence:{mode:'PAPER_ONLY',canTrade:false,canActivateLive:false,profiles:summary?.accounts?.map(a=>({profile:a.profile,closedTrades:a.closedTrades,netPnL:a.netPnL,fees:a.fees}))||[],coverage:summary?.coverage??null,daysObserved:summary?.daysObserved??null}};
}
export function createExperimentStore({rpc}){return{load:uid=>rpc('rea_experiment_state',{p_uid:uid}),commit:(args,book)=>rpc('rea_experiment_checkpoint',{...args,p_book:book})};}
