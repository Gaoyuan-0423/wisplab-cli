// RDML（Real-time PCR Data Markup Language）开放标准解析器。
// .rdml 文件 = ZIP 容器内的 rdml_data.xml（部分导出为纯 XML）。
// 输出合成规范矩阵（表头全部精确命中别名表），下游管线零改动；
// 靶标若声明 amplificationEfficiency，则一并返回供 Pfaffl 使用。

import { unzipSync } from 'fflate';
import { XMLParser } from 'fast-xml-parser';
import type { RdmlMeltCurve } from './melt';

export interface RdmlParseResult {
  matrix: string[][];
  /** RDML 靶标声明的扩增效率（百分比，已按数值大小归一化） */
  targetEfficiencies: Record<string, number>;
  runCount: number;
  /** 原始熔解曲线（mdp 数据点），供熔解 QC 峰检测 */
  meltCurves: RdmlMeltCurve[];
}

const parser = new XMLParser({
  removeNSPrefix: true,
  ignoreAttributes: false,
  parseTagValue: false,
  trimValues: true,
});

function asArray<T>(v: T | T[] | undefined): T[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

function text(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if ('#text' in o) return String(o['#text']).trim();
    return '';
  }
  return String(v).trim();
}

function num(v: unknown): number {
  const n = Number.parseFloat(text(v));
  return Number.isFinite(n) ? n : NaN;
}

/** RDML 靶标效率多数为百分比（如 93.9），个别存系数（如 1.94）；按量级归一化为百分比。 */
function normalizeEffPct(v: number): number | null {
  if (!Number.isFinite(v) || v <= 0) return null;
  const pct = v <= 3 ? (v - 1) * 100 : v;
  if (pct < 20 || pct > 400) return null;
  return Math.round(pct * 100) / 100;
}

/** 样本显示名：优先 <name>，其次 <description>（Roche 用 UUID 作 id、描述放人读名），最后 id。 */
function sampleDisplayName(s: Record<string, unknown>): string {
  const name = text((s as { name?: unknown }).name);
  if (name) return name;
  const desc = text((s as { description?: unknown }).description);
  if (desc) return desc;
  const id = String(s['@_id'] ?? '');
  return UUID_RE.test(id) ? `样本 ${id.slice(0, 8)}` : id;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 任务类型映射：RDML sample type → 规范 task 列。 */
function taskOfType(type: string): string {
  const t = type.toLowerCase().replace(/[\s_-]+/g, '');
  if (t === 'ntc' || t === 'ntp') return 'NTC';
  if (t === 'std' || t === 'standard') return 'STANDARD';
  return '';
}

const HEADERS = ['Plate', 'Well Position', 'Sample Name', 'Target Name', 'Task', 'CT', 'Quantity'];

/** 解析 RDML 字节（ZIP 容器或裸 XML）→ 规范矩阵 + 靶标效率。 */
export function parseRdml(input: Uint8Array | ArrayBuffer): RdmlParseResult {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  let xml: string | null = null;
  // ZIP 容器（仪器导出常态）：优先 rdml_data.xml
  if (bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b) {
    try {
      const z = unzipSync(bytes);
      const names = Object.keys(z);
      const chosen =
        names.find((n) => n.toLowerCase().endsWith('rdml_data.xml')) ??
        names.find((n) => n.toLowerCase().endsWith('.xml'));
      if (chosen) xml = new TextDecoder().decode(z[chosen]);
    } catch {
      // 非 zip，走裸 XML
    }
  }
  if (xml == null) {
    xml = new TextDecoder().decode(bytes);
    if (!xml.includes('<rdml')) throw new Error('不是有效的 RDML 文件（未找到 <rdml> 根元素）');
  }

  const doc = parser.parse(xml) as Record<string, any>;
  const root = doc.rdml ?? doc;
  if (!root || typeof root !== 'object' || !('experiment' in root || 'run' in root)) {
    throw new Error('不是有效的 RDML 文件（缺少 experiment/run 结构）');
  }

  // 样本与靶标字典
  const sampleName = new Map<string, string>();
  const sampleTask = new Map<string, string>();
  const sampleQuantity = new Map<string, number>();
  for (const s of asArray<any>(root.sample)) {
    const id = String(s?.['@_id'] ?? '');
    if (!id) continue;
    sampleName.set(id, sampleDisplayName(s));
    sampleTask.set(id, taskOfType(text(s.type)));
    const q = num((s.quantity as { value?: unknown } | undefined)?.value);
    if (Number.isFinite(q)) sampleQuantity.set(id, q);
  }

  const targetName = new Map<string, string>();
  const targetEff: Record<string, number> = {};
  for (const tg of asArray<any>(root.target)) {
    const id = String(tg?.['@_id'] ?? '');
    if (!id) continue;
    targetName.set(id, text(tg.name) || id);
    const eff = normalizeEffPct(num(tg.amplificationEfficiency));
    // 按解析后的靶标名（而非 id）作键，与矩阵行的基因名一致，供 Pfaffl 按名匹配
    if (eff != null) targetEff[targetName.get(id) || id] = eff;
  }

  const rows: string[][] = [];
  const meltCurves: RdmlMeltCurve[] = [];
  let runCount = 0;
  const experiments = asArray<any>(root.experiment);
  const expList = experiments.length ? experiments : [{ '@_id': '', run: root.run }];
  for (const exp of expList) {
    const expId = String(exp?.['@_id'] ?? '');
    for (const run of asArray<any>(exp.run)) {
      const runId = String(run?.['@_id'] ?? '');
      runCount += 1;
      // run/experiment id 为 UUID 时可读性差，回退为顺序名
      const plate =
        runId && !UUID_RE.test(runId)
          ? runId
          : expId && !UUID_RE.test(expId)
            ? expId
            : `Run ${runCount}`;
      for (const react of asArray<any>(run.react)) {
        const well = String(react?.['@_id'] ?? '');
        const sid = String(react?.sample?.['@_id'] ?? '');
        const sName = sampleName.get(sid) || sid;
        const task = sampleTask.get(sid) ?? '';
        const qty = sampleQuantity.get(sid);
        for (const data of asArray<any>(react.data)) {
          const tid = String(data?.tar?.['@_id'] ?? '');
          if (!tid) continue;
          const cq = num(data.cq);
          const gene = targetName.get(tid) || tid;
          rows.push([
            plate,
            well,
            sName,
            gene,
            task,
            Number.isFinite(cq) ? String(cq) : '',
            qty != null ? String(qty) : '',
          ]);
          const mdp = asArray<any>(data.mdp);
          if (mdp.length >= 5) {
            meltCurves.push({
              plate,
              well,
              sample: sName,
              target: gene,
              points: mdp
                .map((m) => ({ tmp: num(m.tmp), fluor: num(m.fluor) }))
                .filter((m) => Number.isFinite(m.tmp) && Number.isFinite(m.fluor)),
            });
          }
        }
      }
    }
  }

  return { matrix: [HEADERS, ...rows], targetEfficiencies: targetEff, runCount, meltCurves };
}
