import { CASE_LIMIT, WINDOWS, observeChart } from './master-chart-cases.mjs';
import { CHART_ARCHIVE } from './master-chart-archive.mjs';
import { LEARNING_PROTOCOL } from './rea-learning.mjs';

export const EXPERIENCE_VERSION = 'PAPER_EXPERIENCE_32.0';
const DAY = 86_400_000;
const CHART_MINIMUM = 24;
const PAPER_MINIMUM = 30;
const MAX_RECENT_CLOSES = 100;
const cents = value => Math.round(value * 100) / 100;
const total = values => values.reduce((sum, value) => sum + value, 0);
const mean = values => values.length ? total(values) / values.length : null;
const earlierFamily = { TREND_SHORT: 'TREND_FOLLOWING', BREAKOUT_SHORT: 'BREAKOUT', MEAN_REVERSION_SHORT: 'MEAN_REVERSION' };

// The previous experiments share many entries. One baseline provides examples
// without treating sibling portfolios or different rule versions as independent trades.
export function baselineLessons(experiments, now) {
  const source = experiments?.mode === 'PAPER_ONLY' ? experiments.accounts?.EXIT_BASELINE?.lessons : null;
  const records = new Map();
  for (const item of Array.isArray(source) ? source : []) {
    if (item?.protocol !== LEARNING_PROTOCOL || item.status !== 'VERIFIED' || item.mode !== 'PAPER_ONLY' ||
        item.simulation !== true || typeof item.positionId !== 'string' || !item.positionId ||
        !Number.isSafeInteger(item.closedAt) || !Number.isSafeInteger(item.reviewedAt) ||
        item.closedAt > item.reviewedAt || item.reviewedAt > now || !Number.isFinite(item.netPnL) ||
        !item.evidence?.buyFillIds?.length || !item.evidence?.sellFillIds?.length) continue;
    records.set(item.positionId, { id: item.positionId, symbol: item.symbol, strategyId: item.strategy, closedAt: item.closedAt,
      netTHB: item.netPnL, feesTHB: item.metrics?.feesPaid ?? null, exitReasons: item.evidence.exitReasons || [] });
  }
  return { profile: 'EXIT_BASELINE', available: Array.isArray(source),
    records: [...records.values()].sort((a, b) => b.closedAt - a.closedAt).slice(0, 8) };
}

// A ranking hint requires both chronological halves to agree on the sign of the
// mean and a majority of outcomes. Effect sizes are Paper policy, not fitted odds.
function consistency(values, minimum) {
  if (values.length < minimum) return 0;
  const split = Math.floor(values.length / 2);
  function side(part) {
    const sign = Math.sign(total(part));
    return part.filter(value => Math.sign(value) === sign).length > part.length / 2 ? sign : 0;
  }
  const first = side(values.slice(0, split));
  return first === side(values.slice(split)) ? first : 0;
}

export function chartRankingPoints(values, starts) {
  const days = new Set(starts.map(at => Math.floor(at / DAY))).size;
  return days >= 3 ? 2 * consistency(values, CHART_MINIMUM) : 0;
}

