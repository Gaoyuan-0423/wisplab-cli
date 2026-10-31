import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeBiologicalGroups, normalizeBiologicalDesign, holmAdjust } from '../pcr-groups.mjs';
const mean=a=>a.reduce((x,y)=>x+y,0)/a.length;
const sd=a=>Math.sqrt(mean(a.map(x=>(x-mean(a))**2))*a.length/(a.length-1));
const api={mean,sd,isNtcRow:r=>r.sample==='NTC',isStandardRow:()=>false,welchTTest:(a,b)=>({p:0.25,t:mean(a)-mean(b),df:a.length+b.length-2})};
const design={samples:{C1:'C',C2:'C',S1:'S',S2:'S'},controlGroup:'C'};
const rows=Object.keys(design.samples).flatMap((sample,i)=>[{sample,target:'R',cq:20},{sample,target:'T',cq:24-i}]);
const options={refGenes:['R'],biologicalDesign:design};
test('single reference works; repeating technical wells does not change biological n or group result',()=>{
 const a=analyzeBiologicalGroups(rows,options,api),b=analyzeBiologicalGroups(rows.flatMap(r=>[r,r,r]),options,api);
 assert.deepEqual(a.summaries,b.summaries);assert.deepEqual(a.comparisons,b.comparisons);
 assert.equal(a.summaries[1].nBiological,2);assert.equal(a.summaries[1].foldChange,4);
 assert.equal(b.units[0].technicalWellCount,3);
});
test('unmapped samples and invalid designs fail; missing reference remains visible without inflating n',()=>{
 assert.throws(()=>normalizeBiologicalDesign({samples:{C:'C'},controlGroup:'C'}),/treatment/);
 assert.throws(()=>analyzeBiologicalGroups([...rows,{sample:'X',target:'R',cq:20}],options,api),/Unmapped/);
 const r=analyzeBiologicalGroups(rows.filter(r=>!(r.sample==='S2'&&r.target==='R')),options,api);
 assert.deepEqual(r.summaries[1].missingSamples,['S2']);assert.equal(r.comparisons[0].pValue,null);
 assert.equal(r.comparisons[0].reason,'insufficient-biological-replicates');
});
test('zero variance is unavailable instead of p=1; exclusions change usable sample n',()=>{
 const fixed=rows.map(r=>({...r,cq:r.target==='R'?20:r.sample.startsWith('C')?24:22}));
 assert.equal(analyzeBiologicalGroups(fixed,options,api).comparisons[0].reason,'zero-variance');
 const r=analyzeBiologicalGroups(rows.map(r=>({...r,excluded:r.sample==='S2'})),options,api);
 assert.equal(r.summaries[1].nBiological,1);
});
test('Holm uses the whole planned family and preserves null comparisons',()=>{
 const actual=holmAdjust([0.01,0.04,null,0.03]);
 actual.forEach((v,i)=>assert.ok(v===null?i===2:Math.abs(v-[0.04,0.09,0,0.09][i])<1e-12));
});

test('paired design requires exact sample coverage, one sample per group/pair and all groups per pair',()=>{
 const pairIds={C1:'P1',C2:'P2',S1:'P1',S2:'P2'};
 assert.deepEqual(normalizeBiologicalDesign({...design,paired:true,pairIds}).pairIds,pairIds);
 assert.throws(()=>normalizeBiologicalDesign({...design,pairIds}),/requires paired/);
 assert.throws(()=>normalizeBiologicalDesign({...design,paired:'yes',pairIds}),/boolean/);
 assert.throws(()=>normalizeBiologicalDesign({...design,paired:true}),/explicit/);
 assert.throws(()=>normalizeBiologicalDesign({...design,paired:true,pairIds:{C1:'P1',S1:'P1',TYPO:'P2'}}),/missing: C2, S2; unknown: TYPO/);
 assert.throws(()=>normalizeBiologicalDesign({...design,paired:true,pairIds:{...pairIds,C2:'P1'}}),/Duplicate/);
 assert.throws(()=>normalizeBiologicalDesign({...design,paired:true,pairIds:{...pairIds,S2:'P3'}}),/Incomplete pairId/);
 assert.throws(()=>normalizeBiologicalDesign({...design,paired:true,pairIds:{...pairIds,S2:' P2'}}),/whitespace/);
});

