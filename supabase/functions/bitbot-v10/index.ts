// Bitbot 10. Credentials and HMAC signing exist only on the server.
// @ts-nocheck
import {config,initial,cycle,applyFill,floor8} from './engine.mjs';
const ORIGIN='https://keitaphotocamerakathu-sudo.github.io';
const PROJECT=Deno.env.get('SUPABASE_URL')||'';
const SERVICE=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
const ANON=Deno.env.get('SUPABASE_ANON_KEY')||SERVICE;
const EXCHANGE='https://api.bitkub.com';
const LIVE=Deno.env.get('BITBOT_LIVE_ENABLED')!=='false';
const privatePaths=new Set(['/api/v4/wallet/balances','/api/v3/market/place-bid','/api/v3/market/place-ask','/api/v3/market/order-info','/api/v3/market/my-open-orders','/api/v3/market/my-order-history','/api/v3/market/cancel-order']);
const enc=new TextEncoder();
const hex=a=>[...new Uint8Array(a)].map(x=>x.toString(16).padStart(2,'0')).join('');
const sha=async s=>hex(await crypto.subtle.digest('SHA-256',enc.encode(s)));
function fail(message,status=400){throw Object.assign(Error(message),{status});}
async function json(url,opts={},timeout=10000){
 const r=await fetch(url,{...opts,signal:AbortSignal.timeout(timeout)});const d=await r.json().catch(()=>null);
 if(!r.ok)throw Object.assign(Error('บริการตอบกลับ '+r.status),{status:r.status===429?429:502});return d;
}
const headers=()=>({apikey:SERVICE,Authorization:'Bearer '+SERVICE,'Content-Type':'application/json'});
async function db(path,body,method='POST'){
 return await json(PROJECT+'/rest/v1/'+path,{method,headers:{...headers(),Prefer:'return=representation'},...(body!==undefined?{body:JSON.stringify(body)}:{})});
}
const rpc=(name,args={})=>db('rpc/'+name,args);
const read=path=>db(path,undefined,'GET');
async function throttle(req,name,id='',limit=10,window=900){
 const ip=req.headers.get('cf-connecting-ip')||req.headers.get('x-forwarded-for')?.split(',')[0]||'unknown';
 for(const bucket of [name+':ip:'+await sha(ip),...(id?[name+':id:'+await sha(id)]:[])]){
 if(!await rpc('bitbot_v10_rate',{p_bucket:bucket,p_limit:limit,p_window:window}))fail('ลองหลายครั้งเกินไป กรุณารอ '+Math.ceil(window/60)+' นาที',429);
 }
}
async function user(req){
 const token=(req.headers.get('authorization')||'').match(/^Bearer (.+)$/i)?.[1];if(!token)fail('กรุณาเข้าสู่ระบบ',401);
 const r=await fetch(PROJECT+'/auth/v1/user',{headers:{apikey:ANON,Authorization:'Bearer '+token},signal:AbortSignal.timeout(8000)});
 if(!r.ok)fail('เซสชันหมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง',401);const u=await r.json();
 if(!/^[0-9a-f-]{36}$/i.test(u.id))fail('ไม่พบผู้ใช้',401);return u;
}
const emailFor=id=>id.includes('@')?id.toLowerCase():id.toLowerCase()+'@users.bitbot.invalid';
function password(p){if(typeof p!=='string'||p.length<12||p.length>128)fail('ใช้รหัสผ่านอย่างน้อย 12 ตัวอักษร');return p;}
function randomCode(){return hex(crypto.getRandomValues(new Uint8Array(24)));}
async function authAction(req,action,b){
 const id=String(b.identifier||'').trim().toLowerCase();
 if(!/^[a-z0-9][a-z0-9_.@+-]{2,99}$/.test(id))fail('ใช้ชื่อผู้ใช้ภาษาอังกฤษ 3 ตัวขึ้นไป หรืออีเมลเดิม');
 await throttle(req,action,id,action==='register'?5:10,action==='register'?3600:900);
 if(action==='register'){
 if(id.includes('@')||id.length>32)fail('ตั้งชื่อผู้ใช้ภาษาอังกฤษ 3–32 ตัว โดยไม่ใส่อีเมล');
 password(b.password);
 const r=await fetch(PROJECT+'/auth/v1/admin/users',{method:'POST',headers:headers(),body:JSON.stringify({email:emailFor(id),password:b.password,email_confirm:true,user_metadata:{display_name:id,bitbot_v10:true}}),signal:AbortSignal.timeout(10000)});
 const d=await r.json();if(!r.ok)fail('สร้างบัญชีไม่ได้ ชื่ออาจถูกใช้แล้ว หรือรหัสผ่านไม่ผ่านเงื่อนไข',409);
 const recoveryCode=randomCode();await rpc('bitbot_v10_recovery',{p_uid:d.id,p_hash:await sha(recoveryCode)});
 return{registered:true,recoveryCode,note:'เก็บรหัสกู้บัญชีไว้ส่วนตัว ใช้กู้ได้ครั้งเดียว'};
 }
 if(action==='recover'){
 password(b.password);if(!/^[a-f0-9]{48}$/.test(b.recoveryCode||''))fail('รหัสกู้บัญชีไม่ถูกต้อง');
 const uid=await rpc('bitbot_v10_user',{p_email:emailFor(id)}),newCode=randomCode();
 if(!uid||!await rpc('bitbot_v10_recovery',{p_uid:uid,p_hash:await sha(newCode),p_old:await sha(b.recoveryCode)}))fail('ชื่อผู้ใช้หรือรหัสกู้บัญชีไม่ถูกต้อง',401);
 const r=await fetch(PROJECT+'/auth/v1/admin/users/'+uid,{method:'PUT',headers:headers(),body:JSON.stringify({password:b.password}),signal:AbortSignal.timeout(10000)});
 if(!r.ok)fail('เปลี่ยนรหัสผ่านไม่สำเร็จ โปรดติดต่อผู้ดูแล',503);
 await rpc('bitbot_v10_control',{p_uid:uid,p_action:'stop'});
 return{recovered:true,recoveryCode:newCode};
 }
 if(typeof b.password!=='string'||!b.password||b.password.length>128)fail('กรุณากรอกรหัสผ่าน');
 const r=await fetch(PROJECT+'/auth/v1/token?grant_type=password',{method:'POST',headers:{apikey:ANON,'Content-Type':'application/json'},body:JSON.stringify({email:emailFor(id),password:b.password}),signal:AbortSignal.timeout(10000)});
 const d=await r.json();if(!r.ok)fail('ชื่อผู้ใช้/อีเมล หรือรหัสผ่านไม่ตรงกัน',401);
 return{session:{access_token:d.access_token,refresh_token:d.refresh_token,expires_in:d.expires_in}};
}
let marketCache=null,marketPromise=null;
async function market(){
 if(marketCache&&Date.now()-marketCache.observedAt<10000)return marketCache;
 if(marketPromise)return marketPromise;
 marketPromise=(async()=>{
 const now=Date.now(),end=Math.floor(now/1000),from=end-300*240;
 const [raw,bars]=await Promise.all([
 json(EXCHANGE+'/api/v3/market/ticker?sym=btc_thb'),
 json(EXCHANGE+'/tradingview/history?symbol=BTC_THB&resolution=5&from='+from+'&to='+end)]);
 const t=(Array.isArray(raw)?raw:raw?.result)?.find?.(x=>x.symbol==='BTC_THB');
 if(!t)fail('อ่านราคาจาก Bitkub ไม่สำเร็จ',502);
 const candles=Array.isArray(bars?.t)?bars.t.map((t,i)=>({t:Number(t)*1000,c:Number(bars.c?.[i])})).filter(x=>x.t+300000<=now):[];
 const m={symbol:'BTC_THB',last:Number(t.last),bid:Number(t.highest_bid),ask:Number(t.lowest_ask),change:Number(t.percent_change),frozen:Boolean(t.is_frozen===true||t.is_frozen===1||t.is_frozen==='1'),observedAt:Date.now(),candles,source:'BITKUB_LIVE'};
 if(![m.last,m.bid,m.ask].every(x=>Number.isFinite(x)&&x>0)||m.ask<m.bid)fail('ข้อมูลราคาจากตลาดผิดรูปแบบ',502);
 marketCache=m;return m;})();
 try{return await marketPromise;}finally{marketPromise=null;}
}
async function keys(uid){
 const k=await rpc('bitbot_load_exchange_key',{p_user_id:uid});if(!k?.apiKey||!k?.apiSecret)fail('กรุณาเชื่อม API Key และ Secret ก่อน',409);return k;
}
async function signed(pair,method,path,body=null){
 if(!privatePaths.has(path.split('?')[0]))fail('ปลายทางไม่อยู่ในรายการที่อนุญาต',403);
 const time=await json(EXCHANGE+'/api/v3/servertime'),ts=String(typeof time==='number'||typeof time==='string'?time:time?.result);
 if(!/^\d{13}$/.test(ts))fail('เวลาเซิร์ฟเวอร์ Bitkub ผิดรูปแบบ',502);
 const payload=method==='POST'?JSON.stringify(body):'';
 const key=await crypto.subtle.importKey('raw',enc.encode(pair.apiSecret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const sig=hex(await crypto.subtle.sign('HMAC',key,enc.encode(ts+method+path+payload)));
 const d=await json(EXCHANGE+path,{method,headers:{'Content-Type':'application/json','X-BTK-APIKEY':pair.apiKey,'X-BTK-TIMESTAMP':ts,'X-BTK-SIGN':sig},...(method==='POST'?{body:payload}:{})},10000);
 const code=d?.error??d?.code;if(code!==undefined&&String(code)!=='0')throw Object.assign(Error('Bitkub ปฏิเสธ (รหัส '+String(code).slice(0,20)+')'),{exchangeRejected:true,status:409});
 return d;
}
async function wallet(pair){
 const d=await signed(pair,'GET','/api/v4/wallet/balances');if(!Array.isArray(d.data))fail('ข้อมูล Wallet ไม่ถูกต้อง',502);
 const coin=s=>{const x=d.data.find(v=>v.currency===s);const available=Number(x?.available??0),reserved=Number(x?.reserved??0);if(![available,reserved].every(n=>Number.isFinite(n)&&n>=0))fail('ยอด Wallet ผิดรูปแบบ',502);return{available,reserved};};
 return{THB:coin('THB'),BTC:coin('BTC'),at:Date.now()};
}
async function event(uid,kind,payload){await db('bitbot_v10_events',{user_id:uid,kind,payload});}
async function status(uid){
 const [bots,orders,events,setup]=await Promise.all([
 read('bitbot_v10_bots?user_id=eq.'+uid+'&select=running,config,state,updated_at,last_error'),
 read('bitbot_v10_orders?user_id=eq.'+uid+'&order=created_at.desc&limit=100'),
 read('bitbot_v10_events?user_id=eq.'+uid+'&order=id.desc&limit=50'),
 rpc('bitbot_exchange_setup_status',{p_user_id:uid})]);
 return{bot:bots[0]||null,orders,events,key:{configured:setup.configured,suffix:setup.keySuffix,verifiedAt:setup.verifiedAt},serverLiveEnabled:LIVE};
}
async function updateOrder(id,uid,patch){return db('bitbot_v10_orders?id=eq.'+id+'&user_id=eq.'+uid,{...patch,updated_at:new Date().toISOString()},'PATCH');}
async function finish(b,s,trace=[],error=null,id=null,status=null){
 return await rpc('bitbot_v10_finish',{p_uid:b.user_id,p_lease:b.lease,p_state:s,p_trace:trace,p_error:error,p_settle:id,p_status:status});
}
function filledState(state,order,info,c){
 // Per-fill history is required. Missing history never becomes a fabricated fill.
 if(!Array.isArray(info.history))throw Error('ไม่มีประวัติการจับคู่ ต้องตรวจสอบด้วยตนเอง');
 let s=state;
 for(const f of info.history){
 const amount=Number(f.amount),price=Number(f.rate),grossFee=Number(f.fee||0),credit=Number(f.credit||0);
 if(![amount,price,grossFee,credit].every(Number.isFinite)||amount<=0||price<=0||grossFee<0||credit<0)throw Error('ข้อมูลการจับคู่ไม่ครบ');
 const fee=Math.max(0,grossFee-credit);
 // Bitkub: BUY history.amount is THB; SELL history.amount is BTC.
 const qty=order.side==='BUY'?(amount-fee)/price:amount;
 s=applyFill(s,{side:order.side,qty,price,fee,strategy:order.strategy},c);
 }
 if(Number(info.filled)>0&&info.history.length===0)throw Error('ตลาดรายงานจับคู่แล้วแต่ไม่มีรายการย่อย');
 return s;
}
async function reconcile(b,order,pair){
 let info;
 if(!order.exchange_id){
 // Never repeat a submission whose response may have been lost.
 const open=await signed(pair,'GET','/api/v3/market/my-open-orders?sym=btc_thb');
 const list=Array.isArray(open.result)?open.result:[],match=list.find(x=>(x.client_id||x.ci)==='bb10-'+order.id.replaceAll('-','').slice(0,24));
 let recoveredId=match?.id;
 if(!recoveredId){
 const from=Date.parse(order.created_at)-60000,to=Date.now();
 const hist=await signed(pair,'GET','/api/v3/market/my-order-history?sym=btc_thb&lmt=100&pagination_type=keyset&start='+from+'&end='+to);
 const found=(Array.isArray(hist.result)?hist.result:[]).find(x=>x.client_id==='bb10-'+order.id.replaceAll('-','').slice(0,24));
 recoveredId=found?.super_order_id||found?.order_id;
 }
 if(!recoveredId){await updateOrder(order.id,b.user_id,{status:'UNKNOWN'});return await finish(b,b.state,[], 'คำสั่งไม่ทราบผล '+order.id+' — ตรวจใน Bitkub ห้ามส่งซ้ำ');}
 await updateOrder(order.id,b.user_id,{exchange_id:String(recoveredId),status:'OPEN'});order.exchange_id=String(recoveredId);
 }
 const path='/api/v3/market/order-info?sym=btc_thb&id='+encodeURIComponent(order.exchange_id)+'&sd='+(order.side==='BUY'?'buy':'sell');
 info=(await signed(pair,'GET',path)).result;
 if(!info||!['filled','unfilled','cancelled','canceled'].includes(String(info.status).toLowerCase()))throw Error('สถานะออร์เดอร์ไม่ชัดเจน');
 const st=String(info.status).toLowerCase();
 if(st==='unfilled'){
 if(!b.running||Date.now()-Date.parse(order.created_at)>120000)await signed(pair,'POST','/api/v3/market/cancel-order',{sym:'btc_thb',id:order.exchange_id,sd:order.side==='BUY'?'buy':'sell'});
 return await finish(b,b.state,[{agent:'execution',reason:!b.running?'ขอยกเลิกแล้ว รอตรวจผล':'รอจับคู่ / ยกเลิกเมื่อเกิน 2 นาที'}]);
 }
 const state=filledState(b.state,order,info,b.config);
 return await finish(b,state,[{agent:'execution',reason:'ยืนยันผลจาก Bitkub: '+st,exchangeId:order.exchange_id}],null,order.id,st==='filled'?'FILLED':'CANCELED');
}
async function tickBot(b,m){
 try{
 const pair=await keys(b.user_id);
 const pending=await read('bitbot_v10_orders?user_id=eq.'+b.user_id+'&settled=eq.false&limit=1');
 if(pending.length)return await reconcile(b,pending[0],pair);
 if(!b.running)return await finish(b,b.state);
 if(!LIVE)return await finish(b,b.state,[],'ระบบปิดการซื้อขายเงินจริง');
 const c=config(b.config,true),out=cycle(m,b.state,c,Date.now());
 if(out.error)return await finish(b,out.state,out.trace,out.error);
 if(!out.order)return await finish(b,out.state,out.trace);
 const o=out.order,w=await wallet(pair);
 if(o.side==='BUY'&&w.THB.available<o.amount*(1+c.fee))return await finish(b,out.state,out.trace,'ยอด THB ไม่พอรวมสำรองค่าธรรมเนียม');
 if(o.side==='SELL'&&w.BTC.available<o.amount)return await finish(b,out.state,out.trace,'ยอด BTC ที่ขายได้ไม่พอ');
 const rid=crypto.randomUUID();
 // Durable reservation is committed before the first exchange write.
 await rpc('bitbot_v10_reserve',{p_uid:b.user_id,p_lease:b.lease,p_id:rid,p_order:o,p_state:out.state});
 try{
 const body={sym:'btc_thb',amt:o.amount,rat:o.price,typ:'limit',client_id:'bb10-'+rid.replaceAll('-','').slice(0,24)};
 const ans=await signed(pair,'POST',o.side==='BUY'?'/api/v3/market/place-bid':'/api/v3/market/place-ask',body);
 if(!ans.result?.id)throw Error('ไม่มีเลขออร์เดอร์ตอบกลับ');
 await updateOrder(rid,b.user_id,{status:'OPEN',exchange_id:String(ans.result.id)});
 await finish(b,out.state,out.trace);
 }catch(e){
 await updateOrder(rid,b.user_id,{status:e.exchangeRejected?'REJECTED':'UNKNOWN',settled:e.exchangeRejected===true});
 await finish(b,out.state,out.trace,e.exchangeRejected?'Bitkub ปฏิเสธคำสั่ง':'ไม่ทราบผลคำสั่ง '+rid+' หยุดบอทและตรวจใน Bitkub');
 }
 }catch(e){await finish(b,b.state,[],String(e.message||'ระบบผิดพลาด').slice(0,250));}
}
async function run(uid=null){
 const bots=await rpc('bitbot_v10_claim',{p_uid:uid});
 if(!bots.length)return{processed:0};
 let m=null;try{m=await market();}catch{/* Pending orders reconcile even while the public feed is unavailable. */}
 await Promise.all(bots.map(b=>tickBot(b,m)));
 return{processed:bots.length};
}
async function body(req){
 const reader=req.body?.getReader();if(!reader)return{};
 const parts=[];let size=0;
 while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>10000){await reader.cancel();fail('ข้อมูลใหญ่เกินกำหนด',413);}parts.push(part.value);}
 const bytes=new Uint8Array(size);let offset=0;for(const p of parts){bytes.set(p,offset);offset+=p.byteLength;}
 try{return JSON.parse(new TextDecoder().decode(bytes)||'{}');}catch{fail('ข้อมูล JSON ไม่ถูกต้อง');}
}
async function handle(req){
 const a=new URL(req.url).searchParams.get('action')||'health';
 if(req.method==='GET'&&a==='health')return{version:'10.0.0',serverTime:Date.now(),engine:'5 quantitative agents',liveEnabled:LIVE};
 if(req.method==='GET'&&a==='market')return{market:await market()};
 if(req.method!=='POST'&&req.method!=='GET')fail('Method not allowed',405);
 if(a==='run'){
 if(req.method!=='POST'||!await rpc('bitbot_v10_runner_allowed',{p_token:req.headers.get('x-bitbot-runner')||''}))fail('ไม่อนุญาต',401);
 return await run();
 }
 const b=req.method==='POST'?await body(req):{};
 if(['login','register','recover'].includes(a)){if(req.method!=='POST')fail('Method not allowed',405);return await authAction(req,a,b);}
 const u=await user(req),uid=u.id;
 if(req.method==='GET'&&a==='state')return await status(uid);
 if(req.method==='GET'&&a==='wallet')return{wallet:await wallet(await keys(uid))};
 if(req.method!=='POST')fail('Method not allowed',405);
 await throttle(req,'action',uid,60,60);
 if(a==='keys'){
 const apiKey=String(b.apiKey||'').trim(),apiSecret=String(b.apiSecret||'').trim();
 if(apiKey.length<8||apiKey.length>512||apiSecret.length<8||apiSecret.length>1024)fail('API Key หรือ Secret ไม่ครบ');
 const live=(await read('bitbot_v10_bots?user_id=eq.'+uid))[0];
 if(live?.running||(await read('bitbot_v10_orders?user_id=eq.'+uid+'&settled=eq.false&limit=1')).length)fail('หยุดบอทและตรวจออร์เดอร์ค้างก่อนเปลี่ยนคีย์');
 const w=await wallet({apiKey,apiSecret});await rpc('bitbot_store_exchange_key',{p_user_id:uid,p_api_key:apiKey,p_api_secret:apiSecret});return{verified:true,wallet:w};
 }
 if(a==='remove-key'){
 const st=await status(uid);if(st.bot?.running||st.orders.some(x=>!x.settled)||Number(st.bot?.state?.qty)>0)fail('ยังมีบอทหรือสถานะค้าง จัดการก่อนถอดคีย์');
 await rpc('bitbot_remove_exchange_key',{p_user_id:uid});return{removed:true};
 }
 if(a==='save'){
 const c=config(b.config,true),st=await status(uid);
 // A stopped session with no position may retain its accounting; changing budget starts a new session and preserves the old summary in audit.
 if(st.bot)await event(uid,'SESSION_SAVED',{state:st.bot.state,config:st.bot.config});
 await rpc('bitbot_v10_control',{p_uid:uid,p_action:'save',p_config:c,p_state:initial(c)});return{saved:true};
 }
 if(a==='start'){
 if(!LIVE)fail('เซิร์ฟเวอร์ปิดเทรดจริง');
 if(b.confirm!=='เริ่มบอทเงินจริง'||b.acceptRisk!==true||b.noWithdraw!==true)fail('ยืนยันความเสี่ยงและปิดสิทธิ์ถอนก่อนเริ่ม');
 const st=await status(uid);if(!st.bot)fail('บันทึกวงเงินก่อนเริ่ม');
 const w=await wallet(await keys(uid)),m=await market();
 const check=cycle(m,st.bot.state,config(st.bot.config,true));if(check.error)fail(check.error);
 if(w.THB.available<Math.max(0,st.bot.config.budget-st.bot.state.cost))fail('เงิน THB ไม่พอกับเงินทุนที่กำหนด');
 await rpc('bitbot_v10_control',{p_uid:uid,p_action:'start'});
 return{started:true,note:'ตรวจตลาดทุก 1 นาที สัญญาณจากแท่งปิด 5 นาที'};
 }
 if(['pause','resume','stop'].includes(a)){
 await rpc('bitbot_v10_control',{p_uid:uid,p_action:a});return{saved:true,note:a==='stop'?'หยุดส่งคำสั่งใหม่แล้ว ออร์เดอร์ที่ส่งไปแล้วจะตรวจและขอยกเลิก เหรียญที่ถือยังอยู่ใน Bitkub':'บันทึกแล้ว'};
 }
 if(a==='tick'){await run(uid);return await status(uid);}


 if(a==='resolve-order'){
 if(!/^[0-9a-f-]{36}$/i.test(String(b.id||''))||!/^[a-zA-Z0-9_-]{1,100}$/.test(String(b.exchangeId||'')))fail('เลขอ้างอิงไม่ถูกต้อง');
 const row=(await read('bitbot_v10_orders?user_id=eq.'+uid+'&id=eq.'+b.id+'&settled=eq.false&limit=1'))[0];
 if(!row)fail('ไม่พบคำสั่งค้างของบัญชีนี้');
 const result=(await signed(await keys(uid),'GET','/api/v3/market/order-info?sym=btc_thb&id='+encodeURIComponent(b.exchangeId)+'&sd='+(row.side==='BUY'?'buy':'sell'))).result;
 const expected='bb10-'+row.id.replaceAll('-','').slice(0,24);
 if(!result||result.client_id!==expected)fail('เลขออร์เดอร์ไม่ตรงกับรหัสป้องกันส่งซ้ำของ Bitbot');
 await updateOrder(row.id,uid,{exchange_id:b.exchangeId,status:'OPEN'});return{verified:true};
 }

 if(a==='reset-session'){
 const st=await status(uid);if(st.bot?.running||st.orders.some(o=>!o.settled))fail('หยุดบอทและตรวจคำสั่งค้างก่อนเริ่มรอบใหม่');
 if(!st.bot)fail('ยังไม่มีรอบการทำงาน');
 const w=await wallet(await keys(uid));
 if(w.BTC.available+w.BTC.reserved>0.00000001)fail('ยังมี BTC ใน Wallet จัดการที่ Bitkub ให้หมดก่อนเริ่มรอบใหม่');
 if(w.THB.available<st.bot.config.budget)fail('THB ไม่พอกับทุนเดิม');
 await rpc('bitbot_v10_reset',{p_uid:uid,p_state:initial(st.bot.config)});return{reset:true};
 }

 if(a==='recovery-code'){const recoveryCode=randomCode();await rpc('bitbot_v10_recovery',{p_uid:uid,p_hash:await sha(recoveryCode)});return{recoveryCode};}
 fail('ไม่พบคำสั่ง',404);
}
Deno.serve(async req=>{
 const origin=req.headers.get('origin')||'';
 const cors={'Access-Control-Allow-Origin':ORIGIN,'Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'GET,POST,OPTIONS','Vary':'Origin'};
 if(origin&&origin!==ORIGIN)return new Response('Forbidden',{status:403});
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
 try{return new Response(JSON.stringify({ok:true,...await handle(req)}),{headers:{...cors,'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});}
 catch(e){const message=e.name==='TimeoutError'||e.name==='AbortError'?'บริการตอบช้า กรุณาตรวจสถานะก่อนลองใหม่':e.message||'เกิดข้อผิดพลาด';
 return new Response(JSON.stringify({ok:false,error:message}),{status:e.status||500,headers:{...cors,'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});}
});
