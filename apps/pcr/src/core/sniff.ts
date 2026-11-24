import type { ColumnKey, SheetMatrix } from './types';
import { COLUMN_KEYS, COLUMN_LABELS } from './types';

// ── 表头别名表（中英双语，覆盖主流仪器软件的列叫法）──

const ALIASES: Record<ColumnKey, string[]> = {
  plate: [
    'plate', 'plate name', 'plate id', 'run', 'run name', 'experiment', 'experiment name',
    'block', 'block name', '板', '板号', '板次', '实验板', '实验名称',
  ],
  well: [
    'well', 'well position', 'well id', 'well number', 'well location', 'position', 'pos',
    'target well', 'tube', 'tube no', 'tube number', 'reaction id', '孔', '孔位', '孔号', '目标孔', '管号', '位置',
  ],
  sample: [
    'sample', 'sample name', 'sample id', 'sampleid', 'sample identifier', 'sample description',
    'specimen', 'specimen name', '样本', '样本名称', '样本id', '样品', '样品名称',
  ],
  group: [
    'group', 'group name', 'sample group', 'experimental group', 'biological group',
    'condition', 'condition name', 'treatment', 'treatment group', 'cohort', 'category',
    '样本组', '实验组', '组别', '分组', '组', '处理组', '处理', '条件',
  ],
  pairId: [
    'pair', 'pair id', 'subject', 'subject id', 'replicate', 'replicate id', 'repeat', 'repeat id',
    '配对', '配对id', '个体id', '复孔序号', '重复序号',
  ],
  target: [
    'target', 'target name', 'gene', 'gene name', 'gene symbol', 'assay', 'assay name', 'assay id',
    'detector', 'detector name', 'primer', 'primer name', 'amplicon', '靶标', '靶基因', '目标基因', '基因', '检测基因', '引物',
  ],
  cq: [
    'cq', 'ct', 'c t', 'cp', 'crt', 'take off', 'takeoff', 'cq mean', 'ct mean', 'cq average',
    'ct average', 'cq avg', 'ct avg', 'cq value', 'ct value', 'quantification cycle',
    'cycle threshold', 'threshold cycle', 'crossing point', 'crossing threshold',
    'second derivative maximum', '定量循环数', '循环阈值', 'cq值', 'ct值', 'cp值',
    'ct平均值', 'ct均值', '平均ct', '平均cq', 'cq平均值', 'cq均值',
  ],
  task: [
    'task', 'task name', 'task type', 'sample role', 'role', 'well type', 'type',
    '任务', '任务类型', '孔类型', '样品类型',
  ],
  quantity: [
    'quantity', 'quantity mean', 'qty', 'amount', 'concentration', 'starting quantity',
    'copy number', 'copies', 'template amount', ' dilution', '数量', '浓度', '拷贝数', '起始量',
  ],
};

