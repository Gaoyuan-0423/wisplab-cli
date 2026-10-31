import { readFileSync, realpathSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

export function readEngineLock(path = new URL('./engines.lock.json', import.meta.url)) {
  const lock = JSON.parse(readFileSync(path, 'utf8'));
  if (lock.schemaVersion !== 1 || !lock.engines) throw new Error('Unsupported engine lock');
  for (const name of ['wb', 'ihc', 'pcr']) {
    const entry = lock.engines[name];
    if (!entry || !/^[\w.-]+\/[\w.-]+$/.test(entry.repository) || !/^[a-f0-9]{40}$/.test(entry.revision))
      throw new Error(`Invalid locked engine: ${name}`);
  }
  return lock;
}

export function checkEngineRevision(path, expectedRevision) {
  const git = args => {
    const r = spawnSync('git', ['-C', path, ...args], { encoding: 'utf8', timeout: 10000 });
    if (r.error || r.status !== 0) throw new Error(r.error?.message ?? r.stderr.trim());
    return r.stdout.trim();
  };
  try {
    if(realpathSync(git(['rev-parse', '--show-toplevel'])) !== realpathSync(path))
      throw new Error('Configured engine path is not a repository root');
    const revision = git(['rev-parse', 'HEAD']);
    const dirty = git(['status', '--porcelain']).length > 0;
    return { revision, expectedRevision, matchesLock: revision === expectedRevision, dirty,
      verified: revision === expectedRevision && !dirty };
  } catch (error) {
    return { revision: null, expectedRevision, matchesLock: false, dirty: null, verified: false, revisionError: error.message };
  }
}
