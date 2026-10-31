import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {loadConfig,config,runPcr} from '../../lib.mjs';

const root=fileURLToPath(new URL('../..',import.meta.url));
const close=(actual,expected,tol=1e-9)=>assert.ok(Number.isFinite(actual)&&Math.abs(actual-expected)<tol,`${actual} != ${expected}`);

test('real PCR efficiency normalization and unavailable primary-effect boundaries', {timeout:60000},async t=>{
  const cfg=loadConfig(),dir=mkdtempSync(join(tmpdir(),'wisplab-pcr-correctness-'));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const cfgPath=join(dir,'config.json');writeFileSync(cfgPath,JSON.stringify({...cfg,allowPaths:[dir]}));config(cfgPath);
  const file=(name,rows)=>{const path=join(dir,name);writeFileSync(path,['Sample,Target,Cq',...rows.map(row=>row.join(','))].join('\n'));return path;};
  const samples={C1:'C',C2:'C',S1:'S',S2:'S'},design={samples,controlGroup:'C'};
  const pairIds={C1:'1',S1:'1',C2:'2',S2:'2'};
  const cli=args=>{
    const flags=['pcr',args.files[0],'--config',cfgPath,'--ref','R','--groups',JSON.stringify(samples),'--control-group','C'];
    if(args.qc)flags.push('--max-cq',String(args.qc.maxCq),'--qc-mode',args.qcMode);
    if(args.biologicalDesign.paired)flags.push('--paired','--pair-ids',JSON.stringify(pairIds));
    const r=spawnSync(process.execPath,[join(root,'cli.mjs'),...flags],{encoding:'utf8'});
    assert.ok(r.stdout.trim(),r.stderr);return {status:r.status,result:JSON.parse(r.stdout)};
  };
  const mcp=args=>{
    const request={jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'pcr_analyze',arguments:args,_meta:{
      'io.modelcontextprotocol/protocolVersion':'2026-07-28','io.modelcontextprotocol/clientCapabilities':{}}}};
    const r=spawnSync(process.execPath,[join(root,'mcp-server.mjs'),'--config',cfgPath],{encoding:'utf8',input:JSON.stringify(request)+'\n'});
    assert.equal(r.status,0,r.stderr);const reply=JSON.parse(r.stdout).result;
    return {isError:reply.isError,result:JSON.parse(reply.content[0].text)};
  };
  const controls=[['C1','R',20],['C1','T',24],['C2','R',20],['C2','T',25]];
  const cases=[
    {name:'missing-reference',rows:[...controls,['S1','T',22],['S2','T',23],['NTC','R',30]],extra:{}},
    {name:'qc-removed-references',rows:[...controls,['S1','R',40],['S1','T',22],['S2','R',40],['S2','T',23],['NTC','R',30]],extra:{qc:{maxCq:35},qcMode:'exclude'}},
    {name:'no-complete-pairs',rows:[['C1','R',20],['C1','T',24],['C2','T',25],['S1','T',22],['S2','R',20],['S2','T',23],['NTC','R',30]],
      extra:{biologicalDesign:{...design,paired:true,pairIds}}},
  ];
  for(const scenario of cases)await t.test(`${scenario.name}: API/CLI/MCP fail primary inference while preserving every diagnostic`,()=>{
    const args={files:[file(`${scenario.name}.csv`,scenario.rows)],refGenes:['R'],biologicalDesign:design,...scenario.extra};
    const direct=runPcr(args),viaCli=cli(args),viaMcp=mcp(args);
    assert.equal(viaCli.status,1);assert.equal(viaMcp.isError,true);
    for(const result of [direct,viaCli.result,viaMcp.result]) {
      const f=result.files[0],c=f.biologicalGroups.comparisons[0];
      assert.equal(result.provenance.status,'error');assert.match(f.error,/No usable biological treatment\/control effect/);
      assert.equal(f.primaryAnalysis.status,'error');assert.equal(f.primaryAnalysis.kind,'biological-groups');
      assert.deepEqual(f.primaryAnalysis.comparisons,f.biologicalGroups.comparisons);
      assert.equal(c.log2FoldChange,null);assert.ok(f.biologicalGroups.units.some(u=>u.reason==='missing-reference'));
      assert.ok(f.qcReport.rows.length);assert.ok(f.results.some(r=>r.isControl));
      assert.equal(f.ntcReport.find(r=>r.target==='R').verdict,'contaminated');
      if(scenario.name==='qc-removed-references')assert.deepEqual(f.qcReport.excludedRowIds,[5,7]);
      if(scenario.name==='no-complete-pairs'){assert.equal(c.nPairs,0);assert.equal(c.pairing.omittedPairs.length,2);}
    }
  });
  await t.test('one usable biological treatment or complete pair remains a valid descriptive effect without p or CI',()=>{
    const input=file('one-usable.csv',[...controls,['S1','R',20],['S1','T',22],['S2','T',23]]);
    for(const biologicalDesign of [design,{...design,paired:true,pairIds}]) {
      const args={files:[input],refGenes:['R'],biologicalDesign},viaCli=cli(args),viaMcp=mcp(args);
      assert.equal(viaCli.status,0,JSON.stringify(viaCli.result));assert.equal(viaMcp.isError,false);
      for(const result of [runPcr(args),viaCli.result,viaMcp.result]) {
        const f=result.files[0],c=f.primaryAnalysis.comparisons[0];
        assert.equal(f.error,undefined);assert.equal(f.primaryAnalysis.status,'success');assert.equal(result.provenance.status,'success');
        close(c.log2FoldChange,biologicalDesign.paired?2:2.5);assert.equal(c.pValue,null);assert.equal(c.log2FoldChangeCI95,null);
      }
    }
  });
  await t.test('both well-level and biological outputs honor per-reference efficiencies whose mean is 100%',()=>{
    const input=file('unequal-reference-efficiencies.csv',Object.keys(samples).flatMap((sample,i)=>[
      [sample,'T',25],[sample,'T',25],[sample,'R1',i<2?20:30],[sample,'R2',i<2?30:20],
    ]));
    const result=runPcr({files:[input],refGenes:['R1','R2'],efficiencies:{T:100,R1:90,R2:110},biologicalDesign:design});
    const f=result.files[0];assert.equal(f.error,undefined);assert.equal(f.effMode,true);
    // Independent R 4.5.3 in quantity space: 1/sqrt(1.9^(-10)*2.1^10).
    close(f.primaryAnalysis.comparisons[0].foldChange,.60627761164574501,1e-12);
    for(const row of f.results.filter(r=>!r.isControl))close(row.foldChange,.60627761164574501,1e-12);
  });
  await t.test('biological Welch and paired p/CI agree with independent quantity-domain R references',()=>{
    const groups={C1:'C',C2:'C',C3:'C',S1:'S',S2:'S',S3:'S'};
    const target=[25,25.3,24.7,24,23.8,24.2],r1=[20,21,19,30,29.5,30.5],r2=[30,29,31,20,20.5,19.5];
    const input=file('quantity-reference.csv',Object.keys(groups).flatMap((sample,i)=>[[sample,'T',target[i]],[sample,'R1',r1[i]],[sample,'R2',r2[i]]]));
    for(const paired of [false,true]) {
      const biologicalDesign={samples:groups,controlGroup:'C',...(paired?{paired:true,pairIds:Object.fromEntries(Object.keys(groups).map(s=>[s,s.slice(1)]))}:{})};
      const f=runPcr({files:[input],refGenes:['R1','R2'],efficiencies:{T:95,R1:90,R2:110},biologicalDesign}).files[0];
      assert.equal(f.error,undefined);const c=f.primaryAnalysis.comparisons[0];
      close(c.foldChange,1.1822413427092027);close(c.pValue,paired?.55182762196002455:.39258993096257916);
      close(c.log2FoldChangeCI95[0],paired?-1.2241899397635911:-.49622455223176298);
      close(c.log2FoldChangeCI95[1],paired?1.7072390943616138:.97927370682978565);
    }
  });
});
