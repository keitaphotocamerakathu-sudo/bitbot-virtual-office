/* Bitbot: prevent accidental duplicate OTP requests, give accurate 429 feedback.
 * Client-side guard is NOT a way to override Supabase project-wide email limits.
 */
(function(){
'use strict';
const STORE='bitbot:auth:otp-next-v1';
let memoryUntil=0;
function readUntil(){try{const x=Number(localStorage.getItem(STORE)||0);return Number.isFinite(x)&&x>Date.now()?x:memoryUntil;}catch(_){return memoryUntil;}}
function block(ms){const until=Date.now()+Math.max(0,ms);memoryUntil=Math.max(readUntil(),until);try{localStorage.setItem(STORE,String(memoryUntil));}catch(_){}return memoryUntil;}
function remaining(){return Math.max(0,Math.ceil((readUntil()-Date.now())/1000));}
function is429(e){return Number(e?.status)===429||e?.code==='over_email_send_rate_limit'||/rate limit|too many requests|only request this after/i.test(String(e?.message||''));}
function limitSeconds(e){
 const m=String(e?.message||'');
 const sec=m.match(/after\s+(\d+)\s+seconds?/i);
 if(sec)return Math.max(65,Math.min(3600,Number(sec[1])+5));
 return /email rate limit exceeded|over_email_send_rate_limit/i.test(m)?3600:90;
}
async function send(sendFn){
 const sec=remaining();
 if(sec)throw Object.assign(new Error('ยังไม่สามารถขออีเมลใหม่ได้ โปรดรอ '+Math.ceil(sec/60)+' นาที หรือเข้าด้วยรหัสผ่านที่ตั้งไว้'),{cooldown:true});
 try{
 const result=await sendFn();
 if(result?.error)throw result.error;
 block(65);
 return result;
 }catch(err){
 if(is429(err)){const s=limitSeconds(err);block(s);
 throw Object.assign(new Error(s>=3600?'Supabase จำกัดจำนวนอีเมลของโปรเจกต์แล้ว โปรดรอจนโควตากลับมา (อาจประมาณ 1 ชั่วโมง) หรือใช้รหัสผ่าน หากต้องการใช้งานหลายคนควรตั้ง Custom SMTP':'ส่งอีเมลถี่เกินไป โปรดรอประมาณ '+Math.ceil(s/60)+' นาทีแล้วลองอีกครั้ง'),{cooldown:true,originalStatus:429});
 }
 throw err;
 }
}
window.BitbotOtpGuard=Object.freeze({send,remaining,block});
})();