test('paired inference follows declared ids regardless of row order and matches independent R',()=>{
 // R: t.test(c(2,5,8,10),c(1,3,5,9),paired=TRUE).
 const samples={C1:'C',C2:'C',C3:'C',C4:'C',S4:'S',S2:'S',S1:'S',S3:'S'};
 const pairIds=Object.fromEntries(Object.keys(samples).map(s=>[s,`P${s.slice(1)}`]));
 const logs={C1:1,C2:3,C3:5,C4:9,S1:2,S2:5,S3:8,S4:10};
 const data=Object.entries(logs).reverse().flatMap(([sample,log2])=>[{sample,target:'R',cq:20},{sample,target:'T',cq:20-log2}]);
 const opts={refGenes:['R'],biologicalDesign:{samples,controlGroup:'C',paired:true,pairIds}};
 const result=analyzeBiologicalGroups(data,opts,{...api,welchTTest:()=>{throw Error('paired design must not call Welch');}});
 const c=result.comparisons[0], s=result.summaries[1];
 const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-10,`${a} != ${b}`);
 assert.equal(c.inferenceMethod,'paired-t');assert.equal(c.nPairs,4);assert.equal(c.df,3);
 assert.equal(c.log2FoldChange,1.75);close(c.pValue,0.035352847002517);
 close(c.log2FoldChangeCI95[0],0.22651981917118771);close(c.log2FoldChangeCI95[1],3.27348018082881209);
 close(c.foldChangeCI95[0],1.1700091555078791);close(c.foldChangeCI95[1],9.6697606559101565);
 assert.deepEqual(s.log2FoldChangeCI95,c.log2FoldChangeCI95);
 assert.deepEqual(c.pairing.usedPairIds,['P4','P2','P1','P3']);
 assert.deepEqual(result.comparisons,analyzeBiologicalGroups(data.flatMap(r=>[r,r]),opts,api).comparisons);
 const missing=analyzeBiologicalGroups(data.filter(r=>!(r.sample==='C4'&&r.target==='R')),opts,api);
 const m=missing.comparisons[0];assert.equal(m.nPairs,3);assert.equal(m.nControl,3);
 assert.equal(m.log2FoldChange,2);assert.deepEqual(m.pairing.usedPairIds,['P2','P1','P3']);
 assert.deepEqual(m.pairing.omittedPairs,[{pairId:'P4',sample:'S4',controlSample:'C4',sampleReason:null,controlReason:'missing-reference'}]);
 assert.deepEqual(missing.summaries[1].missingSamples,['S4']);
 assert.equal(missing.summaries[1].foldChange,4);
});

test('constant paired differences and fewer than two complete pairs are reported without invented inference',()=>{
 const opts={...options,biologicalDesign:{...design,paired:true,pairIds:{C1:'1',C2:'2',S1:'1',S2:'2'}}};
 const constant=analyzeBiologicalGroups(rows,opts,api).comparisons[0];
 assert.equal(constant.reason,'zero-variance');assert.equal(constant.pValue,null);assert.equal(constant.log2FoldChangeCI95,null);
 const missing=analyzeBiologicalGroups(rows.map(r=>({...r,excluded:r.sample==='S2'})),opts,api).comparisons[0];
 assert.equal(missing.reason,'insufficient-complete-pairs');assert.equal(missing.nPairs,1);assert.equal(missing.foldChangeCI95,null);
});

test('optional references use their own efficiencies before geometric pooling, including means of 100%',()=>{
 const data=Object.keys(design.samples).flatMap((sample,i)=>[
   {sample,target:'T',cq:25+(i%2)*.1},
   {sample,target:'R1',cq:i<2?20:30},
   {sample,target:'R2',cq:i<2?30:20},
 ]);
 const opts={biologicalDesign:design,refGenes:['R1','R2'],efficiencies:{T:100,R1:90,R2:110}};
 const result=analyzeBiologicalGroups(data,opts,api),comparison=result.comparisons[0];
 // Independent R 4.5.3, in quantity space: 1/sqrt(1.9^(-10)*2.1^10).
 assert.ok(Math.abs(comparison.foldChange-0.60627761164574501)<1e-12);
 assert.ok(Math.abs(comparison.log2FoldChange-(-0.7219495466758747))<1e-12);
 assert.deepEqual(result.comparisons,analyzeBiologicalGroups(data,{...opts,refGenes:['R2','R1']},api).comparisons);
 const duplicated=data.flatMap(row=>row.target==='R1'?[row,row,row,row]:[row]);
 assert.deepEqual(result.summaries,analyzeBiologicalGroups(duplicated,opts,api).summaries);
 const defaulted=analyzeBiologicalGroups(data,{...opts,efficiencies:{}},api);
 const all100=analyzeBiologicalGroups(data,{...opts,efficiencies:{T:100,R1:100,R2:100}},api);
 assert.deepEqual(defaulted.comparisons,all100.comparisons);
 assert.equal(defaulted.comparisons[0].foldChange,1);
});

test('unequal reference efficiencies match independent R normalized quantities before paired inference',()=>{
 const samples={C1:'C',C2:'C',C3:'C',S1:'S',S2:'S',S3:'S'};
 const target=[25,25.3,24.7,24,23.8,24.2],r1=[20,21,19,30,29.5,30.5],r2=[30,29,31,20,20.5,19.5];
 const data=Object.keys(samples).flatMap((sample,i)=>[{sample,target:'T',cq:target[i]},{sample,target:'R1',cq:r1[i]},{sample,target:'R2',cq:r2[i]}]);
 const pairIds=Object.fromEntries(Object.keys(samples).map(sample=>[sample,sample.slice(1)]));
 const result=analyzeBiologicalGroups(data,{refGenes:['R1','R2'],efficiencies:{T:95,R1:90,R2:110},
   biologicalDesign:{samples,controlGroup:'C',paired:true,pairIds}},api);
 const expected=[1.22898100456105186,.86774381270099787,1.59021819642110551,1.47050558186006297,1.69929788398883330,1.24171327973129286];
 result.units.forEach((unit,i)=>assert.ok(Math.abs(unit.log2Expression-expected[i])<1e-12));
 const c=result.comparisons[0];
 assert.ok(Math.abs(c.foldChange-1.1822413427092027)<1e-12);
 assert.ok(Math.abs(c.pValue-.55182762196002455)<1e-10);
 assert.ok(Math.abs(c.log2FoldChangeCI95[0]-(-1.2241899397635911))<1e-10);
 assert.ok(Math.abs(c.log2FoldChangeCI95[1]-1.7072390943616138)<1e-10);
});
