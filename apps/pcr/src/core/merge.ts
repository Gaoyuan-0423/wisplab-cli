// 多板/多文件合并：每个文件独立嗅探列映射，抽出的规范行合并成一个数据集。
// 合并语义：同样本同基因的复孔可分布在任意板上，聚合时自动跨板汇总——
// 典型场景"板1做内参、板2做目标基因"由此得到正确的 ΔCt。
// 板名：文件内有板号列用板号列；否则回退为文件名（去扩展名）。

import { extractRows, type AnalysisRow } from './analysis';
import { sniff } from './sniff';
import type { ColumnMapping } from './types';

export interface FileMatrixInput {
  fileName: string;
  matrix: string[][];
}

export interface PerFileInfo {
  fileName: string;
  /** 板名（板号列值或文件名回退） */
  plate: string;
  headerRow: number;
  mapping: ColumnMapping;
  /** 识别出的必需列表头名（摘要展示用） */
  cols: { sample: string; target: string; cq: string };
  rowCount: number;
  ok: boolean;
  problem?: string;
}

export interface MergeResult {
  rows: AnalysisRow[];
  perFile: PerFileInfo[];
}

function plateFallback(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '');
}

export function mergeFileMatrices(inputs: FileMatrixInput[]): MergeResult {
  const rows: AnalysisRow[] = [];
  const perFile: PerFileInfo[] = [];
  let nextId = 1;

  for (const input of inputs) {
    const s = sniff(input.matrix);
    const baseName = plateFallback(input.fileName);
    const headers = input.matrix[s.headerRow] ?? [];
    const colName = (idx: number) => (idx >= 0 ? headers[idx] || `第 ${idx + 1} 列` : '—');
    const info: PerFileInfo = {
      fileName: input.fileName,
      plate: baseName,
      headerRow: s.headerRow,
      mapping: s.mapping,
      cols: {
        sample: colName(s.mapping.sample),
        target: colName(s.mapping.target),
        cq: colName(s.mapping.cq),
      },
      rowCount: 0,
      ok: s.mapping.sample >= 0 && s.mapping.target >= 0 && s.mapping.cq >= 0,
    };
    if (!info.ok) {
      info.problem = '未能识别 样本/基因/Cq 必需列，该文件已跳过';
      perFile.push(info);
      continue;
    }
    const fileRows = extractRows(input.matrix.slice(s.headerRow + 1), s.mapping);
    for (const r of fileRows) {
      if (!r.plate) r.plate = baseName;
      r.id = nextId++;
      rows.push(r);
    }
    info.rowCount = fileRows.length;
    perFile.push(info);
  }

  return { rows, perFile };
}
