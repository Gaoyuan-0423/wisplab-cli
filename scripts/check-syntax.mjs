import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

// Cover every maintained JavaScript module, including new command adapters and test fixtures.
const roots = ['.', 'scripts', 'runners', 'tests'];
function visit(dir, recursive) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory() && recursive) visit(path, true);
    else if (entry.isFile() && entry.name.endsWith('.mjs')) {
      const result = spawnSync(process.execPath, ['--check', path], { stdio: 'inherit' });
      if (result.status !== 0 || result.error) process.exit(result.status ?? 1);
    }
  }
}
for (const root of roots) visit(root, root !== '.');
