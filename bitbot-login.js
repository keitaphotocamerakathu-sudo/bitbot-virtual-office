/* Bitbot: one-login portal. Reuses the SAME Supabase Auth session shared by all Bitbot pages. */
(()=>{'use strict';
const $=id=>document.getElementById(id);
const cfg=window.BITBOT_CLOUD_CONFIG||{};
let client,booted=false,busy=false,session=null,showingRecovery=false;
const BASE='/bitbot-virtual-office/';
const allowed=['','index.html','bitkub-setup.html','bitkub-live.html'];
function target(){
 const str=new URLSearchParams(location.search).get('next')||'';
 if(!str)return './bitkub-live.html';
 try {
  const u=new URL(str,location.href);
  if(u.origin!==location.origin || !u.pathname.startsWith(BASE))return './bitkub-live.html';
  const name=u.pathname.slice(BASE.length);
  return allowed.includes(name)?u.pathname:'./bitkub-live.html';
 }catch(_){return './bitkub-live.html';}
}
function text(id,s){$(id).textContent=s;}
function report(s,error=false,success=false){const e=$('status');e.textContent=s;e.className='status'+(error?' error':success?' ok':'');}
function errorMessage(e){
 const msg=String(e?.message||'');
 if(e?.code==='invalid_credentials'||/invalid login credentials/i.test(msg))return 'อีเมลหรือรหัสผ่าน Bitbot ไม่ตรงกัน คุณสามารถใช้ลิงก์อีเมลแทนการพิมพ์รหัสได้';
 if(e?.status===429||e?.code==='over_email_send_rate_limit'||/rate limit/i.test(msg))return 'Supabase จำกัดการส่งอีเมลชั่วคราว กรุณาใช้ลิงก์ที่ได้รับล่าสุด หรือรอให้โควตาคืน';
 return msg||'เกิดข้อผิดพลาดในการเข้าสู่ระบบ';
}
function update(){
 const logged=!!session?.user;
 $('checking').classList.add('hidden');$('signedIn').classList.toggle('hidden',!logged);$('loginBox').classList.toggle('hidden',logged);
 if(logged){
  text('who','✅ เข้าสู่ระบบแล้ว: '+(session.user.email||'บัญชีที่ยืนยันแล้ว'));
  $('continueLink').href=target();report('เข้าสู่ระบบสำเร็จ ระบบจำบัญชีของคุณบนเบราว์เซอร์นี้โดยใช้ Supabase Auth',false,true);
 }
 for(const id of ['emailLink','passwordLogin','reset'])$(id).disabled=busy||logged;
 $('logout').disabled=busy||!logged;
 const sec=window.BitbotOtpGuard?.remaining?.()||0;
 $('emailLink').disabled||=sec>0;$('reset').disabled||=sec>0;
 $('emailLink').textContent=sec?'ขออีเมลใหม่ได้ในประมาณ '+Math.ceil(sec/60)+' นาที':'ส่งลิงก์เข้าสู่ระบบ';
}
async function supa(){
 if(client)return client;
 if(!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(cfg.url||'')||!cfg.publishableKey)throw Error('ยังไม่ได้ตั้งค่า Supabase บน Bitbot');
 const {createClient}=await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.57.4/+esm');
 client=createClient(cfg.url,cfg.publishableKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
 client.auth.onAuthStateChange((type,s)=>{
   session=s;
   if(type==='PASSWORD_RECOVERY')showingRecovery=true;
   update();
   if(s?.user&&type==='SIGNED_IN'&&!showingRecovery&&new URLSearchParams(location.search).has('next'))location.replace(target());
 });
 return client;
}
async function pending(task){
 if(busy)return;busy=true;update();
 try{await task()}catch(e){report(errorMessage(e),true)}
 finally{busy=false;update()}
}
function email(){const email=$('email').value.trim();if(!/^\S+@\S+\.\S+$/.test(email))throw Error('กรุณากรอกอีเมล Bitbot ให้ถูกต้อง');return email;}
$('emailLink').onclick=()=>pending(async()=>{
 const c=await supa();
 await window.BitbotOtpGuard.send(()=>c.auth.signInWithOtp({email:email(),options:{emailRedirectTo:new URL('./bitkub-setup.html',location.href).href,shouldCreateUser:false}}));
 report('ส่งลิงก์แล้ว หากอีเมลนี้เป็นบัญชีที่ลงทะเบียนไว้ ให้เปิดลิงก์ในกล่องจดหมาย แล้วเว็บจะจดจำการเข้าสู่ระบบ',false,true);
});
$('reset').onclick=()=>pending(async()=>{
 const c=await supa();
 await window.BitbotOtpGuard.send(()=>c.auth.resetPasswordForEmail(email(),{redirectTo:new URL('./bitkub-setup.html',location.href).href}));
 report('หากบัญชีนี้มีอยู่ ระบบได้ส่งลิงก์ตั้งรหัสใหม่ไปยังอีเมลของคุณแล้ว (ขึ้นอยู่กับโควตา Supabase)',false,true);
});
$('passwordLogin').onclick=()=>pending(async()=>{
 const e=email(),password=$('password').value;
 if(!password)throw Error('กรุณากรอกรหัสผ่าน Bitbot');
 try{const c=await supa();const {data,error}=await c.auth.signInWithPassword({email:e,password});if(error)throw error;
  session=data.session;update();if(data.user)location.replace(target());
 }finally{$('password').value='';}
});
$('logout').onclick=()=>pending(async()=>{
 const c=await supa();const {error}=await c.auth.signOut();if(error)throw error;
 session=null;showingRecovery=false;report('ออกจากระบบแล้ว การเข้าสู่ระบบครั้งต่อไปต้องยืนยันบัญชีใหม่');
});
$('password').addEventListener('keydown',e=>{if(e.key==='Enter')$('passwordLogin').click()});
setInterval(()=>{if(booted&&!busy)update()},15000);
(async()=>{try{
  const c=await supa();
  const {data,error}=await c.auth.getSession();
  if(error)throw error;
  session=data.session;booted=true;update();
  if(session?.user&&new URLSearchParams(location.search).has('next'))location.replace(target());
  if(!session?.user)report('ยังไม่ได้เข้าสู่ระบบ — ใช้ลิงก์อีเมลหรือรหัสผ่าน Bitbot ได้');
}catch(e){$('checking').classList.add('hidden');$('loginBox').classList.remove('hidden');report('ตรวจสอบเซสชันไม่ได้: '+errorMessage(e),true);}
})();
})();