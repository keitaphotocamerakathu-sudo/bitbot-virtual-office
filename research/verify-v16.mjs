import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const r=JSON.parse(await fs.readFile('assets/research-v16.json','utf8'));
assert.equal(r.version,'16.0.0');assert.equal(r.protocol.studyType,'DEVELOPMENT_REPLAY_NOT_NEW_BLIND_HOLDOUT');
assert.deepEqual(r.protocol,JSON.parse(await fs.readFile('research/protocol-v16.json','utf8')));
const digest=createHash('sha256').update((await Promise.all(r.sourceFiles.map(p=>fs.readFile(p,'utf8')))).join('\n')).digest('hex');assert.equal(r.codeDigest,digest,'Comparison sources changed: regenerate the development replay');
assert.equal(r.liveApproved,false);assert.equal(r.training.length,32);assert.equal(r.validation.length,32);
for(const x of [...r.training,...r.validation]){assert(x.coverage>=0&&x.coverage<=1);if(x.coverage<.9)assert.equal(x.net,null);if(!x.rounds)assert.equal(x.winRate,null);}
assert.equal(await fs.readFile('supabase/functions/bitbot-v10/adaptive.mjs','utf8'),(await fs.readFile('assets/adaptive.mjs','utf8')).replaceAll('?v=13.0.0',''));
console.log('V16 development-only comparison, exact source digest, coverage and server parity verified.');
