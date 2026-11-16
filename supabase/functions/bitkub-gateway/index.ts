// Bitbot Bitkub Gateway v7 — live exchange prices, authenticated read-only balance,
// and explicitly authorized LIMIT orders with server-enforced kill switch and risk caps.
// IMPORTANT: no API secrets are ever sent to the browser or committed to GitHub.
const BITKUB = 'https://api.bitkub.com';
const WEB_ORIGIN = 'https://keitaphotocamerakathu-sudo.github.io';
const PROJECT = Deno.env.get('SUPABASE_URL') || '';
const PUBLIC_KEY = Deno.env.get('SUPABASE_ANON_KEY') || Deno.env.get('SUPABASE_PUBLISHABLE_KEY') || '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
// Independent emergency kill switch: explicitly set BITBOT_LIVE_ENABLED=false in Edge Secrets to stop all orders.
// A second DB master switch, per-account opt-in, signed-in user and typed trade confirmation are also required.
// Conservative hard ceilings. A user can REDUCE these in setup, but cannot override them.
const LIVE = Deno.env.get('BITBOT_LIVE_ENABLED') !== 'false';
const MAX_ORDER = 100;
const MAX_BUY_DAY = 300;
const MAX_SELL_DAY = 1000;
function respond(data: Record<string,unknown>, code=200, origin='') {
  return new Response(JSON.stringify(data), {status:code,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',
    'Vary':'Origin',...(origin === WEB_ORIGIN ? {'Access-Control-Allow-Origin':WEB_ORIGIN}:{}),
    'X-Content-Type-Options':'nosniff'}});
}
function n(v:unknown) { const x=Number(v); return Number.isFinite(x) ? x : NaN; }
function finitePos(v:unknown) { const x=n(v); return x>0?x:NaN; }
function fail(message:string,code=400):never { throw Object.assign(new Error(message),{httpStatus:code}); }
type KeyPair={apiKey:string,apiSecret:string};
function creds(pair:KeyPair){if(!pair?.apiKey||!pair?.apiSecret)fail('กรุณาตั้ง API Key ผ่านหน้า Setup',503);}
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
  if(!u.email_confirmed_at&&!u.phone_confirmed_at)fail('ต้องยืนยันอีเมลก่อนตั้งค่าบัญชี',403);
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
async function bitkubSigned(method:'GET'|'POST',path:string,data:Record<string,unknown>|null,pair:KeyPair) {
  creds(pair);
  const tsRaw=await getJson(BITKUB+'/api/v3/servertime');
  const stamp=String(typeof tsRaw==='number'||typeof tsRaw==='string'?tsRaw:tsRaw?.result??'');
  if(!/^\d{13}$/.test(stamp))fail('Bitkub server timestamp invalid',502);
  const body=method==='POST'?JSON.stringify(data):'';
  const enc=new TextEncoder();
  const key=await crypto.subtle.importKey('raw',enc.encode(pair.apiSecret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const dig=new Uint8Array(await crypto.subtle.sign('HMAC',key,enc.encode(stamp+method+path+body)));
  const sig=[...dig].map(b=>b.toString(16).padStart(2,'0')).join('');
  const res=await getJson(BITKUB+path,{method,headers:{'X-BTK-APIKEY':pair.apiKey,'X-BTK-TIMESTAMP':stamp,'X-BTK-SIGN':sig,'Content-Type':'application/json'},...(method==='POST'?{body}:{})});
  const err=(res as any)?.error;
  if(err!==undefined && String(err)!=='0')fail('Bitkub exchange rejected request (code '+String(err)+')',502);
  if((res as any)?.code!==undefined && String((res as any).code)!=='0')fail('Bitkub wallet failed (code '+String((res as any).code)+')',502);
  return res;
}
async function balances(pair:KeyPair) {
  const raw=await bitkubSigned('GET','/api/v4/wallet/balances',null,pair);
  const data=(raw as any).data; if(!Array.isArray(data))fail('Bitkub wallet format unsupported',502);
  const select=(s:string)=>{const x=data.find((v:any)=>v.currency===s)||{};return {available:n(x.available)||0,reserved:n(x.reserved)||0,total:n(x.total)||0};};
  return {BTC:select('BTC'),THB:select('THB'),asOf:new Date().toISOString(),source:'BITKUB_WALLET_V4'};
}

async function rpc(name:string,args:Record<string,unknown>){return await internalPost('rpc/'+name,args);}
async function ownerSettings(uid:string){return await rpc('bitbot_exchange_setup_status',{p_user_id:uid});}
async function platformLimits(){
 const p=await rpc('bitbot_live_platform_status',{});
 return {enabled:LIVE && p?.enabled===true,
   maxOrderTHB:Math.min(MAX_ORDER,Number(p?.maxOrderTHB)||0),
   maxDailyBuyTHB:Math.min(MAX_BUY_DAY,Number(p?.maxDailyBuyTHB)||0),
   maxDailySellTHB:Math.min(MAX_SELL_DAY,Number(p?.maxDailySellTHB)||0)};
}
async function ownerPair(uid:string):Promise<KeyPair>{
 const v=await rpc('bitbot_load_exchange_key',{p_user_id:uid});
 if(!v?.apiKey||!v?.apiSecret)fail('กรุณาตั้งค่า Bitkub API ในหน้า Setup',409);
 return v;
}
async function operator(uid:string){
 const grants=await internalGet('bitbot_live_operators?select=user_id&enabled=eq.true&user_id=eq.'+encodeURIComponent(uid)+'&limit=1');
 if(!Array.isArray(grants)||grants.length!==1)fail('ยังไม่ได้รับอนุมัติให้ส่งคำสั่งจริง',403);
}
function cap(v:unknown,max:number){
 const x=Number(v);
 if(!Number.isFinite(x)||x<100||x>max||Math.round(x*100)!==x*100)fail('วงเงินไม่ถูกต้อง',400);
 return x;
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
function riskPreview(order:ReturnType<typeof parseOrder>,quote:Awaited<ReturnType<typeof ticker>>,caps:{maxOrderTHB:number,maxDailyBuyTHB:number,maxDailySellTHB:number}){
  if(quote.frozen)fail('ตลาด Bitkub หยุดซื้อขายชั่วคราว',409);
  // Limit order price must be close to a fresh exchange quote, reducing fat-finger orders.
  if(Math.abs(order.price/quote.priceTHB-1)>.015)fail('ราคา Limit ห่างราคาตลาดเกิน 1.5%',409);
  // The preview is available while live mode is disabled; enforcement is repeated before submit.
  if(order.notional>caps.maxOrderTHB)fail('เกินวงเงินต่อคำสั่ง');
  return {side:order.side,orderType:'LIMIT',symbol:'BTC_THB',amount:order.amount,limitPriceTHB:order.price,
    estimatedNotionalTHB:order.notional,lastPriceTHB:quote.priceTHB,maxOrderTHB:caps.maxOrderTHB,
    dailyBuyCapTHB:caps.maxDailyBuyTHB,dailySellCapTHB:caps.maxDailySellTHB,liveEnabled:LIVE,quoteTime:quote.asOf};
}
async function handle(req:Request) {
  const url=new URL(req.url),action=url.searchParams.get('action')||'status';
  if(req.method==='GET'&&action==='ticker')return {ticker:await ticker()};
  if(req.method==='GET'&&action==='status')return {exchange:'BITKUB',marketData:true,walletConfigured:false,
    liveTradingEnabled:false,
    tradingMode:'MANUAL_LIMIT_ONLY',orderCapTHB:MAX_ORDER,asOf:new Date().toISOString()};
  if(!['GET','POST'].includes(req.method))fail('Method not supported',405);
  const uid=await authenticate(req);
  if(req.method==='GET'&&action==='setup-status'){
  const p=await platformLimits();
  return {setup:await ownerSettings(uid),serverLiveEnabled:p.enabled,serverCaps:p};
 }
  if(req.method==='GET'&&action==='balance')return {balance:await balances(await ownerPair(uid))};
  if(req.method==='GET'&&action==='orders'){
    const rows=await internalGet('bitbot_live_orders?select=request_id,side,amount,limit_price,notional_thb,status,created_at,exchange_order_id,exchange_status&user_id=eq.'+uid+'&order=created_at.desc&limit=100');
    return {orders:rows};
  }
  const body=await req.json().catch(()=>fail('Invalid JSON body'));
  if(action==='setup-save'){
    const apiKey=String(body?.apiKey||'').trim(),apiSecret=String(body?.apiSecret||'').trim();
    if(apiKey.length<8||apiKey.length>512||apiSecret.length<8||apiSecret.length>1024)fail('คีย์ไม่ถูกต้อง');
    await balances({apiKey,apiSecret}); // Only reads wallet. Do not save invalid keys.
    const out=await rpc('bitbot_store_exchange_key',{p_user_id:uid,p_api_key:apiKey,p_api_secret:apiSecret});
    return {saved:true,verified:true,keySuffix:out.keySuffix};
  }
  if(action==='setup-test'){
    const b=await balances(await ownerPair(uid));return {connected:true,asOf:b.asOf};
  }
  if(action==='setup-limits'){
    const maxOrder=cap(body?.maxOrderTHB,MAX_ORDER),maxBuy=cap(body?.maxDailyBuyTHB,MAX_BUY_DAY),maxSell=cap(body?.maxDailySellTHB,MAX_SELL_DAY);
    if(maxOrder>maxBuy||maxOrder>maxSell)fail('วงเงินต่อคำสั่งต้องไม่เกินวงเงินรายวัน');
    await rpc('bitbot_save_exchange_limits',{p_user_id:uid,p_max_order:maxOrder,p_max_buy:maxBuy,p_max_sell:maxSell});
    return {limitsSaved:true};
  }
  if(action==='setup-trading'){
    const enabled=body?.enabled===true;
    if(enabled){
      if(body?.acceptRisk!==true || body?.confirmText!=='เปิดเทรดเงินจริง')fail('ต้องยืนยันรับความเสี่ยงและพิมพ์คำว่า เปิดเทรดเงินจริง',400);
      const p=await platformLimits();
      if(!p.enabled)fail('เซิร์ฟเวอร์ยังไม่อนุญาตให้เปิดเทรดเงินจริง',403);
      await operator(uid);
      await balances(await ownerPair(uid)); // Validate the key still reads real wallet before enabling.
    }
    const out=await rpc('bitbot_set_account_trading',{p_user_id:uid,p_enabled:enabled});
    return {tradingEnabled:out.enabled===true,serverLiveEnabled:(await platformLimits()).enabled};
  }
  if(action==='setup-remove'){
    if(body?.confirm!=='REMOVE BITKUB KEY')fail('กรุณายืนยันการลบคีย์');
    await rpc('bitbot_remove_exchange_key',{p_user_id:uid});return {removed:true};
  }
  const caps=await ownerSettings(uid);
  const p=await platformLimits();
  if(action==='preview'){
    const order=parseOrder(body),quote=await ticker(),preview=riskPreview(order,quote,caps);
    if(order.notional>p.maxOrderTHB)fail('เกินเพดานเซิร์ฟเวอร์ต่อคำสั่ง ('+p.maxOrderTHB+' THB)',409);
    const ready=p.enabled&&caps.configured&&caps.tradingEnabled&&caps.adminApproved;
    return {preview:{...preview,maxOrderTHB:Math.min(p.maxOrderTHB,caps.maxOrderTHB)},maySubmit:ready,
      requirements:{walletConfigured:!!caps.configured,operatorApproved:!!caps.adminApproved,
        manuallyEnabled:!!caps.tradingEnabled,serverEnabled:!!p.enabled},
      warning:'Manual LIMIT orders only. Funds at risk. Fees and partial fills are not included in estimates.'};
  }
  if(action==='submit'){
    if(!p.enabled)fail('Live orders disabled by independent server kill switch',403);
    if(!p.maxOrderTHB||!p.maxDailyBuyTHB||!p.maxDailySellTHB)fail('Server risk caps not configured',503);
    await operator(uid);if(!caps.tradingEnabled)fail('บัญชียังไม่ได้เปิดเทรดจริงฝั่งเซิร์ฟเวอร์',403);
    const pair=await ownerPair(uid);
    if(body?.confirmText!=='I AUTHORIZE A REAL BITKUB ORDER')fail('ต้องยืนยันคำสั่งซื้อขายเงินจริงอย่างชัดเจน',400);
    const rid=String(body?.requestId||'');if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(rid))fail('Request ID invalid');
    const order=parseOrder(body),quote=await ticker();riskPreview(order,quote,caps);
    const maxOrder=Math.min(MAX_ORDER,p.maxOrderTHB,caps.maxOrderTHB),
      maxBuy=Math.min(MAX_BUY_DAY,p.maxDailyBuyTHB,caps.maxDailyBuyTHB),
      maxSell=Math.min(MAX_SELL_DAY,p.maxDailySellTHB,caps.maxDailySellTHB);
    if(order.notional>maxOrder)fail('วงเงินเกินที่ตั้ง');
    const balance=await balances(pair);
    if(order.side==='BUY' && balance.THB.available<order.amount*1.005)fail('ยอด THB ไม่พอพร้อมค่าธรรมเนียมสำรอง',409);
    if(order.side==='SELL' && balance.BTC.available<order.amount)fail('ยอด BTC ไม่เพียงพอ',409);
    await internalPost('rpc/bitbot_reserve_live_order',{
      p_request_id:rid,p_user_id:uid,p_side:order.side,p_amount:order.amount,p_limit_price:order.price,
      p_notional_thb:order.notional,p_max_order_thb:maxOrder,p_max_daily_buy_thb:maxBuy,p_max_daily_sell_thb:maxSell});
    let submitted=false;
    try {
      const payload={sym:'btc_thb',amt:order.amount,rat:order.price,typ:'limit',client_id:'bitbot-'+rid.slice(0,30)};
      submitted=true; // from here onward any network ambiguity is never retried automatically
      const result=await bitkubSigned('POST',order.side==='BUY'?'/api/v3/market/place-bid':'/api/v3/market/place-ask',payload,pair);
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
    const raw=await bitkubSigned('GET',path,null,await ownerPair(uid));
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