function chartEvidence(market, horizon, config, now, archive) {
  const window = WINDOWS[horizon];
  const input = window.minutes === 5
    ? (market.dataQuality?.ready ? market.candles : [])
    : market.masterFrames?.[window.minutes];
  const study = observeChart(input, window, now);
  const quoteValid = market.marketSource === 'exchange' && market.bid > 0 &&
    market.ask >= market.bid && Number.isFinite(market.ask) && Number.isFinite(market.observedAt) &&
    now >= market.observedAt && now - market.observedAt <= 30_000;
  const evidence = {
    direction: study.direction, minutes: window.minutes * window.bars, contextAt: study.contextAt,
    samples: 0, archived: 0, recentFeed: 0, costFactor: null, meanNetMove: null,
    positive: 0, oldestStart: null, latestEnd: null, exampleStarts: [], points: 0
  };
  if (!study.direction || !quoteValid) return evidence;

  // At the decision point only fully resolved outcomes preceding the current
  // context are eligible. A timestamp denotes one case even across two sources.
  const merged = new Map();
  function add(rows, source) {
    for (const [start, label, ppm] of rows) {
      if (start + study.duration > study.contextFrom || start < now - 365 * DAY) continue;
      const prior = merged.get(start);
      if (!prior) merged.set(start, { start, label, ppm, source });
      else if (prior.label !== label || prior.ppm !== ppm) prior.conflict = true;
    }
  }
  add(archive?.markets[market.symbol]?.[horizon] || [], 'ARCHIVE');
  add(study.rows, 'FEED');
  const matches = Array.from(merged.values())
    .filter(row => !row.conflict && row.label === study.direction)
    .sort((a, b) => a.start - b.start).slice(-CASE_LIMIT);
  // Costs for an illustrative open-to-close long: current spread, two fees and
  // the configured slippage allowance split across both sides. No assumed fill.
  const halfSlip = config.slippage / 2;
  const factor = market.bid / market.ask * (1 - config.fee) ** 2 * (1 - halfSlip) / (1 + halfSlip);
  const values = matches.map(row => (1 + row.ppm / 1_000_000) * factor - 1);
  return { ...evidence, samples: matches.length, archived: matches.filter(row => row.source === 'ARCHIVE').length,
    recentFeed: matches.filter(row => row.source === 'FEED').length, costFactor: factor,
    meanNetMove: mean(values), positive: values.filter(value => value > 0).length,
    oldestStart: matches[0]?.start ?? null, latestEnd: matches.length ? matches.at(-1).start + study.duration : null,
    exampleStarts: matches.slice(-3).map(row => row.start), points: chartRankingPoints(values, matches.map(row => row.start)) };
}

// Capture the actual Paper debits while their fills are retained. A long-held
// position keeps this basis on its entry order through restart and fill compaction.
export function recordPaperLessons(book, fills, events) {
  const orders = new Map(book.orders.map(order => [order.id, order]));
  const entryIds = new Set(book.positions.map(position => position.positionId));
  const closures = events.filter(event => event.kind === 'CLOSED_TRADE');
  for (const event of closures) entryIds.add(event.id);
  for (const id of entryIds) {
    const entry = orders.get(id);
    if (entry?.side !== 'BUY' || !entry.fillCount || entry.lessonBasis?.fills === entry.fillCount) continue;
    const buys = book.fills.filter(fill => fill.orderId === id && fill.side === 'BUY' && fill.simulation === true);
    if (buys.length !== entry.fillCount || new Set(buys.map(fill => fill.id)).size !== buys.length ||
        !buys.every(fill => fill.cashDeltaTHB < 0 && fill.qty > 0 && Number.isFinite(fill.fee) && fill.fee >= 0)) continue;
    entry.lessonBasis = { fills: buys.length, paidTHB: cents(-total(buys.map(fill => fill.cashDeltaTHB))),
      feesTHB: cents(total(buys.map(fill => fill.fee))), qty: total(buys.map(fill => fill.qty)) };
  }
  for (const event of closures) {
    const trade = book.closed.find(trade => trade.id === event.id);
    if (!trade) continue;
    const entry = orders.get(trade.id);
    const basis = entry?.lessonBasis?.fills === entry?.fillCount ? entry?.lessonBasis : null;
    const isExit = fill => fill.side === 'SELL' && fill.simulation === true && orders.get(fill.orderId)?.positionId === trade.id;
    const last = fills.findLast(isExit);
    const sells = book.fills.filter(isExit);
    const precision = 10 ** -(entry?.qtyScale ?? 8);
    const completeFees = basis && sells.length && sells.every(fill => Number.isFinite(fill.fee) && fill.fee >= 0) &&
      Math.abs(total(sells.map(fill => fill.qty)) - basis.qty) < precision / 2;
    const lesson = { version: EXPERIENCE_VERSION, exitPolicy: entry?.exitPolicy ?? null,
      exitReason: last?.reason ?? null, entryPaidTHB: basis?.paidTHB ?? null,
      returnAfterCosts: basis?.paidTHB > 0 ? trade.pnl / basis.paidTHB : null,
      feesTHB: completeFees ? cents(basis.feesTHB + total(sells.map(fill => fill.fee))) : null };
    trade.lesson = lesson;
    event.lesson = lesson;
  }
}

function recentClosed(book, now) {
  const unique = new Map();
  for (const trade of book.closed) {
    if (trade.simulation !== true || !trade.id || !Number.isFinite(trade.pnl) ||
        !Number.isSafeInteger(trade.openedAt) || !Number.isSafeInteger(trade.closedAt) ||
        trade.openedAt > trade.closedAt || trade.closedAt > now) continue;
    unique.set(trade.id, trade);
  }
  return [...unique.values()].sort((a, b) => a.closedAt - b.closedAt || a.id.localeCompare(b.id)).slice(-MAX_RECENT_CLOSES);
}

