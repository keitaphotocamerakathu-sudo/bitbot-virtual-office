// Replay archived, timestamped market snapshots; never reconstruct an order book from OHLC.
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import {initialREA,cycleREA,analyticsREA} from '../supabase/functions/bitbot-v10/rea-core.mjs';
export function replayREA(snapshots){
 if(!Array.isArray(snapshots)||!snapshots.length)throw Error('ARCHIVED_SNAPSHOTS_REQUIRED');
 let previous=0,state=initialREA(snapshots[0].at);const curve=[],events=[];
 for(const row of snapshots){if(!Number.isSafeInteger(row.at)||row.at<=previous)throw Error('NON_CHRONOLOGICAL_INPUT');previous=row.at;
  const markets=(row.markets||[]).map(m=>{if(m.observedAt>row.at||m.depth?.at>row.at)throw Error('FUTURE_MARKET_DATA');return{...m,candles:(m.candles||[]).filter(b=>b.t+300000<=row.at)};});
  const out=cycleREA(state,{markets},row.at);state=out.state;curve.push({at:row.at,equity:state.equity});events.push(...out.events.map(e=>({...e,at:row.at})));
 }
 return{mode:'PAPER_ONLY',method:'ARCHIVED_SNAPSHOT_REPLAY',snapshotCount:snapshots.length,summary:analyticsREA(state),state,curve,events,limitations:['LIMIT_QUEUE_AND_LATENCY_APPROXIMATED','NOT_PROFIT_VALIDATION','REQUIRES_OUT_OF_SAMPLE_EVALUATION']};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){if(!process.argv[2])throw Error('Usage: node research/rea-backtest.mjs archived-snapshots.json');console.log(JSON.stringify(replayREA(JSON.parse(fs.readFileSync(process.argv[2],'utf8'))),null,2));}
