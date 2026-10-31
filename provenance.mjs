import { createHash, randomUUID } from 'node:crypto';
import { openSync, readSync, closeSync, statSync, readFileSync, realpathSync, createReadStream } from 'node:fs';
import { stat, readFile, realpath } from 'node:fs/promises';
import { spawnSync, execFile } from 'node:child_process';
import { basename, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { cancellationError } from './runtime-controls.mjs';

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
function finish({ analysis, parameters, inputs }, { startedAt, tick, before, engineBefore, bridgeBefore, version }, { after, engineAfter, bridgeAfter }, result, error) {
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
    status: error || (entries.length > 0 && entries.every(entry => entry?.error)) || (result?.error && !entries.length) ? 'error' : result?.error || entries.some(entry => entry?.error) ? 'partial-error' : 'success',
    runtime: { node: process.version, platform: process.platform, arch: process.arch },
    cli: { version, before: bridgeBefore, after: bridgeAfter },
    engine: { before: engineBefore, after: engineAfter },
    parameters, inputs: inputRecords,
    resolvedParameters: entries.map(entry => ({ file: entry.file, ...(analysis === 'pcr' ? {
      refGenes: entry.refGenesUsed, controlSamples: entry.controlSamples, efficiencies: entry.efficiencies,
      qc: entry.qcReport?.thresholds, excludedRowIds: entry.qcReport?.excludedRowIds,
    } : { settings: entry.settings }) })),
    checks: { inputsUnchanged: inputRecords.every(input => input.unchanged), engineUnchanged, bridgeUnchanged },
    warnings, error: error ? error.message : result?.error ?? null,
  };
  if (error) { error.provenance = provenance; throw error; }
  return { ...result, provenance };
}
export function trackAnalysisSync(spec, operation) {
  const { engineDir, bridgeDir, inputs } = spec;
  const initial = { startedAt: new Date().toISOString(), tick: performance.now(),
    before: inputs.map(({path}) => fingerprint(path)), engineBefore: snapshotRepository(engineDir), bridgeBefore: snapshotRepository(bridgeDir),
    version: JSON.parse(readFileSync(join(bridgeDir, 'package.json'), 'utf8')).version };
  let result, error;
  try { result = operation(); } catch (caught) { error = caught; }
  return finish(spec, initial, { after: inputs.map(({path}) => fingerprint(path)),
    engineAfter: snapshotRepository(engineDir), bridgeAfter: snapshotRepository(bridgeDir) }, result, error);
}

function checkCancelled(signal) { if (signal?.aborted) throw cancellationError(); }
async function fingerprintAsync(path, signal) {
  checkCancelled(signal);
  try {
    const before = await stat(path);
    if (!before.isFile()) throw new Error('not-a-file');
    const hash = createHash('sha256');
    // Yield between chunks so even very large images cannot block MCP ping/cancel.
    for await (const chunk of createReadStream(path, { highWaterMark: 1024 * 1024, signal })) {
      checkCancelled(signal); hash.update(chunk);
    }
    const after = await stat(path);
    checkCancelled(signal);
    return { sha256: hash.digest('hex'), sizeBytes: after.size,
      stableWhileHashing: before.size === after.size && before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs,
      mtimeMs: after.mtimeMs, ctimeMs: after.ctimeMs };
  } catch (error) {
    checkCancelled(signal);
    return { sha256: null, error: error.code ?? error.message };
  }
}
async function snapshotRepositoryAsync(path, signal) {
  checkCancelled(signal);
  const git = (...args) => new Promise((resolve, reject) => {
    execFile('git', ['-C', path, ...args], { encoding: 'utf8', timeout: 10000, maxBuffer: 8 * 1024 * 1024, signal, killSignal: 'SIGKILL' },
      (error, stdout) => error ? reject(error) : resolve(stdout));
  });
  try {
    if (await realpath((await git('rev-parse', '--show-toplevel')).trim()) !== await realpath(path)) throw new Error('Engine path is not a repository root');
    const revision = (await git('rev-parse', 'HEAD')).trim();
    const dirty = (await git('status', '--porcelain')).trim().length > 0;
    const names = [...new Set((await git('ls-files', '-z', '--cached', '--others', '--exclude-standard')).split('\0').filter(Boolean))].sort();
    const hash = createHash('sha256');
    let complete = true;
    for (const name of names) {
      const f = await fingerprintAsync(join(path, name), signal);
      hash.update(JSON.stringify([name, f.sha256, f.error ?? null]) + '\n');
      if (!f.sha256 || !f.stableWhileHashing) complete = false;
    }
    checkCancelled(signal);
    return { revision, dirty, sourceSha256: hash.digest('hex'), sourceFileCount: names.length, complete };
  } catch (error) {
    checkCancelled(signal);
    return { revision: null, dirty: null, sourceSha256: null, complete: false,
      error: error.message === 'Engine path is not a repository root' ? error.message : 'Git metadata unavailable' };
  }
}
async function captureAsync({ inputs, engineDir, bridgeDir }, signal) {
  const files = [];
  for (const {path} of inputs) files.push(await fingerprintAsync(path, signal));
  return { files, engine: await snapshotRepositoryAsync(engineDir, signal), bridge: await snapshotRepositoryAsync(bridgeDir, signal) };
}
export async function trackAnalysis(spec, operation, { signal } = {}) {
  checkCancelled(signal);
  const startedAt = new Date().toISOString(), tick = performance.now();
  let version;
  try { version = JSON.parse(await readFile(join(spec.bridgeDir, 'package.json'), { encoding: 'utf8', signal })).version; }
  catch (error) { checkCancelled(signal); throw error; }
  const before = await captureAsync(spec, signal);
  const initial = { startedAt, tick, version, before: before.files, engineBefore: before.engine, bridgeBefore: before.bridge };
  let result, error;
  try { checkCancelled(signal); result = await operation(); } catch (caught) { error = caught; }
  let after;
  try {
    const captured = await captureAsync(spec, signal);
    after = { after: captured.files, engineAfter: captured.engine, bridgeAfter: captured.bridge };
  } catch (caught) {
    if (caught.code !== 'CANCELLED') throw caught;
    // Do not discard completed images when cancellation interrupts final tracing.
    // Missing checks are explicitly unverified; no synchronous fallback scan follows.
    const repository = { revision: null, dirty: null, sourceSha256: null, complete: false, error: caught.message };
    after = { after: spec.inputs.map(() => ({ sha256: null, error: caught.code })), engineAfter: repository, bridgeAfter: { ...repository } };
    if (result !== undefined) result = { ...result, error: caught.message, code: caught.code, runtime: { ...result.runtime, cancelled: true } };
    else error = caught;
  }
  return finish(spec, initial, after, result, error);
}