/** 表头归一化：小写、去括注、下划线/连字符转空格。 */
export function normalizeHeader(v: string): string {
  return String(v ?? '')
    .trim()
    .toLowerCase()
    .replace(/[（(][^（）()]*[）)]/g, '')
    .replace(/[_\-–—]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const DATE_RE = /\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/;
const WELL_FORMAT_RE = /^[a-z]{1,2}\s*0*\d{1,3}$/;
const NUMERIC_RE = /^\s*[+-]?(\d+[.,]?\d*|[.,]\d+)([eE][+-]?\d+)?\s*$/;

/** 别名匹配打分：精确 100 > 前缀 75（含 CJK 无空格续写，如 ct平均值）> 包含 55（≥4 字符）。 */
function aliasScore(header: string, aliases: string[]): number {
  let best = 0;
  for (const alias of aliases) {
    if (header === alias) return 100;
    if (header.startsWith(alias)) best = Math.max(best, 75);
    else if (header.endsWith(' ' + alias)) best = Math.max(best, 75);
    else if (alias.length >= 4 && header.includes(alias)) best = Math.max(best, 55);
  }
  return best;
}

/** 离散度指标表头（变异系数/标准差等）——是统计量不是数值本身，永不做 Cq 列。 */
const DISPERSION_RE = /(^|\s)(cv|sd|std|dev)(\s|$)|%|标准差|变异|误差/;

function nonEmptyValues(rows: string[][], col: number): string[] {
  const out: string[] = [];
  for (const row of rows) {
    const v = (row[col] ?? '').trim();
    if (v) out.push(v);
    if (out.length >= 600) break;
  }
  return out;
}

function wellRatio(values: string[]): number {
  if (!values.length) return 0;
  return values.filter((v) => WELL_FORMAT_RE.test(v.toLowerCase())).length / values.length;
}

/** 内容校验：防止数字列、孔位格式列被误配为样本/基因列。精确命中别名（score=100）时豁免孔位格式否决——样本名本身可能是 S1/A1 这类短名。 */
function contentValid(key: ColumnKey, values: string[], score = 0): boolean {
  if (!values.length) return false;
  const num = values.filter((v) => NUMERIC_RE.test(v.replace(/,/g, ''))).length / values.length;
  const well = wellRatio(values);
  const exact = score >= 100;
  switch (key) {
    case 'cq':
      return num >= 0.6;
    case 'well':
      return well >= 0.6;
    case 'plate':
    case 'pairId':
      return true;
    case 'sample':
      return num < 0.75 && (exact || well < 0.8);
    case 'target':
      return num < 0.75;
    case 'group':
      return num < 0.75;
    case 'task':
      return num < 0.5;
    case 'quantity':
      return num >= 0.6;
  }
}

export interface SniffResult {
  headerRow: number;
  mapping: Record<ColumnKey, number>;
  scores: Record<ColumnKey, number>;
}

/**
 * 表头行检测 + 列自动映射。
 * 表头行：前三类关键词命中得分 + 下一行数值密度，减元数据行惩罚（日期、校准、键值对）。
 */
export function sniff(matrix: string[][]): SniffResult {
  const maxScan = Math.min(60, matrix.length);
  let headerRow = 0;
  let bestScore = -Infinity;
  for (let ri = 0; ri < maxScan; ri++) {
    const row = matrix[ri];
    const norm = row.map(normalizeHeader);
    let score = 0;
    if (norm.some((v) => v && ALIASES.sample.some((a) => v === a || v.includes(a)))) score += 3;
    if (norm.some((v) => v && ALIASES.target.some((a) => v === a || v.includes(a)))) score += 3;
    if (norm.some((v) => v && ALIASES.cq.some((a) => v === a))) score += 5;
    score += Math.min(row.filter((v) => v.trim().length > 0).length, 5);
    if (ri + 1 < matrix.length) {
      const nums = matrix[ri + 1].filter((v) => NUMERIC_RE.test((v ?? '').replace(/,/g, ''))).length;
      score += Math.min(nums, 3);
    }
    if (row.some((v) => DATE_RE.test(v))) score -= 2;
    if (norm.some((v) => v.includes('校准') || v.includes('calib') || v.includes('仪器') || v.includes('instrument'))) score -= 3;
    score -= norm.filter((v) => v.includes(':') || v.includes('：')).length;
    if (score > bestScore) {
      bestScore = score;
      headerRow = ri;
    }
  }

  const headers = (matrix[headerRow] ?? []).map(normalizeHeader);
  const mapping = {} as Record<ColumnKey, number>;
  const scores = {} as Record<ColumnKey, number>;
  const width = headers.length;
  for (const key of COLUMN_KEYS) {
    let bestCol = -1;
    let best = 0;
    for (let ci = 0; ci < width; ci++) {
      let s = aliasScore(headers[ci] ?? '', ALIASES[key]);
      // Cq 列一票否决离散度指标（Ct CV / Ct SD / Ct标准差……），否则会选中全 0 的统计列
      if (key === 'cq' && s > 0 && DISPERSION_RE.test(headers[ci] ?? '')) s = 0;
      if (s > best) {
        best = s;
        bestCol = ci;
      }
    }
    if (bestCol >= 0) {
      const values = nonEmptyValues(matrix.slice(headerRow + 1), bestCol);
      if (!contentValid(key, values, best)) {
        // 内容不符：在同分或次高分列中找第一个内容合法的
        let alt = -1;
        let altBest = 0;
        for (let ci = 0; ci < width; ci++) {
          if (ci === bestCol) continue;
          const s = aliasScore(headers[ci] ?? '', ALIASES[key]);
          if (s > 0 && s >= altBest) {
            const vals = nonEmptyValues(matrix.slice(headerRow + 1), ci);
            if (contentValid(key, vals, s)) {
              alt = ci;
              altBest = s;
            }
          }
        }
        if (alt >= 0) {
          bestCol = alt;
          best = altBest;
        } else {
          bestCol = -1;
          best = 0;
        }
      }
    }
    mapping[key] = bestCol;
    scores[key] = best;
  }

  // 兜底：target 无别名命中时（如 Roche "Detection Cell"），按内容推断——
  // 少量离散文本值（2~12 种）、非数值、非孔位格式，且未被其他列占用。
  if (mapping.target < 0) {
    let alt = -1;
    let altScore = 0;
    for (let ci = 0; ci < width; ci++) {
      if (Object.values(mapping).includes(ci)) continue;
      const values = nonEmptyValues(matrix.slice(headerRow + 1), ci);
      if (values.length < 4) continue;
      if (!contentValid('target', values)) continue;
      if (wellRatio(values) >= 0.5) continue;
      const distinct = new Set(values).size;
      if (distinct < 2 || distinct > Math.max(12, Math.ceil(values.length / 2))) continue;
      const score = distinct <= 8 ? 3 : 2;
      if (score > altScore) {
        alt = ci;
        altScore = score;
      }
    }
    if (alt >= 0) {
      mapping.target = alt;
      scores.target = altScore;
    }
  }

  return { headerRow, mapping, scores };
}

/** 便捷入口：SheetMatrix → 表头行 + 映射。 */
export function sniffSheet(sheet: SheetMatrix): SniffResult {
  return sniff([sheet.headers, ...sheet.rows]);
}

export function columnLabel(key: ColumnKey): string {
  const l = COLUMN_LABELS[key];
  return `${l.zh} / ${l.en}`;
}
