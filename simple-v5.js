
/* Simplified Bitbot interface, presentation only. Original trading and memory engines remain intact. */
(function(){
'use strict';
const $=id=>document.getElementById(id);
function details(el,title,sub,cls){
 if(!el)return null;
 const d=document.createElement('details');d.className='simple-expand '+cls;
 const s=document.createElement('summary');
 s.innerHTML='<span>'+title+'<small>'+sub+'</small></span>';
 el.before(d);d.append(s,el);return d;
}
function init(){
 const sim=$('simPanel'),controls=sim?.querySelector('.sim-controls'),scenario=$('simScenario');
 if(!sim||!controls||!scenario||document.body.classList.contains('simple-v5'))return;
 document.body.classList.add('simple-v5');
 const breadcrumb=document.querySelector('.breadcrumbs');
 if(breadcrumb)breadcrumb.innerHTML='₿ <strong>BITBOT</strong> · ทดลองเทรด Bitcoin';
 const eyebrow=document.querySelector('.page-head .eyebrow');if(eyebrow)eyebrow.textContent='BITBOT · PAPER TRADING';
 const head=document.querySelector('.page-head h1');if(head)head.innerHTML='ลองให้บอต <span>เทรด Bitcoin</span> 🤖';
 const desc=document.querySelector('.page-head p');if(desc)desc.textContent='เลือกสถานการณ์ กดเริ่ม แล้วดูบอต 5 ตัวช่วยกันตัดสินใจซื้อ–ขายจำลอง ไม่ใช้เงินจริง';
 const phead=document.querySelector('.page-head');
 const steps=document.createElement('div');steps.className='simple-steps';
 steps.innerHTML='<div class="simple-step"><span class="n">1</span><span>เลือกตลาด<small>ขาขึ้น ขาลง หรือแกว่ง</small></span></div><div class="simple-step"><span class="n">2</span><span>กดเริ่มจำลอง<small>ให้บอตประเมินราคา</small></span></div><div class="simple-step"><span class="n">3</span><span>ดูผลและบทเรียน<small>ดู BUY / SELL / กำไร</small></span></div>';
 phead?.after(steps);
 const links=document.createElement('nav');links.className='simple-links';links.setAttribute('aria-label','ทางลัด');
 links.innerHTML='<a href="#simPanel">▶ เริ่มทดลอง</a><a href="#office">🤖 ออฟฟิศบอต</a><button id="simpleMemory" type="button">🧠 บทเรียน</button><button id="simpleTrade" type="button">📒 ประวัติการเทรด</button>';
 steps.after(links);
 const simTitle=sim.querySelector('.sim-header b');if(simTitle)simTitle.textContent='🎮 เริ่มทดลองเทรด';
 const simDesc=sim.querySelector('.sim-header p');if(simDesc)simDesc.textContent='พอร์ตจำลองเริ่มต้น ฿100,000 · ไม่มีการส่งคำสั่งซื้อขายเงินจริง';
 const controlsLabels=Array.from(controls.querySelectorAll(':scope > label'));
 if(controlsLabels[0]){
  controlsLabels[0].classList.add('main-select');
  for(const n of controlsLabels[0].childNodes)if(n.nodeType===3&&n.textContent.trim()){n.textContent='① เลือกสถานการณ์ตลาด';break;}
 }
 const advanced=document.createElement('details');advanced.className='simple-extra';
 const summary=document.createElement('summary');summary.textContent='ตั้งค่าเพิ่มเติม · ตัวกรองตลาด / ความเร็ว / ไฟล์ข้อมูล';
 const inner=document.createElement('div');inner.className='simple-extra-inside';advanced.append(summary,inner);
 controlsLabels.slice(1).forEach(n=>inner.append(n));
 const stepBtn=$('simStep');if(stepBtn){stepBtn.textContent='⏭ เดินทีละแท่ง';inner.append(stepBtn);}
 const oldHistory=sim.querySelector('.history-tools');if(oldHistory)inner.append(oldHistory);
 controls.after(advanced);
 const guide=document.createElement('p');guide.className='simple-guide';
 guide.id='simpleGuide';guide.setAttribute('aria-live','polite');advanced.before(guide);
 function updateGuide(){
  const tips={cycle:'ตลาดมีขึ้นและลงเป็นรอบ เหมาะสำหรับดู BUY → SELL',bull:'ตลาดขาขึ้น ช่วยดูว่า AI เข้าซื้อเมื่อไร',bear:'ตลาดขาลง ช่วยทดสอบการควบคุมความเสี่ยง',sideways:'ตลาดแกว่งแคบ ทดสอบว่า AI เทรดถี่เกินไปไหม',flash:'ตลาดราคาดิ่งแรง ทดสอบ Stop Loss และการหยุดซื้อ',imported:'ใช้ข้อมูล CSV ของคุณเอง ซึ่งต้องตรวจสอบแหล่งข้อมูลก่อน'};
  guide.textContent=tips[scenario.value]||'เลือกตลาดแล้วเริ่มจำลอง';
 }
 scenario.addEventListener('change',updateGuide);updateGuide();
 const showcase=sim.querySelector('.showcase-strip');
 if(showcase){controls.after(showcase);const b=$('showTradeNow');if(b)b.textContent='▶ ดู BUY → SELL 1 รอบ';}
 const metrics=$('metrics'),office=$('office');
 if(metrics&&office){sim.after(metrics);metrics.after(office);}
 const result=document.createElement('div');result.className='simple-result';result.setAttribute('role','status');result.setAttribute('aria-live','polite');
 result.innerHTML='<div><strong>📣 ผลการตัดสินใจล่าสุด</strong><p id="simpleLastTrade">ยังไม่มีคำสั่ง — กดเริ่มจำลองเพื่อดูผล</p></div><span class="signal" id="simpleLastSignal">WAIT</span>';
 if(metrics&&office){metrics.after(result);result.after(office);}
 const trades=$('simTradesBody'),signal=$('signalMetric');
 function updateLast(){
  const row=trades?.querySelector('tr');
  if(row&&row.cells.length>=7){
   const side=row.cells[1]?.textContent?.trim()||'WAIT',price=row.cells[2]?.textContent?.trim()||'—';
   $('simpleLastSignal').textContent=side;
   $('simpleLastTrade').textContent='คำสั่งล่าสุด: '+side+' · ราคา '+price+' THB · เปิดประวัติเพื่อดูรายละเอียด';
  }else{
   $('simpleLastSignal').textContent=(signal?.textContent||'WAIT')+' · PAPER';
  }
 }
 if(trades)new MutationObserver(updateLast).observe(trades,{childList:true,subtree:true,characterData:true});
 if(signal)new MutationObserver(updateLast).observe(signal,{childList:true,subtree:true,characterData:true});
 updateLast();
 const detail=details(document.querySelector('.sim-detail'),'📒 ผลเทรดและประวัติทั้งหมด','ออร์เดอร์ ค่าธรรมเนียม ตารางผล และ CSV','simple-trades');
 const memory=details($('memoryLab'),'🧠 Trading Memory — บทเรียน','เปิดดูประวัติที่บอตจดจำและทดสอบ A/B เพิ่ม','simple-memory');
 details(document.querySelector('.lower-grid'),'🤖 รายละเอียดทีมและกิจกรรม','ส่วนเสริมสำหรับดูการทำงานของแต่ละ Agent','simple-team');
 $('simpleMemory')?.addEventListener('click',()=>{if(memory){memory.open=true;memory.scrollIntoView({behavior:'smooth',block:'start'});}});
 $('simpleTrade')?.addEventListener('click',()=>{if(detail){detail.open=true;detail.scrollIntoView({behavior:'smooth',block:'start'});}});
 const foot=document.querySelector('.main-content footer');
 if(foot)foot.textContent='BITBOT v5 · PAPER TRADING เท่านั้น · ข้อมูลราคาสังเคราะห์ ไม่ใช่ราคาสด Bitkub · บทเรียนเก็บในเบราว์เซอร์นี้ ควรสำรองเป็น JSON';
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
