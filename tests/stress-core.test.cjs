const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');
const html=fs.readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8');
const match=html.match(/<script>\s*(\/\* Pure deterministic PAPER market simulator\.[\s\S]*?)<\/script>/);
assert(match,'Could not locate embedded pure Paper simulator core');
const ctx={module:{exports:{}},console,Date,Math,Number};vm.createContext(ctx);vm.runInContext(match[1],ctx,{timeout:10000});
const {PaperSimulator,generateBars}=ctx.module.exports;
const modes={off:{minAtr:0,minSlowSlope:-1,minTrendEfficiency:0},balanced:{},strict:{minAtr:.003,minSlowSlope:.00035,minTrendEfficiency:.18}};
let count=0, failures=[],totalDecisions=0,totalTrades=0,byScenario={};
for(const scenario of ['cycle','bull','bear','sideways','flash']){
 byScenario[scenario]={};
 for(let seedIx=0;seedIx<3;seedIx++){
  const bars=generateBars(scenario,560,(20261114+1001*seedIx+101*['cycle','bull','bear','sideways','flash'].indexOf(scenario))>>>0);
  for(const [cost,cfg] of [['normal',{fee:.0025,slippage:.0005}],['stress',{fee:.005,slippage:.003}]]){
   for(const [guard,g] of Object.entries(modes)){
     const sim=new PaperSimulator(scenario,{bars,source:'SYNTHETIC_HELDOUT',cfg:{...cfg,...g}});
     try{
      sim.run();const v=sim.snapshot();
      assert(v.done,'Must finish full test');assert(Number.isFinite(v.equity)&&v.equity>=0,'Invalid equity');
      assert(v.maxDrawdownPct>=0&&v.maxDrawdownPct<=100);assert(sim.trades.every(x=>x.mode==='PAPER_ONLY' && Number.isFinite(x.fee)&&x.fee>=0));
      assert(sim.trades.every(x=>x.cashAfter>=-0.001&&x.btcAfter>=0));
      assert(sim.trades.every(x=>x.side==='BUY'||x.side==='SELL'));
      assert.equal(sim.decisions.length,560-66,'One signal per closed candle');
      const wins=sim.trades.filter(x=>x.side==='SELL'&&x.pnl>0).length;
      assert.equal(v.buys,sim.trades.filter(x=>x.side==='BUY').length);
      assert.equal(v.sells,sim.trades.filter(x=>x.side==='SELL').length);
      byScenario[scenario][cost+'-'+guard]=[v.netPnl,v.buys,v.sells];
      count++;totalDecisions+=sim.decisions.length;totalTrades+=sim.trades.length;
     } catch(e){failures.push(scenario+'/'+seedIx+'/'+cost+'/'+guard+': '+e.message);}
   }
  }
 }
}
console.log(JSON.stringify({passed:count,failed:failures.length,decisions:totalDecisions,trades:totalTrades,scenarioSamples:byScenario,failures},null,2));
if(failures.length||count!==90)process.exit(1);