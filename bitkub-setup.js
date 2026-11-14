// Bitbot Secure Bitkub setup: never persists API keys in browser; HTTPS to authenticated Edge Function.
(()=>{'use strict';
const $=id=>document.getElementById(id);
const cfg=window.BITBOT_CLOUD_CONFIG||{};
const endpoint='https://lrxrigimdaedfemqheug.supabase.co/functions/v1/bitkub-gateway';
let client=null,session=null,busy=false,lastId='';
function message(id,text,bad=false){const el=$(id);el.textContent=text;el.dataset.error=bad?'true':'false';}
function controls(){const ok=!!session?.user&&!busy;
for(const id of ['saveKey','testWallet','saveLimits','refresh','deleteKey','logout'])$(id).disabled=!ok;
$('login').disabled=busy||!!session?.user;
$('who').textContent=session?.user?'✅ เข้าสู่ระบบ: '+(session.user.email||session.user.id):'ยังไม่ได้เข้าสู่ระบบ';
}
async function supa(){
if(client)return client;
if(!/^https:\/\/[\w-]+\.supabase\.co$/.test(cfg.url||'')||!/^sb_publishable_/.test(cfg.publishableKey||''))throw Error('ไม่พบการตั้งค่า Supabase Bitbot');
const m=await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.57.4/+esm');
client=m.createClient(cfg.url,cfg.publishableKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
client.auth.onAuthStateChange((_event,s)=>{
session=s;controls();const id=s?.user?.id||'';
if(id!==lastId){lastId=id;if(id)setTimeout(()=>refresh().catch(e=>message('overall',e.message,true)),0);}
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
async function run(job){if(busy)return;busy=true;controls();try{await job();}catch(e){message('overall','⚠️ '+(e.message||'ไม่สามารถดำเนินการได้'),true);}finally{busy=false;controls();}}
function wipe(){$('apiKey').value='';$('apiSecret').value='';}
async function refresh(){
if(!session?.user)return;
const x=await api('setup-status'),s=x.setup||{};
message('keyStatus',s.configured?'✅ บันทึกคีย์แบบเข้ารหัสแล้ว • ลงท้าย '+(s.keySuffix||'—')+' • ตรวจสอบ Wallet ณ '+new Date(s.verifiedAt).toLocaleString('th-TH',{timeZone:'Asia/Bangkok'}):'ยังไม่ได้ตั้ง API Key/Secret');
$('maxOrder').value=s.maxOrderTHB??500;$('maxBuy').value=s.maxDailyBuyTHB??1000;$('maxSell').value=s.maxDailySellTHB??1000;
$('tradeState').textContent=x.serverLiveEnabled&&s.tradingEnabled&&s.adminApproved?'⚠️ อนุญาตคำสั่งจริง':'🔒 เทรดเงินจริงปิดอยู่';
message('overall','ระบบ Bitbot: เชื่อม Supabase สำเร็จ\nAPI Key: '+(s.configured?'เก็บใน Vault แล้ว':'ยังไม่ได้ตั้ง')+
'\nสิทธิ์ส่งคำสั่ง: '+(s.adminApproved?'ผู้ดูแลอนุมัติแล้ว':'ยังไม่ได้อนุมัติ')+
'\nKill Switch: '+(x.serverLiveEnabled?'เปิด':'ปิด')+'\nหน้า Setup ไม่มีการส่งคำสั่งซื้อขาย');
}
$('login').onclick=()=>run(async()=>{const email=$('email').value.trim();
if(!/^\S+@\S+\.\S+$/.test(email))throw Error('กรุณากรอกอีเมลให้ถูกต้อง');
const c=await supa();const r=await c.auth.signInWithOtp({email,options:{emailRedirectTo:location.origin+location.pathname}});
if(r.error)throw r.error;message('overall','ส่งลิงก์เข้าสู่ระบบไปยังอีเมลแล้ว กรุณาเปิดลิงก์และกลับมาหน้านี้');});
$('logout').onclick=()=>run(async()=>{const c=await supa();const r=await c.auth.signOut();if(r.error)throw r.error;
session=null;lastId='';wipe();controls();message('overall','ออกจากระบบแล้ว');});
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
$('saveLimits').onclick=()=>run(async()=>{
const b={maxOrderTHB:Number($('maxOrder').value),maxDailyBuyTHB:Number($('maxBuy').value),maxDailySellTHB:Number($('maxSell').value)};
for(const v of Object.values(b))if(!Number.isFinite(v)||v<100||Math.abs(v*100-Math.round(v*100))>.00001)throw Error('วงเงินต้องตั้งแต่ 100 บาทขึ้นไปและไม่เกิน 2 ตำแหน่ง');
if(b.maxOrderTHB>b.maxDailyBuyTHB||b.maxOrderTHB>b.maxDailySellTHB)throw Error('วงเงินต่อคำสั่งต้องไม่เกินรายวัน');
await api('setup-limits',{method:'POST',body:b});await refresh();message('overall','✅ บันทึกวงเงินบนเซิร์ฟเวอร์แล้ว\nยังไม่เปิดการส่งคำสั่งเงินจริง');});
$('refresh').onclick=()=>run(refresh);
$('deleteKey').onclick=()=>run(async()=>{
if(!confirm('ต้องการลบ API Key/Secret ที่เก็บไว้ในระบบ Bitbot?'))return;
await api('setup-remove',{method:'POST',body:{confirm:'REMOVE BITKUB KEY'}});
wipe();await refresh();message('overall','ลบคีย์ออกจาก Supabase Vault แล้ว\nหากต้องการยกเลิกคีย์เดิมทั้งหมด ให้เพิกถอนคีย์ที่ Bitkub ด้วย');});
controls();supa().catch(e=>message('overall','ระบบล็อกอินโหลดไม่สำเร็จ: '+e.message,true));
})();