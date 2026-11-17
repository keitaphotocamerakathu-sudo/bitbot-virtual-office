// Release-reviewed evidence. A browser or saved config cannot approve its own strategy.
export const HISTORICAL_APPROVAL=Object.freeze({version:'13.0.0',approved:[],decision:'ยังไม่มีกลยุทธ์ผ่านเกณฑ์ข้อมูล จำนวนรอบ และกำไรสุทธิจากช่วงฝึก'});
export function liveReadiness(profile,shadow,now=Date.now()){
 const reasons=[];
 if(!HISTORICAL_APPROVAL.approved.includes(profile))reasons.push(HISTORICAL_APPROVAL.decision);
 const rows=Object.entries(shadow?.states||{}).filter(([key])=>key.startsWith(profile+':')).map(([,v])=>v);
 const ready=shadow?.enabled===true&&!shadow.last_error&&rows.some(r=>{const pnl=r.roundPnls||[],gain=pnl.reduce((v,p)=>v+Math.max(0,p),0),loss=pnl.reduce((v,p)=>v+Math.max(0,-p),0);return !r.error&&pnl.length>=20&&gain-loss>0&&(loss===0||gain/loss>=1.15)&&Number.isFinite(r.lastMarketAt)&&r.lastMarketAt<=now+5000&&now-r.lastMarketAt<180000&&now-Date.parse(shadow.started_at)>=14*86400000;});
 if(!ready)reasons.push('ยังไม่มีผลทดลองเดินหน้าสุทธิเป็นบวกอย่างน้อย 20 รอบและ 14 วัน');
 return{allowed:reasons.length===0,profile,reasons,historicalVersion:HISTORICAL_APPROVAL.version};
}
