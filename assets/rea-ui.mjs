import {createCodexPanel} from './rea-codex-ui.mjs?v=21.1.0';
import {VirtualOffice} from './office.mjs?v=20.0.0';
import {portfolioView,buildREAOffice,liveStatus,liveActivity,fresh,explainReason} from './rea-view-model.mjs?v=22.0.0';
const $=id=>document.getElementById(id),cfg=window.BITBOT_CLOUD_CONFIG;
let client=null,session=null,current=null,liveCurrent=null,busy=false,liveBusy=false,loaded=false;
let liveSubmitting=false,liveBudgetEdited=false,liveControlBusy=false,authBusy=false,keyReceipt=null;
let pageName='live',scope='LIVE',office=null,officeModel=null,liveLoadError='',paperLoadError='';
const number=(x,d=2)=>Number.isFinite(x)?x.toLocaleString('th-TH',{minimumFractionDigits:d,maximumFractionDigits:d}):'—';
const baht=x=>'฿'+number(x),price=x=>Number.isFinite(x)?'฿'+x.toLocaleString('th-TH',{minimumFractionDigits:2,maximumFractionDigits:8}):'รอราคาสด';
const time=x=>x?new Date(x).toLocaleString('th-TH',{timeZone:'Asia/Bangkok',dateStyle:'short',timeStyle:'medium'}):'—';
const age=at=>Number.isFinite(at)?Math.max(0,Math.floor((Date.now()-at)/1000))+' วินาที':'รอข้อมูล';
const text=(id,value)=>$(id).textContent=value;
function notice(msg,bad=false){text('reaNotice',msg);$('reaNotice').className='notice'+(bad?' bad':'');$('reaNotice').hidden=!msg;}
function rows(id,data,columns,empty='ยังไม่มีรายการ'){
 const body=$(id);body.replaceChildren();
 if(!data.length){const tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=columns.length;td.textContent=empty;tr.append(td);body.append(tr);return;}
 for(const item of data){const tr=document.createElement('tr');for(const column of columns){const td=document.createElement('td');td.textContent=column(item);tr.append(td);}body.append(tr);}
}
function liveReason(v){const reason=String(v||'');if(/A1003-MK|CODE_3\b|รหัส 3\b/.test(reason))return'Bitkub ปฏิเสธ API Key ที่บันทึกไว้ กรุณาตรวจ API Key/Secret';if(/HTTP_401/.test(reason))return'Bitkub ปฏิเสธการยืนยันตัวตน (401) กรุณาตรวจ API Key/Secret';return explainReason(reason);}
function chart(points,target='reaCurve'){
 const box=$(target);box.replaceChildren();if(points.length<2){box.textContent='รอประวัติ Equity อย่างน้อย 2 จุด';return;}
 const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg'),path=document.createElementNS(ns,'polyline');svg.setAttribute('viewBox','0 0 1000 200');svg.setAttribute('role','img');svg.setAttribute('aria-label','กราฟ Equity ตามเวลาจริง');
 const values=points.map(p=>Number(p.equity)),lo=Math.min(...values)-1,hi=Math.max(...values)+1;path.setAttribute('points',values.map((v,i)=>(i/(values.length-1)*980+10)+','+(185-(v-lo)/(hi-lo)*170)).join(' '));path.setAttribute('fill','none');path.setAttribute('stroke','#55d7a1');path.setAttribute('stroke-width','2');svg.append(path);box.append(svg);
}
function updateAccount(){
 const logged=!!session?.user; text('reaLogin',logged?'บัญชีของคุณ':'เข้าสู่ระบบ');$('reaLogin').hidden=logged;$('reaLogout').hidden=!logged;
 text('reaAccountSummary',logged?'เข้าสู่ระบบแล้ว: '+(session.user.email||'บัญชี Bitbot ของคุณ')+' · API Key และข้อมูลแยกตามบัญชี':'เข้าสู่ระบบด้วยบัญชี Bitbot เดิมเพื่ออ่านข้อมูลของคุณ');
}
function clearAccount(){
 current=null;liveCurrent=null;loaded=false;keyReceipt=null;codexPanel.reset();liveBudgetEdited=false;liveLoadError='';paperLoadError='';
 for(const id of ['reaEquity','reaDay','reaCash','reaReserved','reaSlots','reaHealth','reaHeartbeat','reaRiskNote','reaControlState','reaUniverse','reaRuntime','reaObservation','reaAdvisory','reaAdvisoryMeta','reaRealized','reaUnrealized','reaStats','reaDrawdown','reaLiveMode','reaLiveWallet','reaLiveReserved','reaLiveEquity','reaLiveCapital','reaLivePnl','reaLiveSlots','reaLiveHeartbeat','reaLiveRiskBudget','reaLivePnlDetail'])text(id,'—');
 for(const id of ['reaScanner','reaIncidents','reaPositions','reaOrders','reaReasons','reaCurve','reaDaily','reaAgents','reaAudit','reaLivePositions','reaLiveOrders','reaLiveFills','reaLiveChecks','reaLiveLimitedChecks','reaLiveCurve','reaFills','reaLiveActivity','reaLiveReasons','reaWalletAssets'])$(id).replaceChildren();
 $('reaLossBar').value=0;for(const id of ['reaLiveApiKey','reaLiveApiSecret','reaLiveConfirm','reaPassword'])$(id).value='';
 for(const id of ['reaLiveAccept','reaLiveNoWithdraw','reaLiveIncomplete'])$(id).checked=false;
 text('reaKeyFeedback','');text('reaOfficeDialogue','เข้าสู่ระบบเพื่อดูงานของทีมคุณ');text('reaOfficeEventTime','');text('reaOfficeSelected','');
 updateAccount();renderLive(null);renderShared();notice('กรุณาเข้าสู่ระบบด้วยบัญชี Bitbot เดิม');
}
async function api(action,data,{publicRequest=false}={}){
 let authSession=null;const headers={apikey:cfg.publishableKey,'Content-Type':'application/json'};
 if(!publicRequest){const {data:auth,error}=await client.auth.getSession();if(error||!auth.session){session=null;clearAccount();throw Error('กรุณาเข้าสู่ระบบด้วยบัญชี Bitbot เดิม');}session=auth.session;authSession=auth.session;headers.Authorization='Bearer '+authSession.access_token;}
 const r=await fetch(cfg.url+'/functions/v1/bitbot-v10?action='+action,{method:data?'POST':'GET',headers,...(data?{body:JSON.stringify(data)}:{}),cache:'no-store',signal:AbortSignal.timeout(25000)});
 const result=await r.json();if(authSession&&session?.user?.id!==authSession.user.id)throw Error('บัญชีเข้าสู่ระบบเปลี่ยนแล้ว');if(!r.ok||!result.ok)throw Error(result.error||'อ่าน Backend ไม่สำเร็จ');return result;
}
const codexPanel=createCodexPanel({api,getSession:()=>session,getLive:()=>liveCurrent});
function renderPaper(data){
 current=data;loaded=!!data?.state;if(!loaded)return;const s=data.state,l=data.latest||{},a=l.summary||{},stale=!fresh(l.at,Date.now());
 const label=s.kill==='ALL'?'EMERGENCY_STOP':s.dailyLocked?'DAILY_LOSS_LOCK':data.operations?.locked?'SAFE_MODE':s.buyPaused||s.kill==='ENTRY'?'พักซื้อใหม่':stale?'รอ Backend':'PAPER_ONLY';
 text('reaEquity',baht(s.equity));text('reaDay',baht(s.dayPnl));text('reaCash',baht(a.available??s.cash));text('reaReserved','ถูกจอง '+baht(a.reserved??0));text('reaSlots',(a.slots??s.positions.length)+' / 2');text('reaHealth',stale?'Heartbeat ขาดหรือยังไม่เริ่ม':l.health||'รอข้อมูล');text('reaHeartbeat',time(l.at));
 text('reaRiskNote','วงเงินเสี่ยงต่อรายการ '+baht(a.riskBudget??100)+' · ใช้ขาดทุนรายวัน '+baht(Math.max(0,-s.dayPnl))+' / '+baht(a.dailyLossLimit??300));$('reaLossBar').max=a.dailyLossLimit??300;$('reaLossBar').value=Math.max(0,-s.dayPnl);text('reaControlState','Kill: '+s.kill+' · Pause: '+s.buyPaused+' · Daily Lock: '+s.dailyLocked);
 const ops=data.operations||{},evidence=data.paperEvidence||{};text('reaRuntime',(l.runtime==='DOCKER'?'Docker Backend':'Supabase Backend · รอบทุกนาที')+' · Watchdog '+time(ops.riskAt)+(ops.locked?' · SAFE MODE: '+(ops.reasons||[]).join(', '):''));
 text('reaObservation','บันทึกแล้ว '+(evidence.samples||0)+' จุดข้อมูล · สังเกตจริง '+number(Number(evidence.daysObserved||0),3)+' วัน / ขั้นต่ำ 7 วันสำหรับการตรวจรับเต็ม');
 $('reaIncidents').replaceChildren();for(const alert of (ops.alerts||[]).filter(a=>a.status==='OPEN')){const p=document.createElement('p');p.className='error-text';p.textContent='แจ้งเตือน: '+alert.reason;$('reaIncidents').append(p);}
 $('reaReasons').replaceChildren();for(const d of (l.decisions||[]).slice(0,8)){const p=document.createElement('p');p.textContent=d.symbol+' · '+explainReason(d.reason)+(d.codex?' · Codex: '+d.codex.reason:'');$('reaReasons').append(p);}if(!l.decisions?.length)text('reaReasons',l.error||'รอผลวิเคราะห์รอบแรก');
 $('reaAudit').replaceChildren();for(const log of data.audit||[]){const p=document.createElement('p');p.textContent=time(log.created_at)+' · '+log.action;$('reaAudit').append(p);}
 if(pageName==='overview'||scope==='PAPER'){text('reaMode',label);notice(stale?'ยังไม่พบ Heartbeat สด กรุณาตรวจ Backend':ops.locked?'SAFE MODE: '+(ops.reasons||[]).join(', '):'กำลังดูข้อมูลเงินจำลอง · ไม่ส่งคำสั่งเงินจริง',stale||ops.locked);}
 renderAdvisory();renderShared();
}
function renderAdvisory(){
 const a=current?.latest?.advisory||{},available=!!a.summary,valid=fresh(a.at,Date.now(),3900000),label=available?(valid?(a.status==='CACHED'?'ใช้ผลสรุปล่าสุดจากแคช':'มีผลสรุปจาก LLM'):'ผลสรุปเก่า'):a.status||'รอผลสรุป';
 const summary=a.summary||'ยังไม่มีผลสรุป LLM ที่ตรวจสอบได้',meta=(a.model||'LLM Advisory')+' · '+label+' · '+time(a.at)+' · ไม่มีสิทธิ์ซื้อขายหรือแก้วงเงิน';
 text('reaAdvisory',summary);text('reaAdvisoryMeta',meta);text('reaLiveAdvisory',summary);text('reaLiveAdvisoryMeta',meta);text('reaLiveAiState',label);
}
const liveCheckNames={LIMITED_CAPITAL_TESTS:'ทดสอบวงเงินเงินจริงขนาดเล็ก',REAL_THB_AVAILABLE:'มีเงินบาทจริงพอเริ่มต้น',PAPER_7_DAYS:'Paper ข้อมูลจริงครบอย่างน้อย 7 วัน',PRIVATE_API_AND_WALLET:'อ่าน Wallet และคำสั่งส่วนตัวจาก Bitkub',LEGACY_EXECUTOR_STOPPED:'ตัวส่งคำสั่งเดิมหยุดและไม่มีคำสั่งค้าง',INDEPENDENT_LIVE_WATCHDOG:'ตัวเฝ้าระวัง Live ทำงานแยกจากกลยุทธ์',EXECUTION_TESTS:'ทดสอบ Live Execution',RECOVERY_TESTS:'ทดสอบ Restart และคำสั่งไม่ทราบผล',RECONCILIATION_REVIEW:'ตรวจยอดและรายการจับคู่จริง',SECURITY_REVIEW:'ตรวจความปลอดภัยอย่างเป็นทางการ',NO_WITHDRAW_SCOPE:'ตรวจ API Key ว่าไม่มีสิทธิ์ถอน',OWNER_ALERT_DELIVERY:'ทดสอบแจ้งเตือนถึงเจ้าของ'};
const livePolicy=()=>$('reaLivePolicy').value;
function liveActivationState(){
 const limited=livePolicy()==='OWNER_LIMITED_LIVE',proof=limited?liveCurrent?.readiness?.limited:liveCurrent?.readiness,cap=limited?100:10000;
 const available=Number(liveCurrent?.preflight?.wallet?.THB?.available),budget=Number($('reaLiveBudget').value),typed=$('reaLiveConfirm').value==='เปิดซื้อขายจริง Bitkub';
 const accepted=$('reaLiveAccept').checked&&$('reaLiveNoWithdraw').checked&&(!limited||$('reaLiveIncomplete').checked),ready=proof?.ready===true&&!liveCurrent?.state;
 $('reaLiveBudget').max=String(cap);$('reaLiveIncompleteLabel').hidden=!limited;$('reaLiveActivate').disabled=liveSubmitting||!ready||!typed||!accepted||!Number.isFinite(budget)||budget<10||budget>cap||!Number.isFinite(available)||budget>available;
 $('reaLiveActivationPanel').hidden=!!liveCurrent?.state||!session;
 const failed=proof?.checks?.filter(x=>!x.passed)||[];text('reaLiveActivationNote',liveCurrent?.state?'พอร์ต Live จัดสรรทุนแล้ว ใช้ปุ่มควบคุมด้านบน':ready?(limited?'เปิดเงินจริงวงเงินจำกัดได้เมื่อเจ้าของยืนยัน ผลตรวจรับเต็มยังไม่ครบ':'ตรวจรับเต็มผ่านแล้ว รอเจ้าของยืนยันวงเงิน'):failed.length?'ยังเปิดไม่ได้: '+failed.map(x=>liveCheckNames[x.name]||x.name).join(' · '):'รอผลตรวจจาก Server');
 const floor=n=>Math.floor((n+1e-9)*100)/100;text('reaLiveBudgetHint',Number.isFinite(budget)&&budget>=10?'ใช้เงินจริง '+baht(budget)+' · เสี่ยงตามแบบจำลองไม่เกิน '+baht(floor(Math.min(100,budget*.01)))+' ต่อรายการ · หยุดซื้อเมื่อขาดทุนรายวัน '+baht(floor(Math.min(300,budget*.03)))+(limited?' · ต่อเหรียญไม่เกิน '+baht(floor(budget*.4))+' · รวมไม่เกิน '+baht(floor(budget*.8)):'')+' · ราคากระโดดอาจทำให้ขาดทุนเกินแบบจำลอง':'ระบุวงเงินอย่างน้อย 10 บาท และไม่เกินเงินบาทที่ใช้ได้');
 for(const [id,checks] of [['reaLiveLimitedChecks',liveCurrent?.readiness?.limited?.checks],['reaLiveChecks',liveCurrent?.readiness?.checks]]){
  $(id).replaceChildren();for(const c of checks||[]){const p=document.createElement('p');p.textContent=(c.passed?'✓ ผ่าน · ':'รอตรวจ · ')+(liveCheckNames[c.name]||c.name)+(c.name==='PAPER_7_DAYS'?' · บันทึกจริง '+number(Number(c.evidence?.daysObserved||0),3)+' วัน':'')+(c.reason?' · '+liveReason(c.reason):'');$(id).append(p);}
 }
}
function renderLive(data){
 liveCurrent=data;const now=Date.now(),s=data?.state,pf=data?.preflight||{},l=data?.latest||{},a=l.summary||{},vm=portfolioView({live:data,now});
 if(keyReceipt&&Number.isFinite(pf.at)&&pf.at>=keyReceipt.at)keyReceipt=null;
 const receipt=keyReceipt&&now-keyReceipt.at<90000?keyReceipt:null,w=receipt?.wallet?.THB||pf.wallet?.THB,status=liveStatus(data,now);
 text('reaLiveHeadline',!session?'เข้าสู่ระบบเพื่อดูบอท':liveLoadError?'อ่านข้อมูลหน้าเว็บไม่สำเร็จ':status.label);$('reaLiveHeadline').dataset.tone=!session?'waiting':liveLoadError?'bad':status.tone;
 text('reaLiveMode',s?.kill==='ALL'?'EMERGENCY_STOP':s?.dailyLocked?'DAILY_LOSS_LOCK':data?.mode||'รอเข้าสู่ระบบ');text('reaSidebarStatus',status.label);
 text('reaLiveStatus',liveLoadError||(!session?'กรุณาเข้าสู่ระบบด้วยบัญชี Bitbot เดิม':receipt?'บันทึก Key และอ่าน Wallet สำเร็จ กำลังรอ Backend ตรวจรอบถัดไป':liveReason(status.description)));
 text('reaConnectionStatus','API · '+(receipt?'บันทึกแล้ว รอ Backend':pf.ok===true&&fresh(pf.at??l.at,now,120000)?'เชื่อมต่อแล้ว':pf.ok===false?'ตรวจการเชื่อมต่อ':'รอข้อมูล'));
 text('reaStrategyStatus','วิเคราะห์ · '+(fresh(l.strategyAt,now)?'อัปเดต '+age(l.strategyAt):l.strategyAt?'ข้อมูลเก่า':'รอรอบแรก'));
 text('reaRiskStatus','เฝ้าความเสี่ยง · '+(fresh(l.riskAt,now)?'อัปเดต '+age(l.riskAt):l.riskAt?'ข้อมูลเก่า':'รอรอบแรก'));
 text('reaLiveWallet',w?baht(w.available):'—');text('reaLiveReserved',w?'Bitkub จองไว้ '+baht(w.reserved):'ยังอ่าน Wallet ไม่สำเร็จ');
 text('reaLiveEquity',s?baht(s.equity):'—');text('reaLiveCapital',s?'จัดสรรให้บอท '+baht(s.allocatedCapital)+(s.policy==='OWNER_LIMITED_LIVE'?' · วงเงินจำกัด':''):'ยังไม่ได้จัดสรรทุนให้บอท');
 text('reaLivePnl',s?baht(s.dayPnl):'—');$('reaLivePnl').classList.toggle('negative',s?.dayPnl<0);text('reaLivePnlDetail',s?'ปิดแล้ว '+baht(a.realized??s.realized)+' · ยังถือ '+baht(a.unrealized):'ยังไม่มีพอร์ต Live');
 text('reaLiveSlots',s?(a.slots??new Set(s.positions.map(p=>p.symbol)).size)+' / 2':'— / 2');text('reaLiveRiskBudget',s?'เสี่ยงต่อรายการ '+baht(a.riskBudget)+' · ขาดทุนรายวัน '+baht(a.dailyLossLimit):'ยังไม่ใช้วงเงิน');text('reaLiveHeartbeat',!session?'เข้าสู่ระบบเพื่อดูเวลาทำงานล่าสุด':'Backend ล่าสุด '+time(l.at)+(vm.stale?' · ข้อมูลเก่า':''));$('reaLiveControlsPanel').hidden=!s;
 if(!liveBudgetEdited&&w)$('reaLiveBudget').value=String(s?.allocatedCapital??Math.floor(Math.min(w.available,livePolicy()==='OWNER_LIMITED_LIVE'?100:10000)*100)/100);
 rows('reaLivePositions',vm.positions,[p=>p.symbol,p=>number(p.qty,8),p=>price(p.entry),p=>baht(p.cost),p=>price(p.current),p=>p.unrealized===null?'รอราคาสด':baht(p.unrealized),p=>price(p.stop)+' / '+price(p.target)],s?'ยังไม่มีเหรียญที่บอทถืออยู่':'ยังไม่เปิดพอร์ต Live');
 rows('reaLiveOrders',data?.orders||[],[o=>o.client_id,o=>o.exchange_id||'ยังไม่มีการตอบรับ',o=>o.payload.symbol+' / '+o.payload.side,o=>o.status,o=>number(o.payload.amount,8)+' / '+number(o.payload.limit,6)]);
 rows('reaLiveFills',data?.fills||[],[f=>f.txn_id+' / '+time(f.payload.at),f=>f.payload.symbol+' / '+f.payload.side,f=>number(f.payload.qty,8)+' / '+number(f.payload.price,6),f=>baht(f.payload.fee)]);
 const events=liveActivity(data);$('reaLiveActivity').replaceChildren();for(const event of events){const el=document.createElement('article'),h=document.createElement('strong'),p=document.createElement('p'),small=document.createElement('small');h.textContent=event.title;p.textContent=event.detail;small.textContent=time(event.at);el.append(h,p,small);$('reaLiveActivity').append(el);}if(!events.length)text('reaLiveActivity',s?'ยังไม่มีคำสั่งหรือผลจับคู่จริง':'รายการซื้อขายจะแสดงหลังเปิด Live และ Exchange ยืนยัน');
 const decisions=l.decisions||[];text('reaLiveDecisionSummary',decisions.length?'วิเคราะห์ '+decisions.length+' คู่ล่าสุด · '+time(l.strategyAt||decisions[0].at):s?'รอรอบวิเคราะห์จาก Backend':'เชื่อม API และยืนยันเปิด Live ก่อนเริ่มซื้อขาย');
 $('reaLiveReasons').replaceChildren();for(const d of decisions.slice(0,5)){const p=document.createElement('p');p.textContent=d.symbol+' · '+explainReason(d.reason)+(d.codex?' · Codex: '+d.codex.reason:'');$('reaLiveReasons').append(p);}if(l.reason){const p=document.createElement('p');p.className='error-text';p.textContent=liveReason(l.reason);$('reaLiveReasons').prepend(p);}
 for(const b of document.querySelectorAll('[data-rea-live-control],#reaLiveUnlock'))b.disabled=!s||liveControlBusy;
 $('reaLiveSaveKey').disabled=!!s||!session;text('reaKeySummary',receipt?'· บันทึกแล้ว รอ Backend':pf.ok?'· เชื่อมต่อแล้ว ไม่ต้องกรอกซ้ำ':s?'· ใช้ Key ที่เจ้าของอนุมัติ':'· ยังไม่เชื่อมต่อ');
 if(!s&&pf.ok!==true&&session)$('reaLiveConnectionPanel').open=true;
 $('reaWalletAssets').replaceChildren();for(const [symbol,amount] of Object.entries(receipt?.wallet||pf.wallet||{})){if(symbol==='at'||!amount||!(amount.available>0||amount.reserved>0))continue;const p=document.createElement('p');p.textContent=symbol+' · ใช้ได้ '+number(amount.available,symbol==='THB'?2:8)+' · ถูกจอง '+number(amount.reserved,symbol==='THB'?2:8);$('reaWalletAssets').append(p);}
 renderCapitalAdvice(data,now);liveActivationState();renderShared();
 if(pageName==='live'){
  text('reaMode',s?'LIVE · เงินจริง':'รอเปิด Live');
  if(!session)notice('กรุณาเข้าสู่ระบบด้วยบัญชี Bitbot เดิม');else if(liveLoadError||status.tone==='bad')notice(liveLoadError||liveReason(status.description),true);else notice('');
 }
}
function renderCapitalAdvice(data,now){
 const a=data?.latest?.capitalAdvice,valid=!!session&&fresh(a?.at,now,45000)&&fresh(data?.latest?.at,now,45000),f=valid?a.financials:null;
 text('reaCapitalHeadline',!session?'เข้าสู่ระบบเพื่อดูคำแนะนำเงินทุน':!a?'รอ Backend ประเมินเงินทุน':!valid?'รอคำแนะนำรอบใหม่':a.headline);
 text('reaCapitalMessage',valid?a.message:'คำแนะนำจะแสดงเมื่อมีข้อมูลบัญชีและผลตรวจ Backend ที่ยังสด');text('reaCapitalNext',valid?a.nextStep:'รอข้อมูลที่ตรวจสอบได้');
 text('reaCapitalUsable',f?baht(f.usableTHB):'—');text('reaCapitalRisk',f?baht(f.riskBudget):'—');text('reaCapitalLimit',f?baht(f.maxPosition):'—');text('reaCapitalLot',valid&&a.recommendedEntryTHB>0?baht(a.recommendedEntryTHB):'รอเงื่อนไข');
 text('reaCapitalFunding',valid&&a.budgetIncreaseTHB>0?'Wallet ขาดเพิ่ม '+baht(a.topUpTHB)+' · ต้องอนุมัติเพิ่มงบบอท '+baht(a.budgetIncreaseTHB)+' เป็น '+baht(a.suggestedAllocationTHB):valid?'ยังไม่มีข้อเสนอให้เพิ่มงบในตอนนี้':'รอข้อมูลเงินทุน');
 text('reaCapitalAt',valid?'ตรวจทุน '+time(a.at)+' · วิเคราะห์สัญญาณ '+time(a.analyzedAt):'ยังไม่มีผลประเมินที่สด');text('reaCapitalHeld',valid&&a.positions?.length?'ไม้ที่ถืออยู่: '+a.positions.map(p=>p.symbol+' '+baht(p.costTHB)).join(' · '):'');
 const reasons={AVAILABLE_CASH_TOO_SMALL:'เงินที่ใช้ได้ยังต่ำกว่าไม้ขั้นต่ำ',BELOW_RISK_MINIMUM:'วงเงินเสี่ยงต่ำกว่าขั้นต่ำตลาด',STRATEGY_RESTRICTION:'กลยุทธ์ยังไม่อนุมัติ'};
 rows('reaCapitalEntries',valid?a.entries||[]:[],[e=>e.symbol,e=>e.amountTHB>0?baht(e.amountTHB):'ยังไม่เปิดไม้ใหม่',e=>number(e.stopDistance*100)+'%',e=>baht(e.riskBudget),e=>e.amountTHB>0?baht(e.modeledLoss):'—',e=>e.reason===a.status?a.message:reasons[e.reason]||explainReason(e.reason)],'รอผลวิเคราะห์สัญญาณจาก Backend');
}
function daily(vm){
 const periods=new Map(),kind=$('reaPeriod').value;
 for(const row of vm.daily){let key=row.day;if(kind==='month')key=key.slice(0,7);if(kind==='week'){const d=new Date(row.day+'T00:00:00Z');d.setUTCDate(d.getUTCDate()-((d.getUTCDay()+6)%7));key='เริ่ม '+d.toISOString().slice(0,10);}const old=periods.get(key)||{key,pnl:0,locked:false};old.pnl+=Number(row.payload.pnl||0);old.locked||=row.payload.locked===true;periods.set(key,old);}
 rows('reaDaily',[...periods.values()].sort((a,b)=>b.key.localeCompare(a.key)),[r=>r.key,r=>baht(r.pnl),r=>r.locked?'มีการล็อกขาดทุน':scope==='LIVE'?'เงินจริง':'Paper']);
}
function renderShared(){
 const vm=portfolioView({live:liveCurrent,paper:current,scope}),s=vm.state,l=vm.latest,a=vm.summary,label=scope==='LIVE'?'เงินจริง':'Paper';
 $('reaDataScope').value=scope;text('reaScopeNote',!session?'ยังไม่ได้อ่านข้อมูลบัญชี':(scope==='LIVE'?'จากผลจับคู่จริง':'เงินจำลอง')+' · '+(vm.stale?'ข้อมูลเก่า · ':'อัปเดต ')+time(l.at));$('reaPaperSafety').hidden=scope!=='PAPER';
 text('reaUniverse','ข้อมูล '+label+' · วิเคราะห์ '+vm.decisions.length+' คู่');
 rows('reaScanner',vm.decisions,[r=>r.symbol,r=>number(r.score),r=>r.strategy||'รอสัญญาณ',r=>age(r.priceAt),r=>explainReason(r.reason)],scope==='LIVE'?'รอผลสแกนของพอร์ตเงินจริงจาก Backend':'รอผลสแกน Paper');
 text('reaPositionsTitle','สถานะที่ถือ · '+label);text('reaOrdersTitle','ประวัติคำสั่ง · '+label);text('reaFillTitle','รายการจับคู่ · '+label);text('reaCurveTitle','มูลค่าพอร์ตตามเวลา · '+label);
 text('reaOrdersNote',scope==='LIVE'?'คำสั่งที่บันทึกก่อนส่ง Exchange ราคา Limit อาจต่างจากราคาที่จับคู่จริง ดูราคาจับคู่ในรายการด้านล่าง':'คำสั่งจำลอง ใช้ข้อมูลตลาดจริง ไม่มีการส่ง Private Trading API');
 rows('reaPositions',vm.positions,[p=>p.symbol,p=>number(p.qty,8),p=>baht(p.cost),p=>number(p.stop,6),p=>number(p.target,6)]);
 rows('reaOrders',(s?.orders||[]).slice(-100).reverse(),[o=>time(o.createdAt),o=>o.symbol+' / '+o.side,o=>o.status,o=>number(o.limit,6),o=>number(o.remaining,o.side==='BUY'?2:8)+' '+(o.side==='BUY'?'THB':'เหรียญ'),o=>explainReason(o.reason)]);
 rows('reaFills',vm.fills.slice(-100).reverse(),[f=>time(f.at)+' / '+f.id,f=>f.symbol+' / '+f.side,f=>number(f.qty,8),f=>price(f.price),f=>baht(f.fee)]);
 text('reaRealized',baht(a.realized??s?.realized));text('reaUnrealized',baht(a.unrealized));text('reaStats',(a.winRate==null?'—':number(a.winRate*100,1)+'%')+' / '+(a.profitFactor==null?'ยังไม่มีข้อมูลขาดทุน':number(a.profitFactor)));text('reaDrawdown',Number.isFinite(a.maxDrawdown)?number(a.maxDrawdown*100)+'%':'—');chart(vm.data?.curve||[]);daily(vm);
 renderOffice();
}
function renderOffice(){
 officeModel=buildREAOffice({live:liveCurrent,paper:current,scope});const label=scope==='LIVE'?'เงินจริง':'Paper';
 text('reaAgentsScope','กำลังดู '+label+' · '+officeModel.roles.length+' หน้าที่จากบันทึก Backend · ตัวตรวจเพิ่มใช้กฎเชิงตัวเลข');
 const team=portfolioView({live:liveCurrent,paper:current,scope}).latest.team;
 text('reaTeamCoverage',team?'ตรวจเพิ่ม '+team.reviewers+' หน้าที่ · บันทึก '+time(team.at):'รอผลทีมตรวจสอบจาก Backend');
 text('reaTeamBlocked',team?team.blockedSymbols.length+' คู่':'—');
 text('reaTeamTime',Number.isFinite(team?.timings?.pipelineMs)?number(team.timings.pipelineMs,0)+' ms':'—');
 text('reaTeamWallet',Number.isFinite(team?.timings?.walletReads)?team.timings.walletReads+' ครั้ง':'—');
 $('reaAgents').replaceChildren();const names={DONE:'มีผลบันทึกแล้ว',COMPLETED:'มีผลบันทึกแล้ว',WAITING:'รอข้อมูล',STALE:'ข้อมูลเก่า',FAILED:'ต้องตรวจสอบ'};
 for(const agent of officeModel.roles){const card=document.createElement('article');card.className='rea-agent';card.dataset.status=agent.status;for(const [tag,value] of [['h3',agent.name],['span',names[agent.status]||agent.status],['p',agent.summary],['small',agent.role+' · '+agent.method],['small',time(agent.at)]]){const el=document.createElement(tag);el.textContent=value;card.append(el);}$('reaAgents').append(card);}
 text('reaOfficeStatus',!session?'รอเข้าสู่ระบบ':officeModel.stale?'Backend ไม่สด':label+' · ข้อมูลจาก Backend');
 text('reaOfficeSource',!session?'แสดงผังทีมเท่านั้น ยังไม่มีข้อมูลบัญชี':officeModel.stale?'ข้อมูล Backend ยังไม่สด การเคลื่อนไหวไม่ยืนยันว่าบอทกำลังทำงาน':'ภาพสรุปงาน '+label+' จากบันทึกจริง · '+time(officeModel.archive?.finishedAt));
 if(office)office.setData(officeModel.workers,officeModel.archive,{preview:!session||officeModel.preview});
}
function goPage(name,{updateHash=true}={}){
 if(!['live','agents','scanner','orders','profit','safety','overview','codex'].includes(name))name='live';pageName=name;
 if(name==='live')scope='LIVE';if(name==='overview')scope='PAPER';
 for(const section of document.querySelectorAll('[data-rea-section]'))section.hidden=section.dataset.reaSection!==name;
 for(const b of document.querySelectorAll('[data-rea-page]'))b.classList.toggle('active',b.dataset.reaPage===name);
 const titles={codex:'สมอง Codex AI',live:'พอร์ตเงินจริง',agents:'ออฟฟิศ AI',scanner:'สแกนตลาด',orders:'คำสั่งและสถานะ',profit:'กำไร / ขาดทุน',safety:'ตั้งค่าและความปลอดภัย',overview:'ทดลอง Paper'};
 text('reaPageTitle',titles[name]);text('reaPageDescription',name==='live'?'ยอดเงิน รายการซื้อขาย และทีม AI จาก Backend ในที่เดียว':'ข้อมูล '+(scope==='LIVE'?'เงินจริง · Bitkub':'เงินจำลอง · Paper')+' ของบัญชีคุณ');
 $('reaScopeBar').hidden=['live','overview','codex'].includes(name);$('reaMode').hidden=name==='live';
 $('reaOfficePanel').hidden=!['live','agents'].includes(name);
 if(['live','agents'].includes(name))$(name==='live'?'reaLiveOfficeHost':'reaAgentOfficeHost').append($('reaOfficePanel'));
 if(updateHash)history.replaceState(null,'','#'+(name==='overview'?'paper':name));
 renderShared();codexPanel.render();if(name==='live')renderLive(liveCurrent);else if(scope==='PAPER'&&current)renderPaper(current);else if(scope==='LIVE'){text('reaMode','LIVE · เงินจริง');notice(!session?'กรุณาเข้าสู่ระบบด้วยบัญชี Bitbot เดิม':liveLoadError,!!liveLoadError);}
}
async function refreshPaper(){if(busy||!client)return;busy=true;try{const r=await api('rea-state');if(!r.rea)throw Error('บัญชีนี้ยังไม่มีพอร์ต Paper');paperLoadError='';renderPaper(r.rea);}catch(e){paperLoadError=e.message;if(scope==='PAPER')notice(e.message,true);}finally{busy=false;}}
async function refreshLive(){if(liveBusy||!client)return;liveBusy=true;try{const r=await api('rea-live-state');liveLoadError='';renderLive(r.live);}catch(e){liveLoadError=e.message;renderLive(liveCurrent);}finally{liveBusy=false;}}
async function refreshAll(){const b=$('reaRefresh');b.disabled=true;try{await Promise.allSettled([refreshPaper(),refreshLive()]);await codexPanel.refresh();renderAdvisory();renderShared();updateAccount();}finally{b.disabled=false;}}
async function paperControl(action,confirm){if(!loaded)return notice('เข้าสู่ระบบและอ่านสถานะก่อนควบคุม',true);for(const b of document.querySelectorAll('[data-rea-control],#reaUnlock'))b.disabled=true;try{await api('rea-control',{action,confirm});await refreshPaper();}catch(e){notice(e.message,true);}finally{for(const b of document.querySelectorAll('[data-rea-control],#reaUnlock'))b.disabled=false;}}
async function liveControl(action,confirm=''){if(!liveCurrent?.state||liveControlBusy)return;liveControlBusy=true;renderLive(liveCurrent);try{await api('rea-live-control',{action,confirm});await refreshLive();}catch(e){notice(e.message,true);}finally{liveControlBusy=false;renderLive(liveCurrent);}}
for(const b of document.querySelectorAll('[data-rea-page]'))b.onclick=()=>goPage(b.dataset.reaPage);
for(const a of document.querySelectorAll('[data-rea-link]'))a.onclick=e=>{e.preventDefault();goPage(a.dataset.reaLink);};
$('reaDataScope').onchange=()=>{scope=$('reaDataScope').value;renderShared();text('reaPageDescription','ข้อมูล '+(scope==='LIVE'?'เงินจริง · Bitkub':'เงินจำลอง · Paper')+' ของบัญชีคุณ');if(scope==='PAPER'&&current)renderPaper(current);else{text('reaMode','LIVE · เงินจริง');notice(liveLoadError,!!liveLoadError);}};
$('reaPeriod').onchange=()=>daily(portfolioView({live:liveCurrent,paper:current,scope}));$('reaRefresh').onclick=refreshAll;$('reaLiveRefresh').onclick=refreshAll;
for(const b of document.querySelectorAll('[data-rea-control]'))b.onclick=()=>paperControl(b.dataset.reaControl);
for(const b of document.querySelectorAll('[data-rea-live-control]'))b.onclick=()=>liveControl(b.dataset.reaLiveControl);
$('reaUnlock').onclick=()=>{if(window.confirm('ปลดเฉพาะ Emergency Stop ของพอร์ตจำลอง? ล็อกขาดทุนรายวันจะยังคงอยู่'))paperControl('clear-emergency','ปลดหยุดฉุกเฉิน Paper');};
$('reaLiveUnlock').onclick=()=>{if(window.confirm('ปลดหยุดฉุกเฉินของพอร์ตเงินจริง? Daily Loss Lock จะยังคงอยู่'))liveControl('clear-emergency','ปลดหยุดฉุกเฉินเงินจริง');};
for(const id of ['reaLiveBudget','reaLiveAccept','reaLiveNoWithdraw','reaLiveConfirm','reaLiveIncomplete'])$(id).addEventListener('input',()=>{if(id==='reaLiveBudget')liveBudgetEdited=true;liveActivationState();});
$('reaLivePolicy').onchange=()=>{liveBudgetEdited=false;$('reaLiveIncomplete').checked=false;$('reaLiveConfirm').value='';renderLive(liveCurrent);};
$('reaLiveActivate').onclick=async()=>{if($('reaLiveActivate').disabled)return;liveSubmitting=true;liveActivationState();try{const r=await api('rea-live-control',{action:'activate',confirm:$('reaLiveConfirm').value,acceptRisk:$('reaLiveAccept').checked,noWithdraw:$('reaLiveNoWithdraw').checked,budget:Number($('reaLiveBudget').value),policy:livePolicy(),acceptIncomplete:$('reaLiveIncomplete').checked});$('reaLiveConfirm').value='';await refreshAll();if(r.activated!==true)notice('Server ยังไม่อนุมัติ Live กรุณาตรวจรายการที่ยังไม่ผ่าน',true);}catch(e){notice(liveReason(e.message),true);}finally{liveSubmitting=false;liveActivationState();}};
$('reaLiveSaveKey').onclick=async()=>{const b=$('reaLiveSaveKey');b.disabled=true;text('reaKeyFeedback','กำลังตรวจ Wallet และบันทึกที่ Backend…');try{const r=await api('keys',{apiKey:$('reaLiveApiKey').value,apiSecret:$('reaLiveApiSecret').value});keyReceipt={at:r.wallet?.at||Date.now(),wallet:r.wallet};text('reaKeyFeedback','เชื่อม Bitkub และบันทึกสำเร็จ เงิน THB ที่ใช้ได้ '+baht(r.wallet?.THB?.available)+' · ไม่ต้องกรอก Key ซ้ำ');await refreshAll();}catch(e){text('reaKeyFeedback',liveReason(e.message));}finally{$('reaLiveApiKey').value='';$('reaLiveApiSecret').value='';b.disabled=!!liveCurrent?.state||!session;}};
function showAuth(){if(session)return; text('reaAuthError','');$('reaPassword').value='';if(!$('reaAuthDialog').open)$('reaAuthDialog').showModal();}
$('reaLogin').onclick=e=>{e.preventDefault();showAuth();};$('reaAuthClose').onclick=()=>$('reaAuthDialog').close();$('reaAuthDialog').addEventListener('close',()=>{$('reaPassword').value='';});
$('reaAuthForm').onsubmit=async e=>{e.preventDefault();if(authBusy)return;authBusy=true;$('reaAuthSubmit').disabled=true;text('reaAuthError','');try{
 const r=await api('login',{identifier:$('reaIdentifier').value.trim(),password:$('reaPassword').value},{publicRequest:true});const {error}=await client.auth.setSession(r.session);if(error)throw error;const {data}=await client.auth.getSession();session=data.session;$('reaAuthDialog').close();goPage('live');await refreshAll();
 }catch(e){text('reaAuthError',e.message);}finally{authBusy=false;$('reaAuthSubmit').disabled=false;$('reaPassword').value='';}};
