// 规范列模型：所有仪器导出文件解析后统一映射到这八列。
// plate/well/group/pairId/task 可选自动识别，sample/target/cq 必需（target 缺失时可走"样本名拆分"兜底）。
export type ColumnKey = 'plate' | 'well' | 'sample' | 'group' | 'pairId' | 'target' | 'cq' | 'task' | 'quantity';

export const COLUMN_KEYS: ColumnKey[] = ['plate', 'well', 'sample', 'group', 'pairId', 'target', 'cq', 'task', 'quantity'];

export const COLUMN_LABELS: Record<ColumnKey, { zh: string; en: string; required: boolean }> = {
  plate: { zh: '板号', en: 'Plate', required: false },
  well: { zh: '孔位', en: 'Well', required: false },
  sample: { zh: '样本 ID', en: 'Sample', required: true },
  group: { zh: '组别', en: 'Group', required: false },
  pairId: { zh: '配对 ID', en: 'Pair ID', required: false },
  target: { zh: '目标基因', en: 'Target', required: true },
  cq: { zh: 'Cq/Ct', en: 'Cq', required: true },
  task: { zh: '任务类型', en: 'Task', required: false },
  quantity: { zh: '数量/浓度', en: 'Quantity', required: false },
};

/** 一张工作表的原始矩阵：headers 为表头行，rows 为其后的数据行。 */
export interface SheetMatrix {
  headers: string[];
  rows: string[][];
}

/** 列映射：ColumnKey → 表头列下标（-1 表示未映射）。 */
export type ColumnMapping = Record<ColumnKey, number>;

export function emptyMapping(): ColumnMapping {
  return { plate: -1, well: -1, sample: -1, group: -1, pairId: -1, target: -1, cq: -1, task: -1, quantity: -1 };
}

export function mappingComplete(m: ColumnMapping): boolean {
  return m.sample >= 0 && m.target >= 0 && m.cq >= 0;
}

/** QC 设置；字段为 NaN 表示该项不启用。 */
export interface QcSettings {
  minCq: number;
  maxCq: number;
  absDev: number;
  zScore: number;
}

export const DEFAULT_QC: QcSettings = { minCq: NaN, maxCq: NaN, absDev: NaN, zScore: NaN };

export interface AnalysisConfig {
  controlSamples: string[];
  refGenes: string[];
  qc: QcSettings;
  /** 每基因扩增效率（百分比，100 = 恰好翻倍）；缺省按 100 处理，全部为 100 时即 Livak 法 */
  efficiencies?: Record<string, number>;
}

/** 单孔 QC 标记原因（空数组 = 通过）。 */
export type QcFlags = Record<number, string[]>;

/** 单个"样本 × 基因"的聚合结果与统计。 */
export interface SampleTargetResult {
  sample: string;
  group: string;
  target: string;
  isControl: boolean;
  excluded: boolean;
  n: number;
  values: number[];
  wells: string[];
  meanCq: number;
  sdCq: number;
  refCq: number | null;
  deltaCt: number | null;
  deltaCtValues: number[];
  ddCt: number | null;
  foldChange: number | null;
  fcValues: number[];
  fcMean: number;
  fcSd: number;
  pValue: number | null;
  /** 多组时 Dunnett vs 对照的校正 p；2 组 Welch 时为 null */
  pAdjusted: number | null;
  significance: string;
  statMethod: string;
}

export type NtcVerdict = 'pass' | 'late' | 'contaminated';

/** 单个目标基因的 NTC（无模板对照）污染检查结果。 */
export interface NtcReportEntry {
  target: string;
  wells: string[];
  /** 有 Cq 的 NTC 孔数（发生扩增） */
  amplified: number;
  minCq: number | null;
  verdict: NtcVerdict;
  message: string;
}

export interface AnalysisOutput {
  results: SampleTargetResult[];
  refGenesUsed: string[];
  controlSamples: string[];
  warnings: string[];
  ntcReport: NtcReportEntry[];
  /** 任一相关基因效率 ≠ 100% 时为 true（Pfaffl 校正生效） */
  effMode: boolean;
  /** 实际生效的每基因效率（百分比） */
  efficiencies: Record<string, number>;
}
