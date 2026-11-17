// Owner consent changes execution permission, never the research result or risk rules.
import {config} from './engine.mjs?v=13.0.0';
export function consentConfig(input){const c=config(input,true);delete c.buyPaused;return JSON.stringify(Object.fromEntries(Object.keys(c).sort().map(k=>[k,c[k]])));}
export function livePermission(evidence,bot,now=Date.now()){
 const consent=bot?.evidence_consent,at=Date.parse(consent?.at);let matching=false;
 try{matching=consentConfig(consent?.config)===consentConfig(bot?.config);}catch{}
 const ownerApproved=bot?.running===true&&consent?.method==='OWNER_START_ACK'&&consent.allowUnvalidated===true&&Number.isFinite(at)&&at<=now+5000&&matching;
 return{...evidence,researchPassed:evidence.allowed===true,ownerApproved,allowed:evidence.allowed===true||ownerApproved,approvalMode:ownerApproved?'OWNER_ACCEPTED_UNVALIDATED':'RESEARCH_REQUIRED',riskChecksRequired:true};
}
