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
