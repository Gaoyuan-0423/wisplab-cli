import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { loadConfig } from '../../lib.mjs';
import { png } from './fixtures.mjs';

test('real WB engine retains repeating ratios for 8/16-bit dark and light bands', t => {
  const cfg = loadConfig();
  const lock = JSON.parse(readFileSync(new URL('../../engines.lock.json', import.meta.url)));
  assert.equal(execFileSync('git', ['-C', cfg.repos.wb, 'rev-parse', 'HEAD'], {encoding: 'utf8'}).trim(), lock.engines.wb.revision);
  assert.equal(execFileSync('git', ['-C', cfg.repos.wb, 'status', '--porcelain'], {encoding: 'utf8'}).trim(), '');
  const dir = mkdtempSync(join(tmpdir(), 'wisplab-wb-precision-'));
  t.after(() => rmSync(dir, {recursive: true, force: true}));
  const require = createRequire(join(cfg.repos.wb, 'package.json'));
  const runner = join(dir, 'wb-run.ts');
  writeFileSync(join(dir, 'package.json'), '{"type":"module"}');
  writeFileSync(runner, readFileSync(new URL('../../runners/wb-run.ts', import.meta.url), 'utf8')
    .replaceAll('<WB>', pathToFileURL(cfg.repos.wb).href));

  for (const depth of [8, 16]) for (const signal of ['dark', 'light']) {
    const scale = depth === 16 ? 257 : 1;
    // Two equal 30x10 rectangles have exact contrasts 90 and 30.
    // Their net signals are 27000 and 9000 (scaled by 257 for 16-bit).
    const bytes = png(160, 100, 1, depth, (x, y) => {
      const contrast = y >= 40 && y < 50 ? (x >= 20 && x < 50 ? 90 : x >= 100 && x < 130 ? 30 : 0) : 0;
      return [(signal === 'dark' ? 220 - contrast : 20 + contrast) * scale];
    });
    const path = join(dir, `${signal}-${depth}.png`);
    writeFileSync(path, bytes);
    // Execute the production runner with tsx's Node loader, without the optional
    // tsx CLI IPC server; all decoder/proposal/measurement code is unmodified.
    const stdout = execFileSync(process.execPath, ['--import', pathToFileURL(require.resolve('tsx')).href, runner,
      JSON.stringify({files: [path], lanes: 2, signal, bg: {kind: 'local'}, controlLane: 1})], {encoding: 'utf8'});
    const line = stdout.split('\n').find(value => value.startsWith('@@WISPLAB@@'));
    assert.ok(line, stdout);
    const result = JSON.parse(line.slice('@@WISPLAB@@'.length));
    const image = result.images[0];
    assert.equal(image.error, undefined);
    assert.equal(image.bitDepth, depth);
    assert.deepEqual(image.lanes.map(lane => lane.net), [27000 * scale, 9000 * scale]);
    assert.deepEqual(image.lanes.map(lane => lane.ratio), [1, 1 / 3]);
  }
});
