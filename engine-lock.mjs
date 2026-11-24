import { readFileSync, realpathSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const cliRoot = realpathSync(fileURLToPath(new URL('.', import.meta.url)));
const modulePaths = { wb: 'apps/wb', ihc: 'apps/pathology', pcr: 'apps/pcr' };
const sha = /^[a-f0-9]{40}$/;

export function readEngineLock(path = new URL('./engines.lock.json', import.meta.url)) {
  const lock = JSON.parse(readFileSync(path, 'utf8'));
  if (lock.schemaVersion !== 1 || !lock.engines) throw new Error('Unsupported engine lock');
  for (const [name, modulePath] of Object.entries(modulePaths)) {
    const entry = lock.engines[name];
    if (!entry || !/^[\w.-]+\/[\w.-]+$/.test(entry.repository) || !sha.test(entry.revision))
      throw new Error(`Invalid locked engine: ${name}`);
    if (entry.bundled && (entry.bundled.path !== modulePath || !sha.test(entry.bundled.tree) || !sha.test(entry.bundled.upstreamRevision)))
      throw new Error(`Invalid bundled engine: ${name}`);
  }
  return lock;
}

// Both paths must be canonical. Other configured checkouts keep their original root-only contract.
export function repositoryScope(root, path) {
  if (root === path) return { paths: root === cliRoot ? ['.', ':(exclude)apps/**'] : ['.'] };
  const modulePath = Object.values(modulePaths).find(name => root === cliRoot && join(root, name) === path);
  if (modulePath) return { modulePath, paths: ['.'] };
  throw new Error('Configured engine path is not a repository root or bundled engine');
}

export function checkEngineRevision(path, lock) {
  const expectedRevision = typeof lock === 'string' ? lock : lock.revision;
  const git = args => {
    const r = spawnSync('git', ['-C', path, '--no-optional-locks', ...args], { encoding: 'utf8', timeout: 10000 });
    if (r.error || r.status !== 0) throw new Error(r.error?.message ?? r.stderr.trim());
    return r.stdout.trim();
  };
  try {
    const scope = repositoryScope(realpathSync(git(['rev-parse', '--show-toplevel'])), realpathSync(path));
    const revision = git(['rev-parse', 'HEAD']);
    const dirty = git(['status', '--porcelain', '--untracked-files=all', '--', ...scope.paths]).length > 0;
    if (scope.modulePath) {
      const bundled = lock.bundled;
      if (bundled?.path !== scope.modulePath) throw new Error('Configured path does not match the locked bundled engine');
      const tree = git(['rev-parse', 'HEAD:' + scope.modulePath]);
      const matchesLock = tree === bundled.tree;
      return { revision, expectedRevision: null, upstreamRevision: bundled.upstreamRevision, modulePath: scope.modulePath, tree,
        expectedTree: bundled.tree, matchesLock, dirty, verified: matchesLock && !dirty };
    }
    return { revision, expectedRevision, matchesLock: revision === expectedRevision, dirty,
      verified: revision === expectedRevision && !dirty };
  } catch (error) {
    return { revision: null, expectedRevision, matchesLock: false, dirty: null, verified: false, revisionError: error.message };
  }
}
