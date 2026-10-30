/** Local-only vendor corpus inventory/run; images never copied into this repository. */
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { runIhc } from '../lib.mjs';
const [rootArg,outArg]=process.argv.slice(2);
if(!rootArg||!outArg)throw new Error('Usage: node scripts/check-vendor-images.mjs <IHC corpus directory> <output directory>');
const root=resolve(rootArg),output=resolve(outArg);
const sources=JSON.parse(readFileSync(join(root,'sources.json')));
const filesIn=folder=>readdirSync(join(root,'images',folder)).filter(n=>/\.jpg$/i.test(n)).sort().map(n=>join(root,'images',folder,n));
const scenes=[{name:'dab',profile:'h_dab',files:sources.images.map(i=>join(root,i.file))},
 {name:'he',profile:'h_eosin',files:filesIn('he')},{name:'masson',profile:'masson',files:filesIn('masson')},
 {name:'if',coloc:true,files:filesIn('if')}];
mkdirSync(output,{recursive:true});
const summary={generatedAt:new Date().toISOString(),sourceManifest:sources.downloadedAt,scenes:[],
 limitations:['Vendor web examples; no manual nucleus labels found in this corpus.',
 'IF uses rendered R/G channels, not original spectrally unmixed channels.',
 'Successful execution does not establish scientific accuracy or scanner robustness.']};
for(const scene of scenes){
 const result=await runIhc(scene);
 writeFileSync(join(output,`${scene.name}.json`),JSON.stringify(result,null,2)+'\n');
 const errors=result.files.filter(f=>f.error);
 summary.scenes.push({scene:scene.name,total:result.files.length,completed:result.files.length-errors.length,errors:errors.map(f=>({file:f.file,error:f.error})),checks:result.provenance.checks});
 console.log(JSON.stringify(summary.scenes.at(-1)));
}
writeFileSync(join(output,'summary.json'),JSON.stringify(summary,null,2)+'\n');
if(summary.scenes.some(s=>s.errors.length||Object.values(s.checks).some(v=>!v)))process.exitCode=1;
