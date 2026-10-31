import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const DEFAULT_TIMEOUT_MS = 300_000;
export const DEFAULT_FILE_TIMEOUT_MS = 120_000;

export function normalizeRuntime(runtime = {}) {
  if (!runtime || typeof runtime !== 'object' || Array.isArray(runtime)) throw new Error('runtime: expected an object');
  const value = { ...runtime, timeoutMs: runtime.timeoutMs ?? DEFAULT_TIMEOUT_MS, fileTimeoutMs: runtime.fileTimeoutMs ?? DEFAULT_FILE_TIMEOUT_MS };
  for (const name of ['timeoutMs', 'fileTimeoutMs']) {
    if (!Number.isSafeInteger(value[name]) || value[name] < 1 || value[name] > 2_147_483_647)
      throw new Error(`runtime.${name}: expected an integer from 1 to 2147483647`);
  }
  return value;
}

function failure(code, message) { return Object.assign(new Error(message), { code }); }
export function cancellationError() { return failure('CANCELLED', 'Analysis cancelled / 分析已取消'); }

// Every job owns a process group on macOS/Linux/WSL, including Vite, Chromium and tsx descendants.
// Resolve only after the worker exits and forced cleanup has run, so the next job can reuse its port.
export function runWorker({ operation, args, cfg, runtime = {}, onEvent = () => {} }) {
  const controls = normalizeRuntime(runtime);
  if (controls.signal?.aborted) return Promise.reject(cancellationError());
  return new Promise((resolve, reject) => {
    const workspace = mkdtempSync(join(tmpdir(), 'wisplab-job-'));
    const child = spawn(process.execPath, [fileURLToPath(new URL('./runtime-worker.mjs', import.meta.url))], {
      env: { ...process.env, TMPDIR: workspace, TEMP: workspace, TMP: workspace },
      detached: process.platform !== 'win32', serialization: 'advanced', stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    });
    const resourceGroups = new Set();
    let result, workerError, stopError, stderr = '', exited = false, cleaned = false, settled = false, fileTimer, stopTimer;
    const kill = (signal) => {
      if (!child.pid) return;
      for (const pid of [child.pid, ...resourceGroups]) {
        try { process.platform === 'win32' ? process.kill(pid, signal) : process.kill(-pid, signal); }
        catch (error) { if (error.code !== 'ESRCH') stderr += `\nCleanup: ${error.message}`; }
      }
    };
    const finish = () => {
      if (settled || !exited || (stopError && !cleaned)) return;
      settled = true;
      clearTimeout(batchTimer); clearTimeout(fileTimer); clearTimeout(stopTimer);
      controls.signal?.removeEventListener('abort', abort);
      rmSync(workspace, { recursive: true, force: true });
      if (stopError || workerError) reject(stopError ?? workerError);
      else if (result !== undefined) resolve(result);
      else reject(new Error(`Analysis worker exited without a result: ${stderr.slice(-1000)}`));
    };
    const stop = (error) => {
      if (settled || stopError) return;
      stopError = error;
      clearTimeout(fileTimer);
      kill('SIGTERM');
      // Kill remaining descendants even if the worker itself has already exited.
      stopTimer = setTimeout(() => { kill('SIGKILL'); cleaned = true; finish(); }, 500);
    };
    const abort = () => stop(cancellationError());
    const batchTimer = setTimeout(() => stop(failure('BATCH_TIMEOUT', `Batch timed out after ${controls.timeoutMs} ms / 整批分析超时`)), controls.timeoutMs);
    controls.signal?.addEventListener('abort', abort, { once: true });
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-4000); });
    child.on('error', error => { workerError = error; exited = true; finish(); });
    child.on('message', message => {
      if (settled || !message || typeof message !== 'object') return;
      if (message.type === 'event' && message.event.kind === 'resource' && Number.isInteger(message.event.pid)) {
        resourceGroups.add(message.event.pid);
        if (stopError) kill('SIGKILL');
      }
      if (stopError) return;
      if (message.type === 'event') {
        if (message.event.kind === 'file-start') {
          clearTimeout(fileTimer);
          fileTimer = setTimeout(() => stop(failure('FILE_TIMEOUT', `${message.event.file}: timed out after ${controls.fileTimeoutMs} ms / 单图分析超时`)), controls.fileTimeoutMs);
        } else if (message.event.kind === 'file-result') clearTimeout(fileTimer);
        onEvent(message.event);
      } else if (message.type === 'result') result = message.result;
      else if (message.type === 'error') workerError = Object.assign(new Error(message.error.message), message.error);
    });
    child.on('close', () => {
      exited = true;
      if (result === undefined && !workerError && !stopError) stop(new Error(`Analysis worker exited without a result: ${stderr.slice(-1000)}`));
      finish();
    });
    child.send({ operation, args, configPath: cfg.path, runtime: { timeoutMs: controls.timeoutMs, fileTimeoutMs: controls.fileTimeoutMs } }, error => { if (error) stop(error); });
  });
}

