import fs from 'node:fs';
export function createTransport({supabaseURL=process.env.SUPABASE_URL,keyFile=process.env.REA_SUPABASE_SERVICE_KEY_FILE||'/run/secrets/supabase_service_key',key:provided,fetchFn=fetch,clock=()=>Date.now()}={}){
 if(!supabaseURL||!/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(supabaseURL))throw Error('SUPABASE_URL_REQUIRED');
 const key=provided??fs.readFileSync(keyFile,'utf8').trim();if(!key)throw Error('BACKEND_KEY_REQUIRED');let blockedUntil=0;
 async function json(target,options={},timeout=15000){const u=new URL(target),method=options.method||'GET';
  if(u.protocol!=='https:')throw Error('HTTPS_REQUIRED');
  if(u.hostname==='api.bitkub.com'){
   if(method!=='GET'||!/^\/(api\/v3\/market\/(symbols|ticker|depth|trades)|tradingview\/history)$/.test(u.pathname))throw Error('PAPER_ONLY_EXCHANGE_WRITE_DENIED');
   if(clock()<blockedUntil)throw Object.assign(Error('BITKUB_RATE_LIMIT_COOLDOWN'),{status:429});
  }else if(u.origin!==supabaseURL||!u.pathname.startsWith('/rest/v1/'))throw Error('HTTP_DESTINATION_DENIED');
  const r=await fetchFn(u,{...options,redirect:'error',signal:AbortSignal.timeout(timeout)});
  if(r.status===429&&u.hostname==='api.bitkub.com'){const retry=r.headers.get('retry-after'),seconds=Number(retry),date=Date.parse(retry||'');blockedUntil=clock()+Math.max(30000,Number.isFinite(seconds)?seconds*1000:Number.isFinite(date)?date-clock():30000);}
  if(!r.ok)throw Object.assign(Error('HTTP '+r.status),{status:r.status});return r.json();
 }
 const headers={apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'};
 const db=(path,body,method='POST')=>json(supabaseURL+'/rest/v1/'+path,{method,headers:{...headers,Prefer:'return=representation'},...(body!==undefined?{body:JSON.stringify(body)}:{})});
 async function newsFetch(target,options={}){const u=new URL(target);if(u.protocol!=='https:'||!['coindesk.com','cointelegraph.com'].some(h=>u.hostname===h||u.hostname.endsWith('.'+h)))throw Error('NEWS_HOST_DENIED');return fetchFn(u,{...options,redirect:'error'});}
 return{json,db,read:path=>db(path,undefined,'GET'),rpc:(name,args={})=>db('rpc/'+name,args),newsFetch};
}
