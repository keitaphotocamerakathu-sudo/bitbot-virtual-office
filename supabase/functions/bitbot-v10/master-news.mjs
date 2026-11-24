// Evidence classification, not an LLM-generated trade instruction.
const names=['SECURITY','EXCHANGE','LISTING','DELISTING','MACRO_RATES','MACRO_INFLATION','PROJECT'];
const rules=[/hack|exploit|breach|attack|โจมตี|แฮ็ก/i,/exchange|bitkub|binance|coinbase/i,/(?<!de)list(?:ing|ed)|เข้าซื้อขาย/i,/delist|suspend|ระงับ|เพิกถอน/i,/federal reserve|\bfed\b|interest rate|ดอกเบี้ย/i,/inflation|\bcpi\b|เงินเฟ้อ/i,/upgrade|mainnet|hard fork|โครงการ/i];
const allowed=new Set(['CoinDesk','Cointelegraph','Federal Reserve','US Bureau of Labor Statistics','Bitkub']);
export function newsIntelligence(bundle,now){
 const feed=bundle?.news||{},seen=new Set(),accepted=[],rejected=[];
 for(const x of feed.items||[]){let url;try{url=new URL(x.url);}catch{rejected.push({reason:'INVALID_SOURCE_URL'});continue;}const key=url.href.replace(/[?#].*$/,'').toLowerCase(),age=now-x.publishedAt;
  const hostOK=x.source==='CoinDesk'&&/(^|\.)coindesk.com$/.test(url.hostname)||x.source==='Cointelegraph'&&/(^|\.)cointelegraph.com$/.test(url.hostname)||x.source==='Federal Reserve'&&url.hostname==='www.federalreserve.gov'||x.source==='US Bureau of Labor Statistics'&&/(^|\.)bls.gov$/.test(url.hostname)||x.source==='Bitkub'&&/(^|\.)bitkub.com$/.test(url.hostname);
  if(!allowed.has(x.source)||!hostOK||url.protocol!=='https:'||!Number.isFinite(x.publishedAt)||age<0||age>21600000||seen.has(key)){rejected.push({url:key,reason:seen.has(key)?'DUPLICATE':age<0?'FUTURE_PUBLICATION':age>21600000?'OLD_NEWS':'UNVERIFIED_SOURCE'});continue;}seen.add(key);
  const title=String(x.title||'').slice(0,240),body=String(x.body||''),rumor=/rumou?r|unconfirmed|speculat|ข่าวลือ|ยังไม่ยืนยัน/i.test(title),contentRead=x.contentRead===true||body.length>=200;
  const tags=names.filter((_,i)=>rules[i].test(title+' '+body.slice(0,4000))),negative=/hack|exploit|delist|lawsuit|ban\b|crash|โจมตี|ระงับ/i.test(title),positive=/approv|adopt|launch|upgrade|อนุมัติ/i.test(title);
  accepted.push({title,url:key,source:x.source,publishedAt:x.publishedAt,contentRead,verification:rumor?'RUMOR':contentRead?'SOURCE_CONTENT_READ':'HEADLINE_ONLY',sentiment:negative?'NEGATIVE':positive?'POSITIVE':'NEUTRAL',tags,canTriggerBuy:false,canVeto:!rumor&&contentRead&&tags.some(t=>['SECURITY','DELISTING'].includes(t))});
 }
 return{at:now,status:accepted.length?'AVAILABLE':'WAITING',method:'SOURCE_TIME_DEDUP_CONTENT_RULES',items:accepted.slice(0,20),rejected:rejected.slice(0,20),coverage:Object.fromEntries(names.map(n=>[n,accepted.some(a=>a.tags.includes(n))])),canTrade:false,canCreateStrategy:false};
}
