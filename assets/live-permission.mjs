// Owner consent changes execution permission, never the research result or risk rules.
import {config} from './engine.mjs?v=13.0.0';
export function consentConfig(input){const c=config(input,true);delete c.buyPaused;return JSON.stringify(Object.fromEntries(Object.keys(c).sort().map(k=>[k,c[k]])));}
export function livePermission(evidence,bot,now=Date.now()){
 return{...evidence,researchPassed:evidence?.allowed===true,ownerApproved:false,allowed:false,approvalMode:'PAPER_ONLY',mode:'PAPER_ONLY',riskChecksRequired:true,reasons:['PAPER_ONLY: ต้องผ่านการตรวจรับและขั้นตอนเปิด Live แยกต่างหาก',...(evidence?.reasons||[])]};
}
