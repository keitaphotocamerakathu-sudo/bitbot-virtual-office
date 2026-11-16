// Browser-only dashboard; NEVER contains Bitkub credentials or signing logic.
(()=>{
 'use strict';
 const $=id=>document.getElementById(id);
 const fmt=(n,d=2)=>Number.isFinite(Number(n))?Number(n).toLocaleString('th-TH',{minimumFractionDigits:d,maximumFractionDigits:d}):'—';
 const cfg=window.BITBOT_CLOUD_CONFIG||{};
 const gateway='https://lrxrigimdaedfemqheug.supabase.co/functions/v1/bitkub-gateway';
 let client=null,session=null,quote=null,settings=null,preview=null,orders=[];
 function show(msg,bad=false){$('gatewayStatus').textContent=msg;$('gatewayStatus').className='status '+(bad?'error':'');}
 function readableError(e){
   const m=String(e?.message||'');
   if(e?.code==='invalid_credentials'||/invalid login credentials/i.test(m))return 'อีเมลหรือรหัสผ่าน Bitbot ไม่ถูกต้อง หากจำไม่ได้ให้ใช้ “ตั้งรหัสผ่าน Bitbot ใหม่” (ไม่ใช่รหัสผ่าน Bitkub)';
   if(e?.status===429||e?.code==='over_email_send_rate_limit')return 'การส่งอีเมลถึงข้อจำกัด Supabase กรุณารอก่อนขอใหม่';
   return m||'ไม่สามารถดำเนินการได้';
 }
 async function getClient(){
   if(!client){const {createClient}=await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.57.4/+esm');
     client=createClient(cfg.url,cfg.publishableKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
     client.auth.onAuthStateChange((_event,s)=>{const old=session?.user?.id;session=s;updateLogin();if(old!==session?.user?.id)setTimeout(()=>status().catch(()=>{}),0);});
     const {data}=await client.auth.getSession();session=data.session;updateLogin();
   }return client;
 }
 function updateLogin(){const user=session?.user;
   $('sessionWho').textContent=user?'ล็อกอิน Bitbot: '+(user.email||'บัญชีที่ยืนยันแล้ว'):'ยังไม่ได้ล็อกอิน Bitbot';
   $('uid').textContent=user?.id||'—';$('logout').disabled=!user;
   $('liveLoginPanel').style.display=user?'none':'';
   const wait=window.BitbotOtpGuard?.remaining?.()||0;
   $('emailLogin').disabled=!!user||wait>0;
   $('emailLogin').textContent=wait?'รอ '+Math.ceil(wait/60)+' นาที ก่อนส่งเมลใหม่':'ส่งลิงก์ล็อกอิน';
   $('otpWait').textContent=wait?'Supabase จำกัดการส่งอีเมล โปรดรออีกประมาณ '+Math.ceil(wait/60)+' นาที หรือใช้รหัสผ่านที่มีอยู่':'หากขึ้น 429 กรุณาอย่ากดขออีเมลซ้ำ เพราะโควตารวมของโปรเจกต์อาจเต็ม';
   $('passwordLogin').disabled=!!user;
   $('resetPassword').disabled=!!user||wait>0;
   $('balanceBtn').disabled=!user;$('ordersBtn').disabled=!user;$('previewBtn').disabled=!user;
   $('reconcileBtn').disabled=!user;
 }
 async function api(action,{method='GET',data,auth=false}={}){
   const headers={Accept:'application/json',apikey:cfg.publishableKey};
   if(data)headers['Content-Type']='application/json';
   if(auth){await getClient();const {data:info,error}=await client.auth.getSession();if(error||!info.session?.access_token)throw Error('กรุณาเข้าสู่ระบบ Bitbot Cloud ก่อน');session=info.session;headers.Authorization='Bearer '+session.access_token;}
   const ac=new AbortController();const timer=setTimeout(()=>ac.abort(),17000);
   try{const r=await fetch(gateway+'?action='+encodeURIComponent(action),{method,headers,body:data?JSON.stringify(data):undefined,cache:'no-store',signal:ac.signal});
     const x=await r.json();if(!r.ok||x.ok===false)throw Error(x.error||'API error '+r.status);return x;
   }finally{clearTimeout(timer);}
 }
 async function ticker(){try{const r=await api('ticker');quote=r.ticker;
   if(!quote?.priceTHB||!quote.bidTHB||!quote.askTHB)throw Error('ราคาขาดข้อมูล');
   $('livePrice').textContent='฿'+fmt(quote.priceTHB);$('liveAsk').textContent='฿'+fmt(quote.askTHB);$('liveBid').textContent='฿'+fmt(quote.bidTHB);
   $('liveChange').textContent=fmt(quote.change24hPct)+'%';$('feedBadge').textContent=quote.frozen?'ตลาดหยุด':'BITKUB LIVE';
   $('quoteAge').textContent='ข้อมูล API Bitkub • ตรวจสอบล่าสุด '+new Date(quote.asOf).toLocaleTimeString('th-TH',{timeZone:'Asia/Bangkok'});
   if(!$('limitPrice').value)$('limitPrice').value=Number(quote.priceTHB).toFixed(2);
 }catch(e){$('feedBadge').textContent='FEED ERROR';$('quoteAge').textContent=e.message;}}
 async function status(){try{const x=await api('status');settings=x;
   let keyInfo='กรุณาเข้าสู่ระบบและตั้งค่าผ่าน ⚙ ตั้งค่า Bitkub',cap=x.orderCapTHB,approved=false;
   if(session?.user){const a=await api('setup-status',{auth:true});keyInfo=a.setup?.configured?'บันทึกเข้ารหัสแล้ว • ลงท้าย '+a.setup.keySuffix:'ยังไม่ได้ตั้ง API Key';cap=a.setup?.maxOrderTHB||cap;approved=Boolean(a.setup?.adminApproved&&a.setup?.tradingEnabled&&a.serverLiveEnabled);}
   settings.liveTradingEnabled=approved;
   show('ข้อมูลราคา: Bitkub API จริง\nเชื่อม Wallet: '+keyInfo+'\nส่งคำสั่งเงินจริง: '+(approved?'เปิดสิทธิ์แล้ว — ยังต้องกดยืนยันแต่ละคำสั่ง':session?.user?'ยังปิดอยู่ — เปิดจากหน้า ⚙ ตั้งค่า Bitkub':'กรุณาเข้าสู่ระบบ')+'\nรูปแบบคำสั่ง: LIMIT เท่านั้น / ยืนยันด้วยตนเอง'+(cap?'\nวงเงินต่อคำสั่งที่ตั้งไว้: ฿'+fmt(cap):''));
 }catch(e){show('Backend ยังไม่พร้อม: '+e.message,true);}}
 async function login(){const email=$('loginEmail').value.trim();if(!/^\S+@\S+\.\S+$/.test(email)){show('กรุณากรอกอีเมล',true);return;}
   try{const c=await getClient();
     await window.BitbotOtpGuard.send(()=>c.auth.signInWithOtp({email,options:{emailRedirectTo:location.origin+location.pathname}}));
     show('ส่งลิงก์เข้าสู่ระบบแล้ว กรุณาตรวจอีเมลและอย่ากดส่งซ้ำ');}
   catch(e){show(e.message+(e.cooldown?' • โปรดรอให้ Supabase คืนโควตา หรือใช้รหัสผ่าน':'') ,true);}
   finally{updateLogin();}}
 async function logout(){try{const c=await getClient();await c.auth.signOut();session=null;updateLogin();show('ออกจากระบบแล้ว');}catch(e){show(e.message,true);}}
 async function balance(){try{const x=await api('balance',{auth:true});const a=x.balance;
   $('balanceOutput').textContent='ยอด THB ใช้ได้: ฿'+fmt(a.THB.available)+' • ติดคำสั่ง: ฿'+fmt(a.THB.reserved)+'\nBTC ใช้ได้: '+fmt(a.BTC.available,8)+' • ติดคำสั่ง: '+fmt(a.BTC.reserved,8)+'\nข้อมูลจาก Bitkub Wallet v4';
 }catch(e){$('balanceOutput').textContent='ยังอ่าน Wallet ไม่ได้: '+e.message;}}
 function payload(){return{side:$('side').value,limitPriceTHB:Number($('limitPrice').value),...($('side').value==='BUY'?{amountTHB:Number($('amount').value)}:{btcQuantity:Number($('amount').value)})};}
 async function preflight(){preview=null;$('tradeConfirm').classList.add('hidden');$('submitBtn').disabled=true;
   try{const x=await api('preview',{method:'POST',auth:true,data:payload()});preview=x.preview;
     $('previewOutput').textContent='ตรวจสอบ: '+preview.side+' BTC_THB\nจำนวน: '+fmt(preview.amount,preview.side==='BUY'?2:8)+(preview.side==='BUY'?' THB':' BTC')+'\nราคา Limit: ฿'+fmt(preview.limitPriceTHB)+'\nมูลค่าโดยประมาณ: ฿'+fmt(preview.estimatedNotionalTHB)+'\nราคาตลาดขณะตรวจ: ฿'+fmt(preview.lastPriceTHB)+'\nคำสั่งจริง: '+(x.maySubmit?'เปิดอยู่ (มีความเสี่ยง)':'ยังไม่เปิด');
     if(x.maySubmit){$('tradeConfirm').classList.remove('hidden');}else show('ตรวจสอบคำสั่งสำเร็จ แต่การส่งคำสั่งจริงยังถูกล็อกที่ Backend');
   }catch(e){$('previewOutput').textContent='ตรวจสอบไม่ได้: '+e.message;}
 }
 async function submit(){if(!preview||!settings?.liveTradingEnabled) return; if($('confirmPhrase').value.trim()!=='เทรดเงินจริง')return;
   const sent={...payload(),requestId:crypto.randomUUID(),confirmText:'I AUTHORIZE A REAL BITKUB ORDER'};
   if(sent.side!==preview.side||Number(sent.limitPriceTHB)!==Number(preview.limitPriceTHB))return show('ข้อมูลเปลี่ยนหลังตรวจ กรุณาตรวจสอบใหม่',true);
   if(!window.confirm('กำลังส่ง '+sent.side+' ด้วยเงินจริงไป Bitkub ยืนยันหรือไม่?'))return;
   $('submitBtn').disabled=true;preview=null;$('tradeConfirm').classList.add('hidden');
   try{const x=await api('submit',{method:'POST',auth:true,data:sent});show('Bitkub รับคำสั่งแล้ว เลขออร์เดอร์: '+x.exchangeOrderId+' • โปรดตรวจสถานะการจับคู่');await history();}
   catch(e){show('คำสั่งไม่สำเร็จหรือสถานะไม่ชัดเจน: '+e.message+'\nห้ามส่งซ้ำจนกว่าจะตรวจสอบบัญชี Bitkub และรายการ Audit',true);await history().catch(()=>{});}
 }
 async function history(){try{const x=await api('orders',{auth:true});orders=x.orders||[];
   $('orderHistory').replaceChildren();if(!orders.length){const tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=6;td.textContent='ยังไม่มีคำสั่งจริง';tr.append(td);$('orderHistory').append(tr);return;}
   for(const o of orders){const tr=document.createElement('tr');for(const v of [new Date(o.created_at).toLocaleString('th-TH',{timeZone:'Asia/Bangkok'}),o.side,fmt(o.amount,8),fmt(o.limit_price),o.status,String(o.exchange_order_id||o.request_id)]){const td=document.createElement('td');td.textContent=v;tr.append(td);}$('orderHistory').append(tr);}
 }catch(e){show('โหลด Audit ไม่สำเร็จ: '+e.message,true);}}
 async function reconcile(){const item=orders.find(o=>['OPEN','UNKNOWN','RESERVED'].includes(o.status));if(!item){show('ยังไม่มีออร์เดอร์ที่ต้องตรวจ');return;}
   try{const x=await api('reconcile',{method:'POST',auth:true,data:{requestId:item.request_id}});show('Bitkub Order '+x.requestId+' สถานะ: '+x.exchangeStatus);await history();}
   catch(e){show('ไม่สามารถตรวจคำสั่ง: '+e.message,true);}
 }
 function onSide(){preview=null;$('tradeConfirm').classList.add('hidden');$('previewOutput').textContent='กรุณาตรวจสอบคำสั่งใหม่';
   const sell=$('side').value==='SELL';$('amountLabel').textContent=sell?'จำนวน Bitcoin ที่ต้องการขาย (BTC)':'จำนวนเงินบาทที่ต้องการใช้ซื้อ (THB)';
   $('amount').step=sell?'0.00000001':'0.01';$('amount').placeholder=sell?'0.001':'100';$('amount').value='';}
 async function passwordLogin(){
   const email=$('loginEmail').value.trim(),password=$('loginPassword').value;
   if(!/^\S+@\S+\.\S+$/.test(email)||!password){show('กรุณากรอกอีเมลและรหัสผ่าน Bitbot',true);return;}
   try{const c=await getClient();const {error}=await c.auth.signInWithPassword({email,password});if(error)throw error;
     show('✅ เข้าสู่ระบบสำเร็จโดยไม่ต้องส่งอีเมล');await status();}
   catch(e){show('เข้าสู่ระบบไม่สำเร็จ: '+readableError(e),true);}
   finally{$('loginPassword').value='';updateLogin();}
 }
 $('loginPassword').addEventListener('keydown',e=>{if(e.key==='Enter')$('passwordLogin').click();});
 $('resetPassword').onclick=async()=>{
    const email=$('loginEmail').value.trim();
    if(!/^\S+@\S+\.\S+$/.test(email)){show('กรุณากรอกอีเมล Bitbot ที่ลงทะเบียนไว้',true);return;}
    try{const c=await getClient();
      await window.BitbotOtpGuard.send(()=>c.auth.resetPasswordForEmail(email,{redirectTo:new URL('./bitkub-setup.html',location.href).href}));
      show('หากอีเมลนี้ลงทะเบียนไว้ Supabase จะส่งลิงก์ตั้งรหัสผ่านใหม่ กรุณาตรวจอีเมลและตั้งรหัสผ่านในหน้า Setup');}
    catch(e){show(readableError(e),true);}finally{updateLogin();}
  };
 $('refreshQuote').onclick=ticker;$('refreshStatus').onclick=status;$('emailLogin').onclick=login;$('passwordLogin').onclick=passwordLogin;$('logout').onclick=logout;$('balanceBtn').onclick=balance;$('ordersBtn').onclick=history;
 $('previewBtn').onclick=preflight;$('submitBtn').onclick=submit;$('reconcileBtn').onclick=reconcile;$('side').onchange=onSide;
 $('confirmPhrase').oninput=()=>{$('submitBtn').disabled=!preview||$('confirmPhrase').value.trim()!=='เทรดเงินจริง';};
 for(const key of ['side','amount','limitPrice'])$(key).addEventListener('input',()=>{preview=null;$('tradeConfirm').classList.add('hidden');});
 updateLogin();ticker();status();getClient().catch(e=>show('ระบบล็อกอินมีปัญหา: '+e.message,true));setInterval(()=>{if(!document.hidden){ticker();updateLogin();}},20000);
})();