/** Replay a saved real WB project through the same pure model used by the GUI. */
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import {
  importRealProject, results, descriptiveStatistics, realPairedTests,
  effectiveNormalization,
} from '<WB>/src/real/model.ts';

const payload = JSON.parse(process.argv[2]);
const files = [];

for (const path of payload.files) {
  const file = basename(path);
  try {
    // The upstream importer validates the archive, embedded-image hashes,
    // regions and design. Never call analyzeAll/proposeRegions here: saved ROIs
    // and review states are the input, including incomplete or blocked states.
    const project = await importRealProject(new Blob([readFileSync(path)]));
    files.push({
      file,
      project: {
        format: project.format, version: project.version, id: project.id,
        name: project.name, createdAt: project.createdAt, updatedAt: project.updatedAt,
      },
      settings: {
        laneLabels: project.laneLabels, laneDescription: project.laneDescription,
        targetLabel: project.targetLabel, referenceLabel: project.referenceLabel,
        designConfirmed: project.designConfirmed,
        pairedDesign: project.pairedDesign ?? null,
        normalization: effectiveNormalization(project),
        backgroundCorrection: project.backgroundCorrection ?? {kind: 'local'},
        statisticalTest: project.statisticalTest ?? 'none',
      },
      images: project.images.map(({bytes, history, hash, ...image}) => ({
        ...image, sha256: hash, historyCount: history.length,
      })),
      results: results(project),
      statistics: descriptiveStatistics(project),
      pairedTests: realPairedTests(project),
    });
  } catch (error) {
    files.push({file, error: String(error?.message ?? error)});
  }
}

console.log('@@WISPLAB@@' + JSON.stringify({
  schemaVersion: 'wisplab.wb-replay/v1', mode: 'saved-project', proposalsRun: false, files,
}));
