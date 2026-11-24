import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

test('bundled verification and provenance isolate each engine from the CLI and sibling applications', async t => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'wisplab-monorepo-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const file of ['engine-lock.mjs', 'provenance.mjs', 'runtime-controls.mjs']) {
    copyFileSync(new URL('../' + file, import.meta.url), join(root, file));
  }
  const engine = join(root, 'apps', 'wb');
  const sibling = join(root, 'apps', 'pcr');
  mkdirSync(engine, { recursive: true });
  mkdirSync(sibling, { recursive: true });
  writeFileSync(join(root, 'package.json'), '{"version":"test"}');
  writeFileSync(join(engine, 'engine.ts'), 'initial');
  writeFileSync(join(sibling, 'other.ts'), 'initial');
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init');
  git('add', '.');
  git('-c', 'user.name=Fixture', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-m', 'fixture');
  const revision = git('rev-parse', 'HEAD');
  const tree = git('rev-parse', 'HEAD:apps/wb');
  const lock = { revision: '1'.repeat(40), bundled: { path: 'apps/wb', tree, upstreamRevision: '2'.repeat(40) } };
  const { checkEngineRevision } = await import(pathToFileURL(join(root, 'engine-lock.mjs')));
  const { trackAnalysisSync, trackAnalysis } = await import(pathToFileURL(join(root, 'provenance.mjs')));
  const verified = checkEngineRevision(engine, lock);
  assert.equal(verified.verified, true);
  assert.equal(verified.tree, tree);
  assert.equal(verified.revision, revision);
  assert.equal(checkEngineRevision(sibling, lock).verified, false);
  assert.equal(checkEngineRevision(engine, { ...lock, bundled: { ...lock.bundled, tree: '0'.repeat(40) } }).verified, false);
  const spec = { analysis: 'wb', engineDir: engine, bridgeDir: root, parameters: {}, inputs: [] };
  const first = trackAnalysisSync(spec, () => {
    writeFileSync(join(sibling, 'other.ts'), 'changed');
    return {};
  }).provenance;
  assert.equal(first.engine.before.modulePath, 'apps/wb');
  assert.equal(first.engine.before.sourceFileCount, 1);
  assert.equal(first.cli.before.sourceFileCount, 4);
  assert.equal(first.checks.bridgeUnchanged, true);
  assert.equal(first.checks.engineUnchanged, true);
  assert.equal(checkEngineRevision(engine, lock).verified, true);

  const second = (await trackAnalysis(spec, async () => {
    writeFileSync(join(engine, 'extra.ts'), 'new untracked module');
    return {};
  })).provenance;
  assert.deepEqual(second.engine.before, first.engine.before);
  assert.equal(second.checks.bridgeUnchanged, true);
  assert.equal(second.checks.engineUnchanged, false);
  assert.equal(second.engine.after.dirty, true);
  assert.equal(checkEngineRevision(engine, lock).verified, false);
});
