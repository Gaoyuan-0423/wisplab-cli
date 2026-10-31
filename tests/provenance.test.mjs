import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { trackAnalysisSync, trackAnalysis } from '../provenance.mjs';
function fixture(t) {
 const dir=mkdtempSync(join(tmpdir(),'wisplab-provenance-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const engine=join(dir,'engine');mkdirSync(engine);writeFileSync(join(engine,'package.json'),'{"version":"test"}\n');writeFileSync(join(engine,'source.txt'),'v1');
 const git=(...args)=>execFileSync('git',['-C',engine,...args],{stdio:'pipe'});
 git('init');git('add','.');git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','-c','commit.gpgsign=false','commit','-m','fixture');
 const input=join(dir,'input.csv');writeFileSync(input,'synthetic');
 return {input,engine,spec:{analysis:'pcr',engineDir:engine,bridgeDir:engine,parameters:{qcMode:'report'},inputs:[{path:input}]}};
}
test('manifest hashes input bytes, records revision/options/timing and preserves result',t=>{
 const f=fixture(t);const result=trackAnalysisSync(f.spec,()=>({files:[{file:'input.csv',results:[1]}]}));const p=result.provenance;
 assert.deepEqual(result.files[0].results,[1]);assert.equal(p.schemaVersion,'wisplab.provenance/v1');
 assert.equal(p.inputs[0].before.sha256,createHash('sha256').update('synthetic').digest('hex'));
 assert.equal(p.engine.before.revision.length,40);assert.equal(p.engine.before.dirty,false);
 assert.deepEqual(p.checks,{inputsUnchanged:true,engineUnchanged:true,bridgeUnchanged:true});
 assert.equal(p.parameters.qcMode,'report');assert.ok(p.durationMs>=0);assert.ok(Date.parse(p.finishedAt)>=Date.parse(p.startedAt));
 assert.ok(!JSON.stringify(p).includes(f.engine));
});
test('input and dirty source changes are detected even without a new commit',t=>{
 const f=fixture(t);writeFileSync(join(f.engine,'source.txt'),'dirty-before');
 const p=trackAnalysisSync(f.spec,()=>{writeFileSync(f.input,'changed');writeFileSync(join(f.engine,'source.txt'),'dirty-after');return {};}).provenance;
 assert.equal(p.checks.inputsUnchanged,false);assert.equal(p.checks.engineUnchanged,false);assert.equal(p.engine.before.dirty,true);
 assert.notEqual(p.engine.before.sourceSha256,p.engine.after.sourceSha256);assert.ok(p.warnings.length>=2);
});
test('failed runs retain provenance, missing files are explicitly unverified',t=>{
 const f=fixture(t);rmSync(f.input);
 assert.throws(()=>trackAnalysisSync(f.spec,()=>{throw new Error('decode failed');}),error=>{
   assert.equal(error.provenance.status,'error');assert.equal(error.provenance.checks.inputsUnchanged,false);
   assert.equal(error.provenance.inputs[0].before.sha256,null);return true;
 });
});
test('async analysis fingerprints controls and distinguishes partial errors',async t=>{
 const f=fixture(t);const control=join(tmpdir(),`wisplab-control-${Date.now()}.tif`);writeFileSync(control,'control');t.after(()=>rmSync(control));
 const result=await trackAnalysis({...f.spec,analysis:'ihc',inputs:[...f.spec.inputs,{path:control,role:'control'}]},async()=>({files:[{file:'ok'},{file:'bad',error:'bad image'}]}));
 assert.equal(result.provenance.inputs[1].role,'control');assert.equal(result.provenance.status,'partial-error');
 assert.equal(result.provenance.inputs[1].before.sha256,createHash('sha256').update(readFileSync(control)).digest('hex'));
});

test('async tracing preserves the synchronous manifest fields and detects source/input mutations', async t => {
 const f=fixture(t), value={files:[{file:'input.csv',results:[1]}]};
 const sync=trackAnalysisSync(f.spec,()=>value).provenance;
 const asyncResult=(await trackAnalysis(f.spec,async()=>value)).provenance;
 for(const key of ['schemaVersion','analysis','status','runtime','cli','engine','parameters','inputs','resolvedParameters','checks','warnings','error'])
   assert.deepEqual(asyncResult[key],sync[key],key);
 const changed=await trackAnalysis(f.spec,async()=>{
   writeFileSync(f.input,'changed');writeFileSync(join(f.engine,'source.txt'),'changed');return value;
 });
 assert.equal(changed.provenance.checks.inputsUnchanged,false);
 assert.equal(changed.provenance.checks.engineUnchanged,false);
 await assert.rejects(trackAnalysis(f.spec,async()=>{throw new Error('decode failed');}),error=>{
   assert.equal(error.provenance.status,'error');assert.equal(error.provenance.error,'decode failed');return true;
 });
});

test('cancellation before tracing prevents analysis and cancellation after analysis retains completed results', async t => {
 const f=fixture(t), before=new AbortController();before.abort();let ran=false;
 await assert.rejects(trackAnalysis(f.spec,async()=>{ran=true;return {};},{signal:before.signal}),{code:'CANCELLED'});
 assert.equal(ran,false);
 const after=new AbortController();
 const result=await trackAnalysis(f.spec,async()=>{after.abort();return {files:[{file:'ok.png',value:42}]};},{signal:after.signal});
 assert.equal(result.code,'CANCELLED');assert.equal(result.runtime.cancelled,true);
 assert.equal(result.files[0].value,42);assert.equal(result.provenance.status,'partial-error');
 assert.deepEqual(result.provenance.checks,{inputsUnchanged:false,engineUnchanged:false,bridgeUnchanged:false});
 assert.equal(result.provenance.inputs[0].after.error,'CANCELLED');
 assert.match(result.provenance.error,/cancelled/);
});
