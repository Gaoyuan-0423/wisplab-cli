import * as XLSX from 'xlsx';
import { parseRdml } from './rdml';
import type { SheetMatrix } from './types';

const EXCEL_EXTS = new Set(['xlsx', 'xls', 'xlsm', 'xlsb']);

/**
 * 纯文本解码：先认 BOM（UTF-8 / UTF-16LE / UTF-16BE），再识别无 BOM 的 UTF-16
 * （ASCII 字符的高字节为 0，NUL 集中在奇数或偶数位），其余优先 UTF-8（严格模式），
 * 失败回落 GBK（国产仪器 Windows 导出常见编码）。
 * QuantStudio / Bio-Rad 等的部分 .txt 导出为 UTF-16LE：NUL 在 UTF-8 中合法，
 * 不先判定就会解成每个字符间夹 \u0000 的文本，列识别全部失败。
 */
export function decodeText(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const utf16 = utf16Encoding(bytes);
  if (utf16) return new TextDecoder(utf16).decode(bytes);
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

function utf16Encoding(bytes: Uint8Array): 'utf-16le' | 'utf-16be' | null {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return 'utf-16le';
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return 'utf-16be';
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return null;
  // 无 BOM：取前 1024 个码元，NUL 几乎只落在一侧时判为 UTF-16。
  const pairs = Math.min(1024, Math.floor(bytes.length / 2));
  if (pairs < 2) return null;
  let evenNul = 0;
  let oddNul = 0;
  for (let i = 0; i < pairs; i += 1) {
    if (bytes[2 * i] === 0) evenNul += 1;
    if (bytes[2 * i + 1] === 0) oddNul += 1;
  }
  if (oddNul >= pairs * 0.4 && evenNul <= pairs * 0.05) return 'utf-16le';
  if (evenNul >= pairs * 0.4 && oddNul <= pairs * 0.05) return 'utf-16be';
  return null;
}

function cellToText(v: unknown): string {
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'number') {
    // Shortest round-trip text: rounding here would turn a 1e-12 standard into 0.
    return String(v);
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
  // raw:true keeps every text cell verbatim. raw:false lets SheetJS guess types by
  // locale: "23,45" became 2345 and sample names such as "1/10" became date serials
  // (which the standard curve then read as concentration 36901). Numbers are parsed
  // by number.ts (parseCq / parseQuantity), which already handles decimal commas.
  const wb = XLSX.read(text, { type: 'string', raw: true });
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
