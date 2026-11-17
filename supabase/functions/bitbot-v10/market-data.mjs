// Public exchange evidence only. An absent candle is never assumed to mean no trades.
export const VERIFIED_DATA_POLICY='verified-v17';
const number=x=>x!==null&&x!==''&&['number','string'].includes(typeof x)?Number(x):NaN;
export function parseHistory(raw,minutes=5,now=Date.now()){
 if(raw?.s==='no_data')return [];
 if(raw?.s!=='ok'||!['t','o','h','l','c','v'].every(k=>Array.isArray(raw[k])&&raw[k].length===raw.t.length))throw Error('ข้อมูล OHLCV ต้นทางไม่ครบ');
 const width=minutes*60000,map=new Map();
 raw.t.forEach((t,i)=>{const b={t:number(t)*1000,o:number(raw.o[i]),h:number(raw.h[i]),l:number(raw.l[i]),c:number(raw.c[i]),v:number(raw.v[i]),source:'BITKUB_HISTORY'};
  if(b.t+width>now)return;
  if(!validBar(b,width))throw Error('ข้อมูล OHLCV ต้นทางผิดรูปแบบ');
  const prior=map.get(b.t);if(prior&&['o','h','l','c','v'].some(k=>prior[k]!==b[k]))throw Error('แท่งราคาซ้ำมีข้อมูลไม่ตรงกัน');map.set(b.t,b);
 });return [...map.values()].sort((a,b)=>a.t-b.t);
}
function validBar(b,width){return ['t','o','h','l','c','v'].every(k=>Number.isFinite(b[k]))&&b.t>0&&b.t%width===0&&b.l>0&&b.v>=0&&b.h>=Math.max(b.o,b.c)&&b.l<=Math.min(b.o,b.c);}
export function parseTrades(raw,now=Date.now()){
 if(raw?.error!==0||!Array.isArray(raw.result))throw Error('รายการซื้อขายต้นทางไม่พร้อม');
 const rows=raw.result.map((x,index)=>{let t=number(x?.[0]);if(t<1e11)t*=1000;const price=number(x?.[1]),qty=number(x?.[2]);
  if(!Number.isFinite(t)||t<=0||t>now+5000||!Number.isFinite(price)||price<=0||!Number.isFinite(qty)||qty<=0||!['BUY','SELL'].includes(String(x?.[3]).toUpperCase()))throw Error('รายการซื้อขายต้นทางผิดรูปแบบ');
  return{t,price,qty,index};
 });
 // API returns latest trades first. Tied timestamps retain the exchange's list order.
 if(rows.some((x,i)=>i&&x.t>rows[i-1].t))throw Error('ลำดับรายการซื้อขายต้นทางผิดปกติ');
 return{rows,oldest:rows.at(-1)?.t??null,newest:rows[0]?.t??null,observedAt:now};
}
export function recoverHistory(bars,tradeEvidence,{minutes=5,now=Date.now(),previous=[],limit=360}={}){
 const width=minutes*60000,end=Math.floor(now/width)*width,start=end-width*limit,map=new Map(),counts={recovered:0,verifiedEmpty:0,retained:0,unresolved:0};
 const evidence=tradeEvidence&&now-tradeEvidence.observedAt<=30000&&tradeEvidence.observedAt<=now+5000?tradeEvidence:null;
 for(const b of bars)if(b.t>=start&&b.t<end&&validBar(b,width))map.set(b.t,b);
 // Previously verified records are preserved only inside the same bounded history window.
 for(const b of previous)if(!map.has(b.t)&&b.t>=start&&b.t<end&&validBar(b,width)&&['VERIFIED_NO_TRADES','BITKUB_TRADES'].includes(b.source)&&b.evidence?.oldest<b.t&&b.evidence?.newest>=b.t+width&&!(evidence?.oldest<b.t&&evidence?.newest>=b.t+width)){map.set(b.t,b);counts.retained++;}
 const grouped=new Map();for(const row of evidence?.rows||[]){const t=Math.floor(row.t/width)*width,list=grouped.get(t)||[];list.push(row);grouped.set(t,list);}
 let prior=null;const output=[];
 for(let t=start;t<end;t+=width){let b=map.get(t);
  if(!b&&evidence?.oldest<t&&evidence?.newest>=t+width){
   const trades=(grouped.get(t)||[]).slice().reverse(),proof={oldest:evidence.oldest,newest:evidence.newest,observedAt:evidence.observedAt};
   if(trades.length){b={t,o:trades[0].price,h:Math.max(...trades.map(x=>x.price)),l:Math.min(...trades.map(x=>x.price)),c:trades.at(-1).price,v:trades.reduce((s,x)=>s+x.qty,0),source:'BITKUB_TRADES',evidence:proof};counts.recovered++;}
   else if(prior&&prior.t+width===t){b={t,o:prior.c,h:prior.c,l:prior.c,c:prior.c,v:0,source:'VERIFIED_NO_TRADES',evidence:proof};counts.verifiedEmpty++;}
  }
  if(b){output.push(b);prior=b;}else if(prior){counts.unresolved++;}
 }
 return{candles:output,repair:counts};
}
export function historyQuality(bars,minutes=5,now=Date.now(),minimum=160,window=25){
 const width=minutes*60000,recent=bars.slice(-window),last=bars.at(-1),gaps=[];
 for(let i=1;i<recent.length;i++)if(recent[i].t-recent[i-1].t!==width)gaps.push({from:recent[i-1].t+width,to:recent[i].t,missing:Math.max(1,(recent[i].t-recent[i-1].t)/width-1)});
 const malformed=recent.some(b=>!validBar(b,width)),fresh=!!last&&last.t+width<=now&&now-(last.t+width)<=2*width;
 const reason=bars.length<minimum?'มีแท่งปิด '+bars.length+'/'+minimum:malformed?'ข้อมูล OHLCV ผิดรูปแบบ':gaps.length?'ยังยืนยันช่วงขาดไม่ได้ '+gaps.reduce((s,x)=>s+x.missing,0)+' ช่วง':!fresh?'แท่งปิดล่าสุดยังไม่อัปเดต':'ข้อมูลพร้อม';
 return{ready:bars.length>=minimum&&recent.length>=window&&!malformed&&!gaps.length&&fresh,bars:bars.length,lastClosedAt:last?last.t+width:null,gaps,reason,verifiedEmpty:recent.filter(b=>b.source==='VERIFIED_NO_TRADES').length,recovered:recent.filter(b=>b.source==='BITKUB_TRADES').length};
}
export function candidateQueue(ranked,held=[],health=new Map(),now=Date.now()){
 const eligible=ranked.filter(m=>m.eligible),healthy=eligible.filter(m=>health.get(m.symbol)?.ready!==false),retry=eligible.filter(m=>health.get(m.symbol)?.ready===false),core=healthy.slice(0,8),rest=healthy.slice(8),rotate=list=>{const at=list.length?Math.floor(now/60000)*4%list.length:0;return [...list.slice(at),...list.slice(0,at)];};
 const required=[...held,'BTC_THB'].map(s=>ranked.find(m=>m.symbol===s)).filter(Boolean);
 return [...new Map([...required,...core,...rotate(rest),...rotate(retry)].map(m=>[m.symbol,m])).values()].slice(0,24);
}
