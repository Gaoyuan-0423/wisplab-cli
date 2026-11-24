import { describe, it, expect } from 'vitest';
import { analyzeDeltaDeltaCt, type AnalysisRow } from './analysis';
import { buildQualityReport } from './auto';
function report(refs: number[], duplicateTarget = false) {
 const rows: AnalysisRow[] = [];
 refs.forEach((cq,i)=>{
  for(const target of ['GAPDH','T',...(duplicateTarget?['T2','T3']:[])])for(let rep=0;rep<3;rep++)
   rows.push({id:rows.length+1,plate:'P',well:String(rows.length+1),sample:i===0?'C':`S${i}`,group:'',pairId:'',target,task:'',cq:target==='GAPDH'?cq:24,quantity:NaN,excluded:false});
 });
 const output=analyzeDeltaDeltaCt(rows,{refGenes:['GAPDH'],controlSamples:['C'],qc:{minCq:NaN,maxCq:NaN,absDev:NaN,zScore:NaN}});
 return buildQualityReport({rows,flags:{},output,guess:{refGenes:['GAPDH'],controlSamples:['C'],basis:'explicit'},mappingComplete:true,headerRow:0});
}
describe('single-reference quality guidance',()=>{
 it('does not label a single reference as a problem or suggest adding genes',()=>{
  const r=report([20,20,20,20]);
  expect(r.issues.some(i=>i.code==='SINGLE_REF')).toBe(false);
  expect(r.advice.some(i=>i.code==='MULTI_REF')).toBe(false);
  expect(r.issues.some(i=>i.code==='REF_UNSTABLE')).toBe(false);
 });
 it('still checks measured instability for a single reference',()=>{
  expect(report([20,18,20,22]).issues.some(i=>i.code==='REF_UNSTABLE')).toBe(true);
 });
 it('counts samples once across targets for the stability minimum',()=>{
  expect(report([20,18,22],true).issues.some(i=>i.code==='REF_UNSTABLE')).toBe(false);
 });
});
