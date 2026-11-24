import { describe, expect, it } from 'vitest';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { DEFAULT_QC, emptyMapping } from './core/types';
import { decodeJson, encodeJson, MAX_PACKAGE_BYTES } from './project-archive';
import { exportPcrProject, importPcrProject, pcrCompleteness, recoverLegacyNumbers, type PcrProjectState } from './project-io';

function fixture(): PcrProjectState {
  return { fileName: 'plate.csv', sheetName: 'Data', matrix: [['sample', 'target', 'cq'], ['A', 'GAPDH', 'Undetermined']], headerRow: 0,
    mapping: { ...emptyMapping(), sample: 0, target: 1, cq: 2 }, excluded: { 1: true }, config: { controlSamples: ['A'], refGenes: ['GAPDH'], qc: { ...DEFAULT_QC, maxCq: 35 }, efficiencies: { GAPDH: 98 } },
    sourceFiles: [new File(['sample,target,cq\nA,GAPDH,Undetermined'], 'plate.csv', { lastModified: 1760000000000 })], meltFile: new File(['Well,No. Tm\nA1,2'], 'melt.csv'),
    autoReport: { score: 80, issues: [{ code: 'melt', severity: 'warning', message: 'Multiple peaks', target: 'GAPDH' }], advice: [{ code: 'check', message: 'Review' }], summary: 'Review data' },
    autoMelt: [{ gene: 'GAPDH', checked: 1, single: 0, none: 0, multi: [{ sample: 'A', well: 'A1', peaks: 2, tm: 80 }] }],
    meltTable: { fileName: 'melt.csv', byWell: { A1: { peaks: 2, tm: 80 } } }, projectName: '实验一', step: 4, guessBasis: 'Manual', inputMatrices: [] };
}
async function mutate(blob: Blob, change: (state: any) => void): Promise<Blob> {
  const entries = unzipSync(new Uint8Array(await blob.arrayBuffer()));
  const manifest = decodeJson(strFromU8(entries['manifest.json']));
  change(manifest);
  entries['manifest.json'] = strToU8(encodeJson(manifest));
  return new Blob([Uint8Array.from(zipSync(entries)).buffer]);
}
describe('PCR project package', () => {
  it('round-trips raw files, NaN QC, exclusions, reports, melt state and names', async () => {
    const source = fixture();
    const { blob, completeness } = await exportPcrProject(source);
    expect(completeness).toEqual([]);
    const restored = await importPcrProject(blob);
    expect(restored.project).toEqual(source);
    expect(Number.isNaN(restored.project.config.qc.minCq)).toBe(true);
    expect(await restored.project.sourceFiles![0].text()).toBe(await source.sourceFiles![0].text());
    expect(await restored.project.meltFile!.text()).toBe(await source.meltFile!.text());
  });
  it('preserves merged NaN rows and per-file raw matrices', async () => {
    const source = fixture(); source.matrix = []; source.inputMatrices = [{ fileName: 'plate.csv', matrix: [['x']] }];
    source.merged = { rows: [{ id: 1, plate: 'p', well: 'A1', sample: 'A', group: 'ctrl', pairId: '', target: 'GAPDH', task: '', cq: NaN, quantity: NaN, excluded: false }], perFile: [{ fileName: 'plate.csv', plate: 'p', headerRow: 0, mapping: source.mapping, cols: { sample: 's', target: 't', cq: 'c' }, rowCount: 1, ok: true }] };
    const restored = await importPcrProject((await exportPcrProject(source)).blob);
    expect(restored.project).toEqual(source);
  });
  it('states missing history without inventing source files', async () => {
    const source = fixture(); delete source.sourceFiles; delete source.meltFile;
    expect(pcrCompleteness(source)).toHaveLength(2);
    const restored = await importPcrProject((await exportPcrProject(source)).blob);
    expect(restored.completeness).toHaveLength(2);
    expect(restored.project.sourceFiles).toEqual([]);
  });
  it.each(['version', 'tool', 'shape', 'secret', 'reference', 'digest'])('rejects invalid %s before returning any state', async (kind) => {
    const blob = (await exportPcrProject(fixture())).blob;
    const corrupted = await mutate(blob, (manifest) => {
      if (kind === 'version') manifest.version = 2;
      if (kind === 'tool') manifest.tool = 'pathology';
      if (kind === 'shape') manifest.state.project.config.qc.minCq = 'wrong';
      if (kind === 'secret') manifest.state.project.aiConfig = { apiKey: 'not-allowed' };
      if (kind === 'reference') manifest.state.sources[0] = 900;
      if (kind === 'digest') manifest.files[0].sha256 = 'bad';
    });
    await expect(importPcrProject(corrupted)).rejects.toThrow();
  });
  it('rejects oversized package before reading bytes', async () => {
    const fake = { size: MAX_PACKAGE_BYTES + 1, arrayBuffer: () => { throw new Error('must not read'); } } as unknown as Blob;
    await expect(importPcrProject(fake)).rejects.not.toThrow('must not read');
  });
  it('keeps NaN in local mirrors and only recovers legacy numeric nulls', () => {
    const source = fixture();
    expect((decodeJson(encodeJson(source.config)) as any).qc.minCq).toBeNaN();
    const legacy = JSON.parse(JSON.stringify(source));
    expect(recoverLegacyNumbers(legacy).config.qc.minCq).toBeNaN();
    expect(recoverLegacyNumbers(legacy).config.qc.maxCq).toBe(35);
  });
});
