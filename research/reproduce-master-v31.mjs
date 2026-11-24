// Reproduce the exact archived public-data scenarios without fetching revised candles.
import {readFile,writeFile} from 'node:fs/promises';import {gunzipSync} from 'node:zlib';
await import('./verify-master-v31.mjs');
await writeFile('/tmp/rea31-history.json',gunzipSync(await readFile(new URL('./data-v31.json.gz',import.meta.url))));
const {runMasterResearch}=await import('./master-backtest-v31.mjs');await runMasterResearch();
