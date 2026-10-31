import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { loadConfig, config, runIhc, runWb } from '../../lib.mjs';
import { runWorker } from '../../runtime-controls.mjs';
import { histology, blot } from './fixtures.mjs';

async function freePort() {
  const server = createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port;
}
function assertStopped(pid) {
  assert.throws(() => process.kill(pid, 0), error => error.code === 'ESRCH', `Browser process ${pid} still exists`);
}

test('real IHC timeout and cancellation stop Chromium and free the port for a subsequent analysis', { timeout: 30000 }, async t => {
  const dir = mkdtempSync(join(tmpdir(), 'wisplab-real-runtime-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const cfg = { ...loadConfig(), ihc: { devPort: await freePort() }, path: join(dir, 'config.json') };
  writeFileSync(cfg.path, JSON.stringify(cfg)); config(cfg.path);
  const file = join(dir, 'histology.png'); writeFileSync(file, histology());
  const args = { files: [file], coloc: false, profile: 'h_dab', controlTif: null };
  for (const cancel of [false, true]) {
    const controller = new AbortController(), browsers = [];
    await assert.rejects(runWorker({ operation: 'ihc-engine', args, cfg,
      runtime: { timeoutMs: 15000, fileTimeoutMs: cancel ? 10000 : 1, signal: controller.signal },
      onEvent: event => {
        if (event.kind === 'resource') browsers.push(event.pid);
        if (cancel && event.kind === 'file-start') controller.abort();
      } }), error => error.code === (cancel ? 'CANCELLED' : 'FILE_TIMEOUT'));
    assert.equal(browsers.length, 1); browsers.forEach(assertStopped);
    const result = await runIhc(args);
    assert.equal(result.files[0].error, undefined); assert.equal(result.provenance.status, 'success');
  }
});


test('real IHC execution and hashes retain the initial input after caller array mutation', { timeout: 30000 }, async t => {
  const dir = mkdtempSync(join(tmpdir(), 'wisplab-real-input-snapshot-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const cfg = { ...loadConfig(), ihc: { devPort: await freePort() } };
  const file = join(dir, 'original.png'); writeFileSync(file, histology());
  const files = [file], pending = runIhc({ files }, cfg);
  files[0] = join(dir, 'missing-replacement.png');
  const result = await pending;
  assert.equal(result.files.length, 1);
  assert.equal(result.files[0].file, 'original.png');
  assert.equal(result.files[0].error, undefined);
  assert.equal(result.provenance.inputs[0].file, 'original.png');
  assert.equal(result.provenance.checks.inputsUnchanged, true);
});

test('real WB preserves good-corrupt-good files and reports partial failure', () => {
  config(process.env.WISPLAB_CONFIG);
  const dir = mkdtempSync(join(tmpdir(), 'wisplab-real-wb-batch-'));
  try {
    const good = join(dir, 'blot.png'), bad = join(dir, 'corrupt.png');
    writeFileSync(good, blot()); writeFileSync(bad, 'invalid image');
    const result = runWb({ files: [good, bad, good], lanes: 2 });
    assert.equal(result.images.length, 3);
    assert.deepEqual(result.images[0].lanes.map(lane => lane.net), [24000, 12000]);
    assert.ok(result.images[1].error);
    assert.deepEqual(result.images[2].lanes, result.images[0].lanes);
    assert.equal(result.provenance.status, 'partial-error');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
