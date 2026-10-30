import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, basename } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { loadConfig, config, runWb, runPcr, runIhc } from '../../lib.mjs';
import { blot, histology, fluorescence, plateCsv, plateMatrix, rdmlXml } from './fixtures.mjs';

const root=fileURLToPath(new URL('../..',import.meta.url));
const lock=JSON.parse(readFileSync(new URL('../../engines.lock.json',import.meta.url)));
const close=(actual,expected,tolerance=1e-9)=>assert.ok(Number.isFinite(actual)&&Math.abs(actual-expected)<=tolerance,`${actual} != ${expected}`);

test('pinned real WispLab engines', {timeout:240000}, async t=>{
  const cfg=loadConfig();
  for(const [name,engine] of Object.entries(lock.engines)) {
    const revision=execFileSync('git',['-C',cfg.repos[name],'rev-parse','HEAD'],{encoding:'utf8'}).trim();
    assert.equal(revision,engine.revision,`${name}: install revisions in engines.lock.json`);
    assert.equal(execFileSync('git',['-C',cfg.repos[name],'status','--porcelain'],{encoding:'utf8'}).trim(),'',`${name}: use a clean pinned engine checkout`);
  }
  const dir=mkdtempSync(join(tmpdir(),'wisplab-integration-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;await new Promise(r=>server.close(r));
  const cfgPath=join(dir,'config.json');writeFileSync(cfgPath,JSON.stringify({...cfg,ihc:{devPort:port},allowPaths:[dir]}));config(cfgPath);
  const file=(name,bytes)=>{const path=join(dir,name);writeFileSync(path,bytes);return path;};
  const csv=file('synthetic.csv',plateCsv), png8=file('blot8.png',blot()), png16=file('blot16.png',blot(16));
  const hdab=file('histology.png',histology()), duplex=file('fluorescence.png',fluorescence());
  const pcrArgs={files:[csv],refGenes:['GAPDH'],controlSamples:['C']};
  const assertManifest=(result,analysis)=>{
    assert.equal(result.provenance.analysis,analysis);
    assert.equal(result.provenance.schemaVersion,'wisplab.provenance/v1');
    assert.equal(result.provenance.engine.before.revision,lock.engines[analysis==='if'?'ihc':analysis].revision);
    assert.deepEqual(result.provenance.checks,{inputsUnchanged:true,engineUnchanged:true,bridgeUnchanged:true});
    assert.equal(result.provenance.status,'success');
  };
  await t.test('WB 8/16-bit exact local net signals, crops and review warnings',()=>{
    for(const [path,scale,depth] of [[png8,1,8],[png16,257,16]])for(const strip of [null,'20,60,0,160']){
      const result=runWb({files:[path],lanes:2,strip});assertManifest(result,'wb');const image=result.images[0];
      assert.equal(image.bitDepth,depth);assert.deepEqual(image.lanes.map(l=>l.net),[24000*scale,12000*scale]);
      assert.deepEqual(image.lanes.map(l=>l.ratio),[1,0.5]);assert.ok(image.lanes.every(l=>l.warnings.includes('CANDIDATES_REQUIRE_REVIEW')));
    }
  });
  await t.test('WB rolling-ball fixed numerical regression',()=>{
    const result=runWb({files:[png8],lanes:2,bg:'rolling',radius:50});assertManifest(result,'wb');
    const expected=JSON.parse(readFileSync(new URL('./expected.json',import.meta.url))).rolling8;
    result.images[0].lanes.forEach((lane,i)=>close(lane.net,expected[i],1e-6));
  });
  await t.test('qPCR report preserves values, opt-in QC filters one row and retains contaminated NTC',()=>{
    const plain=runPcr(pcrArgs);const report=runPcr({...pcrArgs,qc:{maxCq:35,repSD:1}});
    assertManifest(report,'pcr');assert.deepEqual(report.files[0].results,plain.files[0].results);
    const f=report.files[0];assert.deepEqual(f.qcReport.flaggedRowIds,[12]);assert.deepEqual(f.qcReport.excludedRowIds,[]);
    close(f.results.find(r=>r.sample==='S').foldChange,0.0625);
    const filtered=runPcr({...pcrArgs,qc:{maxCq:35},qcMode:'exclude'}).files[0];
    close(filtered.results.find(r=>r.sample==='S').foldChange,4);assert.deepEqual(filtered.qcReport.excludedRowIds,[12]);
    assert.equal(filtered.ntcReport[0].verdict,'contaminated');assert.equal(filtered.qcReport.replication.biologicalReplicateCount,null);
    const none=runPcr({...pcrArgs,qc:{maxCq:1},qcMode:'exclude'});assert.ok(none.files[0].error);assert.equal(none.provenance.status,'error');
  });
  await t.test('single-reference biological groups use sample means and match a known Welch result',()=>{
    const samples={C1:'C',C2:'C',C3:'C',S1:'S',S2:'S',S3:'S'};
    const data=['Sample,Target,Cq'];
    Object.keys(samples).forEach((sample,i)=>{for(let rep=0;rep<(i===0?5:2);rep++)data.push(`${sample},GAPDH,20`,`${sample},T,${20+[4,5,6,2,3,4][i]}`);});
    const input=file('biological.csv',data.join('\n'));
    const args={files:[input],refGenes:['GAPDH'],biologicalDesign:{samples,controlGroup:'C'}};
    const r=runPcr(args);assertManifest(r,'pcr');const b=r.files[0].biologicalGroups;
    assert.deepEqual(r.files[0].refGenesUsed,['GAPDH']);assert.equal(b.summaries[1].nBiological,3);
    close(b.summaries[1].foldChange,4);close(b.comparisons[0].pValue,0.07048399691021993,1e-10);
    close(b.comparisons[0].df,4);assert.equal(b.units[0].technicalWellCount,5);
    const cli=JSON.parse(execFileSync(process.execPath,[join(root,'cli.mjs'),'pcr',input,'--config',cfgPath,'--ref','GAPDH','--groups',JSON.stringify(samples),'--control-group','C'],{encoding:'utf8'}));
    assert.deepEqual(cli.files[0].biologicalGroups,b);
    assert.throws(()=>runPcr({...args,controlSamples:['S1']}),/conflicts/);
  });
  await t.test('actual binary XLSX equals CSV; zipped RDML honors declared and explicit efficiencies',()=>{
    const require=createRequire(join(cfg.repos.pcr,'package.json'));const XLSX=require('xlsx');const {zipSync,strToU8}=require('fflate');
    const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet(plateMatrix),'Plate');
    const xlsx=file('plate.xlsx',XLSX.write(book,{bookType:'xlsx',type:'buffer'}));
    assert.deepEqual(runPcr({...pcrArgs,files:[xlsx]}).files[0].results,runPcr(pcrArgs).files[0].results);
    const rdml=file('plate.rdml',zipSync({'rdml_data.xml':strToU8(rdmlXml)}));
    const declared=runPcr({...pcrArgs,files:[rdml]}).files[0];assert.equal(declared.efficiencies.T,93);
    const explicit=runPcr({...pcrArgs,files:[rdml],efficiencies:{T:92}}).files[0];assert.equal(explicit.efficiencies.T,92);
    close(explicit.results.find(r=>r.sample==='S').foldChange,(2*1.92**2+1.92**-16)/3);
  });
  await t.test('real Chromium H-DAB regression and background-corrected control calibration',async()=>{
    const result=await runIhc({files:[hdab]});assertManifest(result,'ihc');const r=result.files[0];
    assert.equal(r.width,128);assert.equal(r.height,96);assert.equal(r.thresholdUsed,16);assert.equal(r.backgroundLevel,2);
    assert.equal(r.overall.totalNuclei,4);assert.equal(r.overall.positiveNuclei,4);assert.equal(r.overall.hScore,100);
    close(r.overall.positiveFraction,1192/12288);
    const control=await runIhc({files:[hdab],controlTif:hdab});assertManifest(control,'ihc');
    const expected=JSON.parse(readFileSync(new URL('./expected.json',import.meta.url))).controlThreshold;
    assert.equal(control.controlThreshold,expected);assert.equal(control.controlImageName,basename(hdab));
    assert.equal(control.provenance.inputs[1].role,'control');
    assert.equal(control.provenance.inputs[1].before.sha256,createHash('sha256').update(readFileSync(hdab)).digest('hex'));
  });
  await t.test('IF identical channels give Pearson 1 and independently calculated Manders values',async()=>{
    const result=await runIhc({files:[duplex],coloc:true});assertManifest(result,'if');const c=result.files[0].coloc;
    close(c.pearsonAll,1);close(c.pearsonMasked,1);assert.equal(c.thresholdA,88);assert.equal(c.backgroundA,0);
    const levels=Array.from({length:32},(_,i)=>64+6*i);const manders=levels.filter(v=>v>88).reduce((a,b)=>a+b,0)/levels.reduce((a,b)=>a+b,0);
    close(c.mandersM1,manders);close(c.mandersM2,manders);
  });
  await t.test('actual CLI and MCP route QC and drain real async IHC/IF at EOF',()=>{
    const output=execFileSync(process.execPath,[join(root,'cli.mjs'),'pcr',csv,'--config',cfgPath,'--ref','GAPDH','--control','C','--max-cq','35','--qc-mode','exclude'],{encoding:'utf8',timeout:30000,maxBuffer:32*1024*1024});
    const cli=JSON.parse(output);assertManifest(cli,'pcr');assert.deepEqual(cli.files[0].qcReport.excludedRowIds,[12]);
    const meta={'io.modelcontextprotocol/protocolVersion':'2026-07-28','io.modelcontextprotocol/clientCapabilities':{}};
    const messages=[['pcr_analyze',{...pcrArgs,qc:{maxCq:35},qcMode:'exclude'}],['ihc_quantify',{files:[hdab]}],['if_colocalize',{files:[duplex]}]]
      .map(([name,args],i)=>({jsonrpc:'2.0',id:i+1,method:'tools/call',params:{name,arguments:args,_meta:meta}}));
    const child=spawnSync(process.execPath,[join(root,'mcp-server.mjs'),'--config',cfgPath],{input:messages.map(JSON.stringify).join('\n')+'\n',encoding:'utf8',timeout:60000,maxBuffer:32*1024*1024});
    assert.equal(child.status,0,child.stderr);const replies=child.stdout.trim().split('\n').map(JSON.parse);assert.equal(replies.length,3);
    for(const [i,reply] of replies.entries()){assert.equal(reply.result.isError,false,reply.result.content[0].text);assertManifest(JSON.parse(reply.result.content[0].text),['pcr','ihc','if'][i]);}
    assert.deepEqual(JSON.parse(replies[0].result.content[0].text).files[0].qcReport.excludedRowIds,[12]);
  });
});
