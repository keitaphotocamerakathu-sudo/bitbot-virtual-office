export const thaiDay=ms=>new Date(ms+25200000).toISOString().slice(0,10);
export function periodKey(day,period){if(period==='year')return day.slice(0,4);if(period==='month')return day.slice(0,7);if(period==='week'){const d=new Date(day+'T00:00:00Z'),n=(d.getUTCDay()+6)%7;d.setUTCDate(d.getUTCDate()-n);return d.toISOString().slice(0,10);}return day;}
export function aggregateFills(fills,period='day'){
 const groups=new Map();for(const f of fills||[]){const at=Date.parse(f.filled_at||f.at),fee=Number(f.fee),pnl=Number(f.realized||0);if(!Number.isFinite(at)||!Number.isFinite(fee)||fee<0||!Number.isFinite(pnl))continue;
 const key=periodKey(thaiDay(at),period),row=groups.get(key)||{period:key,realized:0,fees:0,fills:0,buy:0,sell:0};row.realized+=pnl;row.fees+=fee;row.fills++;if(f.side==='BUY')row.buy++;if(f.side==='SELL')row.sell++;groups.set(key,row);}
 return[...groups.values()].sort((a,b)=>a.period.localeCompare(b.period));
}
export function closedStatistics(rounds=[]){const usable=rounds.filter(Number.isFinite),wins=usable.filter(x=>x>0),losses=usable.filter(x=>x<0),gain=wins.reduce((a,b)=>a+b,0),loss=-losses.reduce((a,b)=>a+b,0);return{rounds:usable.length,wins:wins.length,losses:losses.length,winRate:usable.length?wins.length/usable.length:null,averageProfit:wins.length?gain/wins.length:null,averageLoss:losses.length?loss/losses.length:null,profitFactor:loss?gain/loss:gain?null:null,noLosingSamples:gain>0&&loss===0};}
export function reconstructRounds(fills){
 const ordered=(fills||[]).slice().sort((a,b)=>Date.parse(a.filled_at)-Date.parse(b.filled_at)),positions=new Map(),rounds=[];let incomplete=false;
 for(const f of ordered){const p=positions.get(f.symbol)||{qty:0,pnl:0},q=Number(f.qty);if(!Number.isFinite(q)||q<=0)continue;
 if(f.side==='BUY')p.qty+=q;else if(f.side==='SELL'){if(q>p.qty+1e-8){incomplete=true;continue;}p.qty=Math.max(0,p.qty-q);p.pnl+=Number(f.realized||0);if(p.qty<1e-8){rounds.push(p.pnl);p.pnl=0;}}positions.set(f.symbol,p);}
 return{rounds,incomplete};
}
export function reportingSummary(state,fills=[]){const tracked=fills.reduce((v,f)=>v+Number(f.realized||0),0),closed=reconstructRounds(fills);return{realized:state.realized||0,trackedRealized:tracked,legacyRealized:(state.realized||0)-tracked,statistics:closedStatistics(closed.rounds),roundCoverageIncomplete:closed.incomplete,trackingSince:state.trackingSince||null,maxDrawdown:state.maxDrawdownSeen??null,scope:'BOT_ALLOCATED_CAPITAL_EXCLUDES_DEPOSITS_WITHDRAWALS_AND_MANUAL_TRADES'};}
