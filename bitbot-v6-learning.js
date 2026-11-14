/* Bitbot Learning Lab v6 - independent holdout evaluation, durable audit records.
 * PAPER ONLY. Never submit orders. Does not self-modify production strategies.
 */
(()=>{
 'use strict';
 const DB='bitbot-paper-learning-v4';
 const SCENARIOS=['cycle','bull','bear','sideways','flash'];
 const GUARDS_V6={off:{minAtr:0,minSlowSlope:-1,minTrendEfficiency:0},balanced:{},strict:{minAtr:.003,minSlowSlope:.00035,minTrendEfficiency:.18}};
 const $=id=>document.getElementById(id);
 const fmt=(x,n=2)=>Number(x||0).toLocaleString('th-TH',{minimumFractionDigits:n,maximumFractionDigits:n});
 const freshSeed=()=>crypto.getRandomValues(new Uint32Array(1))[0]>>>0;
 const now=()=>new Date().toISOString();
 const regimes={cycle:'ขึ้น–ลงสลับ',bull:'ขาขึ้น',bear:'ขาลง',sideways:'ออกข้าง',flash:'ดิ่งฉับพลัน'};
 let busy=false;
 function openDb(){return new Promise((resolve,reject)=>{
   if(!('indexedDB' in window)){reject(Error('เบราว์เซอร์ไม่รองรับ IndexedDB'));return;}
   const req=indexedDB.open(DB,1);
   req.onupgradeneeded=()=>{const d=req.result;for(const name of ['runs','journal','lessons']){if(!d.objectStoreNames.contains(name)){const s=d.createObjectStore(name,{keyPath:'id'});if(name!=='runs')s.createIndex('run','runId');else s.createIndex('scenario','scenario');}}};
   req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error||Error('เปิด IndexedDB ไม่สำเร็จ'));
 });}
 async function getAll(table){await window.BitbotMemory?.flush?.();const db=await openDb();return new Promise((resolve,reject)=>{
  const tx=db.transaction(table),req=tx.objectStore(table).getAll();req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);tx.oncomplete=()=>db.close();tx.onabort=()=>db.close();
 });}
 async function batchPut(table,items,chunk=200){if(!items.length)return;const db=await openDb();try{
  for(let j=0;j<items.length;j+=chunk){await new Promise((resolve,reject)=>{
    const tx=db.transaction(table,'readwrite');const obj=tx.objectStore(table);
    for(const entry of items.slice(j,j+chunk))obj.put(entry);
    tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error||Error('การบันทึกไม่สำเร็จ'));tx.onabort=()=>reject(tx.error||Error('พื้นที่เก็บข้อมูลไม่พอ'));
  });}
 }finally{db.close();}}
 function status(message,error=false){const v=$('v6Status');if(v){v.textContent=message;v.dataset.error=error?'true':'false';}}
 function summaryFor(s){const v=s.snapshot();return {cursor:v.cursor,equity:v.equity,returnPct:v.returnPct,netPnl:v.netPnl,buys:v.buys,sells:v.sells,fees:v.fees,maxDrawdownPct:v.maxDrawdownPct,filteredSignals:v.filteredSignals,blockedEntries:v.blockedEntries};}
 function round(x,n=2){return Math.round((x+Number.EPSILON)*Math.pow(10,n))/Math.pow(10,n)}
 function analyseGroup(items){
   if(!items.length)return null;
   const n=items.length, net=items.reduce((a,x)=>a+x.summary.netPnl,0)/n;
   const worst=Math.min(...items.map(x=>x.summary.netPnl));
   const dd=Math.max(...items.map(x=>x.summary.maxDrawdownPct));
   const trades=items.reduce((a,x)=>a+x.summary.buys+x.summary.sells,0);
   const fees=items.reduce((a,x)=>a+x.summary.fees,0);
   const negative=items.filter(x=>x.summary.netPnl<0).length;
   return {n,net,dd,worst,trades,fees,negative};
 }
 function createLesson(r){const pnl=r.summary.netPnl;const obs=[];
   if(pnl<0)obs.push('ขาดทุนสุทธิในสถานการณ์นี้');
   if(r.summary.buys===0)obs.push('ไม่เกิดคำสั่งซื้อ อาจพลาดโอกาส');
   if(r.summary.fees>Math.abs(pnl)&&r.summary.fees>10)obs.push('ค่าธรรมเนียมสูงเมื่อเทียบกับผลสุทธิ');
   if(r.summary.maxDrawdownPct>3)obs.push('Drawdown สูงกว่า 3%');
   if(!obs.length)obs.push('ผลจำลองยังไม่เพียงพอจะสรุปว่ากลยุทธ์ได้เปรียบ');
   return {id:`${r.id}:v6-summary`,runId:r.id,createdAt:now(),category:pnl<0?'LOSS':r.summary.buys===0?'NO_ENTRY':'EVALUATION',
     confidence:'OBSERVATION',appliedToStrategy:false,finding:obs.join(' · '),evidence:{run:r.id,seed:r.seed,scenario:r.scenario,guard:r.guard,costTier:r.costTier,...r.summary},version:6};
 }
 // Data is held out from prior recordings: new cryptographic seeds; same bars for paired guards.
 async function stress(){
   if(busy)return;busy=true;const btn=$('v6Stress');if(btn)btn.disabled=true;
   const started=performance.now(), core=window.PaperSimCore;
   if(!core?.PaperSimulator||!core.generateBars){status('ไม่พบเครื่องจำลอง Paper ที่ถูกต้อง',true);busy=false;if(btn)btn.disabled=false;return;}
   let successes=0,failures=[];const rows=[];
   try{
     const existing=await getAll('runs');const seen=new Set(existing.filter(x=>Number.isInteger(x.seed)).map(x=>`${x.scenario}:${x.seed}`));
     const costs=[{id:'standard',fee:.0025,slippage:.0005},{id:'stress',fee:.0050,slippage:.0030}];
     // 5 markets × 3 independent seeds × 3 guards × 2 cost conditions = 90 verified runs.
     const total=5*3*3*2;let done=0;
     for(const scenario of SCENARIOS){
       for(let trial=0;trial<3;trial++){
         let seed=freshSeed(),tries=0;while(seen.has(`${scenario}:${seed}`)&&tries++<30)seed=freshSeed();
         if(seen.has(`${scenario}:${seed}`))throw Error('ไม่สามารถสร้าง seed ใหม่ที่ไม่ซ้ำได้');
         seen.add(`${scenario}:${seed}`);const bars=core.generateBars(scenario,560,seed);
         for(const cost of costs){
          for(const [guard,params] of Object.entries(GUARDS_V6)){
           const id=`v6:${scenario}:${seed}:${cost.id}:${guard}`;
           try{
            const sim=new core.PaperSimulator(scenario,{bars,source:'SYNTHETIC_HELDOUT',cfg:{...params,fee:cost.fee,slippage:cost.slippage}});
            // Do not call .run(): v4 wraps it with per-candle IndexedDB transactions.
            // Instead execute the exact same .step() engine and persist its audit trail in batches.
            let steps=0;while(true){const v=sim.step();if(v.done)break;if(++steps>1000)throw Error('ระบบไม่หยุดตามจำนวนแท่งที่กำหนด');}
            const summary=summaryFor(sim);
            if(!Number.isFinite(summary.equity)||summary.equity<0||sim.trades.some(t=>t.mode!=='PAPER_ONLY'))throw Error('ละเมิดความปลอดภัยของพอร์ต');
            const record={id,kind:'heldout-stress',createdAt:now(),updatedAt:now(),scenario,guard,source:'SYNTHETIC_HELDOUT',seed,costTier:cost.id,version:6,status:'COMPLETED',startCash:100000,bars:bars.length,fees:cost.fee,slippage:cost.slippage,
              fingerprint:`v6:${scenario}:${seed}`,summary,safety:'PAPER_ONLY',appliedToStrategy:false};
            const decisions=sim.decisions.map((d,i)=>({id:`${id}:decision:${i}`,runId:id,kind:'decision',seq:i,ts:d.ts,signal:d.signal,evidence:{...d.detail},paperOnly:true}));
            const trades=sim.trades.map((t,i)=>({id:`${id}:trade:${i}`,runId:id,kind:'trade',seq:t.step,ts:t.ts,side:t.side,qty:t.qty,price:t.fill,fee:t.fee,pnl:t.pnl,reason:t.reason,cashAfter:t.cashAfter,btcAfter:t.btcAfter,paperOnly:true}));
            // Write details BEFORE marking a test completed, so incomplete tests cannot look successful.
            await batchPut('journal',decisions.concat(trades));
            await batchPut('lessons',[createLesson(record)]);
            await batchPut('runs',[record]);
            rows.push(record);successes++;
           }catch(e){failures.push(`${scenario}/${guard}/${cost.id}: ${e.message}`);}
           done++;status(`กำลังทดสอบ ${done}/${total} รอบ · บันทึกแล้ว ${successes} รอบ`);
          }
         }
       }
       await new Promise(resolve=>setTimeout(resolve,0));
     }
     const result=compare(rows);
     const time=((performance.now()-started)/1000).toFixed(1);
     status(`บันทึกการทดสอบ ${successes}/${total} รอบ (${time} วินาที) · ${failures.length?'มีข้อผิดพลาด '+failures.length+' รายการ':'ไม่มีข้อผิดพลาดที่ตรวจพบ'}`,Boolean(failures.length));
     const out=$('v6Findings');if(out)out.textContent=result+(failures.length?'\nข้อผิดพลาด:\n'+failures.slice(0,4).join('\n'):'');
     await refresh();
     document.dispatchEvent(new Event('bitbot:memory-saved'));
   }catch(e){status('หยุดการทดสอบเพื่อความปลอดภัย: '+e.message,true);}
   finally{busy=false;if(btn)btn.disabled=false;}
 }
 function compare(rows){
   const text=['บทเรียนจากชุดข้อมูลใหม่ (ยังไม่ปรับกฎเทรดโดยอัตโนมัติ)'];
   for(const scenario of SCENARIOS){
    const found=rows.filter(x=>x.scenario===scenario);
    if(!found.length)continue;
    const grouped=Object.fromEntries(Object.keys(GUARDS_V6).map(k=>[k,analyseGroup(found.filter(r=>r.guard===k))]));
    const parts=Object.entries(grouped).filter(([k,v])=>v).map(([k,v])=>`${k}: เฉลี่ย ${v.net<0?'−':'+'}฿${fmt(Math.abs(v.net))} / DD สูงสุด ${fmt(v.dd)}% / ซื้อขาย ${v.trades} ครั้ง`);
    text.push(`${regimes[scenario]} → ${parts.join(' | ')}`);
   }
   text.push('ทุกผลเป็นข้อมูลสังเคราะห์ ผลครั้งนี้เป็นเพียงข้อสังเกต ไม่ใช่การยืนยันว่ากลยุทธ์ชนะตลาดจริง');
   return text.join('\n\n');
 }
 function chooseSuggestion(runs){
   const valid=runs.filter(r=>r.status==='COMPLETED' && r.source==='SYNTHETIC_HELDOUT' && r.summary && Number.isFinite(r.summary.netPnl));
   const byCase=new Map();for(const r of valid){const k=`${r.scenario}:${r.costTier||'standard'}`;if(!byCase.has(k))byCase.set(k,[]);byCase.get(k).push(r);}
   const lines=[];
   for(const [key,rows] of byCase){
     const perGuard=Object.entries(GUARDS_V6).map(([guard])=>({guard,data:analyseGroup(rows.filter(x=>x.guard===guard))})).filter(x=>x.data && x.data.n>=3);
     if(perGuard.length<2)continue;perGuard.sort((a,b)=>b.data.net-a.data.net);
     const [best,worst]=[perGuard[0],perGuard.at(-1)];
     const minTests=Math.min(...perGuard.map(x=>x.data.n));
     const verdict=minTests<20?'ข้อมูลยังน้อย ต้องทดสอบข้อมูลใหม่เพิ่ม':'ครบขั้นต่ำการจำลอง ยังต้องตรวจข้อมูลจริงนอกตัวอย่าง';
     const safety=best.data.dd>worst.data.dd+1?' แต่ตัวเลือกผลเฉลี่ยสูงกว่ามี Drawdown เสี่ยงเพิ่ม':'';
     const inactive=best.data.trades===0?' ⚠️ กลยุทธ์นี้ไม่ได้ซื้อขายเลย จึงไม่ถือว่าชนะตลาด':'';
     lines.push(`${key} (${minTests} ชุด/กลยุทธ์): ${best.guard} เฉลี่ย ฿${fmt(best.data.net)} เทียบ ${worst.guard} ฿${fmt(worst.data.net)} · ${verdict}${safety}${inactive}`);
   }
   if(!lines.length)return 'ยังไม่มีหลักฐานเพียงพอสำหรับเปรียบเทียบกลยุทธ์ กด “ทดสอบตลาดยาก 90 รอบ” เพื่อสร้างชุดทดสอบที่ไม่ซ้ำเดิม';
   return 'ข้อเสนอจาก Trading Memory (ไม่ปรับกลยุทธ์อัตโนมัติ):\n'+lines.join('\n\n');
 }
 async function refresh(){
   try{
    const [runs,journal,lessons]=await Promise.all(['runs','journal','lessons'].map(getAll));
    const r=$('v6Counts');if(r)r.textContent=`คลังในเครื่อง: ${runs.length.toLocaleString('th-TH')} รอบ · ${journal.filter(x=>x.kind==='trade').length.toLocaleString('th-TH')} คำสั่ง · ${lessons.length.toLocaleString('th-TH')} บทเรียน`;
    const out=$('v6Suggestions');if(out)out.textContent=chooseSuggestion(runs);
    const latest=runs.filter(x=>x.status==='COMPLETED').sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt)))[0];
    const last=$('v6Last');if(last)last.textContent=latest?`บันทึกล่าสุด ${new Date(latest.updatedAt).toLocaleString('th-TH')} · ${latest.scenario} · ${latest.summary?.netPnl<0?'−':'+'}฿${fmt(Math.abs(latest.summary?.netPnl||0))}`:'ยังไม่มีรอบทดสอบที่บันทึก';
    if(window.BitbotMemory?.renderMemory)await window.BitbotMemory.renderMemory();
   }catch(e){status('อ่านประวัติไม่สำเร็จ: '+e.message,true);}
 }
 function makeUi(){
   const target=$('simPanel');if(!target||$('v6Panel'))return;
   const el=document.createElement('section');el.className='v6-panel';el.id='v6Panel';el.setAttribute('aria-label','ระบบเรียนรู้และสำรองการเทรด');
   el.innerHTML=`<div class="v6-top"><div><span class="v6-eyebrow">BITBOT v6 · LEARNING LAB</span><h2>🧠 บอตจดจำอะไรจากการเทรด?</h2><p>ทุกคำสั่งจำลองและรอบทดสอบจะบันทึกไว้ในเครื่องนี้ · ทดสอบเพิ่มจากชุดข้อมูลใหม่เพื่อหาข้อบกพร่อง</p></div><span class="v6-chip">PAPER ONLY</span></div>
   <div class="v6-summary"><span id="v6Counts">กำลังอ่านคลังบทเรียน...</span><small id="v6Last">รอประวัติ</small></div>
   <details class="v6-more"><summary>🧪 การทดสอบเข้มข้นและผลการเรียนรู้ <small>เปิดเพื่อทดสอบ 90 รอบ</small></summary>
    <div class="v6-tools"><button type="button" id="v6Stress">▶ ทดสอบตลาดยาก 90 รอบ</button><button type="button" id="v6Refresh">↻ ทบทวนบทเรียน</button><button type="button" id="v6Export">⬇ สำรองบทเรียน JSON</button></div>
    <p id="v6Status" role="status" aria-live="polite">พร้อมทดลอง · ทุกครั้งจะบันทึกผลพร้อมรหัสชุดข้อมูล</p>
    <h3>ข้อเสนอจากบทเรียนเก่า</h3><div id="v6Suggestions" class="v6-notes">กำลังอ่านประวัติ...</div>
    <h3>ผลการทดสอบชุดใหม่</h3><pre id="v6Findings" class="v6-notes">กดทดสอบเพื่อเปรียบเทียบ กฎเดิม / สมดุล / เข้มงวด กับต้นทุนปกติและต้นทุนสูง</pre>
   </details><details class="v6-more"><summary>☁️ สำรองประวัติข้ามอุปกรณ์ <small id="v6CloudBadge">กำลังตรวจการเชื่อมต่อ</small></summary><div id="v6CloudMount"></div></details>`;
   const latest=$('metrics');if(latest)latest.after(el);else target.after(el);
   $('v6Stress').addEventListener('click',stress);$('v6Refresh').addEventListener('click',refresh);
   $('v6Export').addEventListener('click',()=>window.BitbotMemory?.exportMemory?.());
   refresh().catch(e=>status('เปิดคลังบทเรียนไม่สำเร็จ: '+e.message,true));
   document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh().catch(()=>{});});
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',makeUi);else makeUi();
 window.BitbotLearningV6={stress,refresh,getAll,batchPut,chooseSuggestion};
})();