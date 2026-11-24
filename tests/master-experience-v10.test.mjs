import test from 'node:test';
import assert from 'node:assert/strict';
import { observeChart, WINDOWS } from '../supabase/functions/bitbot-v10/master-chart-cases.mjs';
import { CHART_ARCHIVE } from '../supabase/functions/bitbot-v10/master-chart-archive.mjs';
import { EXPERIENCE_VERSION, rankByExperience } from '../supabase/functions/bitbot-v10/master-experience.mjs';
import { LEARNING_PROTOCOL } from '../supabase/functions/bitbot-v10/rea-learning.mjs';
import { initialMasterBook } from '../supabase/functions/bitbot-v10/master-execution.mjs';
import { MASTER_DEFAULTS, MASTER_SPEC } from '../supabase/functions/bitbot-v10/master-config.mjs';
import { runMaster } from '../supabase/functions/bitbot-v10/master-orchestrator.mjs';
import { masterJournal } from '../supabase/functions/bitbot-v10/master-service.mjs';
import { NOW, market, quote } from './master-fixtures.mjs';

const DAY = 86_400_000;
const HOUR = 3_600_000;
const WIDTH = 300_000;
const now = Math.floor(NOW / DAY) * DAY;
const validation = { forward: { daysObserved: 9, coverage: 0.95 }, weights: {} };
const freshBook = () => initialMasterBook(now - 60 * DAY);
const neutralBars = (count, end = now) => Array.from({ length: count }, (_, i) => ({
  t: end - (count - i) * WIDTH, o: 10, c: 10, h: 11, l: 9, v: 5
}));
function candidate(symbol, score = 80, eligible = true) {
  return { symbol, signalId: 'signal-' + symbol, score, eligible, regime: 'SIDEWAY', horizon: 'SHORT',
    strategyId: 'TREND_SHORT', strategyVersion: MASTER_SPEC, exitPolicy: 'BALANCED_VALIDATION' };
}
function instrument(symbol, candles = neutralBars(12)) {
  return { symbol, marketSource: 'exchange', observedAt: now, bid: 10, ask: 10.01, dataQuality: { ready: true }, candles };
}
function pack(symbolReturns) {
  const markets = {};
  for (const [symbol, returns] of Object.entries(symbolReturns)) {
    markets[symbol] = { SHORT: returns.map((ppm, i) => [now - (returns.length - i + 1) * DAY, 'RANGE', ppm]) };
  }
  return { availableAt: now - DAY, retained: Object.values(symbolReturns).flat().length, markets };
}
const rank = (signals, markets, book = freshBook(), seed = null, v = validation) =>
  rankByExperience(signals, markets, book, MASTER_DEFAULTS, v, now, { seed });

test('price cases use the prior 12 bars for context and a strictly later non-overlapping outcome', () => {
  const bars = neutralBars(48);
  bars[23].c = 10.5;
  const observed = observeChart(bars, WINDOWS.SHORT, now);
  assert.equal(observed.rows.length, 3);
  assert.deepEqual(observed.rows[0], [now - 3 * HOUR, 'RANGE', 50_000]);
  assert(observed.rows.every(([t], i, rows) => !i || t >= rows[i-1][0] + HOUR));
  assert.deepEqual(observeChart([...bars, { ...bars[47], t: now, c: 999, h: 999 }], WINDOWS.SHORT, now), observed);
  const future = [...bars, ...neutralBars(12, now + HOUR)];
  assert.deepEqual(observeChart(future, WINDOWS.SHORT, now), observed);
});

test('gaps, stale contexts, empty volume and contradictory duplicates cannot become training cases', () => {
  const bars = neutralBars(24);
  const observed = input => observeChart(input, WINDOWS.SHORT, now);
  assert.equal(observed(bars).rows.length, 1);
  assert.deepEqual(observed([...bars, bars[19]]), observed(bars));
  for (const input of [bars.filter((_, i) => i !== 19), [...bars, { ...bars[19], c: 10.1 }],
    bars.map((b, i) => i === 19 ? { ...b, v: 0 } : b)]) {
    assert.equal(observed(input).rows.length, 0);
    assert.equal(observed(input).direction, null);
  }
  assert.equal(observeChart(bars, WINDOWS.SHORT, now + WIDTH).direction, null);
});

