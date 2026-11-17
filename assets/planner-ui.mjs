const $=id=>document.getElementById(id);
const label=p=>p==='net-v16'?'สูตรสุทธิตามเวลาถือ v16':'สูตรเดิม v13';
const number=(v,d=2)=>typeof v==='number'&&Number.isFinite(v)?v.toLocaleString('th-TH',{minimumFractionDigits:d,maximumFractionDigits:d}):'—';
const pct=v=>typeof v==='number'&&Number.isFinite(v)?number(v*100)+'%':'—';
const money=v=>typeof v==='number'&&Number.isFinite(v)?'฿'+number(v):'ยังสรุปไม่ได้';
function row(body,values){const tr=document.createElement('tr');for(const v of values){const td=document.createElement('td');td.textContent=String(v);tr.append(td);}body.append(tr);}
export function attachPlannerUI({api,getContext,openAuth,notice}){
 let account=null;
 function update(){const c=getContext();$('activePlanner').textContent='สูตรที่บัญชีเงินจริงใช้อยู่: '+label(c.cloud?.bot?.config?.entryPlanner);if(account!==c.accountId){account=c.accountId;$('planningBody').replaceChildren();$('planningStatus').textContent='กดตรวจสดเพื่อเทียบด้วยวงเงินและความเสี่ยงที่บันทึกไว้';}}
 $('comparePlanning').onclick=async()=>{if(!getContext().accountId){openAuth();return;}const id=getContext().accountId,button=$('comparePlanning');button.disabled=true;try{
 const data=await api('planning',{auth:true});if(id!==getContext().accountId)return;
 $('planningBody').replaceChildren();
 for(const r of data.rows){const p=r.plan;row($('planningBody'),[label(r.planner),r.symbol||'—',r.signal,pct(p?.cost),pct(p?.grossTarget),pct(p?.stopLoss),pct(p?.takeProfit),p?.horizon?.minutes?p.horizon.minutes+' นาที':'60 นาที',r.hourly?.ready?'พร้อม · '+r.hourly.regime:'ไม่พร้อม · '+(r.hourly?.bars||0)+' แท่ง',r.error||r.blocked.join(' • ')||(r.action==='BUY'?'ผ่านราคาและสัญญาณ ต้องตรวจทุกฝ่ายก่อนส่งจริง':'รอสัญญาณ')]);}
 $('planningStatus').textContent='ตรวจเมื่อ '+new Date(data.at).toLocaleString('th-TH',{timeZone:'Asia/Bangkok'})+' · เครดิตค่าธรรมเนียม '+(data.credits.ready?money(data.credits.available):'อ่านไม่ได้ จึงคิดค่าธรรมเนียมเต็ม')+' · สูตรใหม่ใช้เครดิตเฉพาะค่าซื้อที่ตรวจได้ ค่าขายคิดเต็ม · การตรวจนี้ไม่ส่งคำสั่ง';
 }catch(e){notice(e.message,true);}finally{button.disabled=false;}};
 async function research(){try{const response=await fetch('./assets/research-v16.json?v=16.0.0',{cache:'no-store'});if(!response.ok)throw Error('รายงานไม่พร้อม');const r=await response.json();$('netResearchDecision').textContent=r.decision+' · ย้อนหลัง '+r.protocol.days+' วัน / ช่วงท้าย '+r.protocol.validationDays+' วัน · ข้อมูลเดิมที่ใช้พัฒนา ไม่ใช่ผลเดินหน้าใหม่';
 const body=$('netResearchBody');body.replaceChildren();for(const x of r.validation.filter(x=>x.capital===r.protocol.capitalCases[0]))row(body,[x.profile+' / '+x.hold+' นาที',label(x.planner),x.costCase==='STANDARD_FEES'?'ค่าธรรมเนียมเต็ม':'สมมติมีเครดิตเฉพาะซื้อ',money(x.capital),x.buyFills,x.rounds,money(x.net),pct(x.coverage)]);
 $('netResearchNote').textContent='เปรียบเทียบทุน '+r.protocol.capitalCases.map(money).join(' และ ')+' บาท · ช่วงฝึก '+pct(r.training[0]?.coverage)+' / ช่วงท้าย '+pct(r.validation[0]?.coverage)+' ของเวลามีข้อมูลพร้อม · ใช้ราคา 6 เหรียญ ข่าวเป็นกลางและสมุดคำสั่งจำลอง ไม่มีตัวเลือกผ่านช่วงฝึกจึงยังไม่ยืนยันกำไร ค่าขายคิดเต็มแม้สมมติมีเครดิตตอนซื้อ';
 }catch{$('netResearchDecision').textContent='อ่านรายงานไม่ได้ จึงยังสรุปผลไม่ได้';}}
 research();update();return{update};
}
