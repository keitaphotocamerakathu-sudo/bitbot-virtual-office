import {DEFAULTS,config,initial,paperCycle} from './engine.mjs';
const $=id=>document.getElementById(id);
const CFG=window.BITBOT_CLOUD_CONFIG;
const ENDPOINT=CFG.url+'/functions/v1/bitbot-v10';
const STORE='bitbot-v10-paper';
const fmt=(v,d=2)=>Number.isFinite(Number(v))?Number(v).toLocaleString('th-TH',{minimumFractionDigits:d,maximumFractionDigits:d}):'—';
const money=v=>'฿'+fmt(v);
const time=v=>new Date(v).toLocaleString('th-TH',{timeZone:'Asia/Bangkok',dateStyle:'short',timeStyle:'medium'});
const agents=[
{id:'coordinator',name:'COORDINATOR',role:'ประสานงาน',color:'#b7a4ff'},
{id:'trend',name:'TREND',role:'วิเคราะห์แนวโน้ม',color:'#8bc8ff'},
{id:'strategy',name:'STRATEGY',role:'วางกลยุทธ์',color:'#ffcd88'},
{id:'risk',name:'RISK',role:'คุมความเสี่ยง',color:'#9af5c7'},
{id:'execution',name:'EXECUTION',role:'ส่งและตรวจคำสั่ง',color:'#ffacbe'}];
let mode='paper',market=null,session=null,client=null,cloud=null,cloudBusy=false,authBusy=false,actionBusy=false;
let paperConfig=config(),paperState=initial(paperConfig),paperTrades=[],paperJournal=[],paperRunning=false,lastCycle=0,releaseLock=null,cycleBusy=false;
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
async function api(action,{method='GET',data,auth=false}={}){
 const headers={Accept:'application/json',apikey:CFG.publishableKey};
 if(data!==undefined)headers['Content-Type']='application/json';
 if(auth){const c=await sdk();const {data:res,error}=await c.auth.getSession();if(error||!res.session)throw Error('กรุณาเข้าสู่ระบบก่อน');session=res.session;headers.Authorization='Bearer '+session.access_token;}
 let r;try{r=await fetch(ENDPOINT+'?action='+encodeURIComponent(action),{method,headers,...(data!==undefined?{body:JSON.stringify(data)}:{}),signal:AbortSignal.timeout(25000),cache:'no-store'});}
 catch(e){throw Error(e.name==='TimeoutError'||e.name==='AbortError'?'บริการตอบช้า กรุณาตรวจสถานะก่อนลองใหม่':'เชื่อมเซิร์ฟเวอร์ไม่ได้ กรุณาตรวจอินเทอร์เน็ต');}
 const x=await r.json().catch(()=>({}));if(!r.ok||!x.ok)throw Error(x.error||'ระบบตอบกลับ '+r.status);return x;
}
function page(name){for(const e of document.querySelectorAll('.page'))e.hidden=e.id!==name;for(const e of document.querySelectorAll('.nav-item'))e.classList.toggle('active',e.dataset.page===name);if(name==='settings')fillConfig();if(name==='history')renderHistory();}
document.querySelectorAll('[data-page]').forEach(e=>e.addEventListener('click',()=>page(e.dataset.page)));
function cfg(){return mode==='paper'?paperConfig:cloud?.bot?.config||config({budget:1000,maxOrder:100,dailyBuy:300,dailySell:1000},true);}
function state(){return mode==='paper'?paperState:cloud?.bot?.state||initial(cfg());}
function running(){return mode==='paper'?paperRunning:cloud?.bot?.running===true;}
function trace(){return mode==='paper'?paperJournal.at(-1)?.trace||[]:cloud?.events.find(x=>x.payload?.trace?.length)?.payload.trace||[];}
function switchMode(value){mode=value;$('paperMode').classList.toggle('selected',mode==='paper');$('liveMode').classList.toggle('selected',mode==='live');$('liveNotice').hidden=mode!=='live';$('paperConnect').hidden=mode!=='paper';$('liveConnect').hidden=mode!=='live';fillConfig();render();if(mode==='live'&&session)refreshCloud().catch(e=>notice(e.message,true));}
$('paperMode').onclick=()=>switchMode('paper');$('liveMode').onclick=()=>switchMode('live');
$('goLive').onclick=()=>{switchMode('live');page('settings');};
function updateAccount(){
 const logged=!!session?.user,name=session?.user?.user_metadata?.display_name||session?.user?.email||'บัญชีของคุณ';
 text('accountBtn',logged?name:'เข้าสู่ระบบ');text('accountStatus',logged?'เข้าสู่ระบบแล้ว: '+name:'กรุณาเข้าสู่ระบบก่อนเชื่อม API');
 $('keyForm').hidden=!logged;$('loginSettings').hidden=logged;$('logoutBtn').hidden=!logged;$('walletBtn').hidden=!logged;$('removeKey').hidden=!logged||!cloud?.key?.configured;$('newRecovery').hidden=!logged;
}
async function refreshCloud(){if(!session||cloudBusy)return;cloudBusy=true;try{cloud=await api('state',{auth:true});updateAccount();render();}finally{cloudBusy=false;}}
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
$('walletBtn').onclick=()=>perform(async()=>{const x=await api('wallet',{auth:true});$('walletBox').hidden=false;text('walletBox','ยอดเงินจริงจาก Bitkub\nTHB ใช้ได้ '+money(x.wallet.THB.available)+' / ติดคำสั่ง '+money(x.wallet.THB.reserved)+'\nBTC ใช้ได้ '+fmt(x.wallet.BTC.available,8)+' / ติดคำสั่ง '+fmt(x.wallet.BTC.reserved,8)+'\nตรวจเมื่อ '+time(x.wallet.at));});
$('removeKey').onclick=()=>{if(!confirm('ถอดคีย์ Bitkub ออกจากบัญชีนี้หรือไม่?'))return;perform(async()=>{await api('remove-key',{method:'POST',auth:true,data:{}});await refreshCloud();notice('ถอดคีย์แล้ว');});};
const fields=['budget','maxOrder','dailyBuy','dailySell','stopLoss','takeProfit','allocation','dailyLoss','maxDrawdown'];
const percentage=new Set(['stopLoss','takeProfit','allocation','dailyLoss','maxDrawdown']);
function fillConfig(){const c=cfg();for(const k of fields)$(k).value=Number((c[k]*(percentage.has(k)?100:1)).toFixed(4));
 text('settingsMode',mode==='paper'?'ทดลอง':'เงินจริง');$('budget').max=mode==='paper'?'10000000':'100000';$('maxOrder').max=mode==='paper'?'100000':'1000';
 text('limitHint',mode==='paper'?'วันซื้อขายคิดตามเวลาไทย · ค่าธรรมเนียมทดลอง 0.25% และเผื่อราคาคลาดเคลื่อน':'เพดานเซิร์ฟเวอร์: คำสั่งละ 1,000 บาท / ซื้อวันละ 5,000 / ขายวันละ 10,000 บาท ลดเพดานได้ตามต้องการ');}
