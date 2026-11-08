import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { config, runPcr } from '../../lib.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const close = (a,b,tol=1e-9) => assert.ok(Number.isFinite(a) && Math.abs(a-b)<=tol, `${a} != ${b}`);

test('compatible real engine experimental-unit contract', {timeout:120000}, async t => {
  assert.ok(process.env.WISPLAB_UNIT_ENGINE, 'Set WISPLAB_UNIT_ENGINE to a compatible pcr-workbench checkout');
  const engine = resolve(process.env.WISPLAB_UNIT_ENGINE);
  const pinPath = new URL('./experimental-unit-engine.json', import.meta.url);
  const pin = JSON.parse(readFileSync(pinPath, 'utf8'));
  assert.equal(execFileSync('git',['rev-parse','HEAD'],{cwd:engine,encoding:'utf8'}).trim(), pin.revision);
  assert.equal(execFileSync('git',['status','--porcelain'],{cwd:engine,encoding:'utf8'}).trim(), '', 'Use a clean candidate engine');
  const dir=mkdtempSync(join(tmpdir(),'wisplab-unit-contract-'));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const cfg=join(dir,'config.json');
  writeFileSync(cfg,JSON.stringify({repos:{pcr:engine},allowPaths:[dir]}));config(cfg);
  const samples=['C1','C2','C3','T1','T2','T3'];
  const deltas=[4,5,6,2,3,4];
  const assignments=samples.map((sample,i)=>({plate:'',sample,unitId:`U-${sample}`,group:i<3?'C':'T'}));
  const experimentalDesign={kind:'independent',confirmed:true,controlGroup:'C',assignments};
  const rows=['Sample,Target,Cq'];
  samples.forEach((sample,i)=>{for(let j=0;j<2;j++)rows.push(`${sample},R,20`,`${sample},G,${20+deltas[i]}`);});
  const csv=join(dir,'units.csv');writeFileSync(csv,rows.join('\n'));
  const args={files:[csv],refGenes:['R'],controlSamples:samples.slice(0,3),experimentalDesign};
  const group = f => f.groupResults.find(r=>r.target==='G' && r.group==='T');
  let baseline;
  await t.test('real unit means and Welch match six declared independent units',()=>{
    const out=runPcr(args);baseline=out.files[0];
    assert.equal(out.provenance.status,'success');assert.equal(baseline.error,undefined);
    assert.equal(baseline.designStatus,'confirmed');assert.equal(baseline.primaryAnalysis.kind,'experimental-units');
    assert.equal(baseline.primaryAnalysis.statisticalUnit,'experimental_unit');assert.equal(baseline.inferenceMode,'independent_units');
    assert.equal(group(baseline).nBio,3);assert.equal(group(baseline).nTech,6);
    // DeltaCt means 5 vs 3, both sample variance 1, Welch t=sqrt(6), df=4.
    close(group(baseline).pValue,0.07048399691021993,1e-10);
    assert.ok(baseline.results.every(r=>r.pValue===null && r.pAdjusted===null));
    assert.deepEqual(out.provenance.resolvedParameters[0].experimentalDesign,experimentalDesign);
  });
  await t.test('duplicating technical wells cannot increase biological n or alter inference',()=>{
    const duplicate=join(dir,'duplicated.csv');
    writeFileSync(duplicate,[...rows,'C1,R,20','C1,G,24','C1,R,20','C1,G,24'].join('\n'));
    const f=runPcr({...args,files:[duplicate]}).files[0];
    assert.equal(group(f).nBio,3);close(group(f).pValue,group(baseline).pValue);
    assert.equal(f.groupResults.find(r=>r.group==='C').nTech,8);
  });
  await t.test('existing biological design stays distinct with a new engine',()=>{
    const biologicalDesign={samples:Object.fromEntries(samples.map((s,i)=>[s,i<3?'C':'T'])),controlGroup:'C'};
    const f=runPcr({...args,experimentalDesign:undefined,biologicalDesign}).files[0];
    assert.equal(f.primaryAnalysis.kind,'biological-groups');assert.equal(f.primaryAnalysis.status,'success');
    assert.equal(f.inferenceMode,'biological_groups');close(f.primaryAnalysis.comparisons[0].pValue,0.07048399691021993,1e-10);
    assert.equal(f.designStatus,undefined);assert.equal(f.designIssues,undefined);assert.equal(f.groupResults,undefined);
    assert.ok(f.results.every(r=>r.pValue===null));
  });
  await t.test('missing confirmation and unsupported designs never fall back to well inference',()=>{
    const unconfirmed=runPcr({...args,experimentalDesign:{...experimentalDesign,confirmed:false}}).files[0];
    assert.equal(unconfirmed.inferenceMode,'descriptive_only');assert.deepEqual(unconfirmed.primaryAnalysis.comparisons,[]);
    const paired=runPcr({...args,experimentalDesign:{...experimentalDesign,kind:'paired'}});
    assert.equal(paired.provenance.status,'error');assert.equal(paired.files[0].primaryAnalysis.kind,'experimental-units');
    assert.equal(paired.files[0].primaryAnalysis.status,'error');assert.deepEqual(paired.files[0].primaryAnalysis.comparisons,[]);
    const plain=runPcr({...args,experimentalDesign:undefined}).files[0];
    assert.equal(plain.primaryAnalysis.kind,'descriptive-only');assert.deepEqual(plain.primaryAnalysis.comparisons,[]);
    assert.ok(plain.results.every(r=>r.pValue===null));
    assert.throws(()=>runPcr({...args,biologicalDesign:{samples:Object.fromEntries(samples.map((s,i)=>[s,i<3?'C':'T'])),controlGroup:'C'}}),/not both/);
  });
  await t.test('actual CLI config and MCP payload agree with the real API',()=>{
    const cliCfg=join(dir,'cli-config.json');writeFileSync(cliCfg,JSON.stringify({repos:{pcr:engine},allowPaths:[dir],pcr:{experimentalDesign}}));
    const cli=spawnSync(process.execPath,[join(root,'cli.mjs'),'pcr',csv,'--config',cliCfg,'--ref','R','--control','C1,C2,C3'],{encoding:'utf8'});
    assert.equal(cli.status,0,cli.stderr);assert.deepEqual(JSON.parse(cli.stdout).files[0].groupResults,baseline.groupResults);
    const meta={'io.modelcontextprotocol/protocolVersion':'2026-07-28','io.modelcontextprotocol/clientCapabilities':{}};
    const call={jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'pcr_analyze',arguments:args,_meta:meta}};
    const mcp=spawnSync(process.execPath,[join(root,'mcp-server.mjs'),'--config',cfg],{input:JSON.stringify(call)+'\n',encoding:'utf8'});
    assert.equal(mcp.status,0,mcp.stderr);const reply=JSON.parse(mcp.stdout);assert.equal(reply.result.isError,false);
    assert.deepEqual(JSON.parse(reply.result.content[0].text).files[0].groupResults,baseline.groupResults);
  });
});