test('overlapping archive and feed cases count once, conflicts are quarantined and unfinished outcomes are excluded', () => {
  const candles = neutralBars(48);
  const seed = { availableAt: now, retained: 3, markets: { BTC_THB: { SHORT: [
    [now - 3 * HOUR,'RANGE',0], [now - 2 * HOUR,'RANGE',999], [now,'RANGE',999999]
  ] } } };
  const study = rank([candidate('BTC_THB')], [instrument('BTC_THB', candles)], freshBook(), seed).ranking[0].experience.chart;
  assert.equal(study.samples, 1);
  assert.equal(study.archived, 1);
  assert.equal(study.latestEnd, now - 2 * HOUR);
  const futureSeed = { ...seed, availableAt: now + 1 };
  const direct = rank([candidate('BTC_THB')], [instrument('BTC_THB', candles)], freshBook(), futureSeed);
  assert.equal(direct.report.archiveCases, 0);
  assert.equal(direct.ranking[0].experience.chart.recentFeed, 2);
});

test('costed chart evidence reorders close eligible plans within its cap and skips a technically incomplete plan', () => {
  const seed = pack({ AA_THB: Array(32).fill(2000), BB_THB: Array(32).fill(30_000), CC_THB: Array(32).fill(40_000) });
  const signals = [candidate('AA_THB', 81),candidate('BB_THB', 80),candidate('CC_THB', 99, false)];
  const result = rank(signals, signals.map(s => instrument(s.symbol)), freshBook(), seed);
  assert.deepEqual(result.ranking.map(s => s.symbol), ['BB_THB', 'AA_THB', 'CC_THB']);
  const [up, down, waiting] = result.ranking.map(s => s.experience);
  assert.equal(up.appliedPoints, 2);
  assert.equal(down.appliedPoints, -2);
  assert(down.chart.meanNetMove < 0);
  assert.equal(waiting.appliedPoints, 0);
  assert.equal(result.report.changedPriorities, 2);
  assert.equal(result.report.closedInMemory, 0);
  assert.equal(result.report.canActivateLive, false);
});

test('insufficient samples, changing direction between halves and stale quotes keep priorities neutral', () => {
  const s = candidate('AA_THB');
  for (const values of [Array(23).fill(25_000), [...Array(16).fill(25_000), ...Array(16).fill(-25_000)]]) {
    assert.equal(rank([s],[instrument(s.symbol)],freshBook(),pack({AA_THB:values})).ranking[0].experience.appliedPoints, 0);
  }
  const expired = { ...instrument(s.symbol), observedAt: now - 30_001 };
  assert.equal(rank([s],[expired],freshBook(),pack({AA_THB:Array(40).fill(99_000)})).ranking[0].experience.chart.samples,0);
});

function lessons(count, signal) {
  return Array.from({ length: count }, (_, i) => ({
    ...signal, id: 'closed-' + i, openedAt: now - 40 * DAY + i * DAY, closedAt: now - 39 * DAY + i * DAY,
    pnl: -2, simulation: true, lesson: { version: EXPERIENCE_VERSION, exitPolicy: signal.exitPolicy, returnAfterCosts: -0.02 }
  }));
}
test('only dated unique closes with the matching strategy version, entry regime, horizon and exit policy teach the next plan', () => {
  const s = candidate('AA_THB'), book = freshBook(), trades = lessons(30, s), original = trades[0];
  book.closed = [...trades,original,{...original, id:'wrong-regime', regime:'BULLISH'},
    {...original, id:'wrong-version', strategyVersion:'another'}, {...original, id:'wrong-horizon', horizon:'LONG'},
    {...original, id:'wrong-strategy', strategyId:'SWING_MEDIUM'}, {...original,id:'no-basis', lesson:null},
    {...original,id:'live',simulation:false},{...original,id:'partial',closedAt:null},
    {...original,id:'future',closedAt:now+1},{...original,id:'same-tick',closedAt:now},
    {...original,id:'other-exit',lesson:{...original.lesson,exitPolicy:'FIXED_BASELINE'}}];
  const experience = v => rank([s],[instrument(s.symbol)],book,null,v).ranking[0].experience;
  assert.equal(experience().paper.samples,30);
  assert.equal(experience().paper.netTHB,-60);
  assert.equal(experience().appliedPoints,-3);
  assert.equal(experience({weights:{},forward:{daysObserved:10,coverage:0.89}}).appliedPoints,0);
  assert.equal(experience({weights:{},forward:{daysObserved:6.99,coverage:1}}).appliedPoints,0);
  assert.equal(rank([s],[instrument(s.symbol)],structuredClone(book)).ranking[0].experience.paper.samples,30);
  assert.throws(() => rank([s],[instrument(s.symbol)],{...book,mode:'LIVE'}), /PAPER/);
});

