// Bitkub THB sell settlement: truncate net proceeds to satang, per fill.
// Decimal arithmetic avoids binary floating-point crossing a satang boundary.
export const THB_SETTLEMENT='BITKUB-THB-SETTLEMENT-30.0';
function decimal(value){
 const s=String(value);if(s.length>100||!/^(?:\d+(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?$/i.test(s))throw Error('INVALID_SETTLEMENT_DECIMAL');
 const [base,exp='0']=s.toLowerCase().split('e'),[whole,fraction='']=base.split('.'),exponent=Number(exp),scale=fraction.length-exponent;
 if(!Number.isInteger(exponent)||Math.abs(scale)>40)throw Error('INVALID_SETTLEMENT_DECIMAL');
 return scale>=0?{n:BigInt(whole+fraction),d:10n**BigInt(scale)}:{n:BigInt(whole+fraction)*10n**BigInt(-scale),d:1n};
}
export function settleSellTHB(amount,rate,fee=0,credit=0){
 const a=decimal(amount),r=decimal(rate),f=decimal(fee),c=decimal(credit),netFee=f.n*c.d-c.n*f.d,denominator=a.d*r.d*f.d*c.d,numerator=a.n*r.n*f.d*c.d-netFee*a.d*r.d;
 if(a.n<=0n||r.n<=0n||netFee<0n||numerator<0n)throw Error('INVALID_SELL_SETTLEMENT');
 const satang=numerator*100n/denominator;if(satang>BigInt(Number.MAX_SAFE_INTEGER))throw Error('SETTLEMENT_OUT_OF_RANGE');
 return Number(satang)/100;
}
export function feeAfterCreditTHB(fee,credit=0){
 const f=decimal(fee),c=decimal(credit),n=f.n*c.d-c.n*f.d;if(n<0n)throw Error('INVALID_FEE_CREDIT');return Number(n)/Number(f.d*c.d);
}
export function walletReconciliation(s,w,now=Date.now()){
 const at=w?.at,base={protocol:THB_SETTLEMENT,source:'BITKUB_API_V4_BALANCES',at,checkedAt:now,canTrade:false};
 if(!Number.isFinite(at)||at>now+5000||now-at>20000)return{...base,status:'STALE',reason:'WALLET_TIMESTAMP_STALE'};
 if(![w?.THB?.available,w?.THB?.reserved,s?.cash].every(x=>Number.isFinite(x)&&x>=0))return{...base,status:'INVALID',reason:'INVALID_THB_BALANCE'};
 const cents=x=>Math.round(x*100),available=cents(w.THB.available),reserved=cents(w.THB.reserved),bot=cents(s.cash),shortPositions=(s.positions||[]).filter(p=>{const a=w[p.symbol.replace(/_THB$/,'')];return !a||![a.available,a.reserved].every(x=>Number.isFinite(x)&&x>=0)||a.available+a.reserved+1e-8<p.qty;}).map(p=>p.symbol);
 const delta=available+reserved-bot,ready=delta>=0&&!shortPositions.length;
 return{...base,status:ready?'READY':'MISMATCH',reason:shortPositions.length?'BOT_ASSET_SHORTFALL':delta<0?'BOT_THB_EXCEEDS_EXCHANGE':null,walletAvailableTHB:available/100,walletReservedTHB:reserved/100,walletTotalTHB:(available+reserved)/100,botCashTHB:bot/100,differenceTHB:delta/100,unallocatedTHB:Math.max(0,delta)/100,shortPositions};
}
