import * as XLSX from 'xlsx';
import { parseRdml } from './rdml';
import type { SheetMatrix } from './types';

const EXCEL_EXTS = new Set(['xlsx', 'xls', 'xlsm', 'xlsb']);

/** 纯文本解码：优先 UTF-8（严格模式），失败回落 GBK（国产仪器 Windows 导出常见编码）。 */
export function decodeText(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    try {
      return new TextDecoder('gbk').decode(bytes);
    } catch {
      return new TextDecoder('utf-8').decode(bytes);
    }
  }
}

function cellToText(v: unknown): string {
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'number') {
    return Number.isInteger(v) ? String(v) : String(Math.round(v * 1e10) / 1e10);
  }
  return String(v).trim();
}

/** 不做表头切分，返回整个工作表的文本矩阵（表头检测交给 sniff 权威判定）。 */
export function sheetToRawMatrix(wb: XLSX.WorkBook, sheetName: string): string[][] {
  const ws = wb.Sheets[sheetName];
  if (!ws) return [];
  const json = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '', raw: true });
  return json.map((row) => row.map(cellToText)).filter((r) => r.some((c) => c.length > 0));
}

export function sheetToMatrix(wb: XLSX.WorkBook, sheetName: string): SheetMatrix {
  const ws = wb.Sheets[sheetName];
  if (!ws) return { headers: [], rows: [] };
  const json = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '', raw: true });
  const matrix = json.map((row) => row.map(cellToText));
  return matrixToSheet(matrix);
}

/** 从任意矩阵中定位表头：全文本且非空单元格占比高的第一行；其后全空行裁掉。 */
export function matrixToSheet(matrix: string[][]): SheetMatrix {
  const rows = matrix.filter((r) => r.some((c) => c.length > 0));
  if (rows.length === 0) return { headers: [], rows: [] };
  let headerIdx = 0;
  for (let i = 0; i < Math.min(20, rows.length); i++) {
    const row = rows[i];
    const nonEmpty = row.filter((c) => c.length > 0).length;
    if (nonEmpty >= Math.max(2, Math.ceil(row.length * 0.5))) {
      headerIdx = i;
      break;
    }
    headerIdx = i;
  }
  const width = rows.slice(headerIdx).reduce((w, r) => Math.max(w, r.length), 0);
  const headers = Array.from({ length: width }, (_, i) => (rows[headerIdx][i] ?? '').trim());
  const dataRows = rows
    .slice(headerIdx + 1)
    .map((r) => Array.from({ length: width }, (_, i) => r[i] ?? ''))
    .filter((r) => r.some((c) => c.length > 0));
  return { headers, rows: dataRows };
}

export interface WorkbookFile {
  kind: 'workbook';
  fileName: string;
  sheetNames: string[];
  wb: XLSX.WorkBook;
}

export interface RdmlFile {
  kind: 'rdml';
  fileName: string;
  matrix: string[][];
  targetEfficiencies: Record<string, number>;
  meltCurves: import('./melt').RdmlMeltCurve[];
}

/** 读取用户文件：Excel 走二进制，CSV/TSV/TXT 走文本（UTF-8 → GBK 回落），RDML 走标准解析器。 */
export async function readInputFile(file: File): Promise<WorkbookFile | RdmlFile> {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'rdml') {
    const parsed = parseRdml(await file.arrayBuffer());
    return {
      kind: 'rdml',
      fileName: file.name,
      matrix: parsed.matrix,
      targetEfficiencies: parsed.targetEfficiencies,
      meltCurves: parsed.meltCurves,
    };
  }
  if (EXCEL_EXTS.has(ext)) {
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
    return { kind: 'workbook', fileName: file.name, sheetNames: wb.SheetNames, wb };
  }
  const text = decodeText(await file.arrayBuffer());
  // ZIP 魔数 + 无扩展名的 RDML
  const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  if (head[0] === 0x50 && head[1] === 0x4b) {
    const parsed = parseRdml(await file.arrayBuffer());
    return {
      kind: 'rdml',
      fileName: file.name,
      matrix: parsed.matrix,
      targetEfficiencies: parsed.targetEfficiencies,
      meltCurves: parsed.meltCurves,
    };
  }
  const wb = XLSX.read(text, { type: 'string', raw: false });
  return { kind: 'workbook', fileName: file.name, sheetNames: wb.SheetNames, wb };
}

/** 兼容旧调用名（工作簿场景）。 */
export async function readWorkbookFile(file: File): Promise<WorkbookFile> {
  const r = await readInputFile(file);
  if (r.kind === 'rdml') throw new Error('RDML 文件请使用 readInputFile');
  return r;
}

/** 生成 sheet 摘要供多 sheet 选择 UI 使用。 */
export function summarizeSheet(wb: XLSX.WorkBook, sheetName: string) {
  const m = sheetToMatrix(wb, sheetName);
  return {
    name: sheetName,
    rowCount: m.rows.length,
    columnCount: m.headers.length,
    headers: m.headers.filter((h) => h.length > 0),
    preview: m.rows.slice(0, 3).map((r) => r.slice(0, 6)),
  };
}
