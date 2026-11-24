import type { AnalysisRow } from './core/analysis';
import type { QualityReport } from './core/auto';
import type { MeltGeneSummary, MeltTableState } from './core/melt';
import type { FileMatrixInput, PerFileInfo } from './core/merge';
import { COLUMN_KEYS, type AnalysisConfig, type ColumnMapping } from './core/types';
import { array, bool, integer, invalid, nullable, number, numeric, object, oneOf, packProject, record, string, unpackProject } from './project-archive';

export interface PcrProjectState {
  fileName: string;
  sheetName: string;
  matrix: string[][];
  headerRow: number;
  mapping: ColumnMapping;
  excluded: Record<number, boolean>;
  config: AnalysisConfig;
  merged?: { rows: AnalysisRow[]; perFile: PerFileInfo[] } | null;
  autoReport?: QualityReport | null;
  autoMelt?: MeltGeneSummary[];
  meltTable?: MeltTableState | null;
  inputMatrices?: FileMatrixInput[];
  sourceFiles?: File[];
  meltFile?: File | null;
  projectName?: string;
  step?: number;
  guessBasis?: string;
  sourceBundleId?: string;
}

const matrixCheck = array(array(string, 10_000), 200_000);
const mappingCheck = object(Object.fromEntries(COLUMN_KEYS.map((key) => [key, integer(-1, 9999)])));
const configCheck = object({ controlSamples: array(string), refGenes: array(string), qc: object({ minCq: numeric, maxCq: numeric, absDev: numeric, zScore: numeric }) }, { efficiencies: record(number) });
const rowCheck = object({ id: integer(), plate: string, well: string, sample: string, group: string, pairId: string, target: string, task: string, cq: numeric, quantity: numeric, excluded: bool });
const perFileCheck = object({ fileName: string, plate: string, headerRow: integer(), mapping: mappingCheck, cols: object({ sample: string, target: string, cq: string }), rowCount: integer(), ok: bool }, { problem: string });
const reportCheck = object({ score: number, issues: array(object({ code: string, severity: oneOf('error', 'warning', 'info'), message: string }, { target: string })), advice: array(object({ code: string, message: string })), summary: string });
const meltCheck = array(object({ gene: string, checked: integer(), single: integer(), none: integer(), multi: array(object({ sample: string, well: string, peaks: integer(), tm: nullable(number) })) }));
const meltTableCheck = object({ fileName: string, byWell: record(object({ peaks: integer(), tm: nullable(number) })) });
export const pcrStateCheck = object({ fileName: string, sheetName: string, matrix: matrixCheck, headerRow: integer(), mapping: mappingCheck, excluded: record(bool), config: configCheck }, {
  merged: nullable(object({ rows: array(rowCheck, 200_000), perFile: array(perFileCheck, 1000) })),
  autoReport: nullable(reportCheck), autoMelt: meltCheck, meltTable: nullable(meltTableCheck),
  inputMatrices: array(object({ fileName: string, matrix: matrixCheck }), 1000), projectName: string, step: integer(1, 4), guessBasis: string, sourceBundleId: string,
});
interface PackageState { project: Omit<PcrProjectState, 'sourceFiles' | 'meltFile'>; sources: number[]; melt: number | null; completeness: string[] }
const packageCheck = object({ project: pcrStateCheck, sources: array(integer(0, 2999), 1000), melt: nullable(integer(0, 2999)), completeness: array(string, 1000) });

export function pcrCompleteness(project: PcrProjectState): string[] {
  const missing: string[] = [];
  const expected = project.merged ? project.merged.perFile.map((f) => f.fileName) : project.fileName ? [project.fileName] : [];
  const available = (project.sourceFiles ?? []).map((file) => file.name);
  for (const name of expected) {
    const index = available.indexOf(name);
    if (index < 0) missing.push(`缺原始仪器文件 / Missing original instrument file: ${name}`);
    else available.splice(index, 1);
  }
  if (project.merged && !project.inputMatrices?.length) missing.push('历史合并项目缺每文件原始表格 / Legacy merged project lacks per-file raw tables');
  if (project.meltTable && !project.meltFile) missing.push(`缺熔解摘要原文件 / Missing original melt summary: ${project.meltTable.fileName}`);
  return missing;
}

export async function exportPcrProject(project: PcrProjectState): Promise<{ blob: Blob; completeness: string[] }> {
  const { sourceFiles = [], meltFile = null, ...state } = project;
  if (!pcrStateCheck(state)) invalid();
  const files = [...sourceFiles];
  const sources = files.map((_file, i) => i);
  const melt = meltFile ? files.push(meltFile) - 1 : null;
  const completeness = pcrCompleteness(project);
  const blob = await packProject('pcr', { project: state, sources, melt, completeness } satisfies PackageState, files);
  return { blob, completeness };
}

export async function importPcrProject(blob: Blob): Promise<{ project: PcrProjectState; completeness: string[] }> {
  const result = await unpackProject(blob, 'pcr', packageCheck);
  const state = result.state as PackageState;
  const refs = [...state.sources, ...(state.melt === null ? [] : [state.melt])];
  if (refs.length !== result.files.length || new Set(refs).size !== refs.length || refs.some((i) => !result.files[i])) invalid();
  const project: PcrProjectState = { ...state.project, sourceFiles: state.sources.map((i) => result.files[i]), meltFile: state.melt === null ? null : result.files[state.melt] };
  if (project.matrix.length && project.headerRow >= project.matrix.length) invalid();
  if (project.merged && new Set(project.merged.rows.map((r) => r.id)).size !== project.merged.rows.length) invalid();
  return { project, completeness: pcrCompleteness(project) };
}

// Old localStorage mirrors converted NaN to null. Restore only the numeric fields
// that the old serializer lost; never fabricate raw attachments or melt tables.
export function recoverLegacyNumbers(project: PcrProjectState): PcrProjectState {
  return { ...project, config: { ...project.config, qc: Object.fromEntries(Object.entries(project.config.qc).map(([key, value]) => [key, value === null ? NaN : value])) as unknown as AnalysisConfig['qc'] },
    merged: project.merged ? { ...project.merged, rows: project.merged.rows.map((r) => ({ ...r, cq: r.cq === null ? NaN : r.cq, quantity: r.quantity === null ? NaN : r.quantity })) } : project.merged };
}
