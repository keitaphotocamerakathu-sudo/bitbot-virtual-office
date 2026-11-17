import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const report=JSON.parse(await fs.readFile('assets/research-v13.json','utf8'));
const paths=['assets/engine.mjs','assets/strategies.mjs','assets/selection.mjs','assets/intraday.mjs','research/protocol-v13.json'];
const digest=createHash('sha256').update((await Promise.all(paths.map(p=>fs.readFile(p,'utf8')))).join('\n')).digest('hex');
assert.equal(digest,report.codeDigest,'Research logic changed after report: rerun the preregistered study');
assert.deepEqual(report.protocol,JSON.parse(await fs.readFile('research/protocol-v13.json','utf8')));
assert.equal(report.liveApproved,false,'Research must never activate real trading');
assert.equal(report.folds.length,4);
if(!report.final.selected)for(const item of report.final.cases){assert.equal(item.base,null);assert.equal(item.gate.passed,false);}
assert.equal(report.final.smallCapitalTraining.length,6,'Must report actual small-capital diagnostics');
console.log('Archived research protocol, source digest, capital cases and non-activation verified.');