test('a partially filled Paper entry teaches only on final exit, uses actual debit and records the audited reason', () => {
  const first = runMaster(null, {markets:[market()]}, NOW);
  const buy = first.book.orders.find(o=>o.side==='BUY');
  assert(buy);
  const next = market('BTC_THB', NOW+1_000);
  next.depth.asks = [[next.ask, buy.amount * 4 / next.ask]];
  const partial = runMaster(first.book, {markets:[next]}, NOW+1_000);
  const debit = -partial.fills.find(f=>f.side==='BUY').cashDeltaTHB;
  assert(debit > 0 && debit < buy.amount);
  assert.equal(partial.latest.experience.lifetimeClosed, 0);
  const stop = buy.stop * 0.99;
  const exit = runMaster(JSON.parse(JSON.stringify(partial.book)), {markets:[quote(stop,NOW+130_000)]}, NOW+130_000);
  assert(exit.decisions.some(d=>d.action==='SELL'));
  const done = runMaster(exit.book, {markets:[quote(stop,NOW+131_000)]}, NOW+131_000);
  const closed = done.book.closed.find(t=>t.id===buy.id);
  assert.equal(closed.lesson.entryPaidTHB, debit);
  assert.equal(closed.lesson.exitReason,'FIXED_STOP');
  assert.equal(closed.lesson.exitPolicy,buy.exitPolicy);
  assert.equal(closed.lesson.returnAfterCosts, closed.pnl / debit);
  assert.equal(closed.lesson.feesTHB, Math.round((partial.book.fees + done.fills[0].fee)*100)/100);
  assert.equal(masterJournal(done).find(row=>row.type==='CLOSED').payload.lesson.feesTHB,closed.lesson.feesTHB);
  const row = masterJournal(first).find(row=>row.type==='DECISION' && row.payload.signal==='BUY');
  assert.equal(row.payload.experience.version,EXPERIENCE_VERSION);
  assert.equal(row.payload.experience.canActivateLive,false);
  assert.equal(done.latest.experience.lifetimeClosed,1);
  assert.equal(runMaster(done.book,{markets:[]},NOW+131_000).replayed,true);
});

test('archive never increments portfolio P&L, trade totals or evidence minutes and cannot clear a Paper entry lock', () => {
  const afterArchive = Math.max(CHART_ARCHIVE.availableAt, NOW) + 60_000;
  const result = runMaster(null,{markets:[market('BTC_THB',afterArchive)]},afterArchive,{config:{...MASTER_DEFAULTS,buyPaused:true}});
  assert.equal(result.latest.experience.archiveCases,CHART_ARCHIVE.retained);
  assert.equal(result.latest.summary.closedTrades,0);
  assert.equal(result.latest.summary.dayPnl,0);
  assert.equal(result.book.validMinutes,1);
  assert(!result.decisions.some(d=>d.action==='BUY'));
  assert.equal(result.book.orders.length,0);
});

test('reference lessons use one same-owner Paper baseline, require matched fills, and have no vote in Master ranking', () => {
  const signal = candidate('AA_THB');
  const lesson = { protocol:LEARNING_PROTOCOL, mode:'PAPER_ONLY', status:'VERIFIED', simulation:true,
    positionId:'old-1', symbol:signal.symbol, strategy:'TREND_FOLLOWING', closedAt:now-2*DAY, reviewedAt:now-DAY,
    netPnL:-5, metrics:{feesPaid:1}, evidence:{buyFillIds:['b'],sellFillIds:['s'],exitReasons:['STOP_LOSS']} };
  const earlierBook = { mode:'PAPER_ONLY', accounts:{
    EXIT_BASELINE:{lessons:[lesson,lesson,{...lesson,positionId:'future',reviewedAt:now+1},
      {...lesson,positionId:'incomplete',status:'INCOMPLETE'}, {...lesson,positionId:'wrong',simulation:false}]},
    EXIT_PROTECT:{lessons:[{...lesson,positionId:'sibling'}]}
  } };
  const result = rankByExperience([signal],[instrument(signal.symbol)],freshBook(),MASTER_DEFAULTS,validation,now,{seed:null,earlierBook});
  const memory = result.ranking[0].experience;
  assert.equal(result.report.baseline.records.length,1);
  assert.equal(memory.reference.id,lesson.positionId);
  assert.equal(memory.paper.samples,0);
  assert.equal(memory.appliedPoints,0);
  assert.equal(result.report.lifetimeClosed,0);
});
