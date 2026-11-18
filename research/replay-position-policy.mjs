// Quotes-only counterfactual: reports observed trigger opportunities, never synthetic fills.
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import {updatePaperPosition,modeledNet,POSITION_PROTOCOL} from '../supabase/functions/bitbot-v10/rea-position-policy.mjs';
export function replayPositionQuotes(position,quotes){
 if(!position||!Array.isArray(quotes)||!Number.isFinite(position.openedAt))throw Error('POSITION_AND_ARCHIVED_QUOTES_REQUIRED');
 const variants=['BASELINE','PROTECT'].map(policy=>({policy,position:structuredClone(position),trigger:null,observedQuotes:0}));let last=0;
 for(const row of quotes){
  if(!Number.isSafeInteger(row.at)||row.at<=last)throw Error('NON_CHRONOLOGICAL_QUOTES');last=row.at;
  if(row.at<position.openedAt||row.symbol!==position.symbol||!Number.isFinite(row.observedAt)||row.observedAt>row.at||row.at-row.observedAt>30000)continue;
  if(!Number.isFinite(row.bid)||!Number.isFinite(row.ask)||row.bid<=0||row.ask<row.bid)continue;
  for(const v of variants){if(v.trigger)continue;v.observedQuotes++;v.position=updatePaperPosition(v.position,row,row.at,{policy:v.policy}).position;
   const reason=row.bid<=v.position.stop?(v.position.protection?.armed?'PROFIT_PROTECTION':'STOP_LOSS'):row.bid>=v.position.target?'TAKE_PROFIT':null;
   if(reason)v.trigger={at:row.at,bid:row.bid,reason,modeledNetAtObservedBid:modeledNet(v.position,row.bid),assumedFilled:false};
  }
 }
 return{protocol:POSITION_PROTOCOL,method:'ARCHIVED_BID_TRIGGER_COUNTERFACTUAL',mode:'READ_ONLY_RESEARCH',symbol:position.symbol,from:quotes[0]?.at??null,to:quotes.at(-1)?.at??null,variants:variants.map(v=>({policy:v.policy,observedQuotes:v.observedQuotes,trigger:v.trigger,lastStop:v.position.stop,observedPeakNet:v.position.protection?.peakNet??null})),canTrade:false,limitations:['RETROSPECTIVE_ILLUSTRATION_NOT_OUT_OF_SAMPLE_PROOF','QUOTES_DO_NOT_ESTABLISH_ORDER_BOOK_DEPTH_OR_FILL','NO_INTRAMINUTE_PATH_OR_EXCHANGE_LATENCY','MODEL_INCLUDES_FEES_SLIPPAGE_AND_ROUNDING_RESERVE','NOT_REALIZED_PNL_OR_PROMISE_OF_PROFIT']};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){const data=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));console.log(JSON.stringify(data.map(x=>replayPositionQuotes(x.position,x.quotes)),null,2));}