$('reaLogout').onclick=async()=>{try{const {error}=await client.auth.signOut();if(error)throw error;session=null;clearAccount();notice('ออกจากระบบแล้ว บอทบน Backend ยังทำงานตามสถานะเดิม');}catch(e){notice(e.message,true);}};
function theme(){const light=localStorage.getItem('rea-theme')==='light';document.body.classList.toggle('light',light);document.documentElement.dataset.theme=light?'light':'dark';text('reaTheme',light?'โหมดมืด':'โหมดสว่าง');}$('reaTheme').onclick=()=>{localStorage.setItem('rea-theme',localStorage.getItem('rea-theme')==='light'?'dark':'light');theme();};theme();
const requested=location.hash.slice(1);goPage(requested==='paper'||requested==='overview'?'overview':requested==='login'?'live':requested||'live',{updateHash:false});
office=new VirtualOffice($('reaOfficeCanvas'),worker=>{text('reaOfficeSelected',(worker.title||worker.role)+' · '+worker.summary+' · '+time(worker.at));},{onEvent:event=>{if(event.stage!=='SPEAK')return;const worker=officeModel?.roles.find(w=>w.worker_id===event.speaker);text('reaOfficeSpeaker',worker?.name||'สรุปงานจาก Backend');text('reaOfficeDialogue',event.text);text('reaOfficeEventTime','บันทึก '+time(event.sourceAt)+' · เล่นภาพจากผลที่บันทึก');}});
$('reaOfficeMotion').onclick=()=>{office.setMotion(!office.motion);text('reaOfficeMotion',office.motion?'พักภาพเคลื่อนไหว':'เล่นภาพเคลื่อนไหว');};$('reaOfficeZoomIn').onclick=()=>office.zoom(1.2);$('reaOfficeZoomOut').onclick=()=>office.zoom(1/1.2);$('reaOfficeFit').onclick=()=>office.fit();$('reaOfficeSpeed').onchange=()=>office.setSpeed($('reaOfficeSpeed').value);if(window.matchMedia('(prefers-reduced-motion: reduce)').matches){office.setMotion(false);text('reaOfficeMotion','เล่นภาพเคลื่อนไหว');}renderOffice();
window.addEventListener('hashchange',()=>{const name=location.hash.slice(1);if(name==='login')showAuth();else goPage(name==='paper'?'overview':name,{updateHash:false});});
try{
 const {createClient}=await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.57.4/+esm');client=createClient(cfg.url,cfg.publishableKey);
 client.auth.onAuthStateChange((_event,s)=>{const changed=session?.user?.id!==s?.user?.id;session=s;if(changed)clearAccount();updateAccount();if(s)setTimeout(refreshAll,0);else notice('กรุณาเข้าสู่ระบบด้วยบัญชี Bitbot เดิม');});
 await refreshAll();if(location.hash==='#login'&&!session)showAuth();setInterval(refreshAll,15000);
}catch(e){notice('เปิด Dashboard ไม่สำเร็จ: '+e.message,true);}
