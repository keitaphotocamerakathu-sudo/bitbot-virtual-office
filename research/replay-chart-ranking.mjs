// A chronological descriptive check of the chart component, independent of entry
// signals, portfolio constraints and fills. Compare only simultaneous observations.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { chartRankingPoints } from '../supabase/functions/bitbot-v10/master-experience.mjs';
import { CASE_LIMIT, CONTEXT_BARS, WINDOWS, observeChart } from '../supabase/functions/bitbot-v10/master-chart-cases.mjs';
import { CHART_ARCHIVE } from '../supabase/functions/bitbot-v10/master-chart-archive.mjs';

const data = JSON.parse(gunzipSync(await readFile(new URL('./data-v31.json.gz',import.meta.url))));
assert.equal(createHash('sha256').update(JSON.stringify(data.data)).digest('hex'), CHART_ARCHIVE.dataDigest);
const split = data.start + 60 * 86_400_000;
const average = values => values.reduce((a,b) => a+b,0) / values.length;
const fee = 0.0025, spread = 0.001, slip = 0.002;
const factor = (1 - spread/2)/(1 + spread/2) * (1 - fee)**2 * (1 - slip/2)/(1 + slip/2);
const report = {};
for (const [horizon, window] of Object.entries(WINDOWS)) {
  const groups = new Map();
  const width = window.minutes * 60000;
  for (const frames of Object.values(data.data)) {
    const cases = observeChart(frames[window.minutes], window, data.end, data.start).rows;
    const history = new Map();
    let cursor = 0;
    for (const [start, label, gross] of cases) {
      const net = ppm => (1 + ppm / 1_000_000) * factor - 1;
      while (cursor < cases.length && cases[cursor][0] + window.bars * width <= start - CONTEXT_BARS * width) {
        const [at, direction, ppm] = cases[cursor++];
        const bucket = history.get(direction) || [];
        bucket.push({at, value:net(ppm)});
        if (bucket.length > CASE_LIMIT) bucket.shift();
        history.set(direction,bucket);
      }
      if (start < split) continue;
      const prior = history.get(label) || [];
      const points = chartRankingPoints(prior.map(row=>row.value),prior.map(row=>row.at));
      const group = groups.get(start) || [];
      group.push({points,net:net(gross)});
      groups.set(start,group);
    }
  }
  const deltas = [];
  let simultaneous = 0;
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    simultaneous++;
    const top = Math.max(...group.map(row=>row.points));
    const preferred = group.filter(row=>row.points===top);
    if (preferred.length === group.length) continue;
    deltas.push(average(preferred.map(row=>row.net))-average(group.map(row=>row.net)));
  }
  report[horizon] = { simultaneous, differentRanks:deltas.length,
    higher:deltas.filter(v=>v>0).length,lower:deltas.filter(v=>v<0).length,
    meanDifferenceBasisPoints:deltas.length?Math.round(average(deltas)*1_000_000)/100:null };
}
console.log(JSON.stringify({study:'CHART_ONLY_EQUAL_STARTING_SCORES',from:split,to:data.end,fee,spread,slip,report},null,2));