export async function runAnalysisJob(operation, args, cfg, runtime = {}) {
  const controls = normalizeRuntime(runtime);
  controls.onProgress?.({ progress: 0, total: 1, message: 'Analysis started / 分析开始' });
  const result = await runWorker({ operation, args, cfg, runtime: controls });
  controls.onProgress?.({ progress: 1, total: 1, message: 'Analysis completed / 分析完成' });
  return { ...result, runtime: { timeoutMs: controls.timeoutMs } };
}

export async function runIhcBatch(args, cfg, runtime = {}) {
  const controls = normalizeRuntime(runtime), started = Date.now(), files = [], total = args.files.length;
  let next = 0, controlThreshold = null, controlImageName = null, batchError = null;
  controls.onProgress?.({ progress: 0, total, message: 'Analysis started / 分析开始' });
  while (next < total) {
    let current = next, activeRole = 'setup';
    const remaining = controls.timeoutMs - (Date.now() - started);
    if (remaining <= 0 || controls.signal?.aborted) {
      const message = controls.signal?.aborted ? cancellationError().message : 'Batch timed out / 整批分析超时';
      batchError = message;
      for (; next < total; next++) files.push({ file: args.files[next].split('/').pop(), error: message });
      break;
    }
    try {
      const result = await runWorker({ operation: 'ihc-engine', args: { ...args, files: args.files.slice(next) }, cfg,
        runtime: { ...controls, timeoutMs: remaining }, onEvent: event => {
          if (event.kind === 'calibration') { controlThreshold = event.controlThreshold; controlImageName = event.controlImageName; }
          if (event.kind === 'file-start') { activeRole = event.role ?? 'input'; }
          if (event.kind === 'file-result') {
            files.push(event.result); current++; next = current;
            controls.onProgress?.({ progress: next, total, message: `${event.result.file}: ${event.result.error ? 'failed / 失败' : 'completed / 完成'}` });
          }
        } });
      controlThreshold = result.controlThreshold; controlImageName = result.controlImageName;
      // All normal output entries arrive before the final result over ordered IPC.
      break;
    } catch (error) {
      const message = error.message;
      if (error.code === 'FILE_TIMEOUT' && activeRole === 'input') {
        files.push({ file: args.files[next].split('/').pop(), error: message }); next++;
        controls.onProgress?.({ progress: next, total, message });
        continue; // A new process/browser cannot retain work from the timed-out renderer.
      }
      batchError = message;
      for (; next < total; next++) files.push({ file: args.files[next].split('/').pop(), error: message });
      break;
    }
  }
  return { files, coloc: args.coloc, profile: args.coloc ? 'if_coloc' : args.profile, controlThreshold, controlImageName,
    ...(batchError ? { error: batchError } : {}),
    runtime: { timeoutMs: controls.timeoutMs, fileTimeoutMs: controls.fileTimeoutMs, cancelled: Boolean(controls.signal?.aborted) } };
}
