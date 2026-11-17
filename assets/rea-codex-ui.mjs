// Presentation only. The server owns identity, quotas, secret storage and scheduling.
export function createCodexPanel({api,getSession,getLive}){
 const $=id=>document.getElementById(id),put=(id,x)=>$(id).textContent=x;
 let state=null,busy=false,loading=false,dirty=false,error='';
 const date=x=>x?new Date(x).toLocaleString('th-TH',{timeZone:'Asia/Bangkok'}):'—';
 const active=()=>state?.jobs?.find(j=>['CREATING','RUNNING','UNKNOWN','CANCEL_PENDING'].includes(j.status));
 const errors={CODEX_KEY_AND_CONSENT_REQUIRED:'เชื่อม OpenAI Key และยอมรับค่าใช้งานก่อน',CODEX_COST_AND_DATA_CONSENT_REQUIRED:'โปรดยืนยันการส่งข้อมูลและค่าใช้งาน OpenAI',CODEX_REQUEST_ALREADY_ACTIVE:'มีคำขอค้างอยู่แล้ว รอผลเดิมก่อน',CODEX_ACTIVE_REQUEST_REQUIRES_RESOLUTION:'มีคำขอค้างอยู่ กรุณารอหรือตรวจคำขอที่ไม่ทราบผลก่อนเปลี่ยน Key',CODEX_DAILY_LIMIT:'ใช้โควตา 8 ครั้งของวันนี้แล้ว',CODEX_REQUEST_COOLDOWN:'เว้นอย่างน้อย 5 นาทีระหว่างคำขอ',CODEX_INVALID_KEY:'รูปแบบ OpenAI API Key ไม่ถูกต้อง',CODEX_HTTP_401:'OpenAI ไม่ยอมรับ Key กรุณาตรวจ Key อีกครั้ง',CODEX_HTTP_403:'Key ยังไม่มีสิทธิ์ใช้ Codex Agents API หรือโมเดลที่กำหนด',CODEX_HTTP_404:'บัญชีนี้ยังเข้าถึง Codex Agents API หรือโมเดลที่กำหนดไม่ได้',CODEX_HTTP_429:'OpenAI จำกัดการใช้งาน กรุณาตรวจเครดิตและ Rate Limit',CODEX_NETWORK_OUTCOME_UNKNOWN:'ติดต่อ OpenAI ไม่สำเร็จ กรุณาตรวจสถานะก่อนลองใหม่',CODEX_RESOLUTION_CONFIRMATION_REQUIRED:'พิมพ์ข้อความยืนยันให้ตรงก่อน'};
 const explain=e=>errors[e]||e;
 const labels={CREATING:'กำลังสร้างคำขอ',RUNNING:'Codex กำลังวิเคราะห์',COMPLETED:'วิเคราะห์สำเร็จ',FAILED:'วิเคราะห์ไม่สำเร็จ',UNKNOWN:'ไม่ทราบผลคำขอ · หยุดรอตรวจสอบ',CANCEL_PENDING:'กำลังรอยืนยันการหยุดคำขอ',ABANDONED:'เจ้าของตรวจคำขอแล้ว'};
 function render(){
  const signed=!!getSession(),job=active(),result=state?.latest,verified=result?.provider==='OPENAI_CODEX_MANAGED_AGENT'&&result.canTrade===false&&result.model==='gpt-6.1-sol';
  const status=!signed?'เข้าสู่ระบบก่อน':error?'อ่านสถานะ Codex ไม่สำเร็จ':!state?'กำลังอ่าน Backend':!state.configured?'ยังไม่เชื่อม OpenAI Key':job?labels[job.status]:state.requested?'เข้าคิวแล้ว รอ Backend':verified?'มีผลวิเคราะห์ Codex จริง':state.consent?'Key ผ่านการตรวจเบื้องต้น · ยังไม่เคยวิเคราะห์สำเร็จ':'เชื่อม Key แล้ว · ปิดการวิเคราะห์';
  put('reaCodexStatus',status);put('reaCodexQuickStatus',status);
  put('reaCodexQuickSummary',verified?result.summary:'เชื่อม Codex เพื่ออ่านพอร์ตและข้อมูลตลาด แล้วเสนอแผนพร้อมเหตุผล');
  put('reaCodexUsage',state?'โควตาวันนี้ '+(state.dailyCalls||0)+' / 8 ครั้ง · อัตโนมัติทุก 3 ชั่วโมงเมื่อเปิดใช้':'โควตา 8 ครั้งต่อวัน · ค่า API คิดแยกตามการใช้งาน');
  put('reaCodexConnection',state?.configured?'บันทึก Key ฝั่ง Backend แล้ว · โมเดล gpt-6.1-sol':'ยังไม่มี OpenAI API Key สำหรับบัญชีนี้');
  put('reaCodexFeedback',error||$('reaCodexFeedback').textContent);$('reaCodexFeedback').classList.toggle('error-text',!!error);
  if(!dirty){$('reaCodexAuto').checked=state?.enabled===true;$('reaCodexConsent').checked=state?.consent===true;}
  $('reaCodexSave').disabled=!signed||busy||loading||!!error;
  const cooldown=state?.lastStarted&&Date.now()-Date.parse(state.lastStarted)<300000;
  $('reaCodexAsk').disabled=!signed||busy||loading||!!error||!state?.configured||!state?.consent||!!job||state?.requested===true||state?.dailyCalls>=8||!!cooldown||!getLive()?.state;
  put('reaCodexAskHint',!getLive()?.state?'ต้องมีพอร์ต Live ที่จัดสรรทุนก่อน Codex จึงจะอ่านพอร์ตได้':cooldown?'เว้น 5 นาทีระหว่างคำขอ · Backend รอผลเดิมก่อนส่งใหม่':'ผลเป็นข้อเสนอให้ตรวจต่อ กฎซื้อขายและ Stop Loss ทำงานจาก Backend ตามเดิม');
  $('reaCodexUnknown').hidden=job?.status!=='UNKNOWN';$('reaCodexResolve').disabled=!signed||busy||$('reaCodexResolution').value!=='ตรวจคำขอ Codex ที่ไม่ทราบผลแล้ว';
  $('reaCodexResult').replaceChildren();
  if(verified){
   for(const [tag,value] of [['h3',result.summary],['p','ภาวะตลาด '+result.regime+' · ความเสี่ยง '+result.marketRisk+' · ความมั่นใจเชิงความเห็น '+Math.round(result.confidence*100)+'%'],['small','วิเคราะห์ '+date(result.at)+' · ข้อมูล ณ '+date(result.sourceAt)+' · '+result.model],['small','Session: '+result.sessionId+' · Turn: '+result.turnId]]){const el=document.createElement(tag);el.textContent=value;$('reaCodexResult').append(el);}
   const old=Date.now()-result.sourceAt>180000||result.dataFresh!==true;if(old){const el=document.createElement('p');el.className='error-text';el.textContent='ข้อมูลที่ใช้อ้างอิงเก่าแล้ว อ่านเป็นประวัติเท่านั้น ต้องตรวจราคาสดก่อนพิจารณาแผน';$('reaCodexResult').append(el);}
   const names={WATCH:'เฝ้าดู',HOLD:'ถือตามแผนเดิม',REVIEW_ENTRY:'เสนอพิจารณาเข้า',REVIEW_EXIT:'เสนอพิจารณาออก'};
   for(const a of result.actions||[]){const article=document.createElement('article'),h=document.createElement('strong'),p=document.createElement('p'),e=document.createElement('small');h.textContent=a.symbol+' · '+(names[a.action]||a.action);p.textContent=a.reason;e.textContent='หลักฐาน: '+(a.evidenceIds||[]).join(', ');article.append(h,p,e);$('reaCodexResult').append(article);}
   for(const v of result.limitations||[]){const p=document.createElement('p');p.className='subtle';p.textContent=v;$('reaCodexResult').append(p);}
  }else put('reaCodexResult','ยังไม่มีคำตอบจาก Codex ที่ตรวจสอบ Session และผลสำเร็จได้');
  const history=$('reaCodexHistory');history.replaceChildren();for(const j of state?.jobs||[]){const article=document.createElement('article'),h=document.createElement('strong'),p=document.createElement('p');h.textContent=date(j.created_at)+' · '+(labels[j.status]||j.status);p.textContent=(j.result?.summary||explain(j.error_code)||'รอผลจาก OpenAI')+(j.session_id?' · Session '+j.session_id:'');article.append(h,p);history.append(article);}if(!history.children.length)history.textContent='ยังไม่มีประวัติคำขอ';
 }
 async function refresh(){if(loading||!getSession())return;loading=true;try{const r=await api('rea-codex-state');if(!r.codex)throw Error('ยังอ่านสถานะ Codex จาก Backend ไม่ได้');state=r.codex;error='';}catch(e){error=explain(e.message);}finally{loading=false;render();}}
 function reset(){state=null;dirty=false;error='';for(const id of ['reaCodexKey','reaCodexQuestion','reaCodexResolution'])$(id).value='';put('reaCodexFeedback','');render();}
 async function mutate(action,data){if(busy)return;busy=true;error='';put('reaCodexFeedback','กำลังบันทึกที่ Backend…');render();try{const r=await api(action,data);if(r.codex)state=r.codex;dirty=false;put('reaCodexFeedback',action==='rea-codex-request'?'เข้าคิวแล้ว Backend จะเริ่มภายในรอบถัดไป ปิดหน้าเว็บได้':action==='rea-codex-config'?'บันทึกแล้ว การเชื่อม Key ยังไม่ใช่ผลวิเคราะห์สำเร็จ':'บันทึกการตรวจสอบคำขอแล้ว การวิเคราะห์อัตโนมัติปิดอยู่');await refresh();}catch(e){error=explain(e.message);put('reaCodexFeedback',error);}finally{busy=false;$('reaCodexKey').value='';render();}}
 $('reaCodexForm').onsubmit=e=>e.preventDefault();
 $('reaCodexKey').oninput=()=>{error='';render();};
 $('reaCodexConsent').onchange=$('reaCodexAuto').onchange=()=>{dirty=true;};
 $('reaCodexSave').onclick=()=>mutate('rea-codex-config',{apiKey:$('reaCodexKey').value.trim()||undefined,enabled:$('reaCodexAuto').checked,consent:$('reaCodexConsent').checked});
 $('reaCodexAsk').onclick=()=>{if(!$('reaCodexAsk').disabled)mutate('rea-codex-request',{question:$('reaCodexQuestion').value});};
 $('reaCodexResolution').oninput=render;$('reaCodexResolve').onclick=()=>mutate('rea-codex-resolve',{confirm:$('reaCodexResolution').value});
 render();return{refresh,reset,render};
}
