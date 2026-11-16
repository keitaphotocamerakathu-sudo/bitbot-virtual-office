/* Bitbot Email Auth — no client-side countdown or artificial hourly lock.
 * Supabase server email quotas still apply; this helper never bypasses auth.
 * Only one in-flight request is allowed to prevent accidental double-clicks.
 */
(function(){'use strict';
let sending=false;
function isEmailLimit(error){
 return Number(error?.status)===429 || error?.code==='over_email_send_rate_limit'
   || /rate limit|too many requests|only request this after/i.test(String(error?.message||''));
}
async function send(request){
 if(sending)throw Object.assign(new Error('กำลังส่งคำขออยู่ ไม่จำเป็นต้องกดซ้ำ'),{pending:true});
 sending=true;
 try {
   const result=await request();
   if(result?.error)throw result.error;
   return result;
 }catch(error){
   if(isEmailLimit(error)){
     throw Object.assign(new Error('Supabase จำกัดการส่งอีเมลชั่วคราว หากต้องการเข้าใช้งานทันทีให้ใช้เซสชันเดิมหรือรหัสผ่าน Bitbot ส่วนการส่งอีเมลถี่ ๆ ต้องตั้ง Custom SMTP'),{status:429,code:'over_email_send_rate_limit'});
   }
   throw error;
 }finally{sending=false;}
}
window.BitbotOtpGuard=Object.freeze({send,remaining:()=>0});
})();
