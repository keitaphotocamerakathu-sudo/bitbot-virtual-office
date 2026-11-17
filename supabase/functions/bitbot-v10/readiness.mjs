import {HISTORICAL_APPROVAL} from './evidence.mjs';
import {closedStatistics} from './reporting.mjs';
export function readinessProgress(profile,shadow,now=Date.now()){
 const rows=Object.entries(shadow?.states||{}).filter(([key])=>key.startsWith(profile+':')).map(([key,r])=>{
 const start=r.forwardWindowAt||null,rounds=(r.roundHistory||[]).filter(x=>x.at>=start).map(x=>x.pnl),stats=closedStatistics(rounds),fresh=Number.isFinite(r.lastMarketAt)&&now-r.lastMarketAt<=180000&&r.lastMarketAt<=now+5000;
 const days=start&&fresh&&!r.error?(now-start)/86400000:0;return{key,days:Math.max(0,days),start,stats,fresh,net:rounds.reduce((v,p)=>v+p,0),running:shadow.enabled===true};
 }).sort((a,b)=>b.days-a.days||b.stats.rounds-a.stats.rounds);
 const best=rows[0]||{days:0,start:null,stats:closedStatistics([]),fresh:false,net:0,running:false};
 const checks=[{id:'historical',label:'ผลวิจัยและช่วงทดสอบนอกชุดฝึก',passed:HISTORICAL_APPROVAL.approved.includes(profile),value:'หลักฐานวิจัย '+HISTORICAL_APPROVAL.version},
 {id:'duration',label:'ทดลองต่อเนื่องอย่างน้อย 14 วัน',passed:best.days>=14,value:best.days.toFixed(2)+' / 14 วัน'},
 {id:'rounds',label:'รอบซื้อขายที่ปิดแล้วอย่างน้อย 20 รอบ',passed:best.stats.rounds>=20,value:best.stats.rounds+' / 20 รอบ'},
 {id:'net',label:'กำไรสุทธิเป็นบวกและผลกำไรต่อขาดทุนผ่านเกณฑ์',passed:best.net>0&&(best.stats.profitFactor>=1.15||best.stats.noLosingSamples),value:Number(best.net).toFixed(4)+' บาท'},
 {id:'data',label:'ข้อมูลตลาดและระบบทดลองพร้อม',passed:best.running&&best.fresh&&!shadow?.last_error,value:shadow?.enabled?'ตรวจความสดของข้อมูล':'คุณพักการทดลองไว้'}];
 return{profile,best,checks,technicalReady:checks.every(x=>x.passed),ownerApprovalRequired:true,automaticUnlock:false,policy:{days:14,rounds:20,source:'OWNER_SPECIFICATION_WITH_INITIAL_SAMPLE_POLICY'},note:'นับเวลาจากข้อมูลทดลองจริง หากขาดช่วงเกิน 5 นาทีจะเริ่มช่วงต่อเนื่องใหม่ การผ่านเกณฑ์ไม่รับประกันกำไร และยังต้องให้เจ้าของอนุมัติ LIVE'};
}
