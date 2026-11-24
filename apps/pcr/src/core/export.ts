import { translate, type Language } from '../i18n/translate';
import * as XLSX from 'xlsx';
import type { AnalysisOutput, ExperimentalDesign, NtcReportEntry, QcFlags } from './types';
import type { AnalysisRow } from './analysis';

const NUM = (v: number | null | undefined, digits = 4): string => {
  if (v == null || !Number.isFinite(v)) return '';
  return String(Math.round(v * 10 ** digits) / 10 ** digits);
};

/** Sample-level technical descriptions. Never attach group inference to a sample row. */
export function resultAoa(out: AnalysisOutput, language: Language = 'zh'): (string | number)[][] {
  const t = (message: string) => translate(message, language);
  const header = [
    '基因 Target', '样本 Sample', '组别 Group', '是否对照 Control', '技术孔数 nTech',
    '孔位 Wells', '平均 Cq', 'Cq SD', '内参 Cq (池化)', 'ΔCt', 'ΔΔCt',
    out.effMode ? 'Fold Change (Pfaffl)' : 'Fold Change (2^-ΔΔCt)', '技术孔 FC SD',
    '板号', '独立单位 ID', '独立单位数 nBio', '来源样本身份', '结果层级',
  ];
  const rows = out.results.map((r) => [
    r.target, r.sample, r.group || '', t(r.isControl ? '是' : '否'), r.nTech ?? r.n,
    r.wells.join(' '), NUM(r.meanCq), NUM(r.sdCq), NUM(r.refCq), NUM(r.deltaCt), NUM(r.ddCt),
    NUM(r.foldChange), NUM(r.fcSd), r.plate ?? '', r.unitId ?? '',
    out.designStatus === 'confirmed' ? r.nBio ?? '' : '',
    JSON.stringify(r.sampleIds ?? [{ plate: r.plate ?? '', sample: r.sample }]), t('样本技术描述；不作组间推断'),
  ]);
  return [header.map(t), ...rows];
}

const RAW = (value: number | null | undefined): number | '' => value != null && Number.isFinite(value) ? value : '';

/** Unit-level group summaries for CSV/XLSX; probabilities retain numeric precision. */
export function groupResultAoa(out: AnalysisOutput, language: Language = 'zh'): (string | number)[][] {
  const t = (message: string) => translate(message, language);
  const confirmed = out.designStatus === 'confirmed';
  const header = ['基因 Target', '组别 Group', '是否对照 Control', '独立单位数 nBio', '技术孔数 nTech',
    '独立单位 ID 列表', '来源样本身份', '单位 ΔCt 均值', '单位 ΔCt SD', 'ΔΔCt',
    out.effMode ? 'Fold Change (Pfaffl)' : 'Fold Change (2^-ΔΔCt)', '单位 FC 均值', '单位 FC SD',
    'Welch p', 'Dunnett 校正 p', 'ANOVA 总体 p', '显著性', '统计方法', '设计状态'];
  const rows = (out.groupResults ?? []).map((r) => [r.target, r.group, t(r.isControl ? '是' : '否'),
    confirmed ? r.nBio : '', r.nTech, JSON.stringify(r.unitIds), JSON.stringify(r.sampleIds),
    RAW(r.deltaCtMean), RAW(r.deltaCtSd), RAW(r.ddCt), RAW(r.foldChange), RAW(r.fcMean), RAW(r.fcSd),
    confirmed ? RAW(r.pValue) : '', confirmed ? RAW(r.pAdjusted) : '', confirmed ? RAW(r.anovaPValue) : '',
    confirmed ? r.significance : '', t(confirmed ? r.statMethod : '仅描述；未进行组间推断'),
    out.designStatus ?? 'unconfirmed']);
  return [header.map(t), ...rows];
}

