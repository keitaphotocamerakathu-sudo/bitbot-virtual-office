import test from 'node:test';
import assert from 'node:assert/strict';
import {config} from '../assets/engine.mjs';
import {livePermission} from '../assets/live-permission.mjs';
const NOW=1800000000000,failed={allowed:false,reasons:['not proven']};
const bot=()=>({running:true,config:config({budget:100,maxOrder:100,dailyBuy:100,dailySell:100}),evidence_consent:{method:'OWNER_START_ACK',allowUnvalidated:true,at:new Date(NOW).toISOString(),config:config({budget:100,maxOrder:100,dailyBuy:100,dailySell:100})}});
test('owner consent grants execution permission without changing failed research or risk settings',()=>{const b=bot(),before=structuredClone(b),p=livePermission(failed,b,NOW);assert.equal(p.allowed,true);assert.equal(p.researchPassed,false);assert.equal(p.ownerApproved,true);assert.equal(p.riskChecksRequired,true);assert.deepEqual(b,before);assert.equal(failed.allowed,false);});
test('stopping, missing consent, forged flags and changed limits cannot reuse previous permission',()=>{for(const change of [b=>b.running=false,b=>b.evidence_consent=null,b=>b.evidence_consent.allowUnvalidated='true',b=>b.evidence_consent.at=new Date(NOW+60000).toISOString(),b=>b.config.budget=200,b=>b.config.stopLoss=.04,b=>b.config.strategyProfile='trend-confirmed']){const b=bot();change(b);assert.equal(livePermission(failed,b,NOW).allowed,false);}});
test('pausing entry preserves consent but does not change the pause flag',()=>{const b=bot();b.config.buyPaused=true;assert.equal(livePermission(failed,b,NOW).ownerApproved,true);assert.equal(b.config.buyPaused,true);});
