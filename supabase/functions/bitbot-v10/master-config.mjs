export const MASTER_SPEC='REA-MASTER-31.0.0';
export const STRATEGIES=Object.freeze([
 {id:'TREND_SHORT',name:'Trend Following',horizon:'SHORT',frame:5,confirm:15,stopATR:2,targetR:2.5,maxHoldMs:24*3600000},
 {id:'BREAKOUT_SHORT',name:'Breakout',horizon:'SHORT',frame:5,confirm:15,stopATR:2,targetR:3,maxHoldMs:24*3600000},
 {id:'PULLBACK_MEDIUM',name:'Pullback',horizon:'MEDIUM',frame:60,confirm:240,stopATR:2,targetR:3,maxHoldMs:14*86400000},
 {id:'MEAN_REVERSION_SHORT',name:'Mean Reversion',horizon:'SHORT',frame:5,confirm:15,stopATR:1.5,targetR:2,maxHoldMs:6*3600000,riskScale:.5},
 {id:'MOMENTUM_SHORT',name:'Momentum',horizon:'SHORT',frame:5,confirm:60,stopATR:2,targetR:3,maxHoldMs:12*3600000},
 {id:'SWING_MEDIUM',name:'Swing',horizon:'MEDIUM',frame:240,confirm:1440,stopATR:2.5,targetR:3,maxHoldMs:28*86400000},
 {id:'POSITION_LONG',name:'Position',horizon:'LONG',frame:1440,confirm:10080,stopATR:2.5,targetR:3,maxHoldMs:180*86400000}
].map(s=>Object.freeze({...s,version:MASTER_SPEC,mode:'VALIDATION_ONLY',canActivateLive:false})));
export const MASTER_DEFAULTS=Object.freeze({mode:'PAPER_ONLY',enabled:true,riskPerTrade:.01,maxPositions:5,dailyLossLimit:.03,portfolioRiskCap:.03,maxPositionFraction:.4,maxExposureFraction:.7,cashReserve:.3,maxDrawdown:.10,correlationThreshold:.8,minVolumeTHB:1000000,maxSpread:.003,minNetRewardRisk:1.5,slippage:.002,fee:.0025,strategies:STRATEGIES.map(s=>s.id),frames:[1,5,15,60,240,1440,10080],horizons:['SHORT','MEDIUM','LONG'],notifications:{inApp:true},exitPolicy:'BALANCED_VALIDATION',buyPaused:false,kill:'NONE'});
const numeric={riskPerTrade:[.001,.01],maxPositions:[1,5],dailyLossLimit:[.005,.03],portfolioRiskCap:[.005,.03],maxPositionFraction:[.05,.4],maxExposureFraction:[.1,.8],cashReserve:[.2,.9],maxDrawdown:[.02,.2],correlationThreshold:[.5,.95],minVolumeTHB:[250000,1e10],maxSpread:[.0001,.006],minNetRewardRisk:[1,5],slippage:[.001,.01]};
export function validateMasterConfig(input){
 const x=structuredClone(input),keys=Object.keys(MASTER_DEFAULTS).sort();
 if(!x||Object.keys(x).sort().join('|')!==keys.join('|')||x.mode!=='PAPER_ONLY'||x.fee!==.0025||typeof x.enabled!=='boolean'||typeof x.buyPaused!=='boolean'||!['NONE','ENTRY','ALL'].includes(x.kill)||!['BALANCED_VALIDATION','FIXED_BASELINE'].includes(x.exitPolicy))throw Error('INVALID_MASTER_CONFIG');
 for(const [k,[lo,hi]] of Object.entries(numeric))if(!Number.isFinite(x[k])||x[k]<lo||x[k]>hi||k==='maxPositions'&&!Number.isInteger(x[k]))throw Error('INVALID_MASTER_CONFIG_'+k);
 if(x.maxExposureFraction+x.cashReserve>1.0000001)throw Error('MASTER_CASH_RESERVE_CONFLICT');
 for(const [k,allowed] of [['strategies',STRATEGIES.map(s=>s.id)],['frames',[1,5,15,60,240,1440,10080]],['horizons',['SHORT','MEDIUM','LONG']]])if(!Array.isArray(x[k])||!x[k].length||new Set(x[k]).size!==x[k].length||x[k].some(v=>!allowed.includes(v)))throw Error('INVALID_MASTER_CONFIG_'+k);
 if(!x.notifications||Object.keys(x.notifications).join(',')!=='inApp'||typeof x.notifications.inApp!=='boolean')throw Error('INVALID_MASTER_NOTIFICATION_SETTINGS');return x;
}
