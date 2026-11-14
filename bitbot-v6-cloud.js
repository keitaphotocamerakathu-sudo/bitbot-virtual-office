/* Optional private cloud memory sync. Never runs without Bitbot-specific Supabase config.
 * IndexedDB remains authoritative offline; RLS is mandatory at the database side.
 */
(()=>{
 'use strict';
 const $=id=>document.getElementById(id);
 const settings=window.BITBOT_CLOUD_CONFIG||{};
 const enabled=/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(settings.url||'') && /^sb_publishable_[A-Za-z0-9_-]+$|^eyJ[A-Za-z0-9._-]+$/.test(settings.publishableKey||'');
 let client=null,user=null,syncBusy=false;
 const tables=[['runs','bitbot_paper_runs'],['journal','bitbot_paper_journal'],['lessons','bitbot_paper_lessons']];
 function say(text,bad=false){const el=$('v6CloudStatus');if(el){el.textContent=text;el.dataset.error=bad?'true':'false';}}
 async function getClient(){if(!enabled)throw Error('ยังไม่มีโครงการ Supabase Bitbot แยกเป็นของตัวเอง');
  if(!client){const mod=await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.57.4/+esm');
   client=mod.createClient(settings.url.replace(/\/$/,''),settings.publishableKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
   client.auth.onAuthStateChange((_event,session)=>{user=session?.user||null;renderAuth();});}
  return client;
 }
 function renderAuth(){const who=$('v6CloudWho');if(who)who.textContent=user?`เชื่อมต่อในชื่อ ${user.email||user.id}`:'ยังไม่ได้เข้าสู่ระบบ';
  for(const n of ['v6CloudSync','v6CloudRestore','v6CloudLogout']){const b=$(n);if(b)b.disabled=!user||syncBusy;}
  if($('v6CloudLogin'))$('v6CloudLogin').disabled=!!user;
 }
 async function login(){const email=String($('v6CloudEmail')?.value||'').trim();if(!/^\S+@\S+\.\S+$/.test(email)){say('กรุณากรอกอีเมลให้ถูกต้อง',true);return;}
  try{const c=await getClient();const {error}=await c.auth.signInWithOtp({email,options:{emailRedirectTo:location.origin+location.pathname}});
   if(error)throw error;say('ส่งลิงก์เข้าสู่ระบบไปยังอีเมลแล้ว กรุณากดลิงก์เพื่อกลับมาที่เว็บไซต์');
  }catch(e){say('ส่งอีเมลไม่สำเร็จ: '+e.message,true);}
 }
 async function pullTable(c,table){const results=[];for(let start=0;start<300000;start+=500){
  const {data,error}=await c.from(table).select('local_id,payload').order('local_id',{ascending:true}).range(start,start+499);
  if(error)throw error;
  for(const row of data||[]){if(row?.payload && typeof row.payload==='object' && row.payload.id===row.local_id)results.push(row.payload);}
  if((data||[]).length<500)return results;
 }throw Error('ข้อมูลบน Cloud มากกว่า 300,000 รายการ ต้องแบ่งช่วงนำเข้า');}
 async function withLock(fn){if(syncBusy)return;syncBusy=true;renderAuth();try{await fn();}finally{syncBusy=false;renderAuth();}}
 async function sync(){return withLock(async()=>{
   if(!user)throw Error('กรุณาเข้าสู่ระบบก่อน');
   const c=await getClient();say('กำลังสำรองประวัติที่ยังมีในเครื่องขึ้น Cloud...');
   const m=window.BitbotLearningV6;if(!m)throw Error('ไม่พบ Trading Memory');
   let count=0;
   await window.BitbotMemory?.flush?.();
   for(const [local,remote] of tables){
     const records=await m.getAll(local);
     for(let i=0;i<records.length;i+=200){
      // Never send private trading secrets, only simulations; no credentials in data payloads.
      const batch=records.slice(i,i+200).filter(x=>typeof x?.id==='string'&&x.id.length<=200).map(x=>({user_id:user.id,local_id:x.id,payload:x,updated_at:new Date().toISOString()}));
      if(!batch.length)continue;
      const {error}=await c.from(remote).upsert(batch,{onConflict:'user_id,local_id'});
      if(error)throw error;count+=batch.length;
      say(`สำรอง Cloud ${count.toLocaleString('th-TH')} รายการ · ${remote}`);
     }
   }
   say(`✅ สำรองข้อมูลขึ้น Cloud สำเร็จ ${count.toLocaleString('th-TH')} รายการ · ข้อมูลไม่เป็นเงินจริง`);
 });}
 async function restore(){return withLock(async()=>{
  if(!user)throw Error('กรุณาเข้าสู่ระบบก่อน');
  const c=await getClient();const m=window.BitbotLearningV6;if(!m)throw Error('ไม่พบ Trading Memory');
  say('กำลังนำบทเรียนจาก Cloud กลับเข้า IndexedDB ของเครื่องนี้...');let count=0;
  for(const [local,remote] of tables){const records=await pullTable(c,remote);await m.batchPut(local,records);count+=records.length;}
  say(`✅ นำเข้าจาก Cloud ${count.toLocaleString('th-TH')} รายการ (เพิ่ม/อัปเดตตามรหัสเดิม ไม่สร้างรายการซ้ำ)`);
  await m.refresh();
 });}
 function mount(){const badge=$('v6CloudBadge'),mount=$('v6CloudMount');if(!mount)return;
  if(!enabled){if(badge)badge.textContent='ยังไม่เชื่อม Supabase';
   mount.innerHTML='<p>คลังบทเรียนในเครื่องยังทำงานและสำรองเป็น JSON ได้ตามปกติ ส่วนซิงก์ข้ามอุปกรณ์จะเปิดใช้งานหลังสร้างโปรเจกต์ Supabase สำหรับ Bitbot โดยเฉพาะ ไม่ใช้ฐานข้อมูล RESTART หรือสหกรณ์ร่วมกัน</p>';
   return;}
  if(badge)badge.textContent='พร้อมลงชื่อเข้าใช้';
  mount.innerHTML='<p>เข้าสู่ระบบด้วยอีเมลเพื่อสำรองข้อมูลเฉพาะบัญชีของคุณ (ปกป้องด้วย RLS)</p><div class="v6-cloud-auth"><input id="v6CloudEmail" type="email" autocomplete="email" placeholder="อีเมลของคุณ" aria-label="อีเมลสำหรับเข้าสู่ระบบ"><button id="v6CloudLogin" type="button">ส่งลิงก์เข้าใช้</button><button id="v6CloudLogout" type="button">ออกจากระบบ</button></div><p id="v6CloudWho">กำลังตรวจสอบบัญชี...</p><div class="v6-tools"><button id="v6CloudSync" type="button">☁️ สำรองขึ้น Cloud</button><button id="v6CloudRestore" type="button">⬇️ ดึงบทเรียนจาก Cloud</button></div><p id="v6CloudStatus" role="status" aria-live="polite">ข้อมูล Cloud จะเป็นของบัญชีที่ล็อกอินเท่านั้น ไม่เปิดเผยต่อผู้ใช้คนอื่น</p>';
  $('v6CloudLogin').onclick=login;
  $('v6CloudLogout').onclick=async()=>{try{(await getClient()).auth.signOut();user=null;renderAuth();say('ออกจากระบบแล้ว');}catch(e){say(e.message,true);}};
  $('v6CloudSync').onclick=()=>sync().catch(e=>say('สำรอง Cloud ล้มเหลว: '+e.message,true));
  $('v6CloudRestore').onclick=()=>restore().catch(e=>say('นำเข้าจาก Cloud ล้มเหลว: '+e.message,true));
  getClient().then(async c=>{const {data,error}=await c.auth.getUser();if(error && error.status!==400)throw error;user=data?.user||null;renderAuth();}).catch(e=>say('เชื่อมต่อ Supabase ไม่สำเร็จ: '+e.message,true));
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount);else mount();
 window.BitbotCloudV6={configured:enabled};
})();