$('configForm').onsubmit=e=>{e.preventDefault();perform(async()=>{
 const next={...cfg()};for(const k of fields)next[k]=Number($(k).value)/(percentage.has(k)?100:1);
 const c=config(next,mode==='live');
 if(mode==='paper'){
 if(paperRunning||paperState.qty>0)throw Error('หยุดบอทและรอปิดสถานะก่อนเปลี่ยนทุน');
 const s=initial(c),journal=[...paperJournal,{at:Date.now(),trace:[{agent:'coordinator',reason:'บันทึกทุนรอบใหม่ เก็บประวัติเก่าแล้ว'}]}].slice(-300);
 checkpoint({config:c,state:s,trades:paperTrades,journal});paperConfig=c;paperState=s;paperJournal=journal;
 }else{await api('save',{method:'POST',auth:true,data:{config:c}});await refreshCloud();}
 notice('บันทึกวงเงินและความเสี่ยงแล้ว');render();
});};
function stopPaper(){paperRunning=false;if(releaseLock){releaseLock();releaseLock=null;}render();}
async function paperTick(){
 if(!paperRunning||cycleBusy||!market)return;cycleBusy=true;
 try{const out=paperCycle(market,paperState,paperConfig,Date.now()),journal=[...paperJournal,{at:Date.now(),trace:out.trace,error:out.error}].slice(-300),trades=out.fill?[...paperTrades,out.fill].slice(-5000):paperTrades;
 checkpoint({config:paperConfig,state:out.state,trades,journal});paperState=out.state;paperTrades=trades;paperJournal=journal;lastCycle=Date.now();
 if(out.error){stopPaper();notice('บอททดลองหยุด: '+out.error,true);}render();
 }catch(e){stopPaper();notice(e.message,true);}finally{cycleBusy=false;}
}
function startPaper(){
 if(paperRunning)return;
 if(!market){notice('รอเชื่อมข้อมูลตลาดก่อนเริ่ม',true);return;}
 if(!navigator.locks){notice('เบราว์เซอร์นี้ไม่รองรับการป้องกันเปิดบอทซ้ำ กรุณาใช้ Chrome หรือ Safari รุ่นปัจจุบัน',true);return;}
 navigator.locks.request('bitbot-v10-paper',{ifAvailable:true},async lock=>{
 if(!lock){notice('มีหน้าต่างอื่นเปิดบอททดลองอยู่ กรุณาหยุดที่หน้าต่างนั้นก่อน',true);return;}
 // Read the latest snapshot after acquiring the cross-tab lock.
 const raw=JSON.parse(localStorage.getItem(STORE)||'null');if(raw?.version===10){paperConfig=config(raw.config);paperState=raw.state;paperTrades=raw.trades;paperJournal=raw.journal;}
 paperRunning=true;render();notice('เริ่มทดลองด้วยเงินจำลองแล้ว ตรวจทุก 1 นาทีขณะเปิดหน้านี้');
 const hold=new Promise(resolve=>{releaseLock=resolve;});await paperTick();await hold;
 }).catch(e=>{stopPaper();notice(e.message,true);});
}
$('startBtn').onclick=()=>{if(mode==='paper')return startPaper();if(!session){page('settings');openAuth();return;}
 if(!cloud?.key?.configured||!cloud?.bot){page('settings');notice('เชื่อม API และบันทึกวงเงินก่อนเริ่มบอทเงินจริง');return;}
 if(cloud.bot.state.halted){notice('พอร์ตถึงเพดานขาดทุนจากจุดสูงสุดแล้ว ตรวจประวัติและจัดการสถานะก่อนเริ่มรอบใหม่',true);return;}
 const c=cfg();text('startSummary','เงินทุน '+money(c.budget)+'\nต่อคำสั่ง '+money(c.maxOrder)+'\nซื้อรวมต่อวัน '+money(c.dailyBuy)+' / ขาย '+money(c.dailySell)+'\nStop Loss '+fmt(c.stopLoss*100,1)+'% / Take Profit '+fmt(c.takeProfit*100,1)+'%');
 $('startForm').reset();$('startDialog').showModal();
};
$('startForm').onsubmit=e=>{e.preventDefault();perform(async()=>{if($('confirmStart').value!=='เริ่มบอทเงินจริง')throw Error('กรุณาพิมพ์ เริ่มบอทเงินจริง ให้ตรงกัน');
 await api('start',{method:'POST',auth:true,data:{confirm:$('confirmStart').value,acceptRisk:$('riskAccepted').checked,noWithdraw:$('withdrawDisabled').checked}});$('startDialog').close();await refreshCloud();notice('เปิดบอทเงินจริงแล้ว เซิร์ฟเวอร์จะเริ่มตรวจตลาดภายใน 1 นาที');});};
