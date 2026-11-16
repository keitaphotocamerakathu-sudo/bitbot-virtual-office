// Bitbot Secure Bitkub setup: never persists API keys in browser; HTTPS to authenticated Edge Function.
(()=>{'use strict';
const $=id=>document.getElementById(id);
const cfg=window.BITBOT_CLOUD_CONFIG||{};
const endpoint='https://lrxrigimdaedfemqheug.supabase.co/functions/v1/bitkub-gateway';
let client=null,session=null,busy=false,lastId='',setupState=null;
function message(id,text,bad=false){const el=$(id);el.textContent=text;el.dataset.error=bad?'true':'false';}
function readableError(e){
 const m=String(e?.message||'');
 if(e?.code==='invalid_credentials'||/invalid login credentials/i.test(m))return 'อีเมลหรือรหัสผ่าน Bitbot ไม่ถูกต้อง กรุณาตรวจสอบว่ากำลังใช้บัญชี Bitbot (ไม่ใช่ Bitkub) หากจำรหัสไม่ได้ให้กด “ตั้งรหัสผ่าน Bitbot ใหม่”';
 if(e?.status===429||e?.code==='over_email_send_rate_limit')return 'Supabase จำกัดการส่งอีเมลชั่วคราว โปรดรอให้โควตาคืนก่อนส่งคำขอใหม่';
 return m||'ไม่สามารถดำเนินการได้';
}
function controls(){const ok=!!session?.user&&!busy;
for(const id of ['saveKey','testWallet','saveLimits','refresh','deleteKey','logout'])$(id).disabled=!ok;
$('login').disabled=busy||!!session?.user;
$('login').textContent='ส่งลิงก์เข้าสู่ระบบ';
$('passwordLogin').disabled=busy||!!session?.user;
$('resetPassword').disabled=busy||!!session?.user;
$('savePassword').disabled=busy||!session?.user;
$('createPasswordArea').classList.toggle('hide',!session?.user);
$('who').textContent=session?.user?'✅ เข้าสู่ระบบ: '+(session.user.email||session.user.id)+' • ไม่ต้องล็อกอินใหม่':'ยังไม่ได้เข้าสู่ระบบ';
$('setupLoginPanel').style.display=session?.user?'none':'';
$('enableTrading').disabled=!ok||!setupState?.configured||!setupState?.adminApproved||!setupState?.serverLiveEnabled||!!setupState?.tradingEnabled;
$('disableTrading').disabled=!ok||!setupState?.tradingEnabled;
}
async function supa(){
if(client)return client;
if(!/^https:\/\/[\w-]+\.supabase\.co$/.test(cfg.url||'')||!/^sb_publishable_/.test(cfg.publishableKey||''))throw Error('ไม่พบการตั้งค่า Supabase Bitbot');
const m=await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.57.4/+esm');
client=m.createClient(cfg.url,cfg.publishableKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
client.auth.onAuthStateChange((_event,s)=>{
session=s;controls();const id=s?.user?.id||'';
if(id!==lastId){lastId=id;setupState=null;if(id)setTimeout(()=>refresh().catch(e=>message('overall',e.message,true)),0);}
});
const r=await client.auth.getSession();if(r.error)throw r.error;session=r.data.session;controls();return client;
}
async function api(action,{method='GET',body}={}){
const c=await supa(),{data,error}=await c.auth.getSession();
if(error||!data.session?.access_token)throw Error('กรุณาเข้าสู่ระบบ Bitbot ก่อน');
const ac=new AbortController(),tm=setTimeout(()=>ac.abort(),20000);
try{
const r=await fetch(endpoint+'?action='+encodeURIComponent(action),{method,cache:'no-store',signal:ac.signal,
headers:{apikey:cfg.publishableKey,Authorization:'Bearer '+data.session.access_token,...(body?{'Content-Type':'application/json'}:{})},
body:body?JSON.stringify(body):undefined});
const j=await r.json().catch(()=>({}));if(!r.ok||j.ok===false)throw Error(j.error||'เกิดข้อผิดพลาด HTTP '+r.status);return j;
}finally{clearTimeout(tm);}
}
async function run(job){if(busy)return;busy=true;controls();try{await job();}catch(e){message('overall','⚠️ '+readableError(e),true);}finally{busy=false;controls();}}
function wipe(){$('apiKey').value='';$('apiSecret').value='';}
async function refresh(){
if(!session?.user)return;
const x=await api('setup-status'),s=x.setup||{};
setupState={...s,serverLiveEnabled:!!x.serverLiveEnabled};
message('keyStatus',s.configured?'✅ บันทึกคีย์แบบเข้ารหัสแล้ว • ลงท้าย '+(s.keySuffix||'—')+' • ตรวจสอบ Wallet ณ '+new Date(s.verifiedAt).toLocaleString('th-TH',{timeZone:'Asia/Bangkok'}):'ยังไม่ได้ตั้ง API Key/Secret');
$('maxOrder').value=s.maxOrderTHB??100;$('maxBuy').value=s.maxDailyBuyTHB??300;$('maxSell').value=s.maxDailySellTHB??1000;
$('tradeState').textContent=x.serverLiveEnabled&&s.tradingEnabled&&s.adminApproved?'⚠️ เปิดสิทธิ์ส่งคำสั่งเงินจริงแล้ว':'🔒 ไม่ส่งคำสั่งเงินจริง';
const reqs=['API Key: '+(s.configured?'ตรวจแล้ว ✓':'ยังไม่ตั้ง'),'Wallet: '+(s.verifiedAt?'เคยตรวจแล้ว ✓':'ยังไม่ผ่าน'),
'ผู้ควบคุม: '+(s.adminApproved?'อนุมัติ ✓':'รออนุมัติ'),'สวิตช์เซิร์ฟเวอร์: '+(x.serverLiveEnabled?'พร้อม ✓':'ปิด'),'ตัวเลือกของคุณ: '+(s.tradingEnabled?'เปิด':'ปิด')];
message('tradeRequirements',reqs.join(' • '));
message('tradingModeInfo',s.tradingEnabled?'⚠️ บัญชีนี้เปิดโหมดส่งคำสั่งจริงแล้ว ต้องยืนยันแต่ละคำสั่งที่หน้า Bitkub Live':'🔒 บัญชีนี้ยังปิดโหมดส่งคำสั่งจริงอยู่ ผู้ใช้ต้องกดยืนยันเพื่อเปิดด้วยตนเอง');
$('enableTrading').disabled=!s.configured||!s.adminApproved||!x.serverLiveEnabled||s.tradingEnabled;
$('disableTrading').disabled=!s.tradingEnabled;
message('overall','ระบบ Bitbot: เชื่อม Supabase สำเร็จ\nAPI Key: '+(s.configured?'เก็บใน Vault แล้ว':'ยังไม่ได้ตั้ง')+
'\nสิทธิ์ส่งคำสั่ง: '+(s.adminApproved?'ผู้ดูแลอนุมัติแล้ว':'ยังไม่ได้อนุมัติ')+
'\nKill Switch: '+(x.serverLiveEnabled?'เปิด':'ปิด')+'\nหน้า Setup ไม่มีการส่งคำสั่งซื้อขาย');
}
$('login').onclick=()=>run(async()=>{const email=$('email').value.trim();
if(!/^\S+@\S+\.\S+$/.test(email))throw Error('กรุณากรอกอีเมลให้ถูกต้อง');
const c=await supa();
try{
 await window.BitbotOtpGuard.send(()=>c.auth.signInWithOtp({email,options:{emailRedirectTo:location.origin+location.pathname}}));
 message('overall','ส่งลิงก์เข้าสู่ระบบแล้ว โปรดตรวจอีเมล (รวมถึงกล่องสแปม) และกลับมาหน้านี้');
}catch(e){if(e.cooldown){message('overall','⚠️ '+e.message+'\\nหากต้องการส่งเมลบ่อยขึ้น ผู้ดูแลต้องตั้ง Custom SMTP ใน Supabase',true);return;}throw e;}
finally{controls();}});
$('logout').onclick=()=>run(async()=>{const c=await supa();const r=await c.auth.signOut();if(r.error)throw r.error;
session=null;lastId='';setupState=null;wipe();controls();message('overall','ออกจากระบบแล้ว');});
$('saveKey').onclick=()=>run(async()=>{
const apiKey=$('apiKey').value.trim(),apiSecret=$('apiSecret').value.trim();
if(apiKey.length<8||apiSecret.length<8)throw Error('กรุณากรอก API Key/Secret');
if(!confirm('ตรวจสอบ Wallet แบบอ่านอย่างเดียว และบันทึก API Key/Secret แบบเข้ารหัสบน Supabase Vault?'))return;
try{const d=await api('setup-save',{method:'POST',body:{apiKey,apiSecret}});
message('keyStatus','✅ ตรวจสอบบัญชีสำเร็จ บันทึกคีย์แบบเข้ารหัสแล้ว • ลงท้าย '+d.keySuffix);}finally{wipe();}
await refresh();});
$('testWallet').onclick=()=>run(async()=>{
const x=await api('setup-test',{method:'POST',body:{}});
message('keyStatus',x.connected?'✅ ทดสอบ Wallet Bitkub สำเร็จ (อ่านอย่างเดียว)':'เชื่อม Wallet ไม่สำเร็จ');await refresh();});
$('enableTrading').onclick=()=>run(async()=>{
 if(!session?.user)throw Error('กรุณาเข้าสู่ระบบก่อน');
 if(!$('acceptLiveRisk').checked||$('liveConfirm').value.trim()!=='เปิดเทรดเงินจริง')throw Error('กรุณาติ๊กยอมรับความเสี่ยงและพิมพ์ เปิดเทรดเงินจริง ให้ตรง');
 if(!confirm('คุณกำลังเปิดสิทธิ์ส่งคำสั่งซื้อขายเงินจริงบน Bitkub แบบ LIMIT เท่านั้น • แต่ละคำสั่งยังต้องยืนยันอีกครั้ง • ยืนยันเปิดสิทธิ์หรือไม่?'))return;
 await api('setup-trading',{method:'POST',body:{enabled:true,acceptRisk:true,confirmText:'เปิดเทรดเงินจริง'}});
 $('liveConfirm').value='';$('acceptLiveRisk').checked=false;await refresh();
 message('overall','✅ เปิดสิทธิ์ส่งคำสั่งเงินจริงบนบัญชีที่ตรวจสอบแล้ว • ไม่มีการส่งคำสั่งซื้อ/ขายในขั้นตอนนี้');
});
$('disableTrading').onclick=()=>run(async()=>{
 if(!confirm('ยืนยันปิดสิทธิ์ส่งคำสั่งซื้อขายเงินจริงในบัญชีนี้? ออร์เดอร์ที่ส่งไปแล้วจะไม่ถูกยกเลิกโดยอัตโนมัติ'))return;
 await api('setup-trading',{method:'POST',body:{enabled:false}});
 $('liveConfirm').value='';$('acceptLiveRisk').checked=false;await refresh();
 message('overall','🔒 ปิดสิทธิ์ส่งคำสั่งใหม่แล้ว ออร์เดอร์ที่เปิดค้างบน Bitkub ต้องจัดการแยกต่างหาก');
});
$('saveLimits').onclick=()=>run(async()=>{
const b={maxOrderTHB:Number($('maxOrder').value),maxDailyBuyTHB:Number($('maxBuy').value),maxDailySellTHB:Number($('maxSell').value)};
for(const v of Object.values(b))if(!Number.isFinite(v)||v<100||Math.abs(v*100-Math.round(v*100))>.00001)throw Error('วงเงินต้องตั้งแต่ 100 บาทขึ้นไปและไม่เกิน 2 ตำแหน่ง');
if(b.maxOrderTHB>100||b.maxDailyBuyTHB>300||b.maxDailySellTHB>1000)throw Error('วงเงินสูงสุดปัจจุบันของระบบ: 100 บาท/คำสั่ง ซื้อ 300 บาท/วัน ขาย 1,000 บาท/วัน');
if(b.maxOrderTHB>b.maxDailyBuyTHB||b.maxOrderTHB>b.maxDailySellTHB)throw Error('วงเงินต่อคำสั่งต้องไม่เกินรายวัน');
await api('setup-limits',{method:'POST',body:b});await refresh();message('overall','✅ บันทึกวงเงินบนเซิร์ฟเวอร์แล้ว\nยังไม่เปิดการส่งคำสั่งเงินจริง');});
$('refresh').onclick=()=>run(refresh);
$('deleteKey').onclick=()=>run(async()=>{
if(!confirm('ต้องการลบ API Key/Secret ที่เก็บไว้ในระบบ Bitbot?'))return;
await api('setup-remove',{method:'POST',body:{confirm:'REMOVE BITKUB KEY'}});
wipe();await refresh();message('overall','ลบคีย์ออกจาก Supabase Vault แล้ว\nหากต้องการยกเลิกคีย์เดิมทั้งหมด ให้เพิกถอนคีย์ที่ Bitkub ด้วย');});

$('resetPassword').onclick=()=>run(async()=>{
 const email=$('email').value.trim();
 if(!/^\S+@\S+\.\S+$/.test(email))throw Error('กรุณากรอกอีเมล Bitbot ที่ลงทะเบียนไว้');
 const c=await supa();
 await window.BitbotOtpGuard.send(()=>c.auth.resetPasswordForEmail(email,{redirectTo:location.origin+location.pathname}));
 message('overall','หากอีเมลนี้ลงทะเบียนไว้ Supabase จะส่งลิงก์ตั้งรหัสผ่านใหม่ กรุณาตรวจอีเมลและกลับมาที่หน้า Setup เพื่อตั้งรหัสผ่านใหม่');
});
$('passwordLogin').onclick=()=>run(async()=>{
 const email=$('email').value.trim(),password=$('authPassword').value;
 if(!/^\S+@\S+\.\S+$/.test(email)||!password)throw Error('กรอกอีเมลและรหัสผ่าน Bitbot ให้ครบ');
 try{const c=await supa();const {error}=await c.auth.signInWithPassword({email,password});if(error)throw error;
 message('overall','✅ เข้าสู่ระบบ Bitbot สำเร็จโดยไม่ต้องส่งอีเมล');}
 finally{$('authPassword').value='';}
});
$('savePassword').onclick=()=>run(async()=>{
 if(!session?.user)throw Error('กรุณาเข้าสู่ระบบก่อนตั้งรหัสผ่าน');
 const password=$('newPassword').value;
 if(password.length<12||password.length>128)throw Error('รหัสผ่านต้องมีความยาว 12–128 ตัวอักษร');
 try{const c=await supa();const {error}=await c.auth.updateUser({password});if(error)throw error;
 message('overall','✅ ตั้งรหัสผ่าน Bitbot แล้ว ครั้งต่อไปสามารถเข้าสู่ระบบด้วยรหัสผ่านโดยไม่ขอลิงก์อีเมล');}
 finally{$('newPassword').value='';}
});
$('authPassword').addEventListener('keydown',e=>{if(e.key==='Enter'){$('passwordLogin').click();}});
setInterval(()=>{if(!busy)controls();},10000);
controls();supa().catch(e=>message('overall','ระบบล็อกอินโหลดไม่สำเร็จ: '+e.message,true));
})();