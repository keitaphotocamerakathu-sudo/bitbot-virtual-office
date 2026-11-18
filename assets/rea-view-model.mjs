// Read-only presentation of backend records. This module cannot execute trades.
export const REA_TEAM=[
 {role:'Market Scanner',room:'market',name:'สำรวจตลาด',method:'กฎข้อมูลตลาด'},
 {role:'Technical Analyst',room:'quant',name:'วิเคราะห์เทคนิค',method:'EMA · RSI · MACD · ATR'},
 {role:'News Analyst',room:'news',name:'วิเคราะห์ข่าว',method:'แหล่งข่าว + LLM ประกอบ'},
 {role:'Strategy Agent',room:'cio',name:'เลือกกลยุทธ์',method:'กฎเชิงตัวเลข'},
 {role:'Risk Manager',room:'risk',name:'ควบคุมความเสี่ยง',method:'กฎวงเงินที่ AI แก้ไม่ได้'},
 {role:'Execution Engine',room:'execution',name:'ซื้อขายและติดตาม',method:'ผลตอบรับจาก Exchange'},
 {role:'Supervisor & Auditor',room:'audit',name:'ตรวจสอบระบบ',method:'Heartbeat + สมุดบัญชี'}
];
export const fresh=(at,now,max=180000)=>Number.isFinite(at)&&at<=now+5000&&now-at<=max;
const fixed=n=>Number.isFinite(n)?n.toFixed(2):'—';
const active=o=>['RESERVED','SUBMITTING','OPEN','PARTIAL','CANCEL_PENDING','UNKNOWN'].includes(o.status);
const reasonNames={CODEX_AVOID_ENTRY:'Codex เสนอหลีกเลี่ยงการเปิดซื้อเหรียญนี้',NO_COMPLETE_STRATEGY:'รอชุดสัญญาณซื้อที่สมบูรณ์',CANDLE_QUALITY:'แท่งราคายังไม่ผ่านคุณภาพ',SPREAD:'ส่วนต่างราคาเกินเกณฑ์',LIQUIDITY:'สภาพคล่องไม่เพียงพอ',VOLATILITY:'ความผันผวนเกินเกณฑ์',ORDER_BOOK:'สมุดคำสั่งยังไม่พร้อม',NEWS_RISK:'พบข่าวเสี่ยง',MARKET_NOT_EXECUTABLE:'ตลาดนี้ไม่ผ่านเงื่อนไขส่งคำสั่ง',STALE_OR_INVALID_PRICE:'ราคาหมดอายุหรือไม่ถูกต้อง',MAX_POSITIONS:'ครบ 2 สถานะรวมซื้อค้าง',RISK_APPROVED:'ผ่าน Risk Manager',ENTRY_LOCKED:'พักหรือถูกล็อกการซื้อใหม่',SYMBOL_BUSY:'กำลังถือหรือมีคำสั่งเหรียญนี้',SIGNAL_ALREADY_USED:'ใช้สัญญาณนี้แล้ว',MIDNIGHT_BASELINE_UNVERIFIED:'ยังตรวจทุนเริ่มวันไม่ได้',MARKET_DATA_UNAVAILABLE:'ข้อมูลตลาดไม่พร้อม',AVAILABLE_WALLET_TOO_SMALL:'เงินที่ใช้ได้ต่ำกว่าขั้นต่ำของตลาด',BELOW_MARKET_MINIMUM:'ขนาดตามความเสี่ยงต่ำกว่าขั้นต่ำตลาด',WALLET_RECONCILIATION_REQUIRED:'ต้องตรวจยอด Wallet ให้ตรงกัน',UNKNOWN_ORDER_REQUIRES_RECONCILIATION:'รอตรวจคำสั่งที่ยังไม่ทราบผล',LIVE_POSITION_PRICE_STALE:'ราคาสถานะที่ถือเก่า',EMERGENCY_STOP:'หยุดฉุกเฉิน'};
export const explainReason=v=>String(v||'รอประเมิน').split(',').map(x=>reasonNames[x]||x).join(' · ');
export function portfolioView({live,paper,scope='LIVE',now=Date.now()}){
 const data=scope==='LIVE'?live:paper,s=data?.state,l=data?.latest||{},summary=l.summary||{},fills=scope==='LIVE'?(live?.fills?.map(f=>f.payload)||s?.fills||[]):s?.fills||[];
 const positions=(s?.positions||[]).map(p=>{
  const q=(l.quotes||[]).find(q=>q.symbol===p.symbol),priced=scope==='LIVE'&&fresh(q?.at,now,30000)&&Number.isFinite(q.bid)&&q.bid>0;
  const buys=fills.filter(f=>f.side==='BUY'&&f.symbol===p.symbol&&f.orderId===p.positionId),total=buys.reduce((v,f)=>v+f.qty,0);
  return{...p,entry:total>0?buys.reduce((v,f)=>v+f.qty*f.price,0)/total:p.cost/p.qty,current:priced?q.bid:null,priceAt:priced?q.at:null,unrealized:priced?Math.round((p.qty*q.bid*.9975-p.cost)*100)/100:null};
 });
 const daily=scope==='LIVE'?Object.entries(s?.days||{}).map(([day,payload])=>({day,payload})):paper?.daily||[];
 if(scope==='LIVE'&&s?.day&&!daily.some(d=>d.day===s.day))daily.push({day:s.day,payload:{pnl:s.dayPnl,locked:s.dailyLocked}});
 return{data,state:s,latest:l,summary,positions,fills,daily,decisions:l.decisions||[],stale:!fresh(l.at,now),funded:!!s};
}
export function liveStatus(live,now=Date.now()){
 if(!live)return{label:'รอเชื่อมบัญชี',tone:'waiting',description:'เข้าสู่ระบบเพื่ออ่าน Wallet และสถานะบอทของคุณ'};
 const s=live.state,l=live.latest||{},pf=live.preflight||{};
 if(s?.kill==='ALL')return{label:'หยุดฉุกเฉิน',tone:'bad',description:'หยุดส่งคำสั่งทั้งหมด ระบบยังอ่านและตรวจรายการที่ Exchange รับไปแล้ว'};
 if(!fresh(l.at,now)||!fresh(pf.at,now,120000)&&Number.isFinite(pf.at))return{label:'ข้อมูล Backend ไม่สด',tone:'bad',description:'ข้อมูลบนจอยังยืนยันสถานะปัจจุบันไม่ได้ กรุณาตรวจการเชื่อมต่อ'};
 if(pf.ok!==true||l.health==='SAFE_MODE'||live.lastError)return{label:'ต้องตรวจการเชื่อมต่อ',tone:'bad',description:pf.reason||live.lastError||l.reason||'ระบบปฏิเสธการเปิดสถานะใหม่เมื่อข้อมูลไม่พร้อม'};
 if(!s)return{label:'เชื่อม Bitkub แล้ว',tone:'waiting',description:'อ่าน Wallet ได้แล้ว เหลือการยืนยันเปิด Live ด้วยบัญชีเจ้าของ'};
 if(s.dailyLocked)return{label:'หยุดซื้อครบวงเงินขาดทุน',tone:'waiting',description:'ยังเฝ้าจุดออกและจัดการสถานะเดิม ล็อกการซื้อใหม่จนเปลี่ยนวันและตรวจผ่าน'};
 if(s.buyPaused||s.kill==='ENTRY')return{label:'พักซื้อใหม่',tone:'waiting',description:'ยังตรวจ Stop Loss และจุดขายของเหรียญที่ถืออยู่'};
 if(l.riskAt&&!fresh(l.riskAt,now))return{label:'ตัวเฝ้าความเสี่ยงไม่สด',tone:'bad',description:'ต้องตรวจ Risk Watchdog ก่อนเปิดสถานะใหม่'};
 if(l.strategyAt&&!fresh(l.strategyAt,now))return{label:'รอรอบวิเคราะห์ใหม่',tone:'waiting',description:'ยังมีข้อมูลตัวเฝ้าความเสี่ยง แต่รอบวิเคราะห์ตลาดไม่สด'};
 const ready=s.policy==='OWNER_LIMITED_LIVE'?live.readiness?.limited?.ready:live.readiness?.ready;
 if(ready===false)return{label:'พักซื้อรอเงื่อนไขระบบ',tone:'waiting',description:'Server ยังไม่อนุญาตเปิดสถานะใหม่ ระบบยังอ่านและจัดการสถานะเดิมตามกฎ'};
 return{label:'บอทกำลังทำงาน',tone:'good',description:'วิเคราะห์ตลาดทุกนาที · เฝ้าความเสี่ยงทุก 15 วินาที · ปิดเว็บได้'};
}
export function buildREAOffice({live,paper,scope='LIVE',now=Date.now()}){
 const vm=portfolioView({live,paper,scope,now}),s=vm.state,l=vm.latest,pf=live?.preflight||{},advice=paper?.latest?.advisory||{},decisions=vm.decisions;
 const latestFill=vm.fills.slice().sort((a,b)=>b.at-a.at)[0],lastOrder=(s?.orders||[]).slice().sort((a,b)=>(b.updatedAt||b.createdAt)-(a.updatedAt||a.createdAt))[0];
 const strategyAt=l.strategyAt||(!s&&scope==='LIVE'?null:l.at),riskAt=l.riskAt||l.at;
 const roles=REA_TEAM.map(def=>{
  let at=null,summary='รอข้อมูลจาก Backend',status='WAITING';
  if(scope==='PAPER'){
   const record=paper?.latest?.agents?.find(a=>a.role===def.role);at=record?.at;summary=record?.reason||summary;status=record?.status==='COMPLETED'?'DONE':record?.status||status;
  }else if(def.role==='Market Scanner'&&decisions.length){at=strategyAt;summary='ประเมิน '+decisions.length+' คู่ในรอบล่าสุด จากตลาด '+(l.marketCount??'ที่อ่านได้')+' คู่';status='DONE';}
  else if(def.role==='Technical Analyst'&&decisions.length){at=strategyAt;const signal=decisions.find(d=>d.strategy)||decisions[0];summary=signal.symbol+' · คะแนน '+fixed(signal.score)+(Number.isFinite(signal.indicators?.rsi)?' · RSI '+fixed(signal.indicators.rsi):' · ผลอินดิเคเตอร์อยู่ในสัญญาณที่บันทึก');status='DONE';}
  else if(def.role==='News Analyst'&&l.news){at=l.news.at;summary='ข่าวพร้อม '+l.news.readyMarkets+' คู่ · ข่าวเสี่ยง '+l.news.blockedMarkets+' คู่';status='DONE';}
  else if(def.role==='Strategy Agent'&&decisions.length){at=strategyAt;summary=(l.codex?.state==='ACTIVE'?'ใช้แผน Codex '+(l.codex.priority?.join(', ')||'เฝ้าตามแผน')+' · ':'')+decisions.slice(0,3).map(d=>d.symbol+' '+(d.strategy||'รอ')+' · '+explainReason(d.reason)).join(' / ');status='DONE';}
  else if(def.role==='Risk Manager'&&s){at=riskAt;summary='เสี่ยงต่อรายการ '+fixed(vm.summary.riskBudget)+' บาท · ขาดทุนวันนี้ '+fixed(s.dayPnl)+' / -'+fixed(vm.summary.dailyLossLimit)+' บาท · '+(s.dailyLocked?'ล็อกซื้อใหม่':s.kill==='ALL'?'หยุดฉุกเฉิน':'ตรวจตามวงเงิน');status=l.health==='SAFE_MODE'?'FAILED':'DONE';}
  else if(def.role==='Execution Engine'&&(s||pf.ok)){
   at=Math.max(latestFill?.at||0,lastOrder?.updatedAt||lastOrder?.createdAt||0)||l.at;
   summary=latestFill?(latestFill.side==='BUY'?'ซื้อ':'ขาย')+' '+latestFill.symbol+' จำนวน '+latestFill.qty+' · Exchange ยืนยันจับคู่จริง':lastOrder?'คำสั่ง '+lastOrder.symbol+' · '+lastOrder.status:s?'ยังไม่มีผลจับคู่จริง · รอคำสั่งที่ผ่านกฎ':'ยังไม่เปิด Live · ไม่ส่งคำสั่ง';status=lastOrder?.status==='UNKNOWN'?'FAILED':latestFill||lastOrder?'DONE':'WAITING';
  }else if(def.role==='Supervisor & Auditor'&&pf.ok){at=l.at;summary='อ่าน Wallet สำเร็จ · '+(l.health||'รอสถานะ')+' · ผลจับคู่จริง '+vm.fills.length+' รายการ';status=l.health==='SAFE_MODE'?'FAILED':'DONE';}
  if(def.role==='News Analyst'&&advice.summary){summary+=(summary==='รอข้อมูลจาก Backend'?'':' · ')+(advice.status==='CACHED'?'LLM ใช้แคช':'LLM '+advice.status)+' · '+advice.summary;at=at||advice.at;if(status==='WAITING')status='DONE';}
  const maxAge=def.role==='News Analyst'?3900000:def.role==='Execution Engine'&&latestFill?Infinity:180000;
  if(at&&!fresh(at,now,maxAge))status='STALE';
  return{...def,...(def.role==='Strategy Agent'&&l.codex?.state==='ACTIVE'?{method:'Codex จัดลำดับ + สัญญาณเชิงตัวเลข'}:{}),at:at||null,summary,status,worker_id:def.room+'-1',tools:[],lastSeenAt:at||null};
 });
 const workers=roles.map(r=>({...r,role:r.room,title:r.role}));
 const tasks=roles.filter(r=>r.at&&r.status!=='WAITING').map((r,i)=>({id:'rea:'+scope+':'+r.room+':'+r.at,worker:r.worker_id,role:r.room,status:r.status==='FAILED'?'FAILED':'DONE',error:r.status==='FAILED'?r.summary:null,summary:r.summary,source:'REA_BACKEND',finishedAt:r.at,output:{}}));
 const messages=tasks.slice(0,-1).map((t,i)=>({from:t.worker,to:tasks[i+1].worker,taskId:t.id,at:t.finishedAt,kind:'RECORDED_RESULT',text:t.summary}));
 const archive=tasks.length&&!vm.stale?{mode:scope,source:'REA_BACKEND',finishedAt:Math.max(...tasks.map(t=>t.finishedAt)),tasks,messages}:null;
 return{roles,workers,archive,preview:!vm.data,stale:vm.stale,advice};
}
export function liveActivity(live){
 const fills=(live?.fills||[]).map(f=>({id:'fill:'+f.txn_id,at:f.payload.at,title:(f.payload.side==='BUY'?'ซื้อ':'ขาย')+' '+f.payload.symbol,detail:'จับคู่จริง '+f.payload.qty+' ที่ราคา '+fixed(f.payload.price)+' บาท · Txn '+f.txn_id,kind:'FILL'}));
 const orders=(live?.orders||[]).map(o=>({id:'order:'+o.client_order_id,at:o.payload.updatedAt||o.payload.createdAt,title:o.payload.symbol+' · '+o.status,detail:'คำสั่ง '+(o.payload.side==='BUY'?'ซื้อ':'ขาย')+' · '+(o.payload.side==='BUY'?fixed(o.payload.amount)+' บาท':o.payload.amount+' เหรียญ'),kind:'ORDER'}));
 return[...fills,...orders].sort((a,b)=>b.at-a.at).slice(0,10);
}
