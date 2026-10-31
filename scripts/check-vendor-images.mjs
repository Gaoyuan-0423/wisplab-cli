/** Local-only vendor corpus inventory/run; images never copied into this repository. */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, realpathSync, existsSync } from 'node:fs';
import { resolve, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runIhc } from '../lib.mjs';

export async function checkVendorImages(rootArg, outArg, { analyze = runIhc, onScene = () => {} } = {}) {
  if (!rootArg || !outArg) throw new Error('Usage: node scripts/check-vendor-images.mjs <IHC corpus directory> <output directory>');
  const root = resolve(rootArg), output = resolve(outArg);
  const sources = JSON.parse(readFileSync(join(root, 'sources.json')));
  const filesIn = folder => readdirSync(join(root, 'images', folder)).filter(n => /\.jpg$/i.test(n)).sort().map(n => join(root, 'images', folder, n));
  // Discover each scene inside its error boundary, so an absent directory cannot hide later scenes.
  const scenes = [
    { name: 'dab', profile: 'h_dab', getFiles: () => sources.images.map(i => join(root, i.file)) },
    { name: 'he', profile: 'h_eosin', getFiles: () => filesIn('he') },
    { name: 'masson', profile: 'masson', getFiles: () => filesIn('masson') },
    { name: 'if', coloc: true, getFiles: () => filesIn('if') },
  ];
  mkdirSync(output, { recursive: true });
  const summary = {
    generatedAt: new Date().toISOString(), sourceManifest: sources.downloadedAt, scenes: [],
    limitations: ['Vendor web examples; no manual nucleus labels found in this corpus.',
      'IF uses rendered R/G channels, not original spectrally unmixed channels.',
      'Successful execution does not establish scientific accuracy or scanner robustness.'],
  };
  for (const { name, getFiles, ...options } of scenes) {
    let files, result, sceneError;
    try {
      files = getFiles();
      result = await analyze({ ...options, files });
    } catch (error) {
      sceneError = String(error?.message ?? error);
      result = {
        error: sceneError,
        files: (files ?? []).map(path => ({ file: basename(path), error: sceneError })),
        ...(error?.provenance ? { provenance: error.provenance } : {}),
      };
    }
    // Output-write failures remain fatal: silently missing reports would be misleading.
    writeFileSync(join(output, `${name}.json`), JSON.stringify(result, null, 2) + '\n');
    const errors = result.files.filter(file => file.error).map(file => ({ file: file.file, error: file.error }));
    const entry = {
      scene: name, total: files?.length ?? null, completed: result.files.filter(file => !file.error).length,
      errors, ...(sceneError ? { error: sceneError } : {}), checks: result.provenance?.checks ?? null,
    };
    summary.scenes.push(entry);
    onScene(entry);
  }
  summary.failed = summary.scenes.some(scene => scene.error || scene.errors.length ||
    !['inputsUnchanged', 'engineUnchanged', 'bridgeUnchanged'].every(key => scene.checks?.[key] === true));
  writeFileSync(join(output, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
  return summary;
}

if (process.argv[1] && existsSync(process.argv[1]) && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [root, output] = process.argv.slice(2);
  const summary = await checkVendorImages(root, output, { onScene: scene => console.log(JSON.stringify(scene)) });
  if (summary.failed) process.exitCode = 1;
}
