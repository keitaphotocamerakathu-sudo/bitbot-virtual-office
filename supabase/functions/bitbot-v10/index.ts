// Bitbot 10. Credentials and HMAC signing exist only on the server.
// @ts-nocheck
import {config,initial,cycle,applyFill,floor8,heldSymbol,assetOf,roundUnit,sizing,validSymbol,fundingAmount,executionAgent} from './engine.mjs';
import {SHADOW_CANDIDATES,shadowConfig,shadowInitial,shadowStep} from './shadow.mjs';
import {assessCompany,attachReceipts} from './company.mjs';
import {readinessProgress} from './readiness.mjs';
import {livePermission} from './live-permission.mjs';
import {createREAService} from './rea-service.mjs';
import {createExperimentStore} from './rea-experiments.mjs';
import {createRiskWatchdog} from './rea-watchdog.mjs';
import {createRiskQuotes} from './rea-risk-quotes.mjs';
import {createAdvisory} from './rea-advisory.mjs';
import {createCodexService} from './rea-codex.mjs';
import {createLiveService} from './rea-live-service.mjs';
import {exchangeFailure} from './exchange-errors.mjs';
import {reportingSummary,aggregateFills} from './reporting.mjs';
import {pack,unpack} from './archive.mjs';
import {liveReadiness} from './evidence.mjs';
import {portfolioCycle} from './selection.mjs';
import {plannerConfig,adaptivePortfolioCycle} from './adaptive.mjs';
import {indicators} from './technical.mjs';
import {createMarketService} from './market.mjs';
import {createVerifiedMarketService} from './market-verified.mjs';
import {runtimeConfig,dataUpgradeBlock} from './data-policy.mjs';
const ORIGIN='https://keitaphotocamerakathu-sudo.github.io';
const PROJECT=Deno.env.get('SUPABASE_URL')||'';
const SERVICE=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
const ANON=Deno.env.get('SUPABASE_ANON_KEY')||SERVICE;
const EXCHANGE='https://api.bitkub.com';
// SRS v1.0: a deployment lock. Environment flags cannot enable trading.
const LIVE=false;
const privatePaths=new Set(['/api/v4/wallet/balances','/api/v3/user/trading-credits','/api/v3/market/place-bid','/api/v3/market/place-ask','/api/v3/market/order-info','/api/v3/market/my-open-orders','/api/v3/market/my-order-history','/api/v3/market/cancel-order']);
const enc=new TextEncoder();
const hex=a=>[...new Uint8Array(a)].map(x=>x.toString(16).padStart(2,'0')).join('');
const sha=async s=>hex(await crypto.subtle.digest('SHA-256',enc.encode(s)));
function fail(message,status=400){throw Object.assign(Error(message),{status});}
let marketRateLimitUntil=0;
async function json(url,opts={},timeout=10000){
 if(url.startsWith(EXCHANGE+'/')&&Date.now()<marketRateLimitUntil)throw Object.assign(Error('Bitkub rate limit: รอรอบถัดไป'),{status:429});
 const r=await fetch(url,{...opts,signal:AbortSignal.timeout(timeout)});const d=await r.json().catch(()=>null);
 if(r.status===429&&url.startsWith(EXCHANGE+'/')){const retry=Number(r.headers.get('retry-after'));marketRateLimitUntil=Date.now()+Math.max(30000,Number.isFinite(retry)?retry*1000:30000);}
 if(!r.ok){if(url.startsWith(PROJECT+'/rest/v1/rpc/rea_codex_')&&d?.code==='42501')throw Object.assign(Error('CODEX_BACKEND_PERMISSION'),{status:503});if(url.startsWith(PROJECT+'/rest/v1/rpc/rea_codex_')&&/^CODEX_[A-Z_]+$/.test(d?.message||''))throw Object.assign(Error(d.message),{status:409});if(url.startsWith(EXCHANGE+'/'))throw exchangeFailure(r.status,d);if(url.startsWith(PROJECT+'/rest/v1/rpc/rea_'))console.error('REA_DATABASE_ERROR',d?.code,String(d?.message||'').slice(0,250));throw Object.assign(Error('BACKEND_HTTP_'+r.status),{status:r.status===429?429:502});}return d;
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
const markets=createMarketService({json,db,read,rpc,fetchFn:fetch});
const verifiedMarkets=createVerifiedMarketService({base:markets,json,read,rpc});
const codex=createCodexService({rpc});
const rea=createREAService({rpc,marketService:verifiedMarkets,advisor:createAdvisory({rpc}),research:createExperimentStore({rpc})});
const riskWatchdog=createRiskWatchdog({rpc,quotes:createRiskQuotes({markets,json,rpc})});
const reaLive=createLiveService({rpc,keys,wallet,signed,brain:uid=>codex.strategy(uid),scan:held=>verifiedMarkets.scan(held),quotes:createRiskQuotes({markets,json,rpc})});
const marketServiceFor=c=>c?.marketDataPolicy==='verified-v17'?verifiedMarkets:markets;
const market=(symbol='BTC_THB')=>markets.single(symbol);
async function keys(uid){
 const k=await rpc('bitbot_load_exchange_key',{p_user_id:uid});if(!k?.apiKey||!k?.apiSecret)fail('กรุณาเชื่อม API Key และ Secret ก่อน',409);return k;
}
async function signed(pair,method,path,body=null,ticket=null){
 const place=/^\/api\/v3\/market\/place-(bid|ask)$/.test(path.split('?')[0]);
 if(place&&!ticket)fail('PAPER_ONLY: เส้นทางเดิมปิดเทรดจริง ต้องผ่าน REA Live และการตรวจรับ',423);
 if(!privatePaths.has(path.split('?')[0]))fail('ปลายทางไม่อยู่ในรายการที่อนุญาต',403);
 if(ticket){
  if(method!=='POST'||!['PLACE','CANCEL'].includes(ticket.action))fail('INVALID_LIVE_DISPATCH',403);
  const grant=await rpc('rea_live_dispatch',{p_uid:ticket.uid,p_lease:ticket.lease,p_revision:ticket.revision,p_order:ticket.id,p_action:ticket.action,p_body:body,p_path:path});
  if(grant?.allowed!==true)fail('LIVE_GUARD: '+(grant?.reason||'NOT_AUTHORIZED'),423);
  ticket.dispatched=true;ticket.revision=grant.revision;
 }
 const time=await json(EXCHANGE+'/api/v3/servertime'),ts=String(typeof time==='number'||typeof time==='string'?time:time?.result);
 if(!/^\d{13}$/.test(ts))fail('เวลาเซิร์ฟเวอร์ Bitkub ผิดรูปแบบ',502);
 const payload=method==='POST'&&body!==null?JSON.stringify(body):'';
 const key=await crypto.subtle.importKey('raw',enc.encode(pair.apiSecret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const sig=hex(await crypto.subtle.sign('HMAC',key,enc.encode(ts+method+path+payload)));
 const d=await json(EXCHANGE+path,{method,headers:{Accept:'application/json','Content-Type':'application/json','X-BTK-APIKEY':pair.apiKey,'X-BTK-TIMESTAMP':ts,'X-BTK-SIGN':sig},...(payload?{body:payload}:{})},10000);
 const code=d?.error??d?.code;if(code!==undefined&&String(code)!=='0')throw exchangeFailure(200,d);
 return d;
}
async function wallet(pair){
 const d=await signed(pair,'GET','/api/v4/wallet/balances');if(!Array.isArray(d.data))fail('ข้อมูล Wallet ไม่ถูกต้อง',502);
 const out={at:Date.now()};
 for(const x of d.data){
 const code=String(x.currency),available=Number(x.available),reserved=Number(x.reserved);
 if(!/^[A-Z0-9]{1,16}$/.test(code)||![available,reserved].every(n=>Number.isFinite(n)&&n>=0))fail('ยอด Wallet ผิดรูปแบบ',502);
 out[code]={available,reserved};
 }
 out.THB??={available:0,reserved:0};out.BTC??={available:0,reserved:0};return out;
}
async function feeCredits(pair){
 try{const d=await signed(pair,'POST','/api/v3/user/trading-credits'),available=Number(d.result);if(d.result===null||d.result===''||!['number','string'].includes(typeof d.result)||!Number.isFinite(available)||available<0)throw Error('invalid credits');return{ready:true,available,at:Date.now()};}
 catch{return{ready:false,available:0,at:Date.now(),reason:'อ่านเครดิตไม่ได้ คิดค่าธรรมเนียมเต็ม'};}
}
function decide(bundle,state,c,now){
 const data=c.marketDataPolicy==='verified-v17'&&!(state.qty>0)?{...bundle,markets:(bundle?.markets||[]).filter(m=>m.dataQuality?.ready===true)}:bundle;
 const result=c.entryPlanner==='net-v16'?adaptivePortfolioCycle(data,state,c,now):portfolioCycle(data,state,c,now);
 if(c.marketDataPolicy==='verified-v17')result.trace.unshift({agent:'market-data',reason:'ตรวจ '+(bundle?.markets?.length||0)+' คู่ / ข้อมูลพร้อม '+(bundle?.readyCount||0)+' คู่',policy:c.marketDataPolicy,readyCount:bundle?.readyCount||0,quality:(bundle?.markets||[]).map(m=>({symbol:m.symbol,...m.dataQuality})),failures:bundle?.failures||[]});
 return result;
}
function walletValue(w,quotes){
 let total=w.THB.available+w.THB.reserved;
 for(const m of quotes){const a=w[assetOf(m.symbol)];if(a)total+=(a.available+a.reserved)*m.bid;}
 return{...w,equityTHB:total};
}
async function event(uid,kind,payload){await db('bitbot_v10_events',{user_id:uid,kind,payload});}
async function status(uid){
 const [bots,orders,events,setup,shadows,agents,jobs,paperEvents]=await Promise.all([
 read('bitbot_v10_bots?user_id=eq.'+uid+'&select=running,config,state,updated_at,last_error,close_positions,evidence_consent'),
 read('bitbot_v10_orders?user_id=eq.'+uid+'&order=created_at.desc&limit=100'),
 read('bitbot_v10_events?user_id=eq.'+uid+'&order=id.desc&limit=50'),
 rpc('bitbot_exchange_setup_status',{p_user_id:uid}),read('bitbot_v13_shadow?user_id=eq.'+uid+'&select=enabled,capital,states,started_at,updated_at,last_error,base_config,buy_paused'),read('bitbot_v14_agents?user_id=eq.'+uid+'&order=role.asc'),read('bitbot_v14_company_jobs?user_id=eq.'+uid+'&select=id,mode,status,attempts,created_at,started_at,finished_at,error&order=created_at.desc&limit=12'),read('bitbot_v13_shadow_events?user_id=eq.'+uid+'&order=id.desc&limit=100')]);
 const shadow=shadows[0]||null,evidence=liveEvidence(bots[0]?.config?.strategyProfile||'legacy-v12',shadow,bots[0]?.config?.entryPlanner);
 return{bot:bots[0]||null,orders,events,shadow,evidence,permission:livePermission(evidence,bots[0]),paperEvents,readiness:readinessProgress(bots[0]?.config?.strategyProfile||'trend-confirmed',shadow),company:{agents,jobs},reporting:{trackingSince:bots[0]?.state?.trackingSince||null,history:'DAILY_DETAILS_FROM_V12'},key:{configured:setup.configured,suffix:setup.keySuffix,verifiedAt:setup.verifiedAt},serverLiveEnabled:LIVE};
}
function liveEvidence(profile,shadow,planner='legacy-v13'){
 if(planner==='net-v16')return{allowed:false,reasons:['สูตรสุทธิ v16 ยังไม่มีผลเดินหน้าที่ผ่านการยืนยัน'],planner};
 const legacy=liveReadiness(profile,shadow),progress=readinessProgress(profile,shadow);
 return{...legacy,allowed:legacy.allowed&&progress.technicalReady,reasons:[...new Set([...legacy.reasons,...progress.checks.filter(x=>!x.passed).map(x=>x.label+' — '+x.value)])]};
}
async function ledgerPages(path,cap=10000){
 const rows=[];while(rows.length<=cap){const batch=await read(path+'&limit=500&offset='+rows.length);rows.push(...batch);if(batch.length<500)break;}
 return{rows:rows.slice(0,cap),possiblyTruncated:rows.length>cap,limit:cap};
}
async function updateOrder(id,uid,patch){return db('bitbot_v10_orders?id=eq.'+id+'&user_id=eq.'+uid,{...patch,updated_at:new Date().toISOString()},'PATCH');}
async function finish(b,s,trace=[],error=null,id=null,status=null,fills=[]){
 const done=await rpc('bitbot_v12_finish',{p_uid:b.user_id,p_lease:b.lease,p_state:s,p_trace:trace,p_error:error,p_settle:id,p_status:status,p_fills:fills});
 if(b._company){b._company.archive.executionReceipts=[...(b._company.archive.executionReceipts||[]),{stage:b._receipt?.stage||'NO_SUBMISSION',...b._receipt,checkpointCommitted:done,error,settledOrder:id,at:Date.now()}];await companyFinish(b._companyJob,b._company,error);b._company=null;}if(done&&b.close_positions&&s.qty===0){await rpc('bitbot_v10_control',{p_uid:b.user_id,p_action:'stop'});await db('bitbot_v10_bots?user_id=eq.'+b.user_id,{close_positions:false},'PATCH');}return done;
}
function filledState(state,order,info,c,ledger=[]){
 c=config(c);
 // Per-fill history is required. Missing history never becomes a fabricated fill.
 if(!Array.isArray(info.history))throw Error('ไม่มีประวัติการจับคู่ ต้องตรวจสอบด้วยตนเอง');
 let s=state;
 const sorted=info.history.slice().sort((a,b)=>Number(a.timestamp||0)-Number(b.timestamp||0));
 for(const [index,f] of sorted.entries()){
 const amount=Number(f.amount),price=Number(f.rate),grossFee=Number(f.fee||0),credit=Number(f.credit||0);
 if(![amount,price,grossFee,credit].every(Number.isFinite)||amount<=0||price<=0||grossFee<0||credit<0)throw Error('ข้อมูลการจับคู่ไม่ครบ');
 const fee=Math.max(0,grossFee-credit);
 // Bitkub: BUY history.amount is THB; SELL history.amount is the order's base asset.
 const qty=order.side==='BUY'?roundUnit((amount-fee)/price,order.qty_scale??8):amount;
 const before=s.realized,rawAt=Number(f.timestamp),at=Number.isFinite(rawAt)&&rawAt>1000000000000?rawAt:Date.parse(order.created_at)||Date.now();
 s=applyFill(s,{at,entryPolicy:order.entry_policy,symbol:order.symbol||'BTC_THB',qtyScale:order.qty_scale??8,side:order.side,qty,price,fee,strategy:order.strategy,...(order.side==='BUY'?{spend:amount}:{})},c);
 ledger.push({index,at:new Date(at).toISOString(),symbol:order.symbol||'BTC_THB',side:order.side,qty,price,fee,credit,grossFee,realized:s.realized-before,source:f.txn_id||String(f.id||index),timeSource:Number.isFinite(rawAt)&&rawAt>1000000000000?'EXCHANGE':'ORDER_CREATED'});
 }
 if(Number(info.filled)>0&&info.history.length===0)throw Error('ตลาดรายงานจับคู่แล้วแต่ไม่มีรายการย่อย');
 return s;
}
async function reconcile(b,order,pair){
 let info;
 if(!order.exchange_id){
 // Never repeat a submission whose response may have been lost.
 const open=await signed(pair,'GET','/api/v3/market/my-open-orders?sym='+order.symbol.toLowerCase());
 const list=Array.isArray(open.result)?open.result:[],match=list.find(x=>(x.client_id||x.ci)==='bb10-'+order.id.replaceAll('-','').slice(0,24));
 let recoveredId=match?.id;
 if(!recoveredId){
 const from=Date.parse(order.created_at)-60000,to=Date.now();
 const hist=await signed(pair,'GET','/api/v3/market/my-order-history?sym='+order.symbol.toLowerCase()+'&lmt=100&pagination_type=keyset&start='+from+'&end='+to);
 const found=(Array.isArray(hist.result)?hist.result:[]).find(x=>x.client_id==='bb10-'+order.id.replaceAll('-','').slice(0,24));
 recoveredId=found?.super_order_id||found?.order_id;
 }
 if(!recoveredId){await updateOrder(order.id,b.user_id,{status:'UNKNOWN'});return await finish(b,b.state,[], 'คำสั่งไม่ทราบผล '+order.id+' — ตรวจใน Bitkub ห้ามส่งซ้ำ');}
 await updateOrder(order.id,b.user_id,{exchange_id:String(recoveredId),status:'OPEN'});order.exchange_id=String(recoveredId);
 }
 const path='/api/v3/market/order-info?sym='+order.symbol.toLowerCase()+'&id='+encodeURIComponent(order.exchange_id)+'&sd='+(order.side==='BUY'?'buy':'sell');
 info=(await signed(pair,'GET',path)).result;
 if(!info||!['filled','unfilled','cancelled','canceled'].includes(String(info.status).toLowerCase()))throw Error('สถานะออร์เดอร์ไม่ชัดเจน');
 const st=String(info.status).toLowerCase();
 if(st==='unfilled'){
 if(!b.running||Date.now()-Date.parse(order.created_at)>120000)await signed(pair,'POST','/api/v3/market/cancel-order',{sym:order.symbol.toLowerCase(),id:order.exchange_id,sd:order.side==='BUY'?'buy':'sell'});
 return await finish(b,b.state,[{agent:'execution',reason:!b.running?'ขอยกเลิกแล้ว รอตรวจผล':'รอจับคู่ / ยกเลิกเมื่อเกิน 2 นาที'}]);
 }
 const fills=[],state=filledState(b.state,order,info,b.config,fills);
 return await finish(b,state,[{agent:'execution',reason:'ยืนยันผลจาก Bitkub: '+st,exchangeId:order.exchange_id}],null,order.id,st==='filled'?'FILLED':'CANCELED',fills);
}
async function tickBot(b,bundle){
 try{
 const pending=await read('bitbot_v10_orders?user_id=eq.'+b.user_id+'&settled=eq.false&limit=1');
 if(pending.length)return await reconcile(b,pending[0],await keys(b.user_id));
 if(!b.running)return await finish(b,b.state);
 if(b.close_positions&&!(b.state.qty>0)){await rpc('bitbot_v10_control',{p_uid:b.user_id,p_action:'stop'});await db('bitbot_v10_bots?user_id=eq.'+b.user_id,{close_positions:false},'PATCH');return;}
 if(!LIVE)return await finish(b,b.state,[],'PAPER_ONLY: ระบบปิดการซื้อขายเงินจริง');
 const pair=await keys(b.user_id);
 const c=runtimeConfig(b.config,true),w=walletValue(await wallet(pair),bundle?.watchlist||[]),credits=c.entryPlanner==='net-v16'&&!(b.state.qty>0)?await feeCredits(pair):null;
 const data={...bundle,markets:(bundle?.markets||[]).map(m=>({...m,wallet:w,...(credits?{feeCredits:credits}:{})}))};
 let out=decide(data,b.state,c,Date.now());
 if(b.close_positions&&!out.error&&out.market&&!out.market.sellFrozen&&(out.market.ask-out.market.bid)/out.market.last<=c.maxSpread){const notional=Math.min(b.state.qty*out.market.bid,c.maxOrder,c.dailySell-out.state.sold),risk={action:'SELL',notional,exitMinimum:(out.market.rules?.minQuote||10)*(1+c.stopLoss*2+c.fee*2)};const planned=executionAgent(out.market,b.state,risk);out.order=planned.order?{...planned.order,strategy:b.state.entryStrategy||'owner-close',reason:'OWNER_CLOSE'}:null;out.trace=out.trace.map(t=>t.agent==='risk'?{...t,...risk,reason:'OWNER_CLOSE'}:t.agent==='execution'?planned:t);}
 b._companyJob=await companyClaim(b.user_id,'LIVE');
 const proof=livePermission(liveEvidence(c.strategyProfile,(await read('bitbot_v13_shadow?user_id=eq.'+b.user_id+'&limit=1'))[0],c.entryPlanner),b),plans={live:out};
 b._company=assessCompany({bundle:data,plans,records:{live:{state:b.state}},configs:{live:c},advanced:b._companyJob||out.order?.side==='BUY'?await advancedFor(plans,marketServiceFor(c)):{},mode:'LIVE',evidence:proof});out=b._company.plans.live;
 out.state.walletSnapshot={availableTHB:w.THB.available,reservedTHB:w.THB.reserved,
 equityTHB:w.equityTHB,at:w.at,reserveTHB:w.THB.available*c.walletReservePct+c.cashReserveTHB,
 spendableTHB:Math.max(0,w.THB.available*(1-c.walletReservePct)-c.cashReserveTHB)};
 const mark=out.market&&Date.now()-out.market.observedAt<=30000?out.state.cash+out.state.qty*out.market.bid:out.state.qty===0?out.state.cash:null;
 if(mark!==null&&out.state.peak>0)out.state.maxDrawdownSeen=Math.max(out.state.maxDrawdownSeen||0,1-mark/out.state.peak);
 if(out.error)return await finish(b,out.state,out.trace,out.error);
 if(!out.order)return await finish(b,out.state,out.trace);
 const o=out.order,quote=out.market;
 if(o.side==='BUY'){const shadow=(await read('bitbot_v13_shadow?user_id=eq.'+b.user_id+'&limit=1'))[0],ready=livePermission(liveEvidence(c.strategyProfile,shadow,c.entryPlanner),b);if(!ready.allowed)return await finish(b,out.state,[...out.trace,{agent:'risk',reason:ready.reasons.join(' • '),action:'HOLD'}]);}
 if(Date.now()-quote.observedAt>25000)return await finish(b,out.state,[...out.trace,{agent:'execution',reason:'ราคาเก่าเกินส่งคำสั่ง รอตรวจใหม่'}]);
 // Re-read the actual wallet immediately before reserving any exchange write.
 const actual=walletValue(await wallet(pair),bundle.watchlist||[]),power=sizing({...quote,wallet:actual},b.state,c,Date.now());
 if(o.side==='BUY'&&o.amount>power.spendable)return await finish(b,out.state,[...out.trace,{agent:'risk',reason:'ยอดใช้ได้หลังสำรองเปลี่ยน รอรอบใหม่'}]);
 if(o.side==='SELL'&&(actual[assetOf(o.symbol)]?.available||0)<o.amount)return await finish(b,out.state,out.trace,'ยอดเหรียญที่ขายได้ไม่พอ ตรวจ Wallet');
 if(o.side==='BUY'&&o.entryPolicy?.feeModel?.entryCreditUsed>0){const fresh=await feeCredits(pair);if(!fresh.ready||fresh.available<o.entryPolicy.feeModel.entryCreditUsed)return await finish(b,out.state,[...out.trace,{agent:'risk',action:'HOLD',reason:'เครดิตค่าธรรมเนียมเปลี่ยน รอคำนวณใหม่'}]);}
 if(Date.now()-quote.observedAt>25000)return await finish(b,out.state,[...out.trace,{agent:'execution',reason:'ราคาเก่าหลังตรวจยอดและเครดิต รอราคาใหม่'}]);
 const rid=crypto.randomUUID();
 await rpc('bitbot_v10_reserve',{p_uid:b.user_id,p_lease:b.lease,p_id:rid,p_order:o,p_state:out.state});
 try{
 const body={sym:o.symbol.toLowerCase(),amt:o.amount,rat:o.price,typ:'limit',client_id:'bb10-'+rid.replaceAll('-','').slice(0,24)};
 const ans=await signed(pair,'POST',o.side==='BUY'?'/api/v3/market/place-bid':'/api/v3/market/place-ask',body);
 if(!ans.result?.id)throw Error('ไม่มีเลขออร์เดอร์ตอบกลับ');
 await updateOrder(rid,b.user_id,{status:'OPEN',exchange_id:String(ans.result.id)});b._receipt={stage:'EXCHANGE_ACCEPTED',orderId:rid,exchangeId:String(ans.result.id),side:o.side,symbol:o.symbol};await finish(b,out.state,out.trace);
 }catch(e){
 await updateOrder(rid,b.user_id,{status:e.exchangeRejected?'REJECTED':'UNKNOWN',settled:e.exchangeRejected===true});
 await finish(b,out.state,out.trace,e.exchangeRejected?'Bitkub ปฏิเสธคำสั่ง':'ไม่ทราบผลคำสั่ง '+rid+' หยุดบอทและตรวจใน Bitkub');
 }
 }catch(e){await finish(b,b.state,[],String(e.message||'ระบบผิดพลาด').slice(0,250));}
}
async function advancedFor(plans,service=markets){
 const symbols=[...new Set(Object.values(plans).map(p=>p.market?.symbol).filter(Boolean))],advanced={};
 await Promise.all(symbols.map(async symbol=>{const result=await service.analysis(symbol);advanced[symbol]=result.frames;}));return advanced;
}
async function companyClaim(uid,mode,slot=Math.floor(Date.now()/300000)){
 return await rpc('bitbot_v14_company_claim',{p_uid:uid,p_mode:mode,p_slot:slot});
}
async function companyFinish(job,result,error=null){
 if(!job||!result)return false;
 return await rpc('bitbot_v14_company_finish',{p_uid:job.user_id,p_id:job.id,p_lease:job.lease,p_archive:await pack(result.archive),p_workers:result.workers,p_error:error});
}
async function shadowTick(row,bundle){
 const states={...row.states},events=[],records={},configs={},plans={};let job=null,company=null;
 try{
 if(!bundle?.markets?.length)throw Error('ข้อมูลตลาดยังไม่พร้อมสำหรับทดลอง');
 const rawBase=row.base_config||(await read('bitbot_v10_bots?user_id=eq.'+row.user_id+'&select=config&limit=1'))[0]?.config;
 if(!rawBase)throw Error('ไม่พบการตั้งค่าทุน');const base=row.base_config||{...rawBase,marketDataPolicy:'legacy',riskPerTrade:Math.min(rawBase.riskPerTrade||.01,.005),dailyLoss:Math.min(rawBase.dailyLoss||.03,.02)};
 job=await companyClaim(row.user_id,'PAPER');
 for(const candidate of SHADOW_CANDIDATES){
 const previous=states[candidate.key],c=previous?.companyVersion==='14.0.0'&&previous.config?runtimeConfig(previous.config):runtimeConfig(shadowConfig(base,candidate));
 c.marketDataPolicy=base.marketDataPolicy||'legacy';c.buyPaused=row.buy_paused===true;const record=previous||shadowInitial(c,Number(row.capital));records[candidate.key]=record;configs[candidate.key]=c;
 plans[candidate.key]=record.pending?{state:record.state,market:bundle.markets.find(m=>m.symbol===record.pending.order.symbol),order:null,trace:record.trace||[]}:decide(bundle,record.state,c,Date.now());
 }
 const advanced=job||Object.values(plans).some(p=>p.order?.side==='BUY')?await advancedFor(plans,marketServiceFor(base)):{};
 company=assessCompany({bundle,plans,records,configs,advanced,mode:'PAPER'});
 for(const candidate of SHADOW_CANDIDATES){try{
 const key=candidate.key,result=shadowStep(bundle,records[key],configs[key],Date.now(),company.plans[key]);
 const next=result.record,prior=records[key],gap=Date.now()-(prior.forwardLastAt||0);next.forwardWindowAt=!prior.forwardWindowAt||gap>300000?Date.now():prior.forwardWindowAt;if(!next.error&&Number.isFinite(next.lastMarketAt)&&Date.now()-next.lastMarketAt<=30000)next.forwardLastAt=Date.now();
 next.roundHistory=[...(prior.roundHistory||[])];if((next.roundPnls?.length||0)>(prior.roundPnls?.length||0))next.roundHistory.push({at:Date.now(),pnl:next.roundPnls.at(-1)});
 const mark=bundle.markets.find(m=>m.symbol===heldSymbol(next.state)),equity=next.state.qty>0?(mark&&Date.now()-mark.observedAt<=30000?next.state.cash+mark.bid*next.state.qty:null):next.state.cash;if(equity!==null)next.state.maxDrawdownSeen=Math.max(prior.state.maxDrawdownSeen||0,next.state.peak?1-equity/next.state.peak:0);
 states[key]={...next,config:configs[key],companyVersion:'14.0.0'};
 for(const event of result.events)events.push({candidate:key,event});
 }catch(e){states[candidate.key]={...records[candidate.key],error:String(e.message).slice(0,180)};}}
 const committed=await rpc('bitbot_v13_shadow_finish',{p_uid:row.user_id,p_lease:row.lease,p_states:states,p_events:events,p_error:null});
 company.archive=attachReceipts(company.archive,committed?events:[],states);company.archive.checkpointCommitted=committed;
 await companyFinish(job,company,committed?null:'PAPER_CHECKPOINT_NOT_COMMITTED');
 }catch(e){await rpc('bitbot_v13_shadow_finish',{p_uid:row.user_id,p_lease:row.lease,p_states:states,p_events:[],p_error:String(e.message).slice(0,250)});if(company)await companyFinish(job,company,String(e.message).slice(0,180));}
}
async function observeTick(row,bundle){
 const job=await companyClaim(row.user_id,'OBSERVE',Number(row.slot));if(!job)return;
 const bot=(await read('bitbot_v10_bots?user_id=eq.'+row.user_id+'&select=config,state&limit=1'))[0];if(!bot)return;
 const c=runtimeConfig({...bot.config,buyPaused:true}),service=marketServiceFor(c);
 if(c.marketDataPolicy==='verified-v17')bundle=await service.scan([heldSymbol(bot.state)].filter(Boolean));
 const plan=decide(bundle,bot.state,c,Date.now()),plans={observe:plan};
 const advanced=await advancedFor(plans,service),result=assessCompany({bundle,plans,records:{observe:{state:bot.state}},configs:{observe:c},advanced,mode:'OBSERVE'});
 await companyFinish(job,result,plan.error|| (result.archive.tasks.some(t=>t.status==='FAILED')?'DEPARTMENT_FAILURE':null));
}
async function run(uid=null){
 const [bots,shadows,observations]=await Promise.all([rpc('bitbot_v10_claim',{p_uid:uid}),rpc('bitbot_v13_shadow_claim',{p_uid:uid}),read('bitbot_v14_company_jobs?mode=eq.OBSERVE&status=in.(READY,RUNNING)&attempts=lt.3'+(uid?'&user_id=eq.'+uid:'')+'&limit=5')]);
 if(!bots.length&&!shadows.length&&!observations.length)return{processed:0,researchProcessed:0,observed:0};
 const policies=[...new Set([...bots.map(b=>b.config?.marketDataPolicy||'legacy'),...shadows.map(r=>r.base_config?.marketDataPolicy||'legacy'),...(observations.length?['legacy']:[])])],bundles=new Map();
 await Promise.all(policies.map(async policy=>{const held=[...bots.filter(b=>(b.config?.marketDataPolicy||'legacy')===policy).map(b=>heldSymbol(b.state)),...shadows.filter(r=>(r.base_config?.marketDataPolicy||'legacy')===policy).flatMap(r=>Object.values(r.states||{}).map(v=>heldSymbol(v.state||{qty:0})))].filter(Boolean);try{bundles.set(policy,await marketServiceFor({marketDataPolicy:policy}).scan([...new Set(held)]));}catch{bundles.set(policy,null);}}));
 await Promise.allSettled([...bots.map(b=>tickBot(b,bundles.get(b.config?.marketDataPolicy||'legacy'))),...shadows.map(row=>shadowTick(row,bundles.get(row.base_config?.marketDataPolicy||'legacy'))),...observations.map(row=>observeTick(row,bundles.get('legacy')))]);
 return{processed:bots.length,researchProcessed:shadows.length,observed:observations.length};
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
 if(req.method==='GET'&&a==='health')return{version:'30.0.0',mode:'PAPER_ONLY',serverTime:Date.now(),engine:'REA / exchange receipt execution / independent risk / deterministic limits',liveEnabled:LIVE,liveCapability:'SERVER_GATED_REA_LIVE'};
 if(req.method==='GET'&&a==='market')return{market:await market(new URL(req.url).searchParams.get('symbol')||'BTC_THB')};
 if(req.method==='GET'&&a==='scan'){const hold=new URL(req.url).searchParams.get('held');const holds=hold?hold.split(','):[];if(holds.length>3||holds.some(x=>!validSymbol(x)))fail('คู่เหรียญไม่ถูกต้อง');const policy=new URL(req.url).searchParams.get('dataPolicy')||'legacy';if(!['legacy','verified-v17'].includes(policy))fail('ระบบข้อมูลตลาดไม่ถูกต้อง');return{scan:await marketServiceFor({marketDataPolicy:policy}).scan(holds)};}
 if(req.method!=='POST'&&req.method!=='GET')fail('Method not allowed',405);
 if(['run','rea-run','rea-risk','rea-live-run','rea-live-risk','rea-codex-run'].includes(a)){
 if(req.method!=='POST'||!await rpc('bitbot_v10_runner_allowed',{p_token:req.headers.get('x-bitbot-runner')||''}))fail('ไม่อนุญาต',401);
 if(a==='rea-codex-run')return await codex.run();
 if(a==='rea-live-run'||a==='rea-live-risk')return await reaLive.run(a==='rea-live-risk');
 return a==='rea-run'?await rea.run():a==='rea-risk'?await riskWatchdog.run():await run();
 }
 const b=req.method==='POST'?await body(req):{};
 if(['login','register','recover'].includes(a)){if(req.method!=='POST')fail('Method not allowed',405);return await authAction(req,a,b);}
 const u=await user(req),uid=u.id;
 if(req.method==='GET'&&a==='rea-codex-state')return{codex:await codex.view(uid)};
 if(req.method==='POST'&&['rea-codex-config','rea-codex-request','rea-codex-resolve'].includes(a)){
  await throttle(req,a,uid,6,60);
  if(a==='rea-codex-config')return{codex:await codex.configure(uid,b)};
  if(a==='rea-codex-resolve')return{resolved:await codex.resolve(uid,b)};
  return await codex.request(uid,b);
 }
 if(req.method==='GET'&&a==='rea-state')return{rea:await rea.view(uid)};
 if(req.method==='GET'&&a==='rea-live-state')return{live:await reaLive.view(uid)};
 if(req.method==='POST'&&a==='rea-live-control'){
  await throttle(req,'rea-live-control',uid,12,60);
  if(b.action==='activate')return await reaLive.activate(uid,b);
  return await reaLive.control(uid,b.action,b.confirm);
 }
 if(req.method==='POST'&&a==='rea-control'){
  await throttle(req,'rea-control',uid,30,60);
  if(b.action==='clear-emergency'&&b.confirm!=='ปลดหยุดฉุกเฉิน Paper')fail('กรุณายืนยันการปลดหยุดฉุกเฉิน',400);
  return{saved:await rea.control(uid,b.action)};
 }
 if(req.method==='GET'&&a==='state')return await status(uid);
 if(req.method==='GET'&&a==='report'){const st=await status(uid),page=await ledgerPages('bitbot_v12_fills?user_id=eq.'+uid+'&order=filled_at.asc,order_id.asc,fill_index.asc'),fills=page.rows;return{fills,summary:reportingSummary(st.bot?.state||{realized:0},fills),periods:Object.fromEntries(['day','week','month','year'].map(p=>[p,aggregateFills(fills,p)])),coverage:{limit:page.limit,possiblyTruncated:page.possiblyTruncated}};}
 if(req.method==='GET'&&a==='paper-export'){const page=await ledgerPages('bitbot_v13_shadow_events?user_id=eq.'+uid+'&order=id.desc');return{events:page.rows,coverage:{limit:page.limit,possiblyTruncated:page.possiblyTruncated}};}
 if(req.method==='GET'&&a==='company'){const id=new URL(req.url).searchParams.get('id');if(id&&!/^[a-f0-9-]{36}$/.test(id))fail('รหัสงานไม่ถูกต้อง');const rows=await read('bitbot_v14_company_jobs?user_id=eq.'+uid+(id?'&id=eq.'+id:'&order=created_at.desc')+'&limit=1');return{job:rows[0]?{id:rows[0].id,mode:rows[0].mode,status:rows[0].status,archive:rows[0].result_gzip?await unpack(rows[0].result_gzip):null}:null};}
 if(req.method==='GET'&&a==='analysis'){const symbol=new URL(req.url).searchParams.get('symbol');if(!validSymbol(symbol))fail('คู่เหรียญไม่ถูกต้อง');await throttle(req,'analysis',uid,12,60);const m=await market(symbol),extra=await markets.analysis(symbol);return{market:m,extra};}
 if(req.method==='GET'&&a==='planning'){
 await throttle(req,'planning',uid,4,60);
 const bot=(await read('bitbot_v10_bots?user_id=eq.'+uid+'&select=config,state,running&limit=1'))[0];if(!bot)fail('บันทึกวงเงินก่อนตรวจสูตร',409);
 const pair=await keys(uid),[w0,credits,bundle]=await Promise.all([wallet(pair),feeCredits(pair),marketServiceFor(bot.config).scan([heldSymbol(bot.state)].filter(Boolean))]);
 const w=walletValue(w0,bundle.watchlist||[]),data={...bundle,markets:bundle.markets.map(m=>({...m,wallet:w,feeCredits:credits}))},now=Date.now(),plans={};
 for(const planner of ['legacy-v13','net-v16']){const c=runtimeConfig({...bot.config,entryPlanner:planner},true),p=decide(data,structuredClone(bot.state),c,now);plans[planner]=p;}
 const advanced=await advancedFor(plans,marketServiceFor(bot.config)),rows=Object.entries(plans).map(([planner,p])=>{const r=p.trace?.find(t=>t.agent==='risk'),signal=p.trace?.find(t=>t.agent==='strategy'),h=indicators(advanced[p.market?.symbol]?.['60']||[],60,now),blocked=[...(r?.blocked||[])];if(!(bot.state.qty>0)&&!h.ready)blocked.push('รอข้อมูลแท่งปิด 1 ชั่วโมงให้เพียงพอ');else if(!(bot.state.qty>0)&&h.regime==='DOWNTREND')blocked.push('แนวโน้ม 1 ชั่วโมงเป็นขาลง');return{planner,symbol:p.market?.symbol||null,signal:signal?.signal||'HOLD',action:blocked.length||p.error?'HOLD':p.order?.side||'HOLD',plan:r?.plan||null,notional:r?.wallet?.maxBuy||0,blocked,error:p.error||null,hourly:{ready:h.ready,bars:h.bars,regime:h.regime,reason:h.reason}};});
 return{at:now,activePlanner:bot.config.entryPlanner||'legacy-v13',running:bot.running,credits,rows,readOnly:true,note:'เปรียบเทียบจากกระเป๋าและราคาปัจจุบัน ไม่บันทึกสถานะหรือส่งคำสั่ง'};
 }
 if(req.method==='GET'&&a==='wallet')return{wallet:await wallet(await keys(uid))};
 if(req.method!=='POST')fail('Method not allowed',405);
 await throttle(req,'action',uid,60,60);
 if(a==='data-upgrade'){
 if(b.confirm!=='อัปเดตข้อมูลตลาด'||b.acceptRisk!==true||b.allowUnvalidated!==true)fail('กรุณายืนยันการใช้ข้อมูลใหม่กับบอทอัตโนมัติ');
 const st=await status(uid),pending=await read('bitbot_v10_orders?user_id=eq.'+uid+'&settled=eq.false&limit=1'),blocked=dataUpgradeBlock(st.bot,pending);if(blocked)fail(blocked,409);
 if(!b.expectedConfig||JSON.stringify(Object.keys(b.expectedConfig).sort())!==JSON.stringify(Object.keys(st.bot.config).sort())||Object.keys(st.bot.config).some(k=>JSON.stringify(st.bot.config[k])!==JSON.stringify(b.expectedConfig[k])))fail('การตั้งค่าเปลี่ยน กรุณาอ่านสถานะล่าสุดและยืนยันใหม่',409);
 const result=await rpc('bitbot_v17_data_upgrade',{p_uid:uid,p_expected_config:b.expectedConfig,p_ack:true});
 return{...result,note:result.running?'อัปเดตข้อมูลแล้ว บอททำงานอัตโนมัติต่อด้วยวงเงินเดิม':'อัปเดตข้อมูลแล้ว กดเริ่มบอทเพื่อทำงานอัตโนมัติ'};
 }
 if(a==='keys'){
 if(!await rpc('rea_live_key_change_allowed',{p_uid:uid}))fail('บัญชี Live ยังมีทุนที่จัดสรรไว้ ต้องตรวจและปิดการใช้งานก่อนเปลี่ยนกุญแจ',409);
 const apiKey=String(b.apiKey||'').trim(),apiSecret=String(b.apiSecret||'').trim();
 if(apiKey.length<8||apiKey.length>512||apiSecret.length<8||apiSecret.length>1024)fail('API Key หรือ Secret ไม่ครบ');
 const live=(await read('bitbot_v10_bots?user_id=eq.'+uid))[0];
 if(live?.running||(await read('bitbot_v10_orders?user_id=eq.'+uid+'&settled=eq.false&limit=1')).length)fail('หยุดบอทและตรวจออร์เดอร์ค้างก่อนเปลี่ยนคีย์');
 const w=await wallet({apiKey,apiSecret});await rpc('bitbot_store_exchange_key',{p_user_id:uid,p_api_key:apiKey,p_api_secret:apiSecret});return{verified:true,wallet:w};
 }
 if(a==='remove-key'){
 if(!await rpc('rea_live_key_change_allowed',{p_uid:uid}))fail('บัญชี Live ยังมีทุนที่จัดสรรไว้ ห้ามถอดกุญแจระหว่างดูแลพอร์ต',409);
 const st=await status(uid);if(st.bot?.running||st.orders.some(x=>!x.settled)||Number(st.bot?.state?.qty)>0)fail('ยังมีบอทหรือสถานะค้าง จัดการก่อนถอดคีย์');
 await rpc('bitbot_remove_exchange_key',{p_user_id:uid});return{removed:true};
 }
 if(a==='save'){
 const c=runtimeConfig(b.config,true),st=await status(uid);
 // A stopped session with no position may retain its accounting; changing budget starts a new session and preserves the old summary in audit.
 if(st.bot)await event(uid,'SESSION_SAVED',{state:st.bot.state,config:st.bot.config});
 await rpc('bitbot_v10_control',{p_uid:uid,p_action:'save',p_config:c,p_state:initial(c)});await db('bitbot_v10_bots?user_id=eq.'+uid,{evidence_consent:null},'PATCH');return{saved:true};
 }
 if(a==='close-positions'){if(b.confirm!=='ปิดสถานะของบอท'||b.acceptRisk!==true)fail('ยืนยันการปิดสถานะก่อนส่งคำสั่ง');const st=await status(uid);if(!(st.bot?.state?.qty>0))fail('ไม่มีสถานะของบอทที่ต้องปิด');await wallet(await keys(uid));await rpc('bitbot_v14_close_request',{p_uid:uid});return{closing:true,note:'เริ่มทยอยปิดเฉพาะเหรียญของบอท ภายใต้เพดานคำสั่งและสภาพคล่องเดิม'};}
 if(a==='paper-config'){const c=runtimeConfig(b.config),capital=Number(b.capital);if(!Number.isFinite(capital)||capital<=0||capital>c.budget)fail('ทุนทดลองไม่ถูกต้อง');await rpc('bitbot_v14_paper_config',{p_uid:uid,p_config:c,p_capital:capital});return{saved:true};}
 if(a==='paper-pause'){if(typeof b.paused!=='boolean')fail('สถานะพักซื้อไม่ถูกต้อง');await db('bitbot_v13_shadow?user_id=eq.'+uid,{buy_paused:b.paused},'PATCH');return{saved:true};}
 if(a==='observe'){if(!(await status(uid)).bot)fail('ตั้งค่าบัญชีก่อนเรียกวิเคราะห์');await db('bitbot_v14_company_jobs',{user_id:uid,mode:'OBSERVE',slot:Math.floor(Date.now()/300000)},'POST').catch(()=>null);await run(uid);return{observed:true};}
 if(a==='shadow-toggle'){if(typeof b.enabled!=='boolean')fail('สถานะทดลองไม่ถูกต้อง');await rpc('bitbot_v13_shadow_toggle',{p_uid:uid,p_enabled:b.enabled});return{saved:true};}
 if(a==='start'){
 if(!LIVE)fail('PAPER_ONLY: เซิร์ฟเวอร์ปิดเทรดจริงระหว่างตรวจรับ',423);
 if(b.confirm!=='เริ่มบอทเงินจริง'||b.acceptRisk!==true||b.noWithdraw!==true)fail('ยืนยันความเสี่ยงและปิดสิทธิ์ถอนก่อนเริ่ม');
 const st=await status(uid);if(!st.bot)fail('บันทึกวงเงินก่อนเริ่ม');
 if(!(st.bot.state.qty>0)&&!st.evidence.allowed&&b.allowUnvalidated!==true)fail('ผลทดสอบยังไม่ครบ กรุณายืนยันตัวเลือกเริ่มเงินจริงก่อนผลทดสอบครบในหน้าต่างเริ่มบอท',409);
 if(st.orders.some(o=>!o.settled))fail('ตรวจคำสั่งค้างให้เสร็จก่อนเริ่มรอบ');
 const c=runtimeConfig(st.bot.config,true),w=await wallet(await keys(uid)),bundle=await marketServiceFor(c).scan([heldSymbol(st.bot.state)].filter(Boolean));
 if(!bundle.markets.length)fail('ยังไม่มีข้อมูลตลาดพร้อมวิเคราะห์');
 const funds=fundingAmount(c,w);
 if(st.bot.state.qty===0&&funds<10)fail('เงินบาทหลังสำรองต่ำกว่าขั้นต่ำตลาด กรุณาปรับเงินสำรองหรือเติมเงิน');
 if(!st.bot.state.trades&&st.bot.state.qty===0)await rpc('bitbot_v11_fund',{p_uid:uid,p_funds:funds});
 await rpc('bitbot_v15_start',{p_uid:uid,p_expected_config:st.bot.config,p_unvalidated:b.allowUnvalidated===true});
 return{started:true,note:'ตรวจตลาดทุก 1 นาที สัญญาณจากแท่งปิด 5 นาที'};
 }
 if(['pause','resume','stop'].includes(a)){
 await rpc('bitbot_v10_control',{p_uid:uid,p_action:a});if(a==='stop')await db('bitbot_v10_bots?user_id=eq.'+uid,{close_positions:false,evidence_consent:null},'PATCH');return{saved:true,note:a==='stop'?'หยุดส่งคำสั่งใหม่แล้ว ออร์เดอร์ที่ส่งไปแล้วจะตรวจและขอยกเลิก เหรียญที่ถือยังอยู่ใน Bitkub':'บันทึกแล้ว'};
 }
 if(a==='tick'){await run(uid);return await status(uid);}


 if(a==='resolve-order'){
 if(!/^[0-9a-f-]{36}$/i.test(String(b.id||''))||!/^[a-zA-Z0-9_-]{1,100}$/.test(String(b.exchangeId||'')))fail('เลขอ้างอิงไม่ถูกต้อง');
 const row=(await read('bitbot_v10_orders?user_id=eq.'+uid+'&id=eq.'+b.id+'&settled=eq.false&limit=1'))[0];
 if(!row)fail('ไม่พบคำสั่งค้างของบัญชีนี้');
 const result=(await signed(await keys(uid),'GET','/api/v3/market/order-info?sym='+row.symbol.toLowerCase()+'&id='+encodeURIComponent(b.exchangeId)+'&sd='+(row.side==='BUY'?'buy':'sell'))).result;
 const expected='bb10-'+row.id.replaceAll('-','').slice(0,24);
 if(!result||result.client_id!==expected)fail('เลขออร์เดอร์ไม่ตรงกับรหัสป้องกันส่งซ้ำของ Bitbot');
 await updateOrder(row.id,uid,{exchange_id:b.exchangeId,status:'OPEN'});return{verified:true};
 }

 if(a==='reset-session'){
 const st=await status(uid);if(st.bot?.running||st.orders.some(o=>!o.settled))fail('หยุดบอทและตรวจคำสั่งค้างก่อนเริ่มรอบใหม่');
 if(!st.bot)fail('ยังไม่มีรอบการทำงาน');
 const w=await wallet(await keys(uid));
 const held=heldSymbol(st.bot.state);if(held){const m=await market(held),balance=w[assetOf(held)]||{available:0,reserved:0};if((balance.available+balance.reserved)*m.bid>=m.rules.minQuote)fail('ยังมี '+assetOf(held)+' ใน Wallet จัดการสถานะก่อนเริ่มรอบใหม่');}
 if(fundingAmount(config(st.bot.config,true),w)<10)fail('THB หลังสำรองต่ำกว่าขั้นต่ำตลาด');
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
 return new Response(JSON.stringify({ok:false,error:message,...(typeof e.code==='string'&&e.code.startsWith('BITKUB_')?{code:e.code,action:e.action,retryable:e.retryable,exchangeStatus:e.exchangeStatus,exchangeCode:e.exchangeCode}:{})}),{status:e.status||500,headers:{...cors,'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});}
});
