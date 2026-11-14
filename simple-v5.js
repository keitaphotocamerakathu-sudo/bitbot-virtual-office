/* Bitbot v5 simplified interface. Presentation only; the existing paper engine and IndexedDB remain unchanged. */
(function(){
  'use strict';
  const by=id=>document.getElementById(id);
  const safeText=(el,text)=>{if(el)el.textContent=text};
  function wrapDetails(target,summaryHTML,className,expanded=false){
    if(!target||target.parentElement?.classList.contains('simple-detail')) return null;
    const d=document.createElement('details');d.className='simple-detail '+(className||'');d.open=expanded;
    const sum=document.createElement('summary');sum.innerHTML=summaryHTML;
    target.before(d);d.append(sum,target);return d;
  }
  function start(){
    const panel=by('simPanel'),scn=by('simScenario'),controls=panel?.querySelector('.sim-controls');
    if(!panel||!scn||!controls||document.body.classList.contains('simple-v5'))return;
    document.body.classList.add('simple-v5');
    const breadcrumb=document.querySelector('.breadcrumbs');
    if(breadcrumb)breadcrumb.innerHTML='₿ <strong>BITBOT</strong> · ทดลองเทรด Bitcoin';
    const small=document.querySelector('.page-head .eyebrow');safeText(small,'BITBOT · PAPER TRADING');
    const heading=document.querySelector('.page-head h1');if(heading)heading.innerHTML='เทรด Bitcoin <span>แบบทดลอง</span> 🤖';
    safeText(document.querySelector('.page-head p'),'เลือกสถานการณ์ตลาด แล้วดูว่าบอตทั้ง 5 ตัวตัดสินใจซื้อ ขาย หรือรออย่างไร โดยไม่ใช้เงินจริง');
    const main=document.querySelector('.main-content'),head=document.querySelector('.page-head');
    const steps=document.createElement('div');steps.className='simple-stepper';steps.setAttribute('aria-label','สามขั้นตอนการทดลอง');
    steps.innerHTML='<div class="simple-step"><span class="num">1</span><div>เลือกตลาด<small>เช่น ตลาดขาขึ้น</small></div></div><div class="simple-step"><span class="num">2</span><div>เริ่มจำลอง<small>บอตวิเคราะห์ทีละแท่ง</small></div></div><div class="simple-step"><span class="num">3</span><div>ดูผลลัพธ์<small>กำไร ขาดทุน บทเรียน</small></div></div>';
    head.after(steps);
    const tabs=document.createElement('nav');tabs.className='simple-tabs';tabs.setAttribute('aria-label','ทางลัด');
    tabs.innerHTML='<a href="#simPanel">▶ เริ่มจำลอง</a><a href="#office">🤖 ออฟฟิศบอต</a><button type="button" id="simpleMemoryOpen">🧠 บทเรียนที่จำไว้</button><button type="button" id="simpleDetailOpen">📒 ประวัติการเทรด</button>';
    steps.after(tabs);
    const title=panel.querySelector('.sim-header b');safeText(title,'🎮 เริ่มทดลองเทรด');
    safeText(panel.querySelector('.sim-header p'),'เริ่มต้นด้วยเงินจำลอง 100,000 บาท · ข้อมูลราคาเป็นสถานการณ์สังเคราะห์');
    const labels=Array.from(controls.querySelectorAll(':scope > label'));
    if(labels[0]){
      labels[0].classList.add('simple-main-scenario');
      const tn=Array.from(labels[0].childNodes).find(n=>n.nodeType===3&&n.textContent.trim());
      if(tn)tn.textContent='① เลือกสถานการณ์ตลาด';
    }
    const extra=document.createElement('details');extra.className='simple-extra';
    const sum=document.createElement('summary');sum.textContent='ตั้งค่าเพิ่มเติม (ตัวกรองตลาด · ความเร็ว · ข้อมูลย้อนหลัง)';
    const body=document.createElement('div');body.className='simple-extra-content';
    extra.append(sum,body);
    labels.slice(1).forEach(n=>body.append(n));
    const step=by('simStep');if(step){step.textContent='⏭ ประมวลผลทีละแท่ง';body.append(step);}
    const history=panel.querySelector('.history-tools');if(history)body.append(history);
    controls.after(extra);
    const tip=document.createElement('p');tip.className='simple-help';tip.id='simpleScenarioHelp';tip.setAttribute('aria-live','polite');
    extra.before(tip);
    function explain(){const text={cycle:'มีขึ้นและลงสลับกัน เหมาะสำหรับดูตัวอย่าง BUY / SELL',bull:'ตลาดราคาขึ้นต่อเนื่อง ใช้ดูว่าบอตเข้าซื้อเมื่อไร',bear:'ตลาดราคาลดลง ใช้ทดสอบว่าบอตจะป้องกันความเสี่ยงอย่างไร',sideways:'ราคาวิ่งในกรอบแคบ ใช้ทดสอบว่าบอตซื้อขายถี่เกินไปหรือไม่',flash:'ราคาดิ่งฉับพลัน ใช้ตรวจสอบ Stop Loss และการหยุดซื้อ',imported:'ใช้ไฟล์ CSV ที่นำเข้าเอง — ตรวจสอบแหล่งข้อมูลก่อนเสมอ'};safeText(tip,text[scn.value]||'เลือกสถานการณ์เพื่อเริ่มทดสอบ');}
    scn.addEventListener('change',explain);explain();
    const show=panel.querySelector('.showcase-strip');if(show){controls.after(show);const b=by('showTradeNow');if(b)b.textContent='▶ ดูบอตซื้อ–ขาย 1 รอบ';}
    const metrics=by('metrics'),office=by('office');if(metrics&&office){panel.after(metrics);metrics.after(office);}
    const latest=document.createElement('div');latest.className='simple-result';latest.setAttribute('role','status');latest.setAttribute('aria-live','polite');
    latest.innerHTML='<div><strong>📣 ผลการตัดสินใจล่าสุด</strong><p id="simpleTradeLine">ยังไม่มีคำสั่ง — กดเริ่มจำลองเพื่อให้บอตวิเคราะห์</p></div><span class="simple-result-signal" id="simpleSignal">⏳ รอเริ่ม</span>';
    if(metrics){metrics.after(latest);latest.after(office);}
    const tradeBody=by('simTradesBody'),signal=by('signalMetric');
    function refreshTrade(){
      const row=tradeBody?.querySelector('tr');if(!row)return;
      if(row.cells.length<7){safeText(by('simpleTradeLine'),'ยังไม่มีคำสั่ง — ระบบกำลังรอข้อมูลหรือสัญญาณ');safeText(by('simpleSignal'),(signal?.textContent||'WAIT')+' · PAPER');return;}
      const side=row.cells[1]?.textContent?.trim()||'WAIT',price=row.cells[2]?.textContent?.trim()||'—';
      safeText(by('simpleSignal'),(side.includes('BUY')?'🟢 ':side.includes('SELL')?'🔴 ':'')+side);
      safeText(by('simpleTradeLine'),'ล่าสุด: '+side+' · ราคา '+price+' THB · ดูรายละเอียดได้ในประวัติการเทรด');
    }
    if(tradeBody)new MutationObserver(refreshTrade).observe(tradeBody,{childList:true,subtree:true,characterData:true});
    if(signal)new MutationObserver(refreshTrade).observe(signal,{childList:true,subtree:true,characterData:true});
    refreshTrade();
    const dTrade=wrapDetails(document.querySelector('.sim-detail'),'<span>📒 รายละเอียดการซื้อ–ขายและผลทดสอบ <small>ออร์เดอร์ ค่าธรรมเนียม CSV และการเปรียบเทียบกลยุทธ์</small></span>','simple-trade-details');
    const memory=by('memoryLab');
    const dMemory=wrapDetails(memory,'<span>🧠 Trading Memory <small>บันทึกรอบทดลองและนำบทเรียนกลับมาทดสอบ</small></span>','simple-memory-details');
    const lower=document.querySelector('.lower-grid');
    wrapDetails(lower,'<span>🤖 ดูรายละเอียดทีม AI และบันทึกกิจกรรม <small>กดตัวละครในออฟฟิศเพื่อดูหน้าที่ได้เช่นกัน</small></span>','simple-team-details');
    by('simpleMemoryOpen')?.addEventListener('click',()=>{if(dMemory){dMemory.open=true;dMemory.scrollIntoView({behavior:'smooth',block:'start'});}});
    by('simpleDetailOpen')?.addEventListener('click',()=>{if(dTrade){dTrade.open=true;dTrade.scrollIntoView({behavior:'smooth',block:'start'});}});
    const foot=document.querySelector('.main-content footer');
    safeText(foot,'Bitbot v5 · PAPER TRADING เท่านั้น · ข้อมูลราคาสังเคราะห์ ไม่ใช่ราคาสด Bitkub · Trading Memory เก็บในเบราว์เซอร์นี้ ควรสำรอง JSON');
    const motion=by('motionToggle');if(motion)motion.title='หยุดหรือเล่นภาพเคลื่อนไหวของหุ่นยนต์';
  }
  if(document.readyState==='complete')start();
  else document.addEventListener('DOMContentLoaded',start);
})();