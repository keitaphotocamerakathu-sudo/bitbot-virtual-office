// Public Bitkub WebSocket only. Receipt timestamps are explicit, never exchange timestamps.
const valid=s=>typeof s==='string'&&/^[A-Z0-9]{1,16}_THB$/.test(s);
export function parseTicker(data,allowed,now=Date.now()){
 const match=/^market\.ticker\.thb_([a-z0-9]+)$/i.exec(data?.stream||'');
 if(!match)return null;const symbol=match[1].toUpperCase()+'_THB';if(!allowed.has(symbol))return null;
 const last=Number(data.last),bid=Number(data.highestBid),ask=Number(data.lowestAsk);
 if(![last,bid,ask].every(Number.isFinite)||last<=0||bid<=0||ask<bid)return null;
 return{symbol,last,bid,ask,observedAt:now,receivedAt:now,source:'BITKUB_PUBLIC_WS',timestampSource:'LOCAL_RECEIPT',frozen:Number(data.isFrozen||0)!==0};
}
export class PublicTickerCollector{
 constructor({Socket=globalThis.WebSocket,clock=()=>Date.now(),schedule=setTimeout,cancel=clearTimeout,random=Math.random,onQuote=()=>{},onStatus=()=>{}}={}){Object.assign(this,{Socket,clock,schedule,cancel,random,onQuote,onStatus});this.symbols=new Set();this.sessions=[];this.quotes=new Map();this.stopped=true;}
 select(symbols){const next=[...new Set(symbols)].filter(valid).sort().slice(0,32);if(!this.stopped&&next.join(',')===[...this.symbols].join(','))return;this.stop();this.symbols=new Set(next);this.stopped=false;
  for(let i=0;i<next.length;i+=8){const session={symbols:new Set(next.slice(i,i+8)),attempt:0,lastMessage:0,socket:null,timer:null,watch:null,generation:0};this.sessions.push(session);this.connect(session);}
 }
 connect(s){if(this.stopped)return;s.generation++;const generation=s.generation,stream=[...s.symbols].map(x=>'market.ticker.thb_'+x.slice(0,-4).toLowerCase()).join(',');let socket;
  try{socket=new this.Socket('wss://api.bitkub.com/websocket-api/'+stream);}catch{return this.retry(s);}s.socket=socket;this.onStatus({status:'CONNECTING',symbols:[...s.symbols]});
  const watchdog=()=>{this.cancel(s.watch);s.watch=this.schedule(()=>{if(s.socket===socket){this.onStatus({status:'STALE',symbols:[...s.symbols]});socket.close();}},35000);};watchdog();
  socket.onmessage=event=>{if(this.stopped||s.socket!==socket||generation!==s.generation)return;try{if(typeof event.data!=='string'||event.data.length>50000)return;const q=parseTicker(JSON.parse(event.data),s.symbols,this.clock());if(!q)return;this.quotes.set(q.symbol,q);s.lastMessage=this.clock();s.attempt=0;watchdog();this.onQuote(q);}catch{}};
  socket.onerror=()=>socket.close();socket.onclose=()=>{if(this.stopped||s.socket!==socket||generation!==s.generation)return;this.cancel(s.watch);for(const symbol of s.symbols)this.quotes.delete(symbol);this.onStatus({status:'DISCONNECTED',symbols:[...s.symbols]});this.retry(s);};
 }
 retry(s){if(this.stopped)return;this.cancel(s.timer);const delay=Math.min(30000,1000*2**Math.min(5,s.attempt++))+Math.floor(this.random()*500);s.timer=this.schedule(()=>this.connect(s),delay);}
 snapshot(){const now=this.clock();return[...this.quotes.values()].filter(q=>now-q.observedAt<=30000&&q.observedAt<=now+5000);}
 stop(){this.stopped=true;for(const s of this.sessions){this.cancel(s.timer);this.cancel(s.watch);if(s.socket){s.socket.onclose=null;s.socket.onmessage=null;s.socket.close();}}this.sessions=[];this.quotes.clear();}
}