/** Design status and provenance are separate from numerical result tables. */
export function designAoa(out: AnalysisOutput, design?: ExperimentalDesign, language: Language = 'zh'): (string | number)[][] {
  const t = (message: string) => translate(message, language);
  return [
    [t('设计状态'), out.designStatus ?? 'unconfirmed'],
    [t('设计类型'), design?.kind ?? ''],
    [t('设计已确认'), design ? t(design.confirmed ? '是' : '否') : ''],
    [t('对照组'), design?.controlGroup ?? ''],
    [t('单位与组别映射'), JSON.stringify(design?.assignments ?? [])],
    [t('解释边界'), t('技术孔不作为独立重复；仅确认且支持的设计输出组间推断。')],
    ...((out.designIssues ?? []).map((issue) => [issue.code, t(issue.message), issue.unitId ?? '', JSON.stringify(issue.sampleIds ?? [])])),
    ...(out.warnings ?? []).map((warning) => [t('警告'), t(warning)]),
  ];
}

/** 原始数据 + QC 标记表。 */
export function rawAoa(rows: AnalysisRow[], flags: QcFlags, language: Language = 'zh'): (string | number)[][] {
  const t = (message: string) => translate(message, language);
  const header = ['行号', '板号', '孔位', '样本', '组别', '配对ID', '基因', 'Cq', 'QC 标记', '已剔除'];
  const body = rows.map((r) => [
    r.id, r.plate, r.well, r.sample, r.group, r.pairId, r.target,
    Number.isFinite(r.cq) ? NUM(r.cq) : '',
    (flags[r.id] ?? []).map(t).join(language === 'en' ? '; ' : '；'), r.excluded ? t('是') : '',
  ]);
  return [header.map(t), ...body];
}

const VERDICT_LABEL: Record<NtcReportEntry['verdict'], string> = {
  contaminated: '⚠️ 疑似污染',
  late: '晚期扩增',
  pass: '✓ 通过',
};

/** NTC 污染检查表（AOA，含表头）。 */
export function ntcAoa(report: NtcReportEntry[], language: Language = 'zh'): (string | number)[][] {
  const t = (message: string) => translate(message, language);
  const header = ['基因 Target', 'NTC 孔数', '扩增孔数', '最低 Cq', '结论', '说明', 'NTC 孔位'];
  const rows = report.map((e) => [
    e.target, e.wells.length, e.amplified,
    e.minCq != null ? NUM(e.minCq) : t('未扩增'),
    t(VERDICT_LABEL[e.verdict]), t(e.message), e.wells.join(' '),
  ]);
  return [header.map(t), ...rows];
}

function aoaToSheet(aoa: (string | number)[][]): XLSX.WorkSheet {
  return XLSX.utils.aoa_to_sheet(aoa);
}

/** 熔解检查表（AOA，含表头）。 */
export function meltAoa(melt: { gene: string; checked: number; single: number; none: number; multi: { sample: string; well: string; tm: number | null }[] }[], language: Language = 'zh'): (string | number)[][] {
  const t = (message: string) => translate(message, language);
  const header = ['基因 Target', '检查孔数', '单峰（通过）', '多峰（非特异）', '无峰', '多峰孔位与 Tm'];
  const rows = melt.map((m) => [
    m.gene, m.checked, m.single, m.multi.length, m.none,
    m.multi.map((w) => `${w.sample}@${w.well} ${w.tm ?? '—'}°C`).join('；'),
  ]);
  return [header.map(t), ...rows];
}