$('pauseBtn').onclick=()=>perform(async()=>{if(mode==='paper'){paperConfig={...paperConfig,buyPaused:!paperConfig.buyPaused};checkpoint();}else{await api(cfg().buyPaused?'resume':'pause',{method:'POST',auth:true,data:{}});await refreshCloud();}render();});
$('stopBtn').onclick=()=>{if(mode==='paper'){stopPaper();notice('หยุดบอททดลองแล้ว สถานะและข้อมูลยังเก็บไว้');return;}
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
 const c=cfg(),s=state(),isRunning=running(),equity=s.cash+s.qty*(market?.bid||0),pnl=equity-c.budget;
 text('portfolioLabel',mode==='paper'?'จำลอง':'พอร์ตบอท');text('equity',s.qty&&!market?'รอราคาตลาด':money(equity));text('pnl',s.qty&&!market?'—':(pnl>=0?'+':'−')+money(Math.abs(pnl)));$('pnl').className=pnl<0?'negative':'green';
 text('cashHint',mode==='paper'?'ทุนจำลอง '+money(c.budget):'เงินทุนที่จัดสรร ไม่ใช่ Wallet ทั้งหมด');
 text('pnlHint',mode==='paper'?'สุทธิค่าธรรมเนียมทดลอง':'ประมาณการจากประวัติจับคู่ ไม่รวมเครดิตที่ปรับภายหลัง');
 text('qty',fmt(s.qty,8)+' BTC');text('cash',money(s.cash));text('targets',fmt(c.stopLoss*100,1)+'% / '+fmt(c.takeProfit*100,1)+'%');
 text('botStatus',isRunning?(c.buyPaused?'พักซื้อใหม่':'กำลังทำงาน'):s.halted?'ล็อกความเสี่ยง':'หยุดอยู่');
 text('botHint',mode==='live'?cloud?.bot?.last_error||'เซิร์ฟเวอร์ตรวจทุก 1 นาที':paperRunning?'เปิดหน้านี้ไว้ให้บอททำงาน':'เริ่มได้ทันที ไม่ต้องล็อกอิน');
 text('teamBadge',isRunning?'TEAM ACTIVE':'STANDBY');text('startBtn',mode==='paper'?'▶ เริ่มทดลองบอท':'▶ เริ่มบอทเงินจริง');
 $('startBtn').disabled=actionBusy||isRunning;$('pauseBtn').disabled=actionBusy||!isRunning;$('stopBtn').disabled=actionBusy||!isRunning;
 text('pauseBtn',c.buyPaused?'ซื้อใหม่ต่อ':'พักซื้อใหม่');
 text('runNote',mode==='paper'?'ราคาตลาดจริง เงินจำลอง · ต้องเปิดหน้านี้ไว้ · ไม่เริ่มใหม่เองเมื่อปิดหรือรีโหลด':'บอททำงานบนเซิร์ฟเวอร์ · การพักซื้อยังตรวจขาย · ปุ่มหยุดทั้งหมดจะหยุดการเฝ้าสถานะด้วย');
 const live=cloud?.bot;$('serverActivity').hidden=!live?.running||mode==='live';
 if(live?.running&&mode==='paper')text('serverActivity','บอทเงินจริงของคุณยังทำงานบนเซิร์ฟเวอร์ สลับไปโหมดเงินจริงเพื่อดูหรือหยุด');
 renderAgents();renderDecision($('decisionFeed'),trace());if(!$('history').hidden)renderHistory();
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
let marketBusy=false;
async function updateMarket(){
 if(marketBusy)return;marketBusy=true;
 try{const x=await api('market');market=x.market;
 text('connection','BITKUB LIVE');$('connection').classList.remove('negative');text('price',money(market.last));text('chartPrice',money(market.last));text('officePrice',money(market.last));text('priceHint','ตรวจล่าสุด '+time(market.observedAt));
 text('ask',money(market.ask));text('bid',money(market.bid));text('spread',fmt((market.ask-market.bid)/market.last*100,3)+'%');text('change',(market.change>=0?'+':'')+fmt(market.change)+'%');$('change').classList.toggle('negative',market.change<0);chart();render();
 if(paperRunning&&Date.now()-lastCycle>=59000)await paperTick();
 }catch(e){text('connection','ตลาดไม่พร้อม');$('connection').classList.add('negative');text('priceHint',e.message);
 if(paperRunning){stopPaper();notice('หยุดทดลองเพราะอ่านตลาดไม่ได้: '+e.message,true);}}
 finally{marketBusy=false;}
}
const statusName={RESERVED:'กำลังส่ง',OPEN:'รอจับคู่',UNKNOWN:'ไม่ทราบผล ห้ามส่งซ้ำ',FILLED:'จับคู่ครบ',CANCELED:'ยกเลิกแล้ว',REJECTED:'ตลาดปฏิเสธ'};
function rows(){return mode==='paper'?paperTrades.slice().reverse().map(x=>({at:x.at,mode:'ทดลอง',side:x.side,amount:x.qty,price:x.price,status:'จับคู่จำลอง'})):(cloud?.orders||[]).map(x=>({at:x.created_at,mode:'เงินจริง',side:x.side,amount:x.side==='BUY'?x.amount+' THB':x.amount+' BTC',price:x.price,status:statusName[x.status]||x.status,id:x.id}));}
function renderHistory(){
 $('tradesBody').replaceChildren();const rr=rows();if(!rr.length){const tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=6;td.textContent='ยังไม่มีรายการ';tr.append(td);$('tradesBody').append(tr);}
 for(const r of rr.slice(0,200)){const tr=document.createElement('tr');for(const [i,v] of [time(r.at),r.mode,r.side,typeof r.amount==='number'?fmt(r.amount,8)+' BTC':r.amount,money(r.price),r.status].entries()){const td=document.createElement('td');td.textContent=v;if(i===2)td.className=r.side==='BUY'?'buy':'sell';tr.append(td);}if(r.id)tr.title='รหัสอ้างอิง '+r.id;$('tradesBody').append(tr);}
 $('historyFeed').replaceChildren();const journal=mode==='paper'?paperJournal.slice(-50).reverse():cloud?.events||[];
 for(const j of journal){const d=document.createElement('div');d.className='history-entry';const sm=document.createElement('small');sm.textContent=time(j.at||j.created_at)+' · '+(j.kind||'PAPER CYCLE');const p=document.createElement('p');p.textContent=(j.trace||j.payload?.trace||[]).map(x=>x.agent+': '+x.reason).join('\n')||JSON.stringify(j.payload||{});d.append(sm,p);$('historyFeed').append(d);}
 $('lessons').replaceChildren();for(const [k,v] of Object.entries(state().lessons||{})){const p=document.createElement('p');p.textContent=k+' · กำไร '+v.wins+' รอบ / ขาดทุนหรือเท่าทุน '+v.losses+' รอบ';$('lessons').append(p);}
 if(!$('lessons').children.length)text('lessons','ยังไม่มีรอบที่ปิดสถานะ');
}
function download(name,data,type){const a=document.createElement('a'),url=URL.createObjectURL(new Blob([data],{type}));a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
$('exportCsv').onclick=()=>{const cells=v=>'"'+String(v).replaceAll('"','""')+'"';download('bitbot-'+mode+'-'+new Date().toISOString().slice(0,10)+'.csv','\uFEFF'+[['เวลาไทย','โหมด','ประเภท','จำนวน','ราคา','สถานะ'],...rows().map(r=>[time(r.at),r.mode,r.side,r.amount,r.price,r.status])].map(a=>a.map(cells).join(',')).join('\r\n'),'text/csv;charset=utf-8');};
$('backup').onclick=()=>download('bitbot-paper-backup.json',JSON.stringify({version:10,exportedAt:new Date().toISOString(),config:paperConfig,state:paperState,trades:paperTrades,journal:paperJournal},null,2),'application/json');
$('refreshHistory').onclick=()=>perform(async()=>{if(mode==='live'){await api('tick',{method:'POST',auth:true,data:{}});await refreshCloud();}renderHistory();});
$('helpBtn').onclick=()=>info('เริ่มใช้งานใน 3 ขั้นตอน','ทดลอง: กด เริ่มทดลองบอท ได้เลย เงินเริ่มต้น 100,000 บาทเป็นเงินจำลอง\n\nเงินจริง: 1. เข้าสู่ระบบหรือสมัครด้วยชื่อผู้ใช้ 2. เชื่อม Bitkub API และบันทึกวงเงิน 3. กดเริ่มบอทเงินจริงและยืนยัน\n\nพักซื้อ: งดซื้อใหม่แต่ยังเฝ้าขาย\nหยุดบอท: หยุดส่งใหม่และขอยกเลิกออร์เดอร์ค้าง เหรียญที่ถือยังอยู่ ต้องดูแลเอง\n\nStop Loss ตรวจทุก 1 นาที อาจขายไม่ทันราคาที่กำหนดได้ ไม่มีการรับประกันกำไร');
window.addEventListener('online',()=>updateMarket());window.addEventListener('pagehide',()=>stopPaper());
document.addEventListener('visibilitychange',()=>{if(!document.hidden){updateMarket();if(session)refreshCloud().catch(e=>notice(e.message,true));}});
setInterval(()=>updateMarket(),15000);setInterval(()=>{if(session)refreshCloud().catch(e=>{if(mode==='live')notice(e.message,true);});},15000);

$('resetSession').onclick=()=>perform(async()=>{
 if(mode==='paper'){
 if(paperRunning)throw Error('หยุดบอทก่อนเริ่มรอบใหม่');
 if(!confirm('เริ่มทดลองรอบใหม่ด้วยทุนที่ตั้งไว้หรือไม่? สถานะเหรียญจำลองจะถูกล้าง ประวัติซื้อขายเดิมยังดูได้'))return;
 paperJournal=[...paperJournal,{at:Date.now(),trace:[{agent:'coordinator',reason:'จบรอบทดลองเดิม มูลค่าพอร์ต '+money(paperState.cash+paperState.qty*(market?.bid||0))}]}].slice(-300);
 paperState=initial(paperConfig);checkpoint();render();notice('เริ่มรอบทดลองใหม่ได้แล้ว');
 }else{
 if(!confirm('ยืนยันว่าจัดการ BTC ที่ Bitkub แล้ว ระบบจะตรวจว่าไม่มี BTC และคำสั่งค้างก่อนจบรอบ ผลกำไรของการขายภายนอกจะไม่ถูกแต่งขึ้น'))return;
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

const params=new URLSearchParams(location.search);
const legacy=location.pathname.split('/').at(-1)||'';
if(params.get('mode')==='live'||['bitkub-live.html','bitkub-setup.html','bitbot-login.html'].includes(legacy))switchMode('live');
if(params.get('page')==='settings'||['bitkub-setup.html','bitbot-login.html'].includes(legacy))page('settings');
fillConfig();render();updateMarket();
(async()=>{try{const c=await sdk(),{data,error}=await c.auth.getSession();if(error)throw error;session=data.session;updateAccount();if(session)await refreshCloud();}catch(e){if(mode==='live')notice(e.message,true);}})();
