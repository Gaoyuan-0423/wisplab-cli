import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {loadConfig} from '../../lib.mjs';

const root=fileURLToPath(new URL('../..',import.meta.url));
const close=(actual,expected,tolerance=1e-9)=>assert.ok(Number.isFinite(actual)&&Math.abs(actual-expected)<=tolerance,`${actual} != ${expected}`);

test('pinned real PCR import and design runner', {timeout:60000},async t=>{
  const engine=loadConfig().repos.pcr;
  const lock=JSON.parse(readFileSync(new URL('../../engines.lock.json',import.meta.url)));
  assert.equal(execFileSync('git',['-C',engine,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),lock.engines.pcr.revision);
  const dir=mkdtempSync(join(tmpdir(),'wisplab-pcr-import-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const source=readFileSync(join(root,'runners/pcr-run.ts'),'utf8').replaceAll('<PCR>',pathToFileURL(engine).href).replaceAll('<CLI>',pathToFileURL(root).href);
  writeFileSync(join(dir,'package.json'),'{"type":"module"}\n');
  const runner=join(dir,'pcr-run.ts');writeFileSync(runner,source);
  const run=payload=>{
    const stdout=execFileSync(join(engine,'node_modules/.bin/tsx'),[runner,JSON.stringify(payload)],{encoding:'utf8',maxBuffer:32*1024*1024});
    return JSON.parse(stdout.split('\n').find(s=>s.startsWith('@@WISPLAB@@')).slice('@@WISPLAB@@'.length)).files[0];
  };
  const require=createRequire(join(engine,'package.json')),XLSX=require('xlsx');
  const workbook=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook,XLSX.utils.aoa_to_sheet([['Summary only']]),'Summary');
  const matrix=[['Instrument metadata'],[],['Specimen','Gene code','Cycle','Cycle'],['C','R',20,999],[],['C','T',24,999],['S','R',20,999],['S','T',22,999]];
  XLSX.utils.book_append_sheet(workbook,XLSX.utils.aoa_to_sheet(matrix),'2');
  const excel=join(dir,'instrument.xlsx');writeFileSync(excel,XLSX.write(workbook,{type:'buffer',bookType:'xlsx'}));
  const importOptions={sheet:'2',headerRow:3,columns:{sample:'Specimen',target:'Gene code',cq:3}};
  await t.test('real Excel preview preserves physical rows and numeric sheet names, without needing refs or invoking inference',()=>{
    const preview=run({files:[excel],mode:'preview',importOptions});
    assert.equal(preview.error,undefined);assert.equal(preview.primaryAnalysis,undefined);assert.equal(preview.qcReport,undefined);
    assert.equal(preview.importPreview.canAnalyze,true);assert.deepEqual(preview.importPreview.sheetNames,['Summary','2']);
    assert.deepEqual(preview.importPreview.rows.map(r=>[r.sourceRow,r.analysisRowId]),[[4,1],[5,null],[6,2],[7,3],[8,4]]);
    assert.equal(preview.importPreview.rows[4].parsed.cq,22);assert.equal(preview.importPreview.columns.cq.index,3);
    assert.equal(preview.importPreview.preambleRows[0].rawValues[0],'Instrument metadata');
    const auto=run({files:[excel],mode:'preview'});
    assert.equal(auto.sheet,'Summary');assert.equal(auto.status,'success');assert.equal(auto.importPreview.canAnalyze,false);
    assert.ok(auto.warnings.some(w=>w.includes('Only the first worksheet')));
    assert.match(run({files:[excel],mode:'preview',importOptions:{sheet:'1'}}).error,/Worksheet not found/);
    assert.match(run({files:[excel],mode:'preview',importOptions:{...importOptions,columns:{sample:1,target:2,cq:'Cycle'}}}).error,/ambiguous/);
  });
  await t.test('real analysis obeys the same explicit mapping and preserves exclusion ids across blank source rows',()=>{
    const result=run({files:[excel],importOptions,refGenes:['R'],controlSamples:['C']});
    assert.equal(result.error,undefined);close(result.results.find(r=>r.sample==='S').foldChange,4);
    assert.equal(result.importReport.rows.find(r=>r.analysisRowId===2).sourceRow,6);
    const excluded=run({files:[excel],importOptions,refGenes:['R'],controlSamples:['C'],excludeRows:[4]});
    assert.deepEqual(excluded.qcReport.excludedRowIds,[4]);
    assert.equal(excluded.importReport.rows.find(r=>r.analysisRowId===4).sourceRow,8);
  });
  const csv=(name,logs)=>{
    const path=join(dir,name),data=['Sample,Target,Cq'];
    for(const [sample,value] of Object.entries(logs))data.push(`${sample},R,20`,`${sample},T,${20-value}`);
    writeFileSync(path,data.join('\n'));return path;
  };
  await t.test('real unpaired unequal-n Welch effect and confidence limits match independent R 4.5.3',()=>{
    // stats::t.test(c(1.2,2.8,3.1,4.7,6),c(.1,1,1.2,1.5)), defaults two-sided/Welch/95%.
    const logs={C1:.1,C2:1,C3:1.2,C4:1.5,S1:1.2,S2:2.8,S3:3.1,S4:4.7,S5:6};
    const samples=Object.fromEntries(Object.keys(logs).map(s=>[s,s[0]]));
    const result=run({files:[csv('welch.csv',logs)],refGenes:['R'],controlSamples:['C1','C2','C3','C4'],biologicalDesign:{samples,controlGroup:'C'}});
    assert.equal(result.error,undefined);const c=result.primaryAnalysis.comparisons[0];
    assert.equal(c.inferenceMethod,'welch-t');assert.equal(c.nBiological,5);assert.equal(c.nControl,4);
    close(c.log2FoldChange,2.61);close(c.pValue,0.030948735949571);close(c.df,5.01971906499195);
    close(c.log2FoldChangeCI95[0],0.3548901971541184);close(c.log2FoldChangeCI95[1],4.8651098028458826);
    close(c.foldChangeCI95[0],1.2788882419863434);close(c.foldChangeCI95[1],29.1436527003339307);
  });
  await t.test('real paired inference matches R and drops a QC-excluded pair explicitly',()=>{
    const logs={C1:1,C2:3,C3:5,C4:9,S4:10,S2:5,S1:2,S3:8};
    const samples=Object.fromEntries(Object.keys(logs).map(s=>[s,s[0]]));
    const pairIds=Object.fromEntries(Object.keys(logs).map(s=>[s,s.slice(1)]));
    const args={files:[csv('paired.csv',logs)],refGenes:['R'],controlSamples:['C1','C2','C3','C4'],biologicalDesign:{samples,controlGroup:'C',paired:true,pairIds}};
    const result=run(args);assert.equal(result.error,undefined);const c=result.primaryAnalysis.comparisons[0];
    close(c.pValue,0.035352847002517);close(c.log2FoldChange,1.75);assert.equal(c.nPairs,4);
    close(c.log2FoldChangeCI95[0],0.22651981917118771);close(c.log2FoldChangeCI95[1],3.27348018082881209);
    const filtered=run({...args,excludeRows:[7]}),f=filtered.primaryAnalysis.comparisons[0];
    assert.equal(filtered.error,undefined);assert.equal(f.nPairs,3);assert.equal(f.log2FoldChange,2);
    assert.deepEqual(f.pairing.omittedPairs,[{pairId:'4',sample:'S4',controlSample:'C4',sampleReason:null,controlReason:'missing-reference'}]);
    assert.deepEqual(filtered.qcReport.excludedRowIds,[7]);
  });
});