/** 构建多 sheet 工作簿：结果 / 原始数据+QC / NTC检查 / 熔解检查 / 项目信息。 */
export function buildWorkbook(
  out: AnalysisOutput,
  rows: AnalysisRow[],
  flags: QcFlags,
  meta: {
    fileName: string;
    refGenes: string[];
    controlSamples: string[];
    efficiencies?: Record<string, number>;
    experimentalDesign?: ExperimentalDesign;
    melt?: { gene: string; checked: number; single: number; none: number; multi: { sample: string; well: string; tm: number | null }[] }[];
  },
  language: Language = 'zh',
): XLSX.WorkBook {
  const t = (message: string) => translate(message, language);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, aoaToSheet(resultAoa(out, language)), t('样本技术描述'));
  XLSX.utils.book_append_sheet(wb, aoaToSheet(groupResultAoa(out, language)), t('组级独立单位结果'));
  XLSX.utils.book_append_sheet(wb, aoaToSheet(designAoa(out, meta.experimentalDesign, language)), t('实验设计与边界'));
  XLSX.utils.book_append_sheet(wb, aoaToSheet(rawAoa(rows, flags, language)), t('原始数据与QC'));
  if (out.ntcReport.length > 0) {
    XLSX.utils.book_append_sheet(wb, aoaToSheet(ntcAoa(out.ntcReport, language)), t('NTC污染检查'));
  }
  if (meta.melt && meta.melt.length > 0) {
    XLSX.utils.book_append_sheet(wb, aoaToSheet(meltAoa(meta.melt, language)), t('熔解检查'));
  }
  const info: (string | number)[][] = [
    [t('PCR Workbench · PCR 工作台'), ''],
    [t('源文件'), meta.fileName],
    [t('内参基因（池化）'), meta.refGenes.join('、')],
    [t('对照组样本'), meta.controlSamples.join('、')],
    [t('方法'), out.effMode ? 'Pfaffl' : 'Livak 2^-ΔΔCt'],
    [t('设计状态'), out.designStatus ?? 'unconfirmed'],
    [t('统计方法'), out.designStatus === 'confirmed'
      ? [...new Set((out.groupResults ?? []).map((r) => r.statMethod).filter(Boolean))].map(t).join('; ')
      : t('仅描述；未进行组间推断')],
    ...Object.entries(out.efficiencies)
      .filter(([, v]) => Number.isFinite(v) && v !== 100)
      .map(([g, v]) => [t(`效率 ${g}`), t(`${v}%（E=${(1 + v / 100).toFixed(3)}，Pfaffl 校正生效）`)]),
    [t('导出时间'), new Date().toLocaleString(language === 'en' ? 'en' : 'zh-CN')],
  ];
  XLSX.utils.book_append_sheet(wb, aoaToSheet(info), t('项目信息'));
  return wb;
}

/** 工作簿 → 二进制（供浏览器 Blob 下载）。 */
export function workbookToBuffer(wb: XLSX.WorkBook): ArrayBuffer {
  return XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
}

/** CSV 序列化（RFC 4180 引号规则，UTF-8 BOM 便于 Excel 直接打开中文）。 */
export function toCsv(aoa: (string | number)[][]): string {
  const esc = (v: string | number): string => {
    const s = String(v ?? '');
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '\uFEFF' + aoa.map((row) => row.map(esc).join(',')).join('\r\n');
}

/** 触发浏览器下载（UI 层调用）。 */
export function downloadBlob(data: BlobPart, filename: string, mediaType: string): void {
  const url = URL.createObjectURL(new Blob([data], { type: mediaType }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function downloadWorkbook(wb: XLSX.WorkBook, filename: string): void {
  downloadBlob(workbookToBuffer(wb), filename, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
}

export function downloadCsv(aoa: (string | number)[][], filename: string): void {
  downloadBlob(toCsv(aoa), filename, 'text/csv;charset=utf-8');
}

export function downloadSvg(svg: SVGSVGElement | string, filename: string): void {
  const xml = typeof svg === 'string' ? svg : new XMLSerializer().serializeToString(svg);
  downloadBlob('\uFEFF' + xml, filename, 'image/svg+xml;charset=utf-8');
}

/** 按 SVG 固有宽高栅格化为 PNG，保持文字、线条和图片比例一致。 */
export function downloadSvgAsPng(
  svg: SVGSVGElement | string,
  filename: string,
  opts: { scale?: number } = {},
): Promise<void> {
  const scale = opts.scale ?? 2;
  return new Promise((resolve, reject) => {
    const xml = typeof svg === 'string' ? svg : new XMLSerializer().serializeToString(svg);
    const svgBlob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.naturalWidth * scale);
      canvas.height = Math.round(img.naturalHeight * scale);
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        URL.revokeObjectURL(url);
        reject(new Error('无法创建画布'));
        return;
      }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error('PNG 编码失败'));
          return;
        }
        downloadBlob(blob, filename, 'image/png');
        resolve();
      }, 'image/png');
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('SVG 渲染失败'));
    };
    img.src = url;
  });
}
