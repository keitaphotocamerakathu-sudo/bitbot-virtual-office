import {plannerConfig} from './adaptive.mjs';
export const DATA_POLICIES=Object.freeze(['legacy','verified-v17']);
export function runtimeConfig(input={},live=false){const c=plannerConfig(input,live);if(!DATA_POLICIES.includes(c.marketDataPolicy||'legacy'))throw Error('ระบบข้อมูลตลาดไม่ถูกต้อง');return c;}
export function dataUpgradeBlock(bot,pending=[]){
 if(!bot)return 'ตั้งค่าบัญชีก่อนอัปเดตระบบข้อมูล';
 if(bot.state?.halted)return 'พอร์ตล็อกความเสี่ยง กรุณาตรวจสถานะก่อน';
 if(Number(bot.state?.qty)>0)return 'รอให้ปิดสถานะของบอทก่อนอัปเดตระบบข้อมูล';
 if(pending.some(o=>!o.settled))return 'มีคำสั่งที่ยังตรวจผลไม่เสร็จ กรุณารอการตรวจผล';
 if(bot.config?.marketDataPolicy==='verified-v17')return 'ใช้ระบบข้อมูลใหม่อยู่แล้ว';
 return null;
}
