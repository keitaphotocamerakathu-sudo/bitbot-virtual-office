import {analyticsREA,cycleREA,quoteOK,validateREA} from './rea-core.mjs';

const active = order => ['OPEN','PARTIAL'].includes(order.status);

function monitoredAccount(account) {
  try {
    const state = validateREA(account.state);
    const symbols = new Set([...state.positions, ...state.orders.filter(active)].map(item => item.symbol));
    return {account, symbols};
  } catch {
    return {account, symbols: null};
  }
}

function hasDepth(market, now) {
  const book = market?.depth;
  const validLevel = row => {
    const price = Number(row?.price ?? row?.[0]);
    const size = Number(row?.base_volume ?? row?.[1]);
    return Number.isFinite(price) && price > 0 && Number.isFinite(size) && size > 0;
  };
  return book && Number.isFinite(book.at) && book.at >= now - 30000 && book.at <= now + 5000
    && [book.bids,book.asks].every(rows => Array.isArray(rows) && rows.some(validLevel));
}

export function createRiskWatchdog({rpc, quotes, clock = () => Date.now()}) {
  async function inspect({account, symbols}, allMarkets) {
    const now = clock();
    const reasons = new Set();
    let actionable = false, committed = false;
    try {
      if (!symbols) throw Error('INVALID_RISK_STATE');
      const markets = allMarkets.filter(market => symbols.has(market.symbol));
      const bySymbol = new Map(markets.map(market => [market.symbol,market]));
      for (const symbol of symbols) {
        const market = bySymbol.get(symbol);
        if (!quoteOK(market,now)) reasons.add('WATCHDOG_MARKET_DATA_UNAVAILABLE');
        else if (!hasDepth(market,now)) reasons.add('WATCHDOG_DEPTH_UNAVAILABLE');
      }
      const out = cycleREA(account.state,{markets},now,{riskOnly:true,operationalLock:account.operational_lock===true});
      if (out.state.baselinePending) reasons.add('MIDNIGHT_BASELINE_UNVERIFIED');
      if (symbols.size && out.health !== 'OK' && !reasons.size) reasons.add('WATCHDOG_RISK_STATE_UNAVAILABLE');
      actionable = out.fills.length>0 || out.events.some(e => ['ORDER','CANCEL','DAILY_LOSS_LOCK'].includes(e.kind))
        || (out.events.some(e => e.kind==='EMERGENCY_STOP') && account.state.orders.some(active));
      if (actionable) {
        const health = reasons.size ? 'SAFE_MODE' : 'OK';
        const latest = {...account.latest,summary:analyticsREA(out.state),watchdog:{at:now,health,events:out.events},
          quotes:markets.map(m=>({symbol:m.symbol,bid:m.bid,ask:m.ask,at:m.observedAt,source:m.source})),lane:'risk-watchdog'};
        try {
          committed = await rpc('rea_risk_checkpoint',{p_uid:account.user_id,p_revision:account.revision,p_state:out.state,p_latest:latest,p_events:out.events,p_fills:out.fills,p_at:now});
        } catch { committed = false; }
        if (!committed) reasons.add('WATCHDOG_CHECKPOINT_UNCONFIRMED');
      }
    } catch { reasons.add('WATCHDOG_RISK_STATE_UNAVAILABLE'); }
    const health = reasons.size ? 'SAFE_MODE' : symbols.size ? 'OK' : 'IDLE';
    let recorded = false;
    try {
      recorded = await rpc('rea_risk_observation',{p_uid:account.user_id,p_at:now,p_status:health,p_reasons:[...reasons]});
    } catch { /* A failed write is not a heartbeat. Its last confirmed timestamp ages normally. */ }
    return {actionable,committed,health:recorded ? health : 'SAFE_MODE',recorded,reasons:[...reasons]};
  }
  async function run() {
    const accounts = (await rpc('rea_risk_accounts',{})).map(monitoredAccount);
    const symbols = [...new Set(accounts.flatMap(row => [...(row.symbols || [])]))];
    let markets = [];
    if (symbols.length) {
      try { markets = await quotes(symbols); } catch { /* Each affected account records its own missing quote. */ }
    }
    const results = [];
    for (const account of accounts) results.push(await inspect(account,markets));
    return {mode:'PAPER_ONLY',accounts:accounts.length,results};
  }
  return {run};
}
