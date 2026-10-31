/** Browser workflow tests use generated images and simulated clicks, not independent human labels. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { loadConfig } from '../../lib.mjs';
import { createAnnotationPack } from '../../ihc-annotation-pack.mjs';
import { compareNucleiReference } from '../../ihc-nuclei-validation.mjs';
import { png } from './fixtures.mjs';

test('real browser annotation: scaled clicks, review invalidation, draft import and downloads', { timeout: 90000 }, async t => {
  const cfg = loadConfig();
  const { chromium } = createRequire(join(cfg.repos.ihc, 'package.json'))('playwright');
  const dir = mkdtempSync(join(tmpdir(), 'wisplab-annotation-browser-'));
  const browser = await chromium.launch({ args: ['--no-proxy-server'] });
  t.after(async () => { await browser.close(); rmSync(dir, { recursive: true, force: true }); });
  const bytes = png(1000, 400, 3, 8, (x, y) => (x - 200) ** 2 + (y - 100) ** 2 < 200 ? [80, 65, 40] : [245, 245, 245]);
  const hash = createHash('sha256').update(bytes).digest('hex');
  const names = ['generated-tissue.png', 'generated-blank.png'];
  const imageBytes = [bytes, png(1000, 400, 3, 8, () => [245, 245, 245])];
  for (const [index, name] of names.entries()) writeFileSync(join(dir, name), imageBytes[index]);
  const result = { files: names.map(file => ({ file, sourceWidth: 1000, sourceHeight: 400, width: 500, height: 200, settings: { profile: 'h_dab' },
    nuclei: { coordinateSpace: 'working', width: 500, height: 200, items: [] } })),
    provenance: { analysis: 'ihc', status: 'success', checks: { inputsUnchanged: true, engineUnchanged: true, bridgeUnchanged: true },
      inputs: names.map((file, index) => { const sha256 = createHash('sha256').update(imageBytes[index]).digest('hex'); return { file, role: 'input', before: { sha256 }, after: { sha256 }, unchanged: true }; }) } };
  const pack = createAnnotationPack(result, { imagesRoot: dir, outputDir: dir });
  const page = await browser.newPage({ viewport: { width: 600, height: 1000 }, acceptDownloads: true });
  const errors = [], dialogs = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', async dialog => { dialogs.push(dialog.message()); await dialog.accept(); });
  await page.goto(pathToFileURL(pack.html).href);
  await page.waitForFunction(() => document.querySelector('#canvas').width === 1000 && document.querySelector('#status').textContent.includes('generated-tissue.png'));
  await page.evaluate(() => document.querySelector('#canvas').addEventListener('click', event => { window.lastAnnotationClick = { x: event.clientX, y: event.clientY }; }));
  async function clickSource(x, y) {
    await page.locator('#viewport').scrollIntoViewIfNeeded();
    const point = await page.locator('#canvas').evaluate((canvas, point) => {
      const box = canvas.getBoundingClientRect(), style = getComputedStyle(canvas);
      const left = parseFloat(style.borderLeftWidth), right = parseFloat(style.borderRightWidth), top = parseFloat(style.borderTopWidth), bottom = parseFloat(style.borderBottomWidth);
      return { x: box.left + left + (point.x + 0.5) * (box.width - left - right) / canvas.width,
        y: box.top + top + (point.y + 0.5) * (box.height - top - bottom) / canvas.height };
    }, { x, y });
    await page.mouse.click(point.x, point.y);
    return page.locator('#canvas').evaluate(canvas => {
      const box = canvas.getBoundingClientRect(), style = getComputedStyle(canvas);
      const left = parseFloat(style.borderLeftWidth), right = parseFloat(style.borderRightWidth), top = parseFloat(style.borderTopWidth), bottom = parseFloat(style.borderBottomWidth);
      return { x: (window.lastAnnotationClick.x - box.left - left) * canvas.width / (box.width - left - right) - 0.5,
        y: (window.lastAnnotationClick.y - box.top - top) * canvas.height / (box.height - top - bottom) - 0.5 };
    });
  }
  async function download(selector) {
    const event = page.waitForEvent('download'); await page.locator(selector).click();
    const item = await event;
    return { name: item.suggestedFilename(), reference: JSON.parse(readFileSync(await item.path(), 'utf8')) };
  }
  const first = await clickSource(200, 100);
  await page.locator('#reviewed').check();
  await page.locator('#h-score').fill('123.5');
  assert.equal(await page.locator('#reviewed').isChecked(), false, 'Editing H-score must invalidate review');
  await page.locator('#reviewed').check();
  await page.locator('input[name="label"][value="negative"]').check();
  await clickSource(700, 210);
  assert.equal(await page.locator('#reviewed').isChecked(), false, 'Editing a reviewed image must require review again');
  const initial = await download('#draft');
  assert.equal(initial.name, 'nuclei-reference-draft.json');
  assert.equal(initial.reference.images[0].points.length, 2);
  assert.ok(Math.abs(initial.reference.images[0].points[0].x - first.x) < 1e-6, 'Canvas CSS border/scaling must not shift source x');
  assert.ok(Math.abs(initial.reference.images[0].points[0].y - first.y) < 1e-6, 'Canvas CSS border/scaling must not shift source y');
  assert.deepEqual(initial.reference.images[0].points.map(p => p.positive), [true, false]);
  assert.equal(initial.reference.images[0].hScore, 123.5);
  assert.equal(Object.hasOwn(initial.reference.images[1], 'hScore'), false, 'Unscored images must omit H-score');
  assert.ok(initial.reference.images.every(image => image.reviewStatus === 'pending'));
  assert.equal(compareNucleiReference(result, initial.reference, { radius: 5 }).status, 'pending-review');

  await page.locator('input[name="label"][value="erase"]').check();
  await clickSource(700, 210);
  assert.equal((await download('#draft')).reference.images[0].points.length, 1);
  await page.locator('#h-score').fill('80');
  await page.locator('#draft-import').setInputFiles({ name: 'draft.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(initial.reference)) });
  await page.waitForFunction(() => document.querySelector('#status').textContent.includes('nuclei: 2'));
  const restored = (await download('#draft')).reference;
  assert.deepEqual(restored.images[0].points, initial.reference.images[0].points);
  assert.equal(restored.images[0].reviewStatus, 'pending');
  assert.equal(restored.images[0].hScore, 123.5);
  assert.equal(await page.locator('#h-score').inputValue(), '123.5');

  for (const mutate of [
    ref => ref.images[0].sha256 = '0'.repeat(64),
    ref => ref.images[0].sourceWidth += 1,
    ref => ref.images[0].sourceKind = 'synthetic',
    ref => ref.images[0].points[0].x = 1001,
    ref => ref.images[0].hScore = 301,
    ref => ref.images[0].hScore = '80',
    ref => ref.images[0].reviewer = { name: 'Invalid metadata type' },
  ]) {
    const invalid = structuredClone(initial.reference); mutate(invalid);
    const rejection = page.waitForEvent('dialog');
    await page.locator('#draft-import').setInputFiles({ name: 'invalid-draft.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(invalid)) });
    assert.match((await rejection).message(), /Draft import failed/);
  }
  const afterRejectedImports = (await download('#draft')).reference;
  assert.deepEqual(afterRejectedImports.images, restored.images, 'Rejected drafts must leave annotations intact');

  for (const invalidScore of ['-1', '301']) {
    await page.locator('#h-score').fill(invalidScore);
    await page.locator('#reviewed').click();
    assert.equal(await page.locator('#reviewed').isChecked(), false);
    const rejected = page.waitForEvent('dialog');
    await page.locator('#draft').click();
    assert.match((await rejected).message(), /H-score.*0–300/);
  }
  await page.locator('#h-score').fill('123.5');

  await page.locator('#complete').click();
  assert.ok(dialogs.some(message => /review|复核/.test(message)), 'Incomplete exports must explain the missing review');
  await page.locator('#reviewer').fill('Synthetic browser workflow fixture');
  await page.locator('#date').fill('2026-10-31');
  await page.locator('#method').fill('Automated UI test on generated pixels; not independent human reference data');
  await page.locator('#reviewed').check();
  const beforeSecond = dialogs.length;
  await page.locator('#complete').click();
  assert.ok(dialogs.length > beforeSecond, 'All images require explicit review, including empty annotations');
  await page.locator('#image').selectOption('1');
  await page.waitForFunction(() => document.querySelector('#status').textContent.includes('generated-blank.png'));
  assert.equal(await page.locator('#reviewed').isChecked(), false);
  assert.equal(await page.locator('#h-score').inputValue(), '');
  assert.equal(await page.locator('#reviewer').inputValue(), '', 'A second image must not inherit the first reviewer');
  await page.locator('#h-score').fill('0');
  await page.locator('#reviewer').fill('Second synthetic reviewer');
  await page.locator('#date').fill('2026-10-30');
  await page.locator('#method').fill('Independent second-image protocol');
  await page.locator('#reviewed').check();
  const complete = await download('#complete');
  assert.equal(complete.name, 'nuclei-reference.json');
  assert.ok(complete.reference.images.every(image => image.reviewStatus === 'complete'));
  assert.deepEqual(complete.reference.images.map(image => [image.reviewer, image.reviewedOn, image.method]), [
    ['Synthetic browser workflow fixture', '2026-10-31', 'Automated UI test on generated pixels; not independent human reference data'],
    ['Second synthetic reviewer', '2026-10-30', 'Independent second-image protocol'],
  ]);
  assert.equal(complete.reference.images[1].points.length, 0);
  assert.equal(complete.reference.images[0].hScore, 123.5);
  assert.equal(complete.reference.images[1].hScore, 0);
  assert.equal(complete.reference.images[0].sha256, hash);
  assert.equal(complete.reference.images[0].coordinateSpace, 'source');
  await page.locator('#image').selectOption('0');
  await page.waitForFunction(() => document.querySelector('#status').textContent.includes('generated-tissue.png'));
  assert.equal(await page.locator('#reviewed').isChecked(), true);
  assert.equal(await page.locator('#h-score').inputValue(), '123.5');
  assert.equal(await page.locator('#reviewer').inputValue(), 'Synthetic browser workflow fixture');
  await page.locator('#reviewer').fill('Edited reviewer');
  assert.equal(await page.locator('#reviewed').isChecked(), false, 'Metadata changes must invalidate only the current image review');
  await page.locator('#reviewer').fill('Synthetic browser workflow fixture');
  await page.locator('#reviewed').check();
  for (const factor of ['1', '2', '4']) {
    await page.locator('#zoom').selectOption(factor);
    const dimensions = await page.locator('#canvas').evaluate(canvas => ({ width: canvas.getBoundingClientRect().width, height: canvas.getBoundingClientRect().height }));
    assert.equal(dimensions.width, 1000 * Number(factor)); assert.equal(dimensions.height, 400 * Number(factor));
    assert.equal(await page.locator('#reviewed').isChecked(), true, 'Zoom alone must preserve review status');
  }
  await page.locator('#viewport').evaluate(viewport => { viewport.scrollLeft = 1200; viewport.scrollTop = 400; });
  const pan = await page.locator('#viewport').evaluate(viewport => ({ x: viewport.scrollLeft, y: viewport.scrollTop }));
  assert.ok(pan.x > 0 && pan.y > 0, 'Both axes must be scrollable at 400%');
  await page.locator('input[name="label"][value="positive"]').check();
  const zoomed = await clickSource(400, 200);
  assert.equal(await page.locator('#reviewed').isChecked(), false);
  const zoomDraft = (await download('#draft')).reference;
  assert.equal(zoomDraft.images[0].points.length, 3);
  assert.deepEqual(zoomDraft.images[0].points.slice(0, 2), complete.reference.images[0].points);
  assert.ok(Math.abs(zoomDraft.images[0].points[2].x - zoomed.x) < 1e-6);
  assert.ok(Math.abs(zoomDraft.images[0].points[2].y - zoomed.y) < 1e-6);
  await page.locator('#zoom').selectOption('fit');
  const fit = await page.locator('#canvas').evaluate(canvas => ({ width: canvas.getBoundingClientRect().width, height: canvas.getBoundingClientRect().height, viewportWidth: document.querySelector('#viewport').clientWidth, viewportHeight: document.querySelector('#viewport').clientHeight }));
  assert.ok(fit.width <= fit.viewportWidth && fit.height <= fit.viewportHeight);
  assert.deepEqual((await download('#draft')).reference.images[0].points, zoomDraft.images[0].points, 'Returning to fit must keep draft points');
  await page.locator('#h-score').fill('');
  assert.equal(Object.hasOwn((await download('#draft')).reference.images[0], 'hScore'), false, 'Clearing optional H-score must omit its field');
  await page.locator('#draft-import').setInputFiles({ name: 'distinct-reviewers.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(complete.reference)) });
  await page.waitForFunction(() => document.querySelector('#status').textContent.includes('nuclei: 2') && document.querySelector('#h-score').value === '123.5');
  const roundTrip = (await download('#draft')).reference;
  assert.deepEqual(roundTrip.images.map(image => [image.reviewer, image.reviewedOn, image.method]), complete.reference.images.map(image => [image.reviewer, image.reviewedOn, image.method]), 'Import and export must preserve each image reviewer, date and protocol');
  assert.ok(roundTrip.images.every(image => image.reviewStatus === 'pending'));
  assert.deepEqual(errors, []);
});
