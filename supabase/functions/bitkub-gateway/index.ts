// Bitbot Bitkub Gateway v7 — live exchange prices, authenticated read-only balance,
// and explicitly authorized LIMIT orders with server-enforced kill switch and risk caps.
// IMPORTANT: no API secrets are ever sent to the browser or committed to GitHub.
const BITKUB = 'https://api.bitkub.com';
const WEB_ORIGIN = 'https://keitaphotocamerakathu-sudo.github.io';
const PROJECT = Deno.env.get('SUPABASE_URL') || '';
const PUBLIC_KEY = Deno.env.get('SUPABASE_ANON_KEY') || Deno.env.get('SUPABASE_PUBLISHABLE_KEY') || '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const API_KEY = Deno.env.get('BITKUB_API_KEY') || '';
const API_SECRET = Deno.env.get('BITKUB_API_SECRET') || '';
const LIVE = Deno.env.get('BITBOT_LIVE_ENABLED') === 'true';
const MAX_ORDER = positiveEnv('BITBOT_MAX_ORDER_THB');
const MAX_BUY_DAY = positiveEnv('BITBOT_MAX_DAILY_BUY_THB');
const MAX_SELL_DAY = positiveEnv('BITBOT_MAX_DAILY_SELL_THB');
function positiveEnv(name: string) { const v = Number(Deno.env.get(name) || '0'); return Number.isFinite(v) && v > 0 ? v : 0; }
function respond(data: Record<string,unknown>, code=200, origin='') {
  return new Response(JSON.stringify(data), {status:code,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',
    'Vary':'Origin',...(origin === WEB_ORIGIN ? {'Access-Control-Allow-Origin':WEB_ORIGIN}:{}),
    'X-Content-Type-Options':'nosniff'}});
}
function n(v:unknown) { const x=Number(v); return Number.isFinite(x) ? x : NaN; }
function finitePos(v:unknown) { const x=n(v); return x>0?x:NaN; }
function fail(message:string,code=400):never { throw Object.assign(new Error(message),{httpStatus:code}); }
function creds() { if (!API_KEY || !API_SECRET) fail('Bitkub API Key/Secret ยังไม่ตั้งใน Edge Function Secrets',503); }
function safeResult(v:unknown){return typeof v==='object'&&v!==null?v:{};}
async function getJson(url:string, opts:RequestInit={}, timeout=9500) {
  const ac = new AbortController(); const timer=setTimeout(()=>ac.abort(),timeout);
  try {
    const r=await fetch(url,{...opts,headers:{Accept:'application/json',...(opts.headers||{})},signal:ac.signal});
    if(!r.ok)fail('Bitkub request HTTP '+r.status,502);
    return await r.json();
  } catch(e) {
    if((e as Error).name==='AbortError')fail('Bitkub API ตอบช้า ไม่ส่งคำสั่งซ้ำจนกว่าจะตรวจสอบ',504);
    throw e;
  } finally {clearTimeout(timer);}
}
function pickTicker(obj:any){
  const root=obj?.result??obj;
  const t=Array.isArray(root)?root.find(v=>v.symbol==='BTC_THB'||v.symbol==='THB_BTC'):root?.THB_BTC||root?.BTC_THB||root?.btc_thb||root;
  const last=finitePos(t?.last??t?.close),bid=finitePos(t?.highest_bid??t?.highestBid),ask=finitePos(t?.lowest_ask??t?.lowestAsk);
  if(!Number.isFinite(last)||!Number.isFinite(bid)||!Number.isFinite(ask)||ask<bid)fail('Bitkub ส่งราคาผิดรูปแบบ',502);
  const frozen=String(t?.isFrozen??t?.is_frozen??'0')!=='0';
  return {symbol:'BTC_THB',priceTHB:last,bidTHB:bid,askTHB:ask,change24hPct:Number(t?.percent_change??t?.percentChange)||0,
    frozen,asOf:new Date().toISOString(),source:'BITKUB_API_V3_LIVE'};
}
async function ticker() {
  const obj=await getJson(BITKUB+'/api/v3/market/ticker?sym=btc_thb');
  return pickTicker(obj);
}
async function authenticate(req:Request) {
  if(!PROJECT||!PUBLIC_KEY||!SERVICE_KEY)fail('Supabase environment ยังไม่พร้อมสำหรับผู้ใช้ที่ล็อกอิน',503);
  const token=(req.headers.get('authorization')||'').match(/^Bearer\s+(.+)$/i)?.[1];
  if(!token||token.length>10000)fail('กรุณาเข้าสู่ระบบ Bitbot Cloud ก่อน',401);
  const res=await fetch(PROJECT+'/auth/v1/user',{headers:{apikey:PUBLIC_KEY,Authorization:'Bearer '+token},signal:AbortSignal.timeout(9000)});
  if(!res.ok)fail('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่',401);
  const u=await res.json(); if(!/^[0-9a-f-]{36}$/i.test(String(u?.id||'')))fail('ไม่พบผู้ใช้ที่ยืนยันตัวตนแล้ว',401);
  // Access is checked from a server-only allowlist; user metadata cannot grant trading rights.
  const granted=await internalGet('bitbot_live_operators?select=user_id&enabled=eq.true&user_id=eq.'+encodeURIComponent(u.id)+'&limit=1');
  if(!Array.isArray(granted)||granted.length!==1)fail('บัญชีนี้ยังไม่ได้รับสิทธิ์จัดการ Bitkub ผ่าน Bitbot',403);
  return u.id as string;
}
function serviceHeaders():HeadersInit{if(!SERVICE_KEY)fail('Private Supabase backend key unavailable',503);return {apikey:SERVICE_KEY,Authorization:'Bearer '+SERVICE_KEY,'Content-Type':'application/json'};}
async function internalGet(path:string) {
  const r=await fetch(PROJECT+'/rest/v1/'+path,{headers:serviceHeaders(),signal:AbortSignal.timeout(10000)});
  if(!r.ok)fail('Supabase database read failed ('+r.status+')',502);return await r.json();
}
async function internalPost(path:string,body:unknown,method='POST') {
  const r=await fetch(PROJECT+'/rest/v1/'+path,{method,headers:{...serviceHeaders(),'Prefer':'return=representation'},body:JSON.stringify(body),signal:AbortSignal.timeout(10000)});
  const ans=await r.json().catch(()=>({})); if(!r.ok)fail('Supabase reserve/audit failed: '+String(ans.message||r.status),409);
  return ans;
}
async function internalPatch(requestId:string,userId:string,status:string,more:Record<string,unknown>={}) {
  const path='bitbot_live_orders?request_id=eq.'+requestId+'&user_id=eq.'+userId;
  return internalPost(path,{status,updated_at:new Date().toISOString(),...more},'PATCH');
}
async function bitkubSigned(method:'GET'|'POST',path:string,data:Record<string,unknown>|null=null) {
  creds();
  const tsRaw=await getJson(BITKUB+'/api/v3/servertime');
  const stamp=String(typeof tsRaw==='number'||typeof tsRaw==='string'?tsRaw:tsRaw?.result??'');
  if(!/^\d{13}$/.test(stamp))fail('Bitkub server timestamp invalid',502);
  const body=method==='POST'?JSON.stringify(data):'';
  const enc=new TextEncoder();
  const key=await crypto.subtle.importKey('raw',enc.encode(API_SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const dig=new Uint8Array(await crypto.subtle.sign('HMAC',key,enc.encode(stamp+method+path+body)));
  const sig=[...dig].map(b=>b.toString(16).padStart(2,'0')).join('');
  const res=await getJson(BITKUB+path,{method,headers:{'X-BTK-APIKEY':API_KEY,'X-BTK-TIMESTAMP':stamp,'X-BTK-SIGN':sig,'Content-Type':'application/json'},...(method==='POST'?{body}:{})});
  const err=(res as any)?.error;
  if(err!==undefined && String(err)!=='0')fail('Bitkub exchange rejected request (code '+String(err)+')',502);
  if((res as any)?.code!==undefined && String((res as any).code)!=='0')fail('Bitkub wallet failed (code '+String((res as any).code)+')',502);
  return res;
}
async function balances() {
  const raw=await bitkubSigned('GET','/api/v4/wallet/balances');
  const data=(raw as any).data; if(!Array.isArray(data))fail('Bitkub wallet format unsupported',502);
  const select=(s:string)=>{const x=data.find((v:any)=>v.currency===s)||{};return {available:n(x.available)||0,reserved:n(x.reserved)||0,total:n(x.total)||0};};
  return {BTC:select('BTC'),THB:select('THB'),asOf:new Date().toISOString(),source:'BITKUB_WALLET_V4'};
}
function parseOrder(data:any) {
  if(!data||typeof data!=='object')fail('คำสั่งไม่ถูกต้อง');
  const side=data.side;
  if(side!=='BUY'&&side!=='SELL')fail('อนุญาตเฉพาะ BUY/SELL BTC_THB');
  const price=finitePos(data.limitPriceTHB); if(!Number.isFinite(price)||price<1000||price>100000000||Math.abs(Math.round(price*100)-price*100)>1e-5)fail('ราคา Limit ไม่ถูกต้อง (2 ตำแหน่ง)');
  const amount=side==='BUY'?finitePos(data.amountTHB):finitePos(data.btcQuantity);
  if(!Number.isFinite(amount)||amount<=0)fail('จำนวนซื้อ/ขายไม่ถูกต้อง');
  if(side==='SELL' && Math.abs(Math.round(amount*1e8)-amount*1e8)>1e-5)fail('จำนวน BTC ต้องไม่เกิน 8 ตำแหน่ง');
  if(side==='BUY' && Math.abs(Math.round(amount*100)-amount*100)>1e-5)fail('เงิน THB ต้องไม่เกิน 2 ตำแหน่ง');
  const notional=side==='BUY'?amount:amount*price;
  if(notional<100||notional>10000000)fail('มูลค่าคำสั่งไม่ถูกต้อง');
  return {side,price,amount,notional:Math.round(notional*100)/100};
}
function riskPreview(order:ReturnType<typeof parseOrder>,quote:Awaited<ReturnType<typeof ticker>>){
  if(quote.frozen)fail('ตลาด Bitkub หยุดซื้อขายชั่วคราว',409);
  // Limit order price must be close to a fresh exchange quote, reducing fat-finger orders.
  if(Math.abs(order.price/quote.priceTHB-1)>.015)fail('ราคา Limit ห่างราคาตลาดเกิน 1.5%',409);
  // The preview is available while live mode is disabled; enforcement is repeated before submit.
  if(MAX_ORDER>0 && order.notional>MAX_ORDER)fail('เกินวงเงินต่อคำสั่ง');
  return {side:order.side,orderType:'LIMIT',symbol:'BTC_THB',amount:order.amount,limitPriceTHB:order.price,
    estimatedNotionalTHB:order.notional,lastPriceTHB:quote.priceTHB,maxOrderTHB:MAX_ORDER,
    dailyBuyCapTHB:MAX_BUY_DAY,dailySellCapTHB:MAX_SELL_DAY,liveEnabled:LIVE,quoteTime:quote.asOf};
}
async function handle(req:Request) {
  const url=new URL(req.url),action=url.searchParams.get('action')||'status';
  if(req.method==='GET'&&action==='ticker')return {ticker:await ticker()};
  if(req.method==='GET'&&action==='status')return {exchange:'BITKUB',marketData:true,walletConfigured:!!API_KEY&&!!API_SECRET,
    liveTradingEnabled:LIVE&&!!API_KEY&&!!API_SECRET&&!!MAX_ORDER&&!!MAX_BUY_DAY&&!!MAX_SELL_DAY,
    tradingMode:'MANUAL_LIMIT_ONLY',orderCapTHB:MAX_ORDER,asOf:new Date().toISOString()};
  if(!['GET','POST'].includes(req.method))fail('Method not supported',405);
  const uid=await authenticate(req);
  if(req.method==='GET'&&action==='balance')return {balance:await balances()};
  if(req.method==='GET'&&action==='orders'){
    const rows=await internalGet('bitbot_live_orders?select=request_id,side,amount,limit_price,notional_thb,status,created_at,exchange_order_id,exchange_status&user_id=eq.'+uid+'&order=created_at.desc&limit=100');
    return {orders:rows};
  }
  const body=await req.json().catch(()=>fail('Invalid JSON body'));
  if(action==='preview'){
    const order=parseOrder(body);const quote=await ticker();const p=riskPreview(order,quote);
    return {preview:p,maySubmit:p.liveEnabled,warning:'Manual LIMIT orders only. Funds at risk. Fees and partial fills are not included in estimates.'};
  }
  if(action==='submit'){
    if(!LIVE)fail('Live orders disabled by server kill switch',403);
    if(!API_KEY||!API_SECRET||!MAX_ORDER||!MAX_BUY_DAY||!MAX_SELL_DAY)fail('Exchange secrets or risk caps not configured',503);
    if(body?.confirmText!=='I AUTHORIZE A REAL BITKUB ORDER')fail('ต้องยืนยันคำสั่งซื้อขายเงินจริงอย่างชัดเจน',400);
    const rid=String(body?.requestId||'');if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(rid))fail('Request ID invalid');
    const order=parseOrder(body),quote=await ticker();riskPreview(order,quote);
    const balance=await balances();
    if(order.side==='BUY' && balance.THB.available<order.amount*1.005)fail('ยอด THB ไม่พอพร้อมค่าธรรมเนียมสำรอง',409);
    if(order.side==='SELL' && balance.BTC.available<order.amount)fail('ยอด BTC ไม่เพียงพอ',409);
    await internalPost('rpc/bitbot_reserve_live_order',{
      p_request_id:rid,p_user_id:uid,p_side:order.side,p_amount:order.amount,p_limit_price:order.price,
      p_notional_thb:order.notional,p_max_order_thb:MAX_ORDER,p_max_daily_buy_thb:MAX_BUY_DAY,p_max_daily_sell_thb:MAX_SELL_DAY});
    let submitted=false;
    try {
      const payload={sym:'btc_thb',amt:order.amount,rat:order.price,typ:'limit',client_id:'bitbot-'+rid.slice(0,30)};
      submitted=true; // from here onward any network ambiguity is never retried automatically
      const result=await bitkubSigned('POST',order.side==='BUY'?'/api/v3/market/place-bid':'/api/v3/market/place-ask',payload);
      const exid=String((result as any)?.result?.id||'');
      if(!exid)fail('Bitkub response missing order ID (manual reconciliation required)',502);
      await internalPatch(rid,uid,'OPEN',{exchange_order_id:exid,exchange_status:'submitted'});
      return {accepted:true,requestId:rid,exchangeOrderId:exid,status:'OPEN',note:'คำสั่งถูกส่งแล้ว ตรวจสอบสถานะการจับคู่ก่อนส่งคำสั่งอื่น'};
    }catch(e){
      try{await internalPatch(rid,uid,submitted?'UNKNOWN':'REJECTED',{exchange_status:'requires_manual_review'});}catch(_e){/* preserve original failure */}
      throw e;
    }
  }
  if(action==='reconcile'){
    const rid=String(body?.requestId||'');if(!/^[0-9a-f-]{36}$/i.test(rid))fail('Request ID invalid');
    const rows=await internalGet('bitbot_live_orders?select=*&request_id=eq.'+rid+'&user_id=eq.'+uid+'&limit=1');
    const row=rows?.[0];if(!row||!row.exchange_order_id)fail('ยังไม่มีเลขออร์เดอร์จาก Bitkub; ห้าม retry โดยอัตโนมัติ',409);
    const s=row.side==='BUY'?'buy':'sell';
    const path='/api/v3/market/order-info?sym=btc_thb&id='+encodeURIComponent(row.exchange_order_id)+'&sd='+s;
    const raw=await bitkubSigned('GET',path);
    const status=String((raw as any)?.result?.status||'').toLowerCase();
    let mapped='OPEN';if(status==='filled')mapped='FILLED';if(['cancelled','canceled'].includes(status))mapped='CANCELED';
    await internalPatch(rid,uid,mapped,{exchange_status:status});
    return {requestId:rid,status:mapped,exchangeStatus:status};
  }
  fail('Unknown action',404);
}
Deno.serve(async req=>{
  const origin=req.headers.get('origin')||'';
  if(origin && origin!==WEB_ORIGIN)return respond({error:'Origin not allowed'},403,origin);
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers:{'Access-Control-Allow-Origin':WEB_ORIGIN,'Access-Control-Allow-Methods':'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Max-Age':'3600','Vary':'Origin'}});
  try{return respond({ok:true,...await handle(req)},200,origin);}
  catch(e){const x=e as Error & {httpStatus?:number};const code=x.httpStatus||500;return respond({ok:false,error:x.message||'Unexpected error'},code,origin);}
});