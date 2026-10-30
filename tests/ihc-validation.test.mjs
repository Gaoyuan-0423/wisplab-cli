import test from 'node:test';
import assert from 'node:assert/strict';
import { compareIhcReference } from '../ihc-validation.mjs';
const hash='a'.repeat(64);
function fixture(){return {result:{provenance:{analysis:'ihc',status:'success',checks:{inputsUnchanged:true,engineUnchanged:true,bridgeUnchanged:true},inputs:[{role:'input',file:'a.png',before:{sha256:hash},after:{sha256:hash},unchanged:true}]},files:[{file:'a.png',settings:{profile:'h_dab'},overall:{totalNuclei:4,positiveNuclei:4,hScore:100,positiveFraction:0.5}}]},reference:{schemaVersion:'wisplab.ihc-reference/v1',images:[{file:'a.png',sha256:hash,scope:'whole-image',profile:'h_dab',sourceKind:'synthetic',method:'Known drawn objects',metrics:{totalNuclei:8,positiveFraction:0.4}}]}};}
test('signed/absolute errors, zero denominator, explicit tolerances and ungraded status',()=>{
 const f=fixture();let r=compareIhcReference(f.result,f.reference);
 assert.equal(r.status,'ungraded');assert.equal(r.records[0].metrics.totalNuclei.error,-4);
 assert.equal(r.records[0].metrics.totalNuclei.relativeError,-0.5);
 f.reference.images[0].tolerances={totalNuclei:1};assert.equal(compareIhcReference(f.result,f.reference).status,'outside-tolerance');
 f.reference.images[0].metrics={totalNuclei:0};f.reference.images[0].tolerances={totalNuclei:4};
 r=compareIhcReference(f.result,f.reference);assert.equal(r.status,'within-tolerance');assert.equal(r.records[0].metrics.totalNuclei.relativeError,null);
});
test('mismatched bytes, missing/duplicate images, profile changes and metric absence cannot pass',()=>{
 for(const mutate of [f=>f.reference.images[0].sha256='b'.repeat(64),f=>f.result.files.push(f.result.files[0]),f=>f.result.files[0].settings.profile='masson',f=>delete f.result.files[0].overall.totalNuclei,f=>f.result.files.push({file:'unreferenced.png'})]){
 const f=fixture();mutate(f);assert.equal(compareIhcReference(f.result,f.reference).status,'incomplete');}
});
test('manual claims require reviewer/date and invalid references fail explicitly',()=>{
 const f=fixture();f.reference.images[0].sourceKind='manual';assert.throws(()=>compareIhcReference(f.result,f.reference),/reviewer/);
 Object.assign(f.reference.images[0],{reviewer:'Reviewer 1',reviewedOn:'2026-10-31'});assert.equal(compareIhcReference(f.result,f.reference).status,'ungraded');
 for(const metrics of [{hScore:301},{totalNuclei:1.5},{positiveFraction:-1},{totalNuclei:2,positiveNuclei:3},{typo:4}]){
 f.reference.images[0].metrics=metrics;assert.throws(()=>compareIhcReference(f.result,f.reference));}
});
