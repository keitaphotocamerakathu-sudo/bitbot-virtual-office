import {attachCompanyUI} from './company-ui.mjs?v=14.0.0';
import {performance,dayKey} from './intraday.mjs?v=13.0.0';
import {DEFAULTS,config,initial,paperCycle,heldSymbol,assetOf,sizing,portfolioValue} from './engine.mjs?v=13.0.0';
const $=id=>document.getElementById(id);
const CFG=window.BITBOT_CLOUD_CONFIG;
const ENDPOINT=CFG.url+'/functions/v1/bitbot-v10';
const STORE='bitbot-v10-paper';
const fmt=(v,d=2)=>Number.isFinite(Number(v))?Number(v).toLocaleString('th-TH',{minimumFractionDigits:d,maximumFractionDigits:d}):'—';
const money=v=>'฿'+fmt(v);
const priceFmt=v=>'฿'+Number(v).toLocaleString('th-TH',{minimumFractionDigits:2,maximumFractionDigits:8});
const time=v=>new Date(v).toLocaleString('th-TH',{timeZone:'Asia/Bangkok',dateStyle:'short',timeStyle:'medium'});
const agents=[
{id:'coordinator',name:'COORDINATOR',role:'ประสานงาน',color:'#b7a4ff'},
{id:'trend',name:'TREND',role:'วิเคราะห์แนวโน้ม',color:'#8bc8ff'},
{id:'news',name:'NEWS',role:'คัดกรองข่าว',color:'#78e4e7'},
{id:'strategy',name:'STRATEGY',role:'วางกลยุทธ์',color:'#ffcd88'},
{id:'risk',name:'RISK',role:'คุมความเสี่ยง',color:'#9af5c7'},
{id:'execution',name:'EXECUTION',role:'ส่งและตรวจคำสั่ง',color:'#ffacbe'}];
let bundle=null,liveWallet=null,walletError='',lastWalletAttempt=0;
let mode='paper',market=null,session=null,client=null,cloud=null,cloudBusy=false,authBusy=false,actionBusy=false;
let paperConfig=config({strategyProfile:'trend-confirmed',riskPerTrade:.005,dailyLoss:.02}),paperState=initial(paperConfig),paperTrades=[],paperJournal=[],paperRunning=false,lastCycle=0,releaseLock=null,cycleBusy=false;
const text=(id,v)=>$(id).textContent=v;
function notice(message,bad=false){text('notice',message);$('notice').className='notice'+(bad?' bad':'');$('notice').hidden=false;}
function info(title,message){text('infoTitle',title);$('infoContent').replaceChildren();const p=document.createElement('p');p.textContent=message;$('infoContent').append(p);if(!$('infoDialog').open)$('infoDialog').showModal();}
function recovery(code){text('infoTitle','เก็บรหัสกู้บัญชีนี้ไว้ส่วนตัว');$('infoContent').replaceChildren();const p=document.createElement('p');p.textContent='ใช้รหัสนี้ตั้งรหัสผ่านใหม่ได้โดยไม่ต้องใช้อีเมล รหัสเก่าจะใช้ไม่ได้หลังจากกู้บัญชีแล้ว';const el=document.createElement('code');el.textContent=code;$('infoContent').append(p,el);$('infoDialog').showModal();}
$('infoDialog').addEventListener('close',()=>{$('infoContent').replaceChildren();});
function checkpoint(next={config:paperConfig,state:paperState,trades:paperTrades,journal:paperJournal}){
 try{localStorage.setItem(STORE,JSON.stringify({version:10,...next}));}
 catch{stopPaper();throw Error('บันทึกการทดลองไม่ได้ กรุณาสำรองข้อมูลหรือตรวจพื้นที่เบราว์เซอร์');}
}
try{
 const raw=JSON.parse(localStorage.getItem(STORE)||'null');
 if(raw?.version===10){const c=config(raw.config),s=raw.state;
 if(!s||!['cash','qty','cost','realized','fees','peak'].every(k=>typeof s[k]==='number'&&Number.isFinite(s[k]))||s.cash<-.02||s.qty<0||s.cost<0)throw Error('ข้อมูลการทดลองเดิมไม่ครบ');
 paperConfig=c;paperState=s;paperTrades=Array.isArray(raw.trades)?raw.trades.slice(-5000):[];paperJournal=Array.isArray(raw.journal)?raw.journal.slice(-300):[];}
}catch(e){notice('อ่านการทดลองเดิมไม่ได้: '+e.message,true);}
async function sdk(){
 if(client)return client;
 const {createClient}=await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.57.4/+esm');
 client=createClient(CFG.url,CFG.publishableKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
 client.auth.onAuthStateChange((_type,s)=>{session=s;updateAccount();if(s)setTimeout(()=>refreshCloud().catch(e=>notice(e.message,true)),0);else{cloud=null;render();}});
 return client;
}
async function api(action,{method='GET',data,auth=false,query={}}={}){
 const headers={Accept:'application/json',apikey:CFG.publishableKey};
 if(data!==undefined)headers['Content-Type']='application/json';
 if(auth){const c=await sdk();const {data:res,error}=await c.auth.getSession();if(error||!res.session)throw Error('กรุณาเข้าสู่ระบบก่อน');session=res.session;headers.Authorization='Bearer '+session.access_token;}
 let r;try{r=await fetch(ENDPOINT+'?'+new URLSearchParams({action,...query}),{method,headers,...(data!==undefined?{body:JSON.stringify(data)}:{}),signal:AbortSignal.timeout(25000),cache:'no-store'});}
 catch(e){throw Error(e.name==='TimeoutError'||e.name==='AbortError'?'บริการตอบช้า กรุณาตรวจสถานะก่อนลองใหม่':'เชื่อมเซิร์ฟเวอร์ไม่ได้ กรุณาตรวจอินเทอร์เน็ต');}
 const x=await r.json().catch(()=>({}));if(!r.ok||!x.ok)throw Error(x.error||'ระบบตอบกลับ '+r.status);return x;
}
function page(name){for(const e of document.querySelectorAll('.page'))e.hidden=e.id!==name;for(const e of document.querySelectorAll('.nav-item'))e.classList.toggle('active',e.dataset.page===name);if(['settings','risk'].includes(name))fillConfig();if(name==='profit')companyUI?.loadReport();if(name==='history')renderHistory();}
document.querySelectorAll('[data-page]').forEach(e=>e.addEventListener('click',()=>page(e.dataset.page)));
function paperRecord(){return cloud?.shadow?.states?.[$('paperCandidate')?.value||'trend-confirmed:60']||null;}
function cfg(){return mode==='paper'?config(paperRecord()?.config||cloud?.shadow?.base_config||(cloud?.bot?.config?{...cloud.bot.config,riskPerTrade:Math.min(cloud.bot.config.riskPerTrade||.01,.005),dailyLoss:Math.min(cloud.bot.config.dailyLoss||.03,.02)}:paperConfig)):config(cloud?.bot?.config||{budget:1000,maxOrder:100,dailyBuy:300,dailySell:1000},true);}
function state(){return mode==='paper'?paperRecord()?.state||{...initial(cfg()),...(cloud?.shadow?{cash:Number(cloud.shadow.capital),peak:Number(cloud.shadow.capital),startCapital:Number(cloud.shadow.capital)}:{})}:cloud?.bot?.state||initial(cfg());}
function running(){return mode==='paper'?cloud?.shadow?.enabled===true:cloud?.bot?.running===true;}
function trace(){return mode==='paper'?paperRecord()?.trace||[]:cloud?.events.find(x=>x.payload?.trace?.length)?.payload.trace||[];}
function switchMode(value){mode=value;$('paperMode').classList.toggle('selected',mode==='paper');$('liveMode').classList.toggle('selected',mode==='live');$('liveNotice').hidden=mode!=='live';$('paperConnect').hidden=mode!=='paper';$('liveConnect').hidden=mode!=='live';fillConfig();render();updateMarket();if(mode==='live'&&session)refreshCloud().catch(e=>notice(e.message,true));}
$('paperMode').onclick=()=>switchMode('paper');$('liveMode').onclick=()=>switchMode('live');
$('goLive').onclick=()=>{switchMode('live');page('settings');};
function updateAccount(){
 const logged=!!session?.user,name=session?.user?.user_metadata?.display_name||session?.user?.email||'บัญชีของคุณ';
 text('accountBtn',logged?name:'เข้าสู่ระบบ');text('accountStatus',logged?'เข้าสู่ระบบแล้ว: '+name:'กรุณาเข้าสู่ระบบก่อนเชื่อม API');
 $('keyForm').hidden=!logged;$('loginSettings').hidden=logged;$('logoutBtn').hidden=!logged;$('walletBtn').hidden=!logged;$('removeKey').hidden=!logged||!cloud?.key?.configured;$('newRecovery').hidden=!logged;
}
async function refreshCloud(){if(!session||cloudBusy)return;cloudBusy=true;try{cloud=await api('state',{auth:true});
 if(cloud.key?.configured&&Date.now()-lastWalletAttempt>25000){lastWalletAttempt=Date.now();try{liveWallet=(await api('wallet',{auth:true})).wallet;walletError='';}catch(e){walletError=e.message;}}
 updateAccount();render();}finally{cloudBusy=false;}}
function openAuth(){text('authError','');$('password').value='';$('recoverField').hidden=true;text('loginSubmit','เข้าสู่ระบบ');$('authDialog').showModal();}
$('accountBtn').onclick=()=>{if(!session)return openAuth();info('บัญชีของคุณ','บัญชีนี้เชื่อมกับคีย์ของคุณเท่านั้น ใช้หน้า ตั้งค่าและเชื่อมบัญชี เพื่อตรวจยอดหรือออกจากระบบ');};
$('loginSettings').onclick=openAuth;
$('logoutBtn').onclick=()=>perform(async()=>{const c=await sdk();const {error}=await c.auth.signOut();if(error)throw error;session=null;cloud=null;updateAccount();render();notice('ออกจากระบบแล้ว บอทที่เปิดบนเซิร์ฟเวอร์ยังทำงานจนกว่าจะกดหยุดบอท');});
async function login(action){
 if(authBusy)return;authBusy=true;text('authError','');
 for(const id of ['loginSubmit','registerBtn','recoverBtn'])$(id).disabled=true;
 const identifier=$('identifier').value.trim(),password=$('password').value;
 try{
 if(!identifier||!password)throw Error('กรุณากรอกชื่อผู้ใช้และรหัสผ่าน');
 if(action==='register'&&password.length<12)throw Error('บัญชีใหม่ใช้รหัสผ่านอย่างน้อย 12 ตัวอักษร');
 const out=await api(action,{method:'POST',data:{identifier,password,...(action==='recover'?{recoveryCode:$('recoveryCode').value.trim()}: {})}});
 if(action==='recover'){$('authDialog').close();recovery(out.recoveryCode);notice('เปลี่ยนรหัสผ่านแล้ว เข้าสู่ระบบด้วยรหัสใหม่ได้เลย');return;}
 const loginData=action==='register'?await api('login',{method:'POST',data:{identifier,password}}):out;
 const c=await sdk(),{error}=await c.auth.setSession(loginData.session);if(error)throw error;
 const {data}=await c.auth.getSession();session=data.session;$('authDialog').close();updateAccount();await refreshCloud();
 notice('เข้าสู่ระบบแล้ว เชื่อม API และบันทึกวงเงินเพื่อเริ่มบอทได้');
 if(out.recoveryCode)recovery(out.recoveryCode);
 }catch(e){text('authError',e.message);}
 finally{$('password').value='';$('recoveryCode').value='';authBusy=false;for(const id of ['loginSubmit','registerBtn','recoverBtn'])$(id).disabled=false;}
}
$('authForm').onsubmit=e=>{e.preventDefault();login($('recoverField').hidden?'login':'recover');};
$('registerBtn').onclick=()=>login('register');
$('recoverBtn').onclick=()=>{$('recoverField').hidden=!$('recoverField').hidden;text('loginSubmit',$('recoverField').hidden?'เข้าสู่ระบบ':'ตั้งรหัสผ่านใหม่');};
$('authDialog').addEventListener('close',()=>{$('password').value='';$('recoveryCode').value='';});
async function perform(task){if(actionBusy)return;actionBusy=true;render();try{await task();}catch(e){notice(e.message,true);}finally{actionBusy=false;render();}}
$('keyForm').onsubmit=e=>{e.preventDefault();perform(async()=>{
 try{await api('keys',{method:'POST',auth:true,data:{apiKey:$('apiKey').value.trim(),apiSecret:$('apiSecret').value.trim()}});notice('เชื่อม Bitkub และตรวจ Wallet สำเร็จ คีย์ถูกเข้ารหัสแล้ว');await refreshCloud();}
 finally{$('apiKey').value='';$('apiSecret').value='';$('keyPermission').checked=false;}
});};
$('walletBtn').onclick=()=>perform(async()=>{const x=await api('wallet',{auth:true});$('walletBox').hidden=false;liveWallet=x.wallet;text('walletBox','ยอดเงินจริงจาก Bitkub\nTHB ใช้ได้ '+money(x.wallet.THB.available)+' / ติดคำสั่ง '+money(x.wallet.THB.reserved)+'\n'+Object.entries(x.wallet).filter(([k,v])=>k!=='THB'&&typeof v==='object'&&v.available+v.reserved>0).slice(0,20).map(([k,v])=>k+' ใช้ได้ '+fmt(v.available,8)+' / ติดคำสั่ง '+fmt(v.reserved,8)).join('\n')+'\nตรวจเมื่อ '+time(x.wallet.at));render();});
$('removeKey').onclick=()=>{if(!confirm('ถอดคีย์ Bitkub ออกจากบัญชีนี้หรือไม่?'))return;perform(async()=>{await api('remove-key',{method:'POST',auth:true,data:{}});await refreshCloud();notice('ถอดคีย์แล้ว');});};
const fields=['budget','maxOrder','dailyBuy','dailySell','stopLoss','takeProfit','allocation','dailyLoss','maxDrawdown','walletReservePct','cashReserveTHB','riskPerTrade','minVolumeTHB','maxVolatility','maxHoldMinutes','dailyProfitTarget','maxEntries','lossStreakLimit','cooldownMinutes'];
const percentage=new Set(['stopLoss','takeProfit','allocation','dailyLoss','maxDrawdown','walletReservePct','riskPerTrade','maxVolatility','dailyProfitTarget']);
function fillConfig(){const c=cfg();for(const k of fields)$(k).value=Number((c[k]*(percentage.has(k)?100:1)).toFixed(4));
 $('strategyProfile').value=c.strategyProfile;$('strategyProfile').disabled=mode==='paper';document.querySelector('label[for=budget]').textContent=mode==='paper'?'ทุนจำลองต่อชุด (บาท)':'ทุนสูงสุดที่บอทใช้ได้ (บาท)';
 text('settingsMode',mode==='paper'?'ทดลอง':'เงินจริง');$('budget').max=mode==='paper'?'10000000':'100000';$('maxOrder').max=mode==='paper'?'100000':'1000';
 text('limitHint',mode==='paper'?'วันซื้อขายคิดตามเวลาไทย · ค่าธรรมเนียมทดลอง 0.25% และเผื่อราคาคลาดเคลื่อน':'เพดานเซิร์ฟเวอร์: คำสั่งละ 1,000 บาท / ซื้อวันละ 5,000 / ขายวันละ 10,000 บาท ลดเพดานได้ตามต้องการ');}
$('configForm').onsubmit=e=>{e.preventDefault();perform(async()=>{
 const next={...cfg()};for(const k of fields)next[k]=Number($(k).value)/(percentage.has(k)?100:1);
 next.strategyProfile=$('strategyProfile').value;
 const c=config(next,mode==='live');
 if(mode==='paper'){
 if(!session){openAuth();throw Error('เข้าสู่ระบบเพื่อบันทึกทุนทดลองบน Cloud');}
 if(running())throw Error('หยุดการทดลองก่อนเปลี่ยนทุน');
 await api('paper-config',{method:'POST',auth:true,data:{config:c,capital:c.budget}});await refreshCloud();
 }else{await api('save',{method:'POST',auth:true,data:{config:c}});await refreshCloud();}
 notice('บันทึกวงเงินและความเสี่ยงแล้ว');render();
});};
function stopPaper(){paperRunning=false;if(releaseLock){releaseLock();releaseLock=null;}render();}
async function startPaper(){
 if(!session){openAuth();notice('ทดลองบน Cloud ต้องเข้าสู่ระบบ ข้อมูลจะทำงานต่อได้แม้ปิดคอม');return;}
 await perform(async()=>{if(!cloud?.shadow){await api('paper-config',{method:'POST',auth:true,data:{config:cfg(),capital:cfg().budget}});}await api('shadow-toggle',{method:'POST',auth:true,data:{enabled:true}});await refreshCloud();notice('เริ่มทดลองบน Cloud แล้ว ใช้เงินจำลองเท่านั้น ไม่ต้องเปิดหน้านี้ไว้');});
}
$('startBtn').onclick=()=>{if(mode==='paper')return startPaper();if(!session){page('settings');openAuth();return;}
 if(cloud?.evidence&&!cloud.evidence.allowed&&!(cloud.bot?.state?.qty>0)){page('health');notice('พักเงินจริง: ดูความคืบหน้าและรายการที่ยังไม่ผ่านในหน้านี้',true);return;}
 if(!cloud?.key?.configured||!cloud?.bot){page('settings');notice('เชื่อม API และบันทึกวงเงินก่อนเริ่มบอทเงินจริง');return;}
 if(cloud.bot.state.halted){notice('พอร์ตถึงเพดานขาดทุนจากจุดสูงสุดแล้ว ตรวจประวัติและจัดการสถานะก่อนเริ่มรอบใหม่',true);return;}
 const c=cfg();text('startSummary','ทุนสูงสุด '+money(c.budget)+'\nสำรองเงิน '+fmt(c.walletReservePct*100,1)+'% + '+money(c.cashReserveTHB)+'\nต่อคำสั่ง '+money(c.maxOrder)+'\nซื้อรวมต่อวัน '+money(c.dailyBuy)+' / ขาย '+money(c.dailySell)+'\nStop Loss '+fmt(c.stopLoss*100,1)+'% / Take Profit '+fmt(c.takeProfit*100,1)+'%');
 $('startForm').reset();$('startDialog').showModal();
};
$('startForm').onsubmit=e=>{e.preventDefault();perform(async()=>{if($('confirmStart').value!=='เริ่มบอทเงินจริง')throw Error('กรุณาพิมพ์ เริ่มบอทเงินจริง ให้ตรงกัน');
 await api('start',{method:'POST',auth:true,data:{confirm:$('confirmStart').value,acceptRisk:$('riskAccepted').checked,noWithdraw:$('withdrawDisabled').checked}});$('startDialog').close();await refreshCloud();notice('เปิดบอทเงินจริงแล้ว เซิร์ฟเวอร์จะเริ่มตรวจตลาดภายใน 1 นาที');});};
$('pauseBtn').onclick=()=>perform(async()=>{if(mode==='paper'){await api('paper-pause',{method:'POST',auth:true,data:{paused:!cloud?.shadow?.buy_paused}});await refreshCloud();}else{await api(cfg().buyPaused?'resume':'pause',{method:'POST',auth:true,data:{}});await refreshCloud();}render();});
$('stopBtn').onclick=()=>{if(mode==='paper'){perform(async()=>{await api('shadow-toggle',{method:'POST',auth:true,data:{enabled:false}});await refreshCloud();notice('หยุดการทดลองบน Cloud แล้ว เก็บสถานะและประวัติไว้');});return;}
 if(!confirm('หยุดส่งคำสั่งใหม่และขอยกเลิกคำสั่งค้าง เหรียญที่ถือยังอยู่ใน Bitkub และจะไม่มีบอทเฝ้าขายต่อ ยืนยันหรือไม่?'))return;
 perform(async()=>{const x=await api('stop',{method:'POST',auth:true,data:{}});await refreshCloud();notice(x.note);});};
function renderAgents(){
 const t=trace();$('agentCards').replaceChildren();
 for(const a of agents){const found=t.find(x=>x.agent===a.id),b=document.createElement('button');b.className='agent'+(found?' has-result':'');b.style.setProperty('--accent',a.color);
 const avatar=document.createElement('div');avatar.className='avatar';avatar.setAttribute('aria-hidden','true');const name=document.createElement('strong');name.textContent=a.name;const role=document.createElement('small');role.textContent=a.role;const st=document.createElement('span');st.className='agent-status';st.textContent=found?(a.id==='trend'?found.bias||'ตรวจข้อมูล':a.id==='strategy'?found.signal||'HOLD':a.id==='risk'?found.action||'ตรวจความเสี่ยง':a.id==='execution'?(found.order?'มีคำสั่ง':'ตรวจคำสั่ง'):'จัดการรอบ'):'รอเริ่ม';b.append(avatar,name,role,st);b.onclick=()=>info(a.name+' · '+a.role,found?JSON.stringify(found,null,2):'ยังไม่มีผลประเมินจากรอบการทำงาน');$('agentCards').append(b);}
}
function renderDecision(container,rows){
 container.replaceChildren();if(!rows.length){const p=document.createElement('p');p.className='muted';p.textContent='ยังไม่มีผลประเมิน กดเริ่มบอทเพื่อดูเหตุผลของทีม';container.append(p);return;}
 for(const a of agents){const x=rows.find(t=>t.agent===a.id);if(!x)continue;const d=document.createElement('div');d.className='decision';d.style.setProperty('--accent',a.color);const b=document.createElement('b');b.textContent=a.name;const p=document.createElement('p');p.textContent=x.reason||'ตรวจข้อมูลแล้ว';d.append(b,p);container.append(d);}
}
function render(){
 const c=cfg(),s=state(),isRunning=running(),held=heldSymbol(s),equity=portfolioValue(s,[...(bundle?.markets||[]),...(bundle?.watchlist||[])]),pnl=performance(s,bundle?.watchlist||[],c).totalNet;
 text('portfolioLabel',mode==='paper'?'จำลอง Cloud':'พอร์ตบอท');text('equity',equity===null?'รอราคาเหรียญที่ถือ':money(equity));text('pnl',pnl===null?'—':(pnl>=0?'+':'−')+money(Math.abs(pnl)));$('pnl').className=pnl<0?'negative':'green';
 if(mode==='live'&&!cloud?.key?.configured){text('equity','ยังไม่เชื่อม Wallet');text('pnl','—');}
 text('cashHint',mode==='paper'?'ทุนจำลอง '+money(s.startCapital??c.budget):'เงินทุนที่จัดสรร ไม่ใช่ Wallet ทั้งหมด');
 text('pnlHint',mode==='paper'?'สุทธิค่าธรรมเนียมทดลอง':'ประมาณการจากประวัติจับคู่ ไม่รวมเครดิตที่ปรับภายหลัง');
 renderProfit();
 text('qty',fmt(s.qty,s.qtyScale??8)+' '+(assetOf(held)||'เหรียญ'));text('cash',money(s.cash));text('targets',fmt((s.entryPolicy?.stopLoss??c.stopLoss)*100,1)+'% / '+fmt((s.entryPolicy?.takeProfit??c.takeProfit)*100,1)+'%'+(s.entryPolicy?.maxHoldMinutes?' · '+s.entryPolicy.maxHoldMinutes+' นาที':''));
 text('botStatus',isRunning?((mode==='paper'?cloud?.shadow?.buy_paused:c.buyPaused)?'พักซื้อใหม่':'กำลังทำงาน'):s.halted?'ล็อกความเสี่ยง':'หยุดอยู่');
 text('botHint',mode==='live'?cloud?.bot?.last_error||'เซิร์ฟเวอร์ตรวจทุก 1 นาที':isRunning?'ทดลองบน Cloud แม้ปิดคอม':'เข้าสู่ระบบเพื่อเริ่มทดลองบน Cloud');
 text('teamBadge',isRunning?'TEAM ACTIVE':'STANDBY');text('startBtn',mode==='paper'?'▶ เริ่มทดลองบอท':'▶ เริ่มบอทเงินจริง');
 $('startBtn').disabled=actionBusy||isRunning;$('pauseBtn').disabled=actionBusy||!isRunning;$('stopBtn').disabled=actionBusy||!isRunning;
 text('pauseBtn',(mode==='paper'?cloud?.shadow?.buy_paused:c.buyPaused)?'ซื้อใหม่ต่อ':'พักซื้อใหม่');
 text('runNote',mode==='paper'?'ราคาตลาดจริง เงินจำลอง · ทำงานบน Cloud แม้ปิดเว็บ · การรีโหลดไม่เริ่มหรือหยุดระบบเอง':'บอททำงานบนเซิร์ฟเวอร์ · การพักซื้อยังตรวจขาย · ปุ่มหยุดทั้งหมดจะหยุดการเฝ้าสถานะด้วย');
 const live=cloud?.bot;$('serverActivity').hidden=!live?.running||mode==='live';
 if(live?.running&&mode==='paper')text('serverActivity','บอทเงินจริงของคุณยังทำงานบนเซิร์ฟเวอร์ สลับไปโหมดเงินจริงเพื่อดูหรือหยุด');
 if(live?.running&&Date.now()-Date.parse(live.updated_at)>180000){
 $('serverActivity').hidden=false;$('serverActivity').className='notice bad';text('serverActivity','เซิร์ฟเวอร์ไม่ได้อัปเดตเกิน 3 นาที กรุณาตรวจคำสั่งและสถานะที่ Bitkub');if(mode==='live')text('botStatus','รอตรวจเซิร์ฟเวอร์');
 }else $('serverActivity').className='notice';
 companyUI?.update().catch(e=>notice(e.message,true));renderCloudResearch();renderScanner();renderWalletPower();renderAgents();renderDecision($('decisionFeed'),trace());if(!$('history').hidden)renderHistory();
}
function chart(){
 if(!market?.candles.length)return;const cs=market.candles.slice(-80),values=cs.map(x=>x.c),lo=Math.min(...values),hi=Math.max(...values),span=hi-lo||1;
 const pts=values.map((v,i)=>[i/(values.length-1||1)*400,115-(v-lo)/span*100]);
 const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 400 145');svg.setAttribute('role','img');svg.setAttribute('aria-label','ราคาปิด 5 นาที ล่าสุด '+values.length+' แท่ง');
 for(let i=0;i<3;i++){const line=document.createElementNS(ns,'line');line.setAttribute('x1','0');line.setAttribute('x2','400');line.setAttribute('y1',String(15+i*50));line.setAttribute('y2',String(15+i*50));line.setAttribute('stroke','#2c3b4a');line.setAttribute('stroke-dasharray','3 4');svg.append(line);}
 const area=document.createElementNS(ns,'polygon');area.setAttribute('points','0,122 '+pts.map(p=>p.join(',')).join(' ')+' 400,122');area.setAttribute('fill','#92f7c212');svg.append(area);
 const line=document.createElementNS(ns,'polyline');line.setAttribute('points',pts.map(p=>p.join(',')).join(' '));line.setAttribute('fill','none');line.setAttribute('stroke','#92f7c2');line.setAttribute('stroke-width','2');svg.append(line);
 for(const [label,x] of [[new Date(cs[0].t).toLocaleTimeString('th-TH',{timeZone:'Asia/Bangkok',hour:'2-digit',minute:'2-digit'}),0],[new Date(cs.at(-1).t).toLocaleTimeString('th-TH',{timeZone:'Asia/Bangkok',hour:'2-digit',minute:'2-digit'}),365]]){const tx=document.createElementNS(ns,'text');tx.setAttribute('x',String(x));tx.setAttribute('y','142');tx.setAttribute('fill','#71859e');tx.setAttribute('font-size','9');tx.textContent=label;svg.append(tx);}
 $('chart').replaceChildren(svg);
}
function renderWalletPower(){
 const c=cfg(),s=state(),w=mode==='live'?liveWallet:null;
 const available=mode==='live'?w?.THB?.available:s.cash;
 text('walletAvailable',available===undefined?'รออ่าน Wallet':money(available));
 const reserve=Number.isFinite(available)?available*c.walletReservePct+c.cashReserveTHB:NaN;
 text('walletReserve',Number.isFinite(reserve)?money(Math.min(available,reserve)):'—');
 const spendable=Number.isFinite(available)?Math.max(0,available-reserve):NaN;
 text('walletSpendable',Number.isFinite(spendable)?money(Math.min(spendable,s.cash,c.maxOrder)):'—');
 text('walletSizingHint',mode==='live'?(walletError||'คำนวณจาก THB ที่ใช้ได้จริง ไม่รวมเงินติดคำสั่ง • ยืนยันยอดอีกครั้งก่อนส่งซื้อ'):'เงินในส่วนนี้เป็นกระเป๋าจำลอง • สำรองเงินและจำกัดความเสี่ยงด้วยกฎเดียวกับเงินจริง');
}
function renderScanner(){
 if(!bundle)return;
 const c=cfg(),s=state(),w=mode==='live'?liveWallet:null;
 const coord=trace().find(x=>x.agent==='coordinator'),out={market:bundle.markets.find(m=>m.symbol===coord?.selected),ranking:coord?.ranking||[]};
 text('scanCount',bundle.universeCount+' คู่ / วิเคราะห์ '+bundle.markets.length+' คู่');
 text('selectedCoin',heldSymbol(s)||out.market?.symbol||'รอจังหวะ');
 $('scannerBody').replaceChildren();
 const detailed=new Map((out.ranking||[]).map(x=>[x.symbol,x]));
 const sorted=[...bundle.watchlist].sort((a,b)=>(detailed.get(b.symbol)?.score??-1)-(detailed.get(a.symbol)?.score??-1));
 for(const row of sorted.slice(0,30)){
 const result=detailed.get(row.symbol),tr=document.createElement('tr');
 const values=[row.symbol,priceFmt(row.last),money(row.volumeTHB),fmt((row.ask-row.bid)/row.last*100,3)+'%',result?.score??'—',result?.signal||'รอคัดรอบถัดไป',(result?.reasons?.join(' • ')||row.reasons?.join(' • ')||'ผ่านคัดกรองเบื้องต้น')];
 for(const value of values){const td=document.createElement('td');td.textContent=String(value);tr.append(td);}$('scannerBody').append(tr);
 }
 const n=bundle.news;$('newsFeed').replaceChildren();
 text('newsState',n?.ready?'แหล่งข่าวพร้อม':'งดซื้อใหม่: ข่าวไม่พร้อม');
 text('newsSources',(n?.sources||[]).map(x=>x.name+': '+(x.ok?'อัปเดตแล้ว':'ไม่พร้อม')).join(' • ')+' • อ่านเนื้อหาได้ '+(n?.contentRead||0)+' บทความจากชุดข่าวล่าสุด');
 for(const item of (n?.items||[]).slice(0,6)){const div=document.createElement('div');div.className='history-entry';const a=document.createElement('a');a.textContent=item.title;a.href=item.url;a.target='_blank';a.rel='noopener noreferrer';const small=document.createElement('small');small.textContent=item.source+' · '+time(item.publishedAt)+' · '+(item.method==='JSON_LD_ARTICLE'||item.method==='HTML_ARTICLE'?'อ่านเนื้อหาแล้ว':'เฉพาะหัวข่าว');div.append(small,document.createElement('br'),a);$('newsFeed').append(div);}
}
let marketBusy=false;
async function updateMarket(){
 if(marketBusy)return;marketBusy=true;
 try{const holds=[...new Set([heldSymbol(paperState),heldSymbol(cloud?.bot?.state||{qty:0})].filter(Boolean))],x=await api('scan',{query:holds.length?{held:holds.join(',')}: {}});bundle=x.scan;
 const selected=heldSymbol(state())||trace().find(x=>x.agent==='coordinator')?.selected;market=bundle.markets.find(m=>m.symbol===selected)||bundle.markets[0];if(!market)throw Error('ไม่มีข้อมูลตลาดพร้อมแสดง');
 text('pairLabel',market.symbol.replace('_',' / '));text('officePair',market.symbol.replace('_',' / '));
 text('connection','BITKUB LIVE');$('connection').classList.remove('negative');text('price',priceFmt(market.last));text('chartPrice',priceFmt(market.last));text('officePrice',priceFmt(market.last));text('priceHint','ตรวจล่าสุด '+time(market.observedAt));
 text('ask',priceFmt(market.ask));text('bid',priceFmt(market.bid));text('spread',fmt((market.ask-market.bid)/market.last*100,3)+'%');text('change',(market.change>=0?'+':'')+fmt(market.change)+'%');$('change').classList.toggle('negative',market.change<0);chart();render();

 }catch(e){text('connection','ตลาดไม่พร้อม');$('connection').classList.add('negative');text('priceHint',e.message);
 if(paperRunning){stopPaper();notice('หยุดทดลองเพราะอ่านตลาดไม่ได้: '+e.message,true);}}
 finally{marketBusy=false;}
}
const statusName={RESERVED:'กำลังส่ง',OPEN:'รอจับคู่',UNKNOWN:'ไม่ทราบผล ห้ามส่งซ้ำ',FILLED:'จับคู่ครบ',CANCELED:'ยกเลิกแล้ว',REJECTED:'ตลาดปฏิเสธ'};
function rows(){return mode==='paper'?(cloud?.paperEvents||[]).filter(x=>x.payload?.kind==='FILL').map(x=>({at:x.payload.at,mode:'ทดลอง Cloud',symbol:x.payload.symbol,side:x.payload.side,amount:x.payload.qty,price:x.payload.price,status:'จับคู่จำลอง '+x.candidate})):(cloud?.orders||[]).map(x=>({at:x.created_at,mode:'เงินจริง',symbol:x.symbol,side:x.side,amount:x.side==='BUY'?x.amount+' THB':x.amount+' '+assetOf(x.symbol),price:x.price,status:statusName[x.status]||x.status,id:x.id}));}
function renderHistory(){
 renderDaily();
 $('tradesBody').replaceChildren();const rr=rows();if(!rr.length){const tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=7;td.textContent='ยังไม่มีรายการ';tr.append(td);$('tradesBody').append(tr);}
 for(const r of rr.slice(0,200)){const tr=document.createElement('tr');for(const [i,v] of [time(r.at),r.mode,r.symbol,r.side,typeof r.amount==='number'?fmt(r.amount,8)+' '+assetOf(r.symbol):r.amount,priceFmt(r.price),r.status].entries()){const td=document.createElement('td');td.textContent=v;if(i===3)td.className=r.side==='BUY'?'buy':'sell';tr.append(td);}if(r.id)tr.title='รหัสอ้างอิง '+r.id;$('tradesBody').append(tr);}
 $('historyFeed').replaceChildren();const journal=mode==='paper'?(cloud?.paperEvents||[]).map(x=>({...x,kind:'PAPER '+x.candidate,payload:x.payload})):cloud?.events||[];
 for(const j of journal){const d=document.createElement('div');d.className='history-entry';const sm=document.createElement('small');sm.textContent=time(j.at||j.created_at)+' · '+(j.kind||'PAPER CYCLE');const p=document.createElement('p');p.textContent=(j.trace||j.payload?.trace||[]).map(x=>x.agent+': '+x.reason).join('\n')||JSON.stringify(j.payload||{});d.append(sm,p);$('historyFeed').append(d);}
 $('lessons').replaceChildren();for(const [k,v] of Object.entries(state().lessons||{})){const p=document.createElement('p');p.textContent=k+' · กำไร '+v.wins+' รอบ / ขาดทุนหรือเท่าทุน '+v.losses+' รอบ';$('lessons').append(p);}
 if(!$('lessons').children.length)text('lessons','ยังไม่มีรอบที่ปิดสถานะ');
}
function download(name,data,type){const a=document.createElement('a'),url=URL.createObjectURL(new Blob([data],{type}));a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
$('exportCsv').onclick=()=>{const cells=v=>'"'+String(v).replaceAll('"','""')+'"';download('bitbot-'+mode+'-'+new Date().toISOString().slice(0,10)+'.csv','\uFEFF'+[['เวลาไทย','โหมด','เหรียญ','ประเภท','จำนวน','ราคา','สถานะ'],...rows().map(r=>[time(r.at),r.mode,r.symbol,r.side,r.amount,r.price,r.status])].map(a=>a.map(cells).join(',')).join('\r\n'),'text/csv;charset=utf-8');};
$('backup').onclick=()=>perform(async()=>{const result=session?await api('paper-export',{auth:true}):{events:[],coverage:{}};download('bitbot-paper-backup.json',JSON.stringify({version:14,exportedAt:new Date().toISOString(),cloudPaper:cloud?.shadow||null,...result,legacyLocal:{config:paperConfig,state:paperState,trades:paperTrades,journal:paperJournal}},null,2),'application/json');notice(result.coverage?.possiblyTruncated?'สำรองสถานะและ 10,000 เหตุการณ์ล่าสุดแล้ว ข้อมูลเก่ากว่านี้ยังอยู่ในฐานข้อมูล':'สำรองสถานะและประวัติทดลองแล้ว');});
$('refreshHistory').onclick=()=>perform(async()=>{if(mode==='live'){await api('tick',{method:'POST',auth:true,data:{}});await refreshCloud();}renderHistory();});
$('helpBtn').onclick=()=>info('เริ่มใช้งาน','ทดลอง: เข้าสู่ระบบ ตั้งทุนจำลองใน Risk Control แล้วกดเริ่มทดลองบอท ระบบทำงานบน Cloud แม้ปิดคอม แยกพอร์ต 6 ชุดและไม่ส่งคำสั่งเงินจริง\n\nเงินจริง: เชื่อม Bitkub API และบันทึกวงเงิน ตรวจความคืบหน้าใน System Health ก่อนยืนยันเริ่มด้วยตนเอง ผลวิจัยและผลทดลองต้องผ่านเกณฑ์ก่อนซื้อใหม่\n\nระบบคัดเหรียญคู่ THB จากสภาพคล่อง ข่าว แนวโน้ม และความผันผวน ถือทีละเหรียญต่อพอร์ต ใช้เงินบาทหลังสำรอง และไม่เกินเพดานทุน\n\nพักซื้อ: งดซื้อใหม่แต่ยังเฝ้าขาย\nหยุดบอท: หยุดส่งใหม่และขอยกเลิกออร์เดอร์ค้าง เหรียญที่ถือยังอยู่ ต้องดูแลเอง\nปิดสถานะ: ต้องยืนยันแยก ขายเฉพาะเหรียญที่บอทถือ\n\nStop Loss ตรวจทุก 1 นาที อาจขายไม่ทันราคาที่กำหนดได้ ไม่มีการรับประกันกำไร');
window.addEventListener('online',()=>updateMarket());window.addEventListener('pagehide',()=>stopPaper());
document.addEventListener('visibilitychange',()=>{if(!document.hidden){updateMarket();if(session)refreshCloud().catch(e=>notice(e.message,true));}});
setInterval(()=>updateMarket(),30000);setInterval(()=>{if(session)refreshCloud().catch(e=>{if(mode==='live')notice(e.message,true);});},15000);

$('resetSession').onclick=()=>perform(async()=>{
 if(mode==='paper'){
 info('เริ่มรอบทดลองใหม่','หยุดการทดลองและปิดสถานะจำลองก่อน จากนั้นบันทึกทุนใหม่ใน Risk Control ประวัติรอบเดิมจะถูกเก็บไว้');return;
 }else{
 if(!confirm('ยืนยันว่าจัดการเหรียญที่ถือใน Bitkub แล้ว ระบบจะตรวจสถานะและคำสั่งค้างก่อนจบรอบ ผลกำไรของการขายภายนอกจะไม่ถูกแต่งขึ้น'))return;
 await api('reset-session',{method:'POST',auth:true,data:{}});await refreshCloud();notice('จบรอบเดิมและเก็บบันทึกแล้ว');
 }
});
$('newRecovery').onclick=()=>perform(async()=>{if(!confirm('สร้างรหัสกู้บัญชีใหม่หรือไม่? รหัสเดิมจะใช้ไม่ได้'))return;const x=await api('recovery-code',{method:'POST',auth:true,data:{}});recovery(x.recoveryCode);});
$('resolveOrder').onclick=()=>perform(async()=>{
 if(mode!=='live')throw Error('ใช้สำหรับคำสั่งเงินจริงเท่านั้น');
 const id=prompt('รหัสอ้างอิงคำสั่ง Bitbot ที่ไม่ทราบผล (ดูจากประวัติ)');
 if(!id)return;const exchangeId=prompt('เลขออร์เดอร์ที่ตรวจจากบัญชี Bitkub');if(!exchangeId)return;
 await api('resolve-order',{method:'POST',auth:true,data:{id,exchangeId}});await refreshCloud();notice('ตรวจเลขออร์เดอร์แล้ว เซิร์ฟเวอร์จะตรวจผลการจับคู่ในรอบถัดไป');
});

let companyUI=attachCompanyUI({api,getContext:()=>({cloud,bundle,mode,wallet:liveWallet,config:cfg(),state:state(),accountId:session?.user?.id}),info,notice,openAuth,refresh:refreshCloud});
$('paperCandidate').onchange=()=>{fillConfig();render();updateMarket();};
const params=new URLSearchParams(location.search);
const legacy=location.pathname.split('/').at(-1)||'';
if(params.get('mode')==='live'||['bitkub-live.html','bitkub-setup.html','bitbot-login.html'].includes(legacy))switchMode('live');
if(params.get('page')&&document.getElementById(params.get('page'))?.classList.contains('page'))page(params.get('page'));
if(params.get('page')==='settings'||['bitkub-setup.html','bitbot-login.html'].includes(legacy))page('settings');
fillConfig();render();updateMarket();
(async()=>{try{const c=await sdk(),{data,error}=await c.auth.getSession();if(error)throw error;session=data.session;updateAccount();if(session)await refreshCloud();}catch(e){if(mode==='live')notice(e.message,true);}})();

function renderProfit(){
 const s=state(),c=cfg(),p=performance(s,bundle?.watchlist||[],c),day=dayKey(Date.now());
 for(const [id,v] of [['realizedPnl',p.realized],['unrealizedPnl',p.unrealized],['todayPnl',s.day===day?s.dayPnl:0]]){
 text(id,v===null?'รอราคา':(v>=0?'+':'−')+money(Math.abs(v)));$(id).className=v<0?'negative':'green';
 }
 text('paidFees',money(p.fees));text('profitDay',day+' · ไทย');
 text('dailyGuard','เข้าเทรดวันนี้ '+(s.day===day?s.entriesToday||0:0)+' / '+c.maxEntries+' ครั้ง · พักซื้อเมื่อกำไรที่ขายแล้วถึง '+(c.dailyProfitTarget>0?money((s.dayStart||s.cash)*c.dailyProfitTarget):'ปิดเป้าพักซื้อ')+((s.cooldownUntil||0)>Date.now()?' · พักหลังขาดทุนถึง '+time(s.cooldownUntil):''));
}
function renderDaily(){
 const s=state(),p=performance(s,bundle?.watchlist||[],cfg());
 $('dailyBody').replaceChildren();
 for(const row of p.daily.slice(-90).reverse()){
 const tr=document.createElement('tr');for(const v of [row.day,money(row.realized),money(row.fees),row.entries,row.rounds,row.wins+' / '+row.losses]){const td=document.createElement('td');td.textContent=String(v);tr.append(td);}$('dailyBody').append(tr);
 }
 if(!p.daily.length){const tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=6;td.textContent='ยังไม่มีการจับคู่หลังอัปเดตนี้';tr.append(td);$('dailyBody').append(tr);}
 text('reportingNote',s.trackingSince?'รายละเอียดรายวันเริ่มเก็บ '+time(s.trackingSince)+' · ผลสะสมเดิมยังอยู่ในยอดกำไรที่ขายแล้ว รายการก่อนอัปเดตไม่ได้สร้างรายละเอียดขึ้นใหม่':'รายละเอียดแสดงตั้งแต่เริ่มเก็บข้อมูลรุ่นนี้ ไม่รวมการซื้อขายที่คุณทำเองนอกบอท');
}
async function loadBacktest(){
 try{
 const r=await fetch('./assets/backtest-v12.json?v=13.0.0',{cache:'no-store'});if(!r.ok)throw Error('pending');
 const data=await r.json();if(!Array.isArray(data.folds)||!data.folds.length)throw Error('pending');
 text('backtestSummary',data.status==='INSUFFICIENT_DATA'?'ข้อมูล '+data.from+' ถึง '+data.to+' ยังขาดช่วงจนไม่ผ่านเกณฑ์ความครอบคลุม 75% จึงยังสรุปกำไรจากการทดสอบย้อนหลังไม่ได้':'ข้อมูล '+data.from+' ถึง '+data.to+' · '+data.symbols.join(', ')+' · '+data.folds.length+' ช่วงทดสอบถัดจากช่วงฝึก · '+(data.totalNet>=0?'กำไร':'ขาดทุน')+'รวม '+money(Math.abs(data.totalNet))+' จากทุนเริ่มต่อช่วง '+money(data.capitalPerFold)+' · ผลนี้ยังไม่ยืนยันกำไรทุกวัน');
 $('backtestBody').replaceChildren();
 for(const row of data.folds){
 const values=row.status==='INSUFFICIENT_DATA'?[row.from+' – '+row.to,'ข้อมูลไม่พอ','—','ยังสรุปไม่ได้','—','—']:[row.from+' – '+row.to,row.maxHoldMinutes+' นาที',row.rounds,money(row.net),fmt(row.maxDrawdown*100)+'%',row.profitableDays+' / '+row.days];
 const tr=document.createElement('tr');for(const v of values){const td=document.createElement('td');td.textContent=String(v);tr.append(td);}$('backtestBody').append(tr);
 }
 }catch{text('backtestSummary','ยังไม่มีผลทดสอบย้อนหลังที่ตรวจสอบได้ กำลังเก็บผลทดลองเดินหน้า ไม่ถือว่าผ่านเกณฑ์ใช้เงินจริง');}
}
loadBacktest();

function renderCloudResearch(){
 const sh=cloud?.shadow;const evidence=cloud?.evidence;
 text('evidenceState',evidence?(evidence.allowed?'ผ่านเงื่อนไขพิจารณาเงินจริง':'พักเงินจริง: '+evidence.reasons.join(' • ')):'เข้าสู่ระบบเพื่อดูผลทดลองอัตโนมัติของบัญชีคุณ');
 text('cloudResearchStatus',!sh?'ยังไม่มีการทดลองบนเซิร์ฟเวอร์':sh.last_error?'ข้อมูลทดลองไม่พร้อม: '+sh.last_error:sh.enabled?'กำลังเก็บผลด้วยเงินจำลอง แม้ปิดคอม':'พักการทดลองอยู่');
 text('researchCapital',sh?'ทุนจำลองชุดละ '+money(Number(sh.capital)):'เงินจำลองแยกจากเงินจริง');
 const control=$('researchToggle');control.hidden=!session;control.disabled=actionBusy;text('researchToggle',sh?.enabled?'พักทดลองอัตโนมัติ':'เริ่มทดลองอัตโนมัติ');
 $('cloudResearchBody').replaceChildren();
 for(const [key,record] of Object.entries(sh?.states||{})){
 const p=performance(record.state,bundle?.watchlist||[],cfg()),tr=document.createElement('tr');
 for(const value of [key,(record.roundPnls||[]).length,money(p.realized),p.unrealized===null?'รอราคา':money(p.unrealized),money(p.fees),record.pending?'รอจับคู่จำลอง':record.error||'รอจังหวะ']){const td=document.createElement('td');td.textContent=String(value);tr.append(td);}$('cloudResearchBody').append(tr);
 }
}
$('researchToggle').onclick=()=>perform(async()=>{await api('shadow-toggle',{method:'POST',auth:true,data:{enabled:!cloud?.shadow?.enabled}});await refreshCloud();});
async function loadResearch(){
 try{const r=await fetch('./assets/research-v13.json?v=13.0.0',{cache:'no-store'});if(!r.ok)throw Error('pending');const data=await r.json();
 text('researchDecision',data.decision+' · ข้อมูล '+data.dataFrom+' ถึง '+data.dataTo+' · ช่วงสุดท้าย '+data.final.from+' – '+data.final.to+(data.final.selected?'':' ยังไม่ถูกใช้เลือกค่า เพราะไม่มีตัวเลือกผ่านช่วงฝึก'));
 $('researchTrainingBody').replaceChildren();
 for(const [capital,rows] of [[10000,data.final.training],[79.98,data.final.smallCapitalTraining||[]]])for(const row of rows){
 const tr=document.createElement('tr');for(const value of [row.candidate.profile,row.candidate.hold+' นาที',money(capital),row.rounds,row.net===null?'ข้อมูลไม่พอ':money(row.net),fmt(row.profitFactor,2),row.status==='QUALIFIED'&&row.rounds>=20&&row.net>0&&row.profitFactor>=1.15&&row.maxDrawdown<=.03?'ผ่านช่วงฝึก':'ยังไม่ผ่าน']){const td=document.createElement('td');td.textContent=String(value);tr.append(td);}$('researchTrainingBody').append(tr);
 }
 }catch{text('researchDecision','ยังอ่านรายงานการทดลองไม่ได้ จึงยังไม่มีหลักฐานอนุมัติให้ใช้เงินจริง');}
}
loadResearch();
