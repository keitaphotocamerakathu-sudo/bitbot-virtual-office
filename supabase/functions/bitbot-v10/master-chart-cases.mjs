// A case describes a move between two public prices. It has no order or position.
const MINUTE = 60_000;
export const CONTEXT_BARS = 12;
export const CASE_LIMIT = 64;
export const WINDOWS = Object.freeze({
  SHORT: { minutes: 5, bars: 12 },
  MEDIUM: { minutes: 60, bars: 24 },
  LONG: { minutes: 1440, bars: 7 }
});

function validBar(bar) {
  return [bar.o, bar.h, bar.l, bar.c, bar.v].every(Number.isFinite) &&
    bar.l > 0 && bar.l <= Math.min(bar.o, bar.c) && bar.h >= Math.max(bar.o, bar.c) && bar.v > 0;
}

// Gaps, conflicting duplicates, zero-volume bars and unfinished bars cannot form a case.
function closedSeries(input, width, now) {
  const byTime = new Map();
  for (const bar of input || []) {
    if (!Number.isSafeInteger(bar?.t) || bar.t <= 0 || bar.t % width || bar.t + width > now) continue;
    const prior = byTime.get(bar.t);
    const conflict = prior && ['o', 'h', 'l', 'c', 'v'].some(key => prior[key] !== bar[key]);
    if (prior === null || conflict || !validBar(bar)) byTime.set(bar.t, null);
    else byTime.set(bar.t, bar);
  }
  return Array.from(byTime.values()).filter(Boolean).sort((a, b) => a.t - b.t);
}

function direction(bars, index) {
  const first = index - CONTEXT_BARS;
  let range = 0;
  for (let i = first; i < index; i++) range += bars[i].h - bars[i].l;
  const move = bars[index - 1].c - bars[first].o;
  if (move > range / CONTEXT_BARS) return 'UP';
  if (move < -range / CONTEXT_BARS) return 'DOWN';
  return 'RANGE';
}

export function observeChart(input, window, now, from = 0) {
  const width = window.minutes * MINUTE;
  const duration = width * window.bars;
  const bars = closedSeries(input, width, now);
  const rows = [];
  let consecutive = 0;
  for (let end = 0; end < bars.length; end++) {
    consecutive = end && bars[end].t === bars[end - 1].t + width ? consecutive + 1 : 1;
    if (consecutive < CONTEXT_BARS + window.bars) continue;
    const first = end - window.bars + 1;
    const start = bars[first].t;
    if (start < from || start % duration !== 0) continue;
    const grossPpm = Math.round((bars[end].c / bars[first].o - 1) * 1_000_000);
    if (Number.isSafeInteger(grossPpm)) rows.push([start, direction(bars, first), grossPpm]);
  }
  const contextAt = Math.floor(now / width) * width;
  const fresh = consecutive >= CONTEXT_BARS && bars.at(-1).t + width === contextAt;
  return { rows, direction: fresh ? direction(bars, bars.length) : null, contextAt,
    contextFrom: contextAt - CONTEXT_BARS * width, duration };
}

export function retainCases(rows) {
  return ['UP', 'RANGE', 'DOWN'].flatMap(regime =>
    rows.filter(row => row[1] === regime).slice(-CASE_LIMIT)
  ).sort((a, b) => a[0] - b[0]);
}
