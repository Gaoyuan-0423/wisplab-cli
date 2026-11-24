import { describe, expect, it } from 'vitest';
import { analyzeDeltaDeltaCt } from './analysis';
import { mergeFileMatrices, type FileMatrixInput } from './merge';
import { DEFAULT_QC } from './types';

const HEADERS = ['Well Position', 'Sample Name', 'Target Name', 'Cq Mean'];

function matrix(data: (string | number)[][]): string[][] {
  return [HEADERS, ...data.map((r) => r.map(String))];
}

const plate1: FileMatrixInput = {
  fileName: 'merge-plate1.csv',
  matrix: matrix([
    ['A01', 'Control-1', 'GAPDH', 20],
    ['A02', 'Control-1', 'GAPDH', 20],
    ['A03', 'Control-1', 'GAPDH', 20],
    ['B01', 'Treat-1', 'GAPDH', 20],
    ['B02', 'Treat-1', 'GAPDH', 20],
    ['B03', 'Treat-1', 'GAPDH', 20],
  ]),
};
const plate2: FileMatrixInput = {
  fileName: 'merge-plate2.csv',
  matrix: matrix([
    ['A01', 'Control-1', 'LDHA', 25],
    ['A02', 'Control-1', 'LDHA', 25],
    ['A03', 'Control-1', 'LDHA', 26],
    ['B01', 'Treat-1', 'LDHA', 23],
    ['B02', 'Treat-1', 'LDHA', 23],
    ['B03', 'Treat-1', 'LDHA', 23],
  ]),
};

describe('多板合并', () => {
  const m = mergeFileMatrices([plate1, plate2]);

  it('两文件各自嗅探成功，板名回退为文件名', () => {
    expect(m.perFile).toHaveLength(2);
    expect(m.perFile.every((f) => f.ok)).toBe(true);
    expect(m.perFile.map((f) => f.plate)).toEqual(['merge-plate1', 'merge-plate2']);
    expect(m.perFile[0].cols.sample).toBe('Sample Name');
    expect(m.perFile[0].cols.cq).toBe('Cq Mean');
  });

  it('行合并且 id 全局唯一', () => {
    expect(m.rows).toHaveLength(12);
    expect(new Set(m.rows.map((r) => r.id)).size).toBe(12);
    expect(m.rows.every((r) => r.plate === 'merge-plate1' || r.plate === 'merge-plate2')).toBe(true);
  });

  it('跨板 ΔCt 手算对照：内参在板1、目标在板2 自动配对', () => {
    const out = analyzeDeltaDeltaCt(m.rows, {
      controlSamples: ['Control-1'],
      refGenes: ['GAPDH'],
      qc: DEFAULT_QC,
    });
    expect(out.results).toHaveLength(2);
    const ctrl = out.results.find((r) => r.isControl)!;
    const treat = out.results.find((r) => r.sample === 'Treat-1')!;
    // 每个样本的内参 Cq 来自板1，目标 Cq 来自板2
    expect(ctrl.refCq).toBeCloseTo(20);
    expect(treat.refCq).toBeCloseTo(20);
    // 复孔跨板聚合：Control-1 LDHA 25,25,26 → ΔCt 16/3
    expect(treat.ddCt).toBeCloseTo(3 - 16 / 3, 10);
    expect(treat.foldChange).toBeCloseTo(Math.pow(2, 16 / 3 - 3), 10);
    // 结果行保留板位信息（wells 可来自不同板）
    expect(treat.n).toBe(3);
  });

  it('文件内有板号列时优先用板号列', () => {
    const withPlate: FileMatrixInput = {
      fileName: 'run7.csv',
      matrix: [
        ['Plate', 'Well Position', 'Sample Name', 'Target Name', 'Cq Mean'],
        ['P7-A', 'A01', 'S1', 'GAPDH', '20'],
      ],
    };
    const m2 = mergeFileMatrices([withPlate]);
    expect(m2.rows[0].plate).toBe('P7-A');
    expect(m2.perFile[0].plate).toBe('run7'); // perFile.plate 记录回退名，行内用板号列
  });

  it('无法识别必需列的文件被跳过并注明', () => {
    const bad: FileMatrixInput = { fileName: 'bad.csv', matrix: [['foo', 'bar'], ['1', '2']] };
    const m3 = mergeFileMatrices([plate1, bad]);
    expect(m3.perFile[1].ok).toBe(false);
    expect(m3.perFile[1].problem).toContain('跳过');
    expect(m3.rows.every((r) => r.plate !== 'bad')).toBe(true);
  });
});
