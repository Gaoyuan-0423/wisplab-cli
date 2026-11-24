// 孔板布局：从 well 字符串（A1/A01/P24…）解析行列，生成 96/384 或自定义网格。

export interface WellPos {
  row: number; // 0 起
  col: number; // 0 起
}

const WELL_RE = /^([a-z]{1,2})\s*0*(\d{1,3})$/;

export function parseWell(s: string): WellPos | null {
  const m = WELL_RE.exec(String(s ?? '').trim().toLowerCase());
  if (!m) return null;
  const letters = m[1];
  const num = parseInt(m[2], 10);
  if (num < 1 || num > 48) return null;
  let row = 0;
  for (let i = 0; i < letters.length; i++) {
    const c = letters.charCodeAt(i) - 96;
    if (c < 1 || c > 26) return null;
    row = row * 26 + c;
  }
  return { row: row - 1, col: num - 1 };
}

export function wellName(row: number, col: number): string {
  let r = row + 1;
  let letters = '';
  while (r > 0) {
    const rem = (r - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    r = Math.floor((r - 1) / 26);
  }
  return `${letters}${col + 1}`;
}

export interface PlateLayout {
  rowCount: number;
  colCount: number;
  /** '96' | '384' | 'custom'：完整标准板才标记标准型。 */
  kind: '96' | '384' | 'custom';
  rowLabels: string[];
  colLabels: string[];
}

/** 根据实际出现的孔位推断板型；解析不出任何孔位返回 null。 */
export function detectPlateLayout(wells: string[]): PlateLayout | null {
  let maxRow = -1;
  let maxCol = -1;
  let count = 0;
  for (const w of wells) {
    const p = parseWell(w);
    if (!p) continue;
    maxRow = Math.max(maxRow, p.row);
    maxCol = Math.max(maxCol, p.col);
    count++;
  }
  if (count === 0) return null;
  const rowCount = maxRow + 1;
  const colCount = maxCol + 1;
  let kind: PlateLayout['kind'] = 'custom';
  if (rowCount <= 8 && colCount <= 12) kind = '96';
  else if (rowCount <= 16 && colCount <= 24) kind = '384';
  return {
    rowCount,
    colCount,
    kind,
    rowLabels: Array.from({ length: rowCount }, (_, i) => wellName(i, 0).replace(/\d+$/, '')),
    colLabels: Array.from({ length: colCount }, (_, i) => String(i + 1)),
  };
}

/** 生成完整网格的孔位名（按行优先），用于渲染空孔。 */
export function allWellNames(layout: PlateLayout): string[] {
  const out: string[] = [];
  for (let r = 0; r < layout.rowCount; r++) {
    for (let c = 0; c < layout.colCount; c++) {
      out.push(wellName(r, c));
    }
  }
  return out;
}
