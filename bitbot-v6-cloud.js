/* Bitbot v6.1 PRIVATE cloud memory. Public publishable key + strict RLS only.
 * The trading simulator never connects to an exchange account and cannot send live orders.
 * Local IndexedDB is the offline journal; cloud is a user-authorized backup while this page is open.
 */
(()=>{
 'use strict';
 const $=id=>document.getElementById(id);
 const cfg=window.BITBOT_CLOUD_CONFIG||{};
 const enabled=/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(cfg.url||'') && /^(sb_publishable_[A-Za-z0-9_-]+|eyJ[A-Za-z0-9._-]+)$/.test(cfg.publishableKey||'');
 const tables=[['runs','bitbot_paper_runs'],['journal','bitbot_paper_journal'],['lessons','bitbot_paper_lessons']];
 const allow={
   runs:'id kind createdAt updatedAt source scenario guard seed startCash fees slippage fingerprint bars cfg status summary version costTier safety appliedToStrategy'.split(' '),
   journal:'id runId kind seq ts signal source scenario evidence paperOnly side qty price fee pnl reason cashAfter btcAfter agent eventType message'.split(' '),
   lessons:'id runId createdAt category confidence appliedToStrategy finding evidence version'.split(' ')
 };
 let client=null,user=null,syncBusy=false,syncAgain=false,syncTimer=null,lastSyncTime=0,cloudVerified=false;
 const OWNER_KEY='bitbot_cloud_owner_v1';
 function assertOwner(owner){
   let previous;
   try{previous=localStorage.getItem(OWNER_KEY);}catch(_){throw Error('เบราว์เซอร์ไม่อนุญาตพื้นที่จัดเก็บข้อมูล จึงไม่สามารถตรวจสิทธิ์คลังในเครื่องได้');}
   if(previous&&previous!==owner)throw Error('บัญชีนี้ไม่ตรงกับเจ้าของประวัติในเบราว์เซอร์นี้ โปรดใช้โปรไฟล์เบราว์เซอร์แยก เพื่อป้องกันส่งประวัติของผู้อื่น');
 }
 function bindOwner(owner){assertOwner(owner);localStorage.setItem(OWNER_KEY,owner);}
 async function cloudCounts(c){
   const out=[];
   for(const [local,remote] of tables){
     const {count,error}=await c.from(remote).select('local_id',{head:true,count:'exact'});
     if(error)throw error;
     out.push({name:local,count:count||0});
   }
   const n=$('v6CloudCounts');if(n)n.textContent='ข้อมูลออนไลน์ในบัญชีนี้: '+out.map(r=>r.name+' '+r.count.toLocaleString('th-TH')).join(' · ');
   return out;
 }

 function say(message,bad=false){const el=$('v6CloudStatus');if(el){el.textContent=message;el.dataset.error=bad?'true':'false';}}
 function safeRecord(table,r){
   if(!r||typeof r!=='object'||Array.isArray(r)||typeof r.id!=='string'||r.id.length<1||r.id.length>200)return null;
   const p={};for(const k of allow[table]||[])if(Object.prototype.hasOwnProperty.call(r,k))p[k]=r[k];
   // Do not copy any unrecognized fields (especially API keys/passwords) from imported JSON.
   if(!p.id)return null;
   if(JSON.stringify(p).length>65000)return null;
   return p;
 }
 async function getClient(){
   if(!enabled)throw Error('ยังไม่เปิดใช้โปรเจกต์ Supabase ของ Bitbot');
   if(!client){
     const mod=await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.57.4/+esm');
     client=mod.createClient(cfg.url.replace(/\/$/,''),cfg.publishableKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
     client.auth.onAuthStateChange((_event,session)=>{
       const old=user?.id;user=session?.user||null;if(old!==user?.id)cloudVerified=false;renderAuth();
       if(user&&old!==user.id)queueBootstrap(5000);
     });
   }
   return client;
 }
 function renderAuth(){
   const who=$('v6CloudWho');if(who)who.textContent=user?`บัญชี: ${user.email||user.id}`:'ยังไม่ได้เข้าสู่ระบบ';
   for(const id of ['v6CloudSync','v6CloudRestore','v6CloudLogout','v6CloudCheck']){const el=$(id);if(el)el.disabled=!user||syncBusy;}
   const login=$('v6CloudLogin');if(login)login.disabled=!!user||syncBusy;
   const badge=$('v6CloudBadge');if(badge)badge.textContent=user?(syncBusy?'กำลังบันทึก':cloudVerified?'ยืนยันเขียน–อ่าน Cloud แล้ว':'เข้าสู่ระบบแล้ว'):'รอเข้าสู่ระบบ';
 }
 async function login(){
   const email=String($('v6CloudEmail')?.value||'').trim();
   if(!/^\S+@\S+\.\S+$/.test(email)){say('กรุณากรอกอีเมลให้ถูกต้อง',true);return;}
   try{
     const c=await getClient();const {error}=await c.auth.signInWithOtp({email,options:{emailRedirectTo:location.origin+location.pathname}});
     if(error)throw error;
     say('ส่งอีเมลเข้าสู่ระบบแล้ว กรุณาเปิดลิงก์ในอีเมล และกลับมาที่ Bitbot เพื่อซิงก์บทเรียน');
   }catch(e){say('ไม่สามารถส่งอีเมล: '+e.message,true);}
 }
 async function withLock(task){if(syncBusy){syncAgain=true;return;}syncBusy=true;renderAuth();
   try{await task();}finally{syncBusy=false;renderAuth();if(syncAgain){syncAgain=false;queueAutoSync(8000);}}
 }
 async function readLocal(name){
   const lab=window.BitbotLearningV6;if(!lab)throw Error('ไม่พบ Trading Memory v6');
   await window.BitbotMemory?.flush?.();return lab.getAll(name);
 }
 async function sync(isAuto=false){
   if(!user){if(!isAuto)say('กรุณาเข้าสู่ระบบก่อน',true);return;}
   if(syncBusy){syncAgain=true;return;}
   return withLock(async()=>{
     if(navigator.onLine===false){say('ออฟไลน์อยู่ ข้อมูลยังอยู่ในเครื่อง จะสำรองเมื่อกลับมาออนไลน์',true);return;}
     const c=await getClient(),owner=user.id;
     assertOwner(owner);
     say(isAuto?'กำลังสำรองบทเรียนอัตโนมัติ...':'กำลังสำรองประวัติจากเครื่องขึ้น Cloud...');
     let count=0,skipped=0;
     for(const [local,remote] of tables){
       const records=await readLocal(local);
       for(let i=0;i<records.length;i+=150){
         if(!user||user.id!==owner)throw Error('บัญชีเปลี่ยนระหว่างซิงก์ ระบบหยุดเพื่อความปลอดภัย');
         const batch=[];
         for(const record of records.slice(i,i+150)){
           const safe=safeRecord(local,record);if(!safe){skipped++;continue;}
           batch.push({user_id:owner,local_id:safe.id,payload:safe,updated_at:record.updatedAt||new Date().toISOString()});
         }
         if(!batch.length)continue;
         const {error}=await c.from(remote).upsert(batch,{onConflict:'user_id,local_id'});
         if(error)throw error;
         count+=batch.length;
         if(count%1200<150)say(`กำลังสำรอง Cloud ${count.toLocaleString('th-TH')} รายการ...`);
       }
     }
     lastSyncTime=Date.now();
     if(count>0)bindOwner(owner);
     await cloudCounts(c);
     say(count>0?`✅ สำรองออนไลน์สำเร็จ ${count.toLocaleString('th-TH')} รายการ${skipped?' · ข้ามรายการผิดรูปแบบ '+skipped+' รายการ':''} · ไม่ใช้เงินจริง`:'ล็อกอินได้ แต่ไม่มีประวัติในเครื่องให้สำรอง ลองกดเริ่มจำลองก่อน');
   });
 }
 async function pullTable(c,table){const result=[];
   for(let start=0;start<300000;start+=500){
     const {data,error}=await c.from(table).select('local_id,payload').order('local_id',{ascending:true}).range(start,start+499);
     if(error)throw error;
     for(const row of data||[])if(row?.payload&&typeof row.payload==='object'&&row.payload.id===row.local_id)result.push(row.payload);
     if((data||[]).length<500)return result;
   }
   throw Error('มีข้อมูล Cloud เกิน 300,000 รายการ กรุณาแบ่งช่วงกู้คืน');
 }
 async function restore(){if(!user){say('กรุณาเข้าสู่ระบบก่อน',true);return;}
   return withLock(async()=>{
     const c=await getClient(),lab=window.BitbotLearningV6;
     assertOwner(user.id);
     if(!lab)throw Error('ไม่พบ Trading Memory');
     say('กำลังดึงข้อมูลจาก Cloud...');let count=0;
     for(const [local,remote] of tables){
       const records=await pullTable(c,remote);
       await lab.batchPut(local,records);count+=records.length;
     }
     if(count>0)bindOwner(user.id);
     await cloudCounts(c);
     say(count>0?`✅ ดึงบทเรียนจาก Cloud ${count.toLocaleString('th-TH')} รายการ · เพิ่ม/อัปเดตตามรหัส ไม่สร้างซ้ำ`:'Cloud ของบัญชีนี้ยังไม่มีประวัติ ลองเริ่มจำลองแล้วกดสำรอง');
     await lab.refresh();
   });
 }
 // Write, read and delete a transient proof row using the exact authenticated browser session.
 async function testCloud(){
   if(!user){say('กรุณาเข้าสู่ระบบ Supabase ก่อนทดสอบเขียนข้อมูลจริง',true);return;}
   return withLock(async()=>{
     const c=await getClient(),owner=user.id;
     assertOwner(owner);
     const checkId='check-'+crypto.randomUUID(),proof='proof-'+crypto.randomUUID();
     say('กำลังทดสอบเขียน → อ่านกลับ → ลบรายการทดสอบใน Supabase...');
     const {error:writeError}=await c.from('bitbot_cloud_checks').insert({user_id:owner,check_id:checkId,proof});
     if(writeError)throw Error('เขียนข้อมูลไม่ได้: '+writeError.message);
     let readError=null,deleteError=null;
     try{
       const {data,error}=await c.from('bitbot_cloud_checks').select('proof').eq('check_id',checkId).single();
       if(error||data?.proof!==proof)readError=new Error('อ่านกลับไม่ตรงกับข้อมูลที่เขียน: '+(error?.message||'ค่าไม่ตรง'));
     }finally{
       const {error}=await c.from('bitbot_cloud_checks').delete().eq('check_id',checkId);
       if(error)deleteError=new Error('ลบแถวทดสอบไม่สำเร็จ: '+error.message);
     }
     if(readError)throw readError;
     if(deleteError)throw deleteError;
     cloudVerified=true;renderAuth();
     await cloudCounts(c);
     say('✅ ทดสอบ Supabase จริงสำเร็จ: เขียน อ่านกลับ และลบข้อมูลทดสอบแล้ว (RLS ตามบัญชีผู้ใช้)');
   });
 }
 function queueBootstrap(delay=3000){
   if(!user||!enabled)return;
   if(syncTimer)clearTimeout(syncTimer);
   syncTimer=setTimeout(async()=>{
     syncTimer=null;
     try{
       assertOwner(user.id);
       const local=await Promise.all(tables.map(([name])=>readLocal(name)));
       if(local.some(records=>records.length>0))await sync(true);
       else await restore();
     }catch(e){say('Cloud ยังไม่ได้ซิงก์: '+e.message,true);}
   },delay);
 }
 function queueAutoSync(delay=8000){
   if(!user||!enabled)return;
   if(syncTimer)clearTimeout(syncTimer);
   syncTimer=setTimeout(()=>{syncTimer=null;sync(true).catch(e=>say('Cloud ยังไม่สำเร็จ (ประวัติในเครื่องยังปลอดภัย): '+e.message,true));},delay);
 }
 function mount(){const el=$('v6CloudMount'),badge=$('v6CloudBadge');if(!el)return;
   if(!enabled){if(badge)badge.textContent='ยังไม่เชื่อม Supabase';
     el.textContent='กำลังใช้ประวัติในเครื่อง คุณยังสามารถสำรองไฟล์ JSON ได้';return;
   }
   el.innerHTML='<p>เข้าสู่ระบบด้วยอีเมลครั้งแรก แล้วเว็บไซต์จะสำรองบทเรียนขึ้น Supabase อัตโนมัติขณะเปิดเว็บและมีอินเทอร์เน็ต ข้อมูลเป็นส่วนตัวของบัญชีคุณ</p><div class="v6-cloud-auth"><input id="v6CloudEmail" type="email" autocomplete="email" placeholder="อีเมลสำหรับสำรองบทเรียน" aria-label="อีเมลสำหรับเข้าสู่ระบบ"><button id="v6CloudLogin" type="button">ส่งลิงก์เข้าใช้</button><button id="v6CloudLogout" type="button">ออกจากระบบ</button></div><p id="v6CloudWho">กำลังตรวจสอบบัญชี...</p><div class="v6-tools"><button id="v6CloudSync" type="button">☁️ สำรองขึ้น Cloud ตอนนี้</button><button id="v6CloudRestore" type="button">⬇️ ดึงบทเรียนจาก Cloud</button><button id="v6CloudCheck" type="button">🧪 ทดสอบบันทึกจริง</button></div><p id="v6CloudCounts" aria-live="polite">ยังไม่ได้อ่านจำนวนข้อมูลบน Cloud</p><p id="v6CloudStatus" role="status" aria-live="polite">PAPER ONLY · ข้อมูลจะอยู่ในเครื่องจนกว่าจะลงชื่อเข้าใช้เพื่อสำรองออนไลน์</p>';
   $('v6CloudLogin').onclick=login;
   $('v6CloudLogout').onclick=async()=>{try{await (await getClient()).auth.signOut();user=null;if(syncTimer)clearTimeout(syncTimer);renderAuth();say('ออกจากระบบแล้ว ข้อมูลในเครื่องยังอยู่');}catch(e){say(e.message,true);}};
   $('v6CloudSync').onclick=()=>sync(false).catch(e=>say('สำรอง Cloud ไม่สำเร็จ: '+e.message,true));
   $('v6CloudRestore').onclick=()=>restore().catch(e=>say('กู้คืน Cloud ไม่สำเร็จ: '+e.message,true));
   $('v6CloudCheck').onclick=()=>testCloud().catch(e=>say('ทดสอบ Cloud ไม่สำเร็จ: '+e.message,true));
   getClient().then(async c=>{const {data,error}=await c.auth.getUser();if(error&&error.status!==400)throw error;
     user=data?.user||null;renderAuth();if(user)queueBootstrap(4500);else say('เซิร์ฟเวอร์ Supabase พร้อมเชื่อมต่อ · กรุณาเข้าสู่ระบบเพื่อสำรองข้อมูลจริง');
   }).catch(e=>say('เชื่อมต่อ Supabase ไม่สำเร็จ: '+e.message,true));
   document.addEventListener('bitbot:memory-saved',()=>queueAutoSync(10000));
   window.addEventListener('online',()=>queueAutoSync(3500));
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount);else mount();
 window.BitbotCloudV6={configured:enabled, sync:()=>sync(false), restore, testCloud};
})();