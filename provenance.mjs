import { createHash, randomUUID } from 'node:crypto';
import { openSync, readSync, closeSync, statSync, readFileSync, realpathSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { basename, join } from 'node:path';
import { performance } from 'node:perf_hooks';

function fingerprint(path) {
  let fd;
  try {
    const before = statSync(path);
    if (!before.isFile()) throw new Error('not-a-file');
    const hash = createHash('sha256');
    fd = openSync(path, 'r');
    const buffer = Buffer.alloc(1024 * 1024);
    let length;
    while ((length = readSync(fd, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, length));
    const after = statSync(path);
    return { sha256: hash.digest('hex'), sizeBytes: after.size,
      stableWhileHashing: before.size === after.size && before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs,
      mtimeMs: after.mtimeMs, ctimeMs: after.ctimeMs };
  } catch (error) { return { sha256: null, error: error.code ?? error.message }; }
  finally { if (fd !== undefined) closeSync(fd); }
}

export function snapshotRepository(path) {
  const git = (...args) => {
    const r = spawnSync('git', ['-C', path, ...args], { encoding: 'utf8', timeout: 10000, maxBuffer: 8 * 1024 * 1024 });
    if (r.status !== 0 || r.error) throw new Error('Git metadata unavailable');
    return r.stdout;
  };
  try {
    if (realpathSync(git('rev-parse', '--show-toplevel').trim()) !== realpathSync(path)) throw new Error('Engine path is not a repository root');
    const revision = git('rev-parse', 'HEAD').trim();
    const dirty = git('status', '--porcelain').trim().length > 0;
    const names = [...new Set(git('ls-files', '-z', '--cached', '--others', '--exclude-standard').split('\0').filter(Boolean))].sort();
    const hash = createHash('sha256');
    let complete = true;
    for (const name of names) {
      const f = fingerprint(join(path, name));
      hash.update(JSON.stringify([name, f.sha256, f.error ?? null]) + '\n');
      if (!f.sha256 || !f.stableWhileHashing) complete = false;
    }
    return { revision, dirty, sourceSha256: hash.digest('hex'), sourceFileCount: names.length, complete };
  } catch (error) { return { revision: null, dirty: null, sourceSha256: null, complete: false, error: error.message }; }
}

function sameFile(a, b) {
  return Boolean(a.sha256 && a.sha256 === b.sha256 && a.sizeBytes === b.sizeBytes && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs && a.stableWhileHashing && b.stableWhileHashing);
}
function sameRepo(a, b) {
  return Boolean(a.complete && b.complete && a.revision === b.revision && a.sourceSha256 === b.sourceSha256 && a.dirty === b.dirty);
}
function start({ analysis, engineDir, bridgeDir, parameters, inputs }) {
  const startedAt = new Date().toISOString();
  const tick = performance.now();
  const before = inputs.map(({path}) => fingerprint(path));
  const engineBefore = snapshotRepository(engineDir);
  const bridgeBefore = snapshotRepository(bridgeDir);
  const version = JSON.parse(readFileSync(join(bridgeDir, 'package.json'), 'utf8')).version;
  return (result, error) => {
    const after = inputs.map(({path}) => fingerprint(path));
    const engineAfter = snapshotRepository(engineDir);
    const bridgeAfter = snapshotRepository(bridgeDir);
    const entries = [...(result?.files ?? []), ...(result?.images ?? [])];
    const warnings = [];
    const inputRecords = inputs.map(({path, role = 'input'}, index) => {
      const unchanged = sameFile(before[index], after[index]);
      if (!unchanged) warnings.push(`Input ${index + 1} changed or could not be fingerprinted`);
      return { index, role, file: basename(path), before: before[index], after: after[index], unchanged };
    });
    const engineUnchanged = sameRepo(engineBefore, engineAfter);
    const bridgeUnchanged = sameRepo(bridgeBefore, bridgeAfter);
    if (!engineUnchanged) warnings.push('Engine source changed or Git metadata is unavailable');
    if (!bridgeUnchanged) warnings.push('Bridge source changed or Git metadata is unavailable');
    if (engineBefore.dirty || bridgeBefore.dirty) warnings.push('Uncommitted source changes are fingerprinted but are not archived');
    const provenance = {
      schemaVersion: 'wisplab.provenance/v1', runId: randomUUID(), analysis,
      startedAt, finishedAt: new Date().toISOString(), durationMs: Math.round(performance.now() - tick),
      status: error || (entries.length > 0 && entries.every(entry => entry?.error)) ? 'error' : entries.some(entry => entry?.error) ? 'partial-error' : 'success',
      runtime: { node: process.version, platform: process.platform, arch: process.arch },
      cli: { version, before: bridgeBefore, after: bridgeAfter },
      engine: { before: engineBefore, after: engineAfter },
      parameters, inputs: inputRecords,
      resolvedParameters: entries.map(entry => ({ file: entry.file, ...(analysis === 'pcr' ? {
        refGenes: entry.refGenesUsed, controlSamples: entry.controlSamples, efficiencies: entry.efficiencies,
        qc: entry.qcReport?.thresholds, excludedRowIds: entry.qcReport?.excludedRowIds,
      } : { settings: entry.settings }) })),
      checks: { inputsUnchanged: inputRecords.every(input => input.unchanged), engineUnchanged, bridgeUnchanged },
      warnings, error: error ? error.message : null,
    };
    if (error) { error.provenance = provenance; throw error; }
    return { ...result, provenance };
  };
}
export function trackAnalysisSync(spec, operation) {
  const finish = start(spec);
  let result;
  try { result = operation(); } catch (error) { return finish(undefined, error); }
  return finish(result);
}
export async function trackAnalysis(spec, operation) {
  const finish = start(spec);
  let result;
  try { result = await operation(); } catch (error) { return finish(undefined, error); }
  return finish(result);
}
