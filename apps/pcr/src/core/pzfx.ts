// Prism XML: technical Cq, descriptive scalars, and confirmed unit-level data
// are separate tables. Summary means and SDs are never two replicate rows.
import { translate, type Language } from '../i18n/translate';
import type { DesignStatus, GroupTargetResult, SampleTargetResult } from './types';

const esc = (s: string): string =>
  Array.from(String(s ?? '')).filter((character) => {
    const code = character.codePointAt(0)!;
    return code === 9 || code === 10 || code === 13 || (code >= 0x20 && code <= 0xd7ff)
      || (code >= 0xe000 && code <= 0xfffd) || code >= 0x10000;
  }).join('').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

interface PrismColumn { title: string; values: (number | null | undefined)[] }

export interface PrismExportOptions {
  projectName: string;
  refGenes: string[];
  controlSamples: string[];
  language?: Language;
  groupResults?: GroupTargetResult[];
  designStatus?: DesignStatus;
}

export function buildPrismPzfx(results: SampleTargetResult[], opts: PrismExportOptions): string {
  const t = (message: string) => translate(message, opts.language ?? 'zh');
  const genes = [...new Set(results.map((r) => r.target))].sort();
  const tables: string[] = [];
  const exportNotes: string[] = [];
  const addTable = (title: string, rowLabels: string[], columns: PrismColumn[]) => {
    const id = tables.length + 1;
    const body = columns.map((column) =>
      `      <YColumn Width="100" Decimals="4" Subcolumns="1">\n        <Title>${esc(column.title)}</Title>\n        <Subcolumn>\n` +
      rowLabels.map((_, index) => {
        const value = column.values[index];
        return `          <d>${value != null && Number.isFinite(value) ? value : ''}</d>\n`;
      }).join('') + '        </Subcolumn>\n      </YColumn>',
    ).join('\n');
    tables.push(`    <Table ID="Table${id}" XFormat="none" YFormat="replicates" Replicates="1" TableType="OneWay">\n` +
      `      <Title>${esc(title)}</Title>\n      <RowTitlesColumn Width="100">\n        <Subcolumn>\n` +
      rowLabels.map((label) => `          <d>${esc(label)}</d>\n`).join('') +
      `        </Subcolumn>\n      </RowTitlesColumn>\n${body}\n    </Table>`);
  };
  const sampleLabel = (r: SampleTargetResult) => {
    const identity = JSON.stringify(r.sampleIds ?? [{ plate: r.plate ?? '', sample: r.sample }]);
    return `${r.sample}${r.isControl ? ` (${t('对照')})` : ''} | ${identity}`;
  };

  for (const gene of genes) {
    const geneRows = results.filter((r) => r.target === gene);
    const n = Math.max(0, ...geneRows.map((r) => r.values.length));
    addTable(`${gene} — ${t('技术孔 Cq；不用于组间推断')}`,
      Array.from({ length: n }, (_, i) => `${t('技术孔')} ${i + 1}`),
      geneRows.map((r) => ({ title: sampleLabel(r), values: r.values })));
  }
  const scalarRows = results.map((r) => ({ title: `${r.target} | ${sampleLabel(r)}`, result: r }));
  addTable(t('样本 FC 描述值'), [t('描述值')], scalarRows.map(({ title, result }) => ({ title, values: [result.foldChange] })));
  addTable(t('技术孔 FC SD'), [t('技术孔 FC SD')], scalarRows.map(({ title, result }) => ({ title, values: [result.fcSd] })));

  // A confirmed design is required even if a legacy caller supplies group rows.
  if (opts.designStatus === 'confirmed') {
    const groups = opts.groupResults ?? [];
    for (const gene of [...new Set(groups.map((r) => r.target))].sort()) {
      const geneGroups = groups.filter((r) => r.target === gene);
      const unitIds = geneGroups.flatMap((r) => r.unitIds);
      if (new Set(unitIds).size !== unitIds.length || geneGroups.some((r) =>
        r.nBio !== r.unitIds.length || r.deltaCtValues.length !== r.unitIds.length)) {
        exportNotes.push(`${gene}: ${t('独立单位与数值未一一对应，已跳过该靶标的 Prism 组结果。')}`);
        continue;
      }
      for (const [title, field] of [['独立单位 ΔCt', 'deltaCtValues'], ['独立单位 FC', 'fcValues']] as const) {
        addTable(`${gene} — ${t(title)}`, unitIds, geneGroups.map((r) => {
          // Missing controls or nonfinite FCs can leave a filtered/empty FC array.
          // Without matching IDs, never shift the remaining values onto other units.
          if (r[field].length !== r.unitIds.length) {
            exportNotes.push(`${gene} / ${r.group}: ${t('FC 缺失或无法按单位对齐，已留空；ΔCt 保留。')}`);
            return { title: r.group, values: [] };
          }
          const values = new Map(r.unitIds.map((id, i) => [id, r[field][i]]));
          return { title: r.group, values: unitIds.map((id) => values.get(id)) };
        }));
      }
    }
  }

  const info = [
    [t('对照'), opts.controlSamples.join('、')], [t('内参'), opts.refGenes.join('、')],
    [t('设计状态'), opts.designStatus ?? 'unconfirmed'],
    [t('解释边界'), t('技术孔不作为独立重复；仅确认且支持的设计输出组间推断。')],
    [t('数据表说明'), t('组结果每行对应一个独立单位；空白表示不属于该组或指标不可用。样本 FC 与技术 SD 是单独的描述表。')],
    ...exportNotes.map((note) => [t('导出说明'), note]),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<GraphPadPrismFile xmlns="http://graphpad.com/prism/Prism.htm" PrismXMLVersion="5.00">\n` +
    `  <Created>\n    <OriginalVersion CreatedByProgram="PCR Workbench" />\n  </Created>\n` +
    `  <InfoSequence><Ref ID="Info1" /></InfoSequence>\n  <Info ID="Info1">\n    <Title>${esc(opts.projectName || 'PCR Workbench')}</Title>\n` +
    info.map(([name, value]) => `    <Constant><Name>${esc(name)}</Name><Value>${esc(value)}</Value></Constant>\n`).join('') +
    `  </Info>\n  <TableSequence>\n${tables.map((_, i) => `    <Ref ID="Table${i + 1}" />`).join('\n')}\n  </TableSequence>\n` +
    `${tables.join('\n')}\n</GraphPadPrismFile>\n`;
}
