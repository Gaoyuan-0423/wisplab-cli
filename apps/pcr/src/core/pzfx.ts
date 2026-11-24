// Prism (.pzfx XML) 数据表：每基因一张 Cq 复孔表，另附 Fold Change 汇总。
// Structure follows GraphPad's published Prism XML schema (FAQ 1638).

import type { SampleTargetResult } from './types';

const esc = (s: string): string =>
  Array.from(String(s ?? '')).filter((character) => {
    const code = character.codePointAt(0)!;
    return code === 9 || code === 10 || code === 13 || (code >= 0x20 && code <= 0xd7ff)
      || (code >= 0xe000 && code <= 0xfffd) || code >= 0x10000;
  }).join('').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

interface PrismSubcolumn {
  title: string;
  /** 复孔值（按行序），缺失补空 */
  values: (number | null)[];
}

/** 由结果聚合出 每基因×样本 的复孔列。 */
function subcolumnsForGene(results: SampleTargetResult[], gene: string): PrismSubcolumn[] {
  const geneRows = results.filter((r) => r.target === gene);
  const cols: PrismSubcolumn[] = [];
  for (const r of geneRows) {
    cols.push({
      title: r.isControl ? `${r.sample} (对照)` : r.sample,
      values: [...r.values],
    });
  }
  return cols;
}

export function buildPrismPzfx(
  results: SampleTargetResult[],
  opts: { projectName: string; refGenes: string[]; controlSamples: string[] },
): string {
  const genes = [...new Set(results.map((r) => r.target))].sort();
  const maxRows = genes.reduce((mx, g) => {
    return Math.max(mx, ...results.filter((r) => r.target === g).map((r) => r.values.length));
  }, 0);

  const tables: string[] = [];
  let tableId = 0;

  for (const gene of genes) {
    const cols = subcolumnsForGene(results, gene);
    tableId += 1;
    const subcols = cols
      .map(
        (c) =>
          `      <YColumn Width="100" Decimals="4" Subcolumns="1">\n        <Title>${esc(c.title)}</Title>\n        <Subcolumn>\n` +
          Array.from({ length: maxRows }, (_, i) =>
            c.values[i] != null && Number.isFinite(c.values[i]!) ? `          <d>${c.values[i]!}</d>\n` : '          <d></d>\n',
          ).join('') +
          '        </Subcolumn>\n      </YColumn>',
      )
      .join('\n');
    // Prism stores row-title cells as unprefixed <d> elements inside Subcolumn.
    const rowTitles = Array.from({ length: maxRows }, (_, i) => `          <d>${i + 1}</d>`).join('\n');
    tables.push(
      `    <Table ID="Table${tableId}" XFormat="none" YFormat="replicates" Replicates="1" TableType="OneWay">\n` +
        `      <Title>${esc(gene)} — Cq replicates</Title>\n` +
        `      <RowTitlesColumn Width="100">\n        <Subcolumn>\n${rowTitles}\n        </Subcolumn>\n      </RowTitlesColumn>\n` +
        `${subcols}\n    </Table>`,
    );
  }

  // 汇总表：Fold Change mean ± SD（直接可贴入 Prism 作图）
  tableId += 1;
  const fcCols: string[] = [];
  for (const gene of genes) {
    for (const r of results.filter((x) => x.target === gene)) {
      fcCols.push(
        `      <YColumn Width="100" Decimals="4" Subcolumns="1">\n        <Title>${esc(r.target + ' | ' + r.sample)}</Title>\n        <Subcolumn>\n          <d>${r.foldChange != null && Number.isFinite(r.foldChange) ? r.foldChange.toFixed(4) : ''}</d>\n          <d>${r.fcSd != null && Number.isFinite(r.fcSd) ? r.fcSd.toFixed(4) : ''}</d>\n        </Subcolumn>\n      </YColumn>`,
      );
    }
  }
  tables.push(
    `    <Table ID="Table${tableId}" XFormat="none" YFormat="replicates" Replicates="1" TableType="TwoWay">\n` +
      `      <Title>Fold Change (mean ± SD)</Title>\n` +
      `      <RowTitlesColumn Width="100">\n        <Subcolumn>\n          <d>Mean</d>\n          <d>SD</d>\n        </Subcolumn>\n      </RowTitlesColumn>\n` +
      `${fcCols.join('\n')}\n    </Table>`,
  );

  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<GraphPadPrismFile xmlns="http://graphpad.com/prism/Prism.htm" PrismXMLVersion="5.00">\n` +
    `  <Created>\n    <OriginalVersion CreatedByProgram="PCR Workbench" />\n  </Created>\n` +
    `  <InfoSequence><Ref ID="Info1" /></InfoSequence>\n` +
    `  <Info ID="Info1">\n    <Title>${esc(opts.projectName || 'PCR Workbench')}</Title>\n` +
    `    <Constant><Name>对照</Name><Value>${esc(opts.controlSamples.join('、'))}</Value></Constant>\n` +
    `    <Constant><Name>内参</Name><Value>${esc(opts.refGenes.join('、'))}</Value></Constant>\n  </Info>\n` +
    `  <TableSequence>\n${tables.map((_, i) => `    <Ref ID="Table${i + 1}" />`).join('\n')}\n  </TableSequence>\n` +
    `${tables.join('\n')}\n` +
    `</GraphPadPrismFile>\n`
  );
}
