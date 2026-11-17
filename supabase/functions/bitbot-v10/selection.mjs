import {STABLE_ASSETS} from './intraday.mjs';
import {config,cycle,paperCycle,heldSymbol,validSymbol,trendAgent,newsAgent} from './engine.mjs';
const esc=s=>s.replace(/[.*+?^$()|[\]\\]/g,'\\$&');
export function plain(s=''){return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/<[^>]*>/g,' ').replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Math.min(0x10ffff,Number(n)))).replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&apos;|&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/\s+/g,' ').trim();}
export function parseRSS(xml,source,now=Date.now()){
 if(typeof xml!=='string'||xml.length>1000000||!/^\s*<\?xml|<rss\b|<feed\b/i.test(xml))throw Error('รูปแบบ RSS ไม่ถูกต้อง');
 const items=[];const tag=(s,n)=>s.match(new RegExp('<'+n+'(?:\\s[^>]*)?>([\\s\\S]*?)<\\/'+n+'>','i'))?.[1]||'';
 for(const match of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)){
 const raw=match[1],title=plain(tag(raw,'title')).slice(0,350),link=plain(tag(raw,'link')),publishedAt=Date.parse(plain(tag(raw,'pubDate')||tag(raw,'dc:date')));
 let u;try{u=new URL(link);}catch{continue;}
 if(u.protocol!=='https:'||!(u.hostname===source.host||u.hostname.endsWith('.'+source.host))||!title||!Number.isFinite(publishedAt)||publishedAt>now+300000||now-publishedAt>172800000)continue;
 items.push({title,url:u.href,publishedAt,source:source.name});
 if(items.length>=60)break;
 }
 return items;
}
const ambiguous=new Set(['ONE','NEAR','GAS','FUN','AI','ID','ON','MASK','S','L','W','T','C','M','IO','OP','THE','US','GO','ME','IN']);
export function matchesAsset(title,market){
 const asset=market.symbol.replace(/_THB$/,''),name=market.name||'';
 const symbolMatch=ambiguous.has(asset)?new RegExp('\\$'+esc(asset)+'\\b|\\('+esc(asset)+'\\)').test(title):new RegExp('(^|[^A-Za-z0-9])'+esc(asset)+'([^A-Za-z0-9]|$)','i').test(title);
 const nameMatch=name.length>3&&name.toUpperCase()!==asset&&new RegExp('(^|[^A-Za-z0-9])'+esc(name)+'([^A-Za-z0-9]|$)','i').test(title);
 return symbolMatch||nameMatch;
}
export function assessNews(m,feed,now=Date.now()){
 const ready=feed?.ready===true&&Number.isFinite(feed.fetchedAt)&&now-feed.fetchedAt<=1800000;
 const rows=ready?(feed.items||[]).filter(x=>Number.isFinite(x.publishedAt)&&x.publishedAt<=now+300000&&now-x.publishedAt<=86400000&&(matchesAsset(x.title+' '+(x.body||''),m)||/crypto (market|exchange).*(crash|hack|bankrupt)/i.test(x.title))):[];
 const high=/\b(hack(?:ed|s|ing|er|ers)?|exploit(?:ed|s|ation)?|delist(?:ing|ed|s)?|rug.?pull|fraud(?:ulent)?|insolven(?:t|cy)|bankrupt(?:cy)?|breach(?:es|ed)?|criminal|drain(?:ed|s)?)\b|trading (halt|suspend)|withdrawals? (halt|suspend)/i;
 const negative=/\b(tumbl|plung|crash|liquidat|sell.off|lawsuit|outflow|dump|unlock)/i;
 const positive=/\b(approv|adopt|partnership|inflow|upgrad|integrat)/i;
 const evidence=rows.map(h=>{
 const body=typeof h.body==='string'?h.body:'',sentences=(h.title+'. '+body).split(/(?<=[.!?])\s+/).filter(t=>matchesAsset(t,m)||/crypto (market|exchange)/i.test(t));
 const relevant=sentences.join(' ').slice(0,11000),severe=high.test(relevant);
 const denial=/\b(no evidence of|not (?:been )?(?:hacked|exploited)|denies? (?:the )?(?:hack|fraud)|hack(?:ed)? (?:rumou?r|claim) (?:denied|false))\b/i.test(relevant);
 return{...h,body:undefined,contentRead:body.length>=200,method:h.method||'HEADLINE_ONLY',risk:severe?(denial?'UNCERTAIN':'HIGH'):negative.test(relevant)?'NEGATIVE':'NEUTRAL',positive:positive.test(relevant)&&!severe};
 });
 const sources=new Set(evidence.map(x=>x.source)),confirmedPositive=evidence.filter(x=>x.positive&&x.contentRead).length;
 let score=0;for(const h of evidence)score+=h.risk==='HIGH'?-3:h.risk==='UNCERTAIN'||h.risk==='NEGATIVE'?-1:0;
 if(sources.size>=2&&confirmedPositive>=2)score++;
 return{ready,fetchedAt:feed?.fetchedAt||0,blocked:evidence.some(x=>x.risk==='HIGH'||x.risk==='UNCERTAIN'),score:Math.max(-1,Math.min(1,score/3)),headlines:evidence.slice(0,5),sourceCount:sources.size,contentRead:evidence.filter(x=>x.contentRead).length,uncertain:evidence.some(x=>x.risk==='UNCERTAIN'),method:'ENTITY_CONTEXT_RULES_WITH_CONTENT',model:'NO_LLM'};
}
export function rankUniverse(markets,c,news,now=Date.now()){
 c=config(c);
 return markets.filter(m=>validSymbol(m.symbol)).map(m=>{
 const reasons=[],spread=(m.ask-m.bid)/m.last;
 if(m.status!=='active'||m.frozen||m.buyFrozen)reasons.push('ตลาดปิดหรือระงับซื้อ');
 if(![m.bid,m.ask,m.last,m.volumeTHB].every(Number.isFinite)||m.bid<=0||m.ask<m.bid)reasons.push('ข้อมูลตลาดไม่ครบ');
 if(c.intraday&&STABLE_ASSETS.has(m.symbol.slice(0,-4)))reasons.push('เหรียญตรึงมูลค่า งดเปิดรอบเทรดสั้น');
 if(m.marketSource==='broker')reasons.push('API ซื้อขายปัจจุบันไม่รองรับเหรียญ broker');
 if(m.volumeTHB<c.minVolumeTHB)reasons.push('สภาพคล่องต่ำ');
 if(!Number.isFinite(spread)||spread>c.maxSpread)reasons.push('ส่วนต่างราคาสูง');
 if(m.change>25)reasons.push('ราคาวันนี้พุ่งสูง เสี่ยงไล่ราคา');
 const n=assessNews(m,news,now);if(!n.ready)reasons.push('ข่าวไม่พร้อม');if(n.blocked)reasons.push('พบข่าวเสี่ยง');
 const liquidity=Math.max(0,Math.min(1,(Math.log10(Math.max(1,m.volumeTHB))-5)/3));
 const score=30*liquidity+25*Math.max(0,1-spread/c.maxSpread)+10*Math.max(-1,Math.min(1,m.change/10))+n.score*5;
 return{...m,news:n,preScore:Number.isFinite(score)?score:-999,eligible:reasons.length===0,reasons};
 }).sort((a,b)=>Number(b.eligible)-Number(a.eligible)||b.preScore-a.preScore);
}
export function evaluate(m,state,c,now=Date.now()){
 const out=cycle(m,state,c,now),trend=out.trace.find(x=>x.agent==='trend'),n=out.trace.find(x=>x.agent==='news'),r=out.trace.find(x=>x.agent==='risk');
 const plan=r?.plan;
 const opportunity=plan?Math.max(-25,Math.min(15,(plan.range-plan.cost)*300)):0;
 const timing=trend?.bias==='UP'?35:trend?.bias==='FLAT'?10:0;
 const score=Math.max(0,Math.min(100,(m.preScore||0)+timing+opportunity-(trend?.volatility||0)*200+(out.order?.side==='BUY'?10:0)));
 return{market:m,out,score:Math.round(score*10)/10,signal:out.order?.side||'HOLD',reasons:r?.blocked?.length?r.blocked:[out.error||out.trace.find(x=>x.agent==='strategy')?.reason||'รอจังหวะ'],risk:r,news:n,trend};
}
export function portfolioCycle(bundle,state,c,now=Date.now(),paper=false){
 const hold=heldSymbol(state),markets=bundle?.markets||[],pool=hold?markets.filter(m=>m.symbol===hold):markets;
 const ranked=pool.map(m=>evaluate(m,state,c,now)).sort((a,b)=>Number(b.signal==='BUY')-Number(a.signal==='BUY')||b.score-a.score);
 const chosen=ranked[0];
 if(!chosen)return{state:structuredClone(state),order:null,error:hold?'ยังอ่านข้อมูลเหรียญที่ถือไม่ได้':'ไม่มีข้อมูลตลาดพร้อมวิเคราะห์',trace:[],ranking:[],market:null};
 const out=paper?paperCycle(chosen.market,state,c,now):chosen.out;
 const scan={agent:'coordinator',reason:hold?'ดูแล '+hold+' ก่อนเปิดสถานะใหม่':'คัดกรอง '+(bundle.universeCount||markets.length)+' คู่ / วิเคราะห์ '+markets.length+' คู่ / เลือก '+chosen.market.symbol+' คะแนน '+chosen.score,selected:chosen.market.symbol,score:chosen.score,universeCount:bundle.universeCount||markets.length,ranking:ranked.slice(0,12).map(x=>({symbol:x.market.symbol,score:x.score,signal:x.signal,reasons:x.reasons}))};
 out.trace=out.trace.map(x=>x.agent==='coordinator'?scan:x);
 return{...out,market:chosen.market,ranking:scan.ranking};
}
