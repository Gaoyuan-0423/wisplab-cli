import test from 'node:test';
import assert from 'node:assert/strict';
import {compareNucleiReference,makeAnnotationTemplate,matchNuclei} from '../ihc-nuclei-validation.mjs';

const sha='a'.repeat(64);
function fixtures(){
 const result={files:[{file:'x.png',sourceWidth:20,sourceHeight:20,width:10,height:10,settings:{profile:'h_dab'},
 nuclei:{coordinateSpace:'working',width:10,height:10,items:[{id:'p1',x:1,y:1,positive:true},{id:'p2',x:4,y:4,positive:false},{id:'extra',x:8,y:8,positive:true}]}}],
 provenance:{analysis:'ihc',status:'success',inputs:[{file:'x.png',role:'input',before:{sha256:sha},after:{sha256:sha},unchanged:true}],checks:{inputsUnchanged:true,engineUnchanged:true,bridgeUnchanged:true}}};
 const reference=makeAnnotationTemplate(result);Object.assign(reference.images[0],{sourceKind:'synthetic',reviewStatus:'complete',reviewer:'fixture',reviewedOn:'2026-10-31',method:'Original synthetic known coordinates',points:[{id:'r1',x:2.5,y:2.5,positive:true},{id:'r2',x:8.5,y:8.5,positive:true},{id:'missed',x:19,y:1,positive:false}]});
 return {result,reference};
}
test('spatial review uses source pixel centres, one-to-one matches and conditional classification',()=>{
 const {result,reference}=fixtures(),r=compareNucleiReference(result,reference,{radius:0.1});
 assert.equal(r.status,'compared');assert.deepEqual(r.records[0].detection,{truePositives:2,falsePositives:1,falseNegatives:1,precision:2/3,recall:2/3,f1:2/3});
 assert.equal(r.records[0].classificationOnMatched.falseNegative,1);assert.equal(r.records[0].classificationOnMatched.accuracy,0.5);
 assert.deepEqual(r.records[0].missedReferenceIds,['missed']);assert.deepEqual(r.records[0].unmatchedPredictionIds,['extra']);
});
test('matching finds augmenting paths instead of losing a valid match to greedy nearest pairing',()=>{
 const r=matchNuclei([{id:'r1',x:0,y:0},{id:'r2',x:1,y:0}],[{id:'p1',x:.4,y:0},{id:'p2',x:-.8,y:0}],1);
 assert.equal(r.matches.length,2);assert.equal(r.matches.find(m=>m.referenceId==='r1').predictedId,'p2');
});
test('unreviewed templates cannot produce accuracy or pass, and hash changes remain incomplete',()=>{
 const {result}=fixtures(),reference=makeAnnotationTemplate(result);
 const pending=compareNucleiReference(result,reference,{radius:2});assert.equal(pending.status,'pending-review');assert.equal(pending.summaries,null);
 const complete=fixtures().reference;complete.images[0].sha256='b'.repeat(64);
 assert.equal(compareNucleiReference(result,complete,{radius:2}).status,'incomplete');
});
test('reject malformed/ambiguous labels and dates; empty reviewed images have undefined rates',()=>{
 const {result,reference}=fixtures();reference.images[0].reviewedOn='2026-02-31';assert.throws(()=>compareNucleiReference(result,reference,{radius:1}),/date/);
 reference.images[0].reviewedOn='2026-10-31';reference.images[0].points.push({...reference.images[0].points[0]});assert.throws(()=>compareNucleiReference(result,reference,{radius:1}),/duplicate/);
 reference.images[0].points=[];result.files[0].nuclei.items=[];
 const report=compareNucleiReference(result,reference,{radius:1});assert.equal(report.status,'compared');assert.equal(report.summaries.detection.f1,null);
 delete result.files[0].nuclei;assert.equal(compareNucleiReference(result,reference,{radius:1}).records[0].reason,'missing-nucleus-export');
});
