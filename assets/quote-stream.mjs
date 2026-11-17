// Public ticker display only. These quotes never enter a trading decision or state.
export class QuoteStream{
 constructor(onData,{Socket=globalThis.WebSocket,schedule=(fn,ms)=>globalThis.setTimeout(fn,ms),cancel=id=>globalThis.clearTimeout(id)}={}){this.onData=onData;this.Socket=Socket;this.schedule=schedule;this.cancel=cancel;this.attempt=0;}
 select(symbol){if(symbol===this.symbol)return;this.stop();if(!/^[A-Z0-9]{1,16}_THB$/.test(symbol))return;this.symbol=symbol;this.attempt=0;this.connect();}
 stop(){this.symbol=null;this.cancel(this.timer);this.cancel(this.watchdog);const socket=this.socket;this.socket=null;if(socket){socket.onclose=null;socket.close();}}
 connect(){if(!this.symbol||!this.Socket)return;const symbol=this.symbol,stream='market.ticker.thb_'+symbol.split('_')[0].toLowerCase();let socket;
 try{socket=new this.Socket('wss://api.bitkub.com/websocket-api/'+stream);}catch{this.retry();return;}this.socket=socket;this.onData({status:'CONNECTING',symbol});
 const stale=()=>{this.cancel(this.watchdog);this.watchdog=this.schedule(()=>{if(this.socket===socket){this.onData({status:'REST_FALLBACK',symbol});socket.close();}},45000);};stale();
 socket.onmessage=e=>{if(this.socket!==socket||this.symbol!==symbol)return;try{const d=JSON.parse(e.data),last=Number(d.last),bid=Number(d.highestBid),ask=Number(d.lowestAsk);if(d.stream!==stream||![last,bid,ask].every(Number.isFinite)||last<=0||bid<=0||ask<bid)return;this.attempt=0;stale();this.onData({status:'LIVE',symbol,last,bid,ask,receivedAt:Date.now(),timestampSource:'LOCAL_RECEIPT'});}catch{}};
 socket.onerror=()=>socket.close();socket.onclose=()=>{if(this.socket!==socket)return;this.cancel(this.watchdog);this.onData({status:'REST_FALLBACK',symbol});this.retry();};
 }
 retry(){this.cancel(this.timer);const delay=Math.min(60000,1000*2**Math.min(6,this.attempt++));this.timer=this.schedule(()=>this.connect(),delay);}
}