function paperEvidence(trades, signal, forward, now) {
  const similar = trades.filter(trade => trade.closedAt < now && trade.strategyVersion === signal.strategyVersion &&
    trade.strategyId === signal.strategyId && trade.horizon === signal.horizon && trade.regime === signal.regime &&
    trade.lesson?.version === EXPERIENCE_VERSION && trade.lesson.exitPolicy === signal.exitPolicy &&
    Number.isFinite(trade.lesson.returnAfterCosts));
  const values = similar.map(trade => trade.lesson.returnAfterCosts);
  const enoughCoverage = forward.daysObserved >= 7 && forward.coverage >= 0.9;
  const days = new Set(similar.map(trade => Math.floor((trade.closedAt + 7 * 3_600_000) / DAY))).size;
  return { samples: similar.length, wins: similar.filter(trade => trade.pnl > 0).length,
    netTHB: cents(total(similar.map(trade => trade.pnl))), meanNetReturn: mean(values),
    latestClosedAt: similar.at(-1)?.closedAt ?? null, exampleIds: similar.slice(-3).map(trade => trade.id),
    points: enoughCoverage && days >= 3 ? 3 * consistency(values, PAPER_MINIMUM) : 0 };
}

export function rankByExperience(signals, markets, book, config, validation, now, { seed = CHART_ARCHIVE, earlierBook = null } = {}) {
  if (book.mode !== 'PAPER_ONLY') throw Error('PAPER_EXPERIENCE_REQUIRES_PAPER_BOOK');
  const archive = seed && seed.availableAt <= now ? seed : null;
  const closed = recentClosed(book, now);
  const baseline = baselineLessons(earlierBook, now);
  const marketBySymbol = new Map(markets.map(market => [market.symbol, market]));
  const charts = new Map();
  const ranking = signals.map(signal => {
    const key = signal.symbol + ':' + signal.horizon;
    if (!charts.has(key)) charts.set(key, chartEvidence(marketBySymbol.get(signal.symbol), signal.horizon, config, now, archive));
    const chart = charts.get(key);
    const paper = paperEvidence(closed, signal, validation.forward, now);
    const adaptiveWeight = validation.weights[signal.strategyId] ?? 1;
    const basePriority = signal.score * adaptiveWeight;
    const adjustment = signal.eligible ? chart.points + paper.points : 0;
    const priority = Math.min(100, Math.max(0, (signal.score + adjustment) * adaptiveWeight));
    const family = earlierFamily[signal.strategyId];
    const reference = family ? baseline.records.find(row => row.closedAt < now &&
      row.symbol === signal.symbol && row.strategyId === family) ?? null : null;
    const experience = { version: EXPERIENCE_VERSION, asOf: now, chart, paper, reference, basePriority,
      priority, appliedPoints: cents(priority - basePriority), eligible: signal.eligible, canActivateLive: false };
    return { ...signal, adaptiveWeight, experience };
  }).sort((a, b) => Number(b.eligible) - Number(a.eligible) || b.experience.priority - a.experience.priority ||
    b.experience.basePriority - a.experience.basePriority || a.signalId.localeCompare(b.signalId));

  const latestLessons = closed.slice(-8).reverse().map(trade => ({
    id: trade.id, symbol: trade.symbol, strategyId: trade.strategyId, regime: trade.regime, closedAt: trade.closedAt,
    netTHB: trade.pnl, feesTHB: trade.lesson?.feesTHB ?? null, exitReason: trade.lesson?.exitReason ?? null
  }));
  return { ranking, report: { version: EXPERIENCE_VERSION, mode: 'PAPER_ONLY', status: 'READY', at: now,
    archiveCases: archive?.retained ?? 0, archiveSymbols: Object.keys(archive?.markets || {}), archiveDigest: archive?.dataDigest ?? null,
    archiveFrom: archive?.from ?? null, archiveTo: archive?.to ?? null, closedInMemory: closed.length,
    lifetimeClosed: book.stats.closedTrades, recentLimit: MAX_RECENT_CLOSES, chartMinimum: CHART_MINIMUM,
    paperMinimum: PAPER_MINIMUM, changedPriorities: ranking.filter(signal => signal.experience.appliedPoints !== 0).length,
    latestLessons, baseline, canActivateLive: false } };
}
