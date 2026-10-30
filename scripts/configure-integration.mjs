import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
const lock=JSON.parse(readFileSync(new URL('../engines.lock.json',import.meta.url)));
const root=resolve(process.argv[2]??'.engines');const repos={};
for(const [name,engine] of Object.entries(lock.engines)) {
 const path=join(root,name);const revision=execFileSync('git',['-C',path,'rev-parse','HEAD'],{encoding:'utf8'}).trim();
 if(revision!==engine.revision)throw new Error(`${name}: expected ${engine.revision}, got ${revision}`);
 repos[name]=path;
}
mkdirSync('.integration',{recursive:true});
writeFileSync('.integration/config.json',JSON.stringify({repos,ihc:{devPort:5173},allowPaths:[tmpdir()]},null,2)+'\n');
console.log('Configured pinned integration engines in .integration/config.json');
