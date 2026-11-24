import { describe, expect, it } from 'vitest';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { analyzeDeltaDeltaCt, extractRows } from './analysis';
import { DEFAULT_QC, emptyMapping } from './types';
import { buildPrismPzfx } from './pzfx';

const target = 'Gene <A&B>';
const control = 'Control--1';
const treatment = 'Treat "2"';
const rows = extractRows([
  [control, 'REF', '20'], [control, 'REF', '20'],
  [treatment, 'REF', '20'], [treatment, 'REF', '20'],
  [control, target, '25'], [control, target, '25'],
  [treatment, target, '23'], [treatment, target, '23'],
], { ...emptyMapping(), sample: 0, target: 1, cq: 2 });
const output = analyzeDeltaDeltaCt(rows, { controlSamples: [control], refGenes: ['REF'], qc: DEFAULT_QC });
const options = { projectName: 'Project <A> & "B"', refGenes: ['REF'], controlSamples: [control] };
const parse = (xml: string) => new XMLParser({
  ignoreAttributes: false,
  parseTagValue: false,
  isArray: (name) => ['Table', 'Ref', 'YColumn', 'd', 'Constant'].includes(name),
}).parse(xml).GraphPadPrismFile;

describe('Prism PZFX export', () => {
  it('preserves Cq and fold-change cells in referenced Prism data tables', () => {
    const xml = buildPrismPzfx(output.results, options);
    expect(XMLValidator.validate(xml)).toBe(true);
    const document = parse(xml);
    expect(document.TableSequence.Ref.map((ref: Record<string, string>) => ref['@_ID']))
      .toEqual(document.Table.map((table: Record<string, string>) => table['@_ID']));
    const [cq, summary] = document.Table;
    expect(cq.Title).toBe(`${target} — Cq replicates`);
    expect(cq.RowTitlesColumn.Subcolumn.d).toEqual(['1', '2']);
    expect(cq.YColumn.map((column: { Title: string }) => column.Title)).toEqual([`${control} (对照)`, treatment]);
    expect(cq.YColumn.map((column: { Subcolumn: { d: string[] } }) => column.Subcolumn.d))
      .toEqual([['25', '25'], ['23', '23']]);
    expect(summary.RowTitlesColumn.Subcolumn.d).toEqual(['Mean', 'SD']);
    expect(summary.YColumn.map((column: { Subcolumn: { d: string[] } }) => column.Subcolumn.d))
      .toEqual([['1.0000', '0.0000'], ['4.0000', '0.0000']]);
  });

  it('round-trips labels and metadata with XML punctuation and comment delimiters', () => {
    const document = parse(buildPrismPzfx(output.results, options));
    expect(document.Info.Title).toBe(options.projectName);
    expect(document.Info.Constant[0].Value).toBe(control);
    expect(document.Info.Constant[1].Value).toBe('REF');
    expect(document.InfoSequence.Ref[0]['@_ID']).toBe(document.Info['@_ID']);
    expect(document.Created.OriginalVersion['@_CreatedByProgram']).toBe('PCR Workbench');
  });

  it('writes missing numeric cells as blank and removes characters forbidden in XML 1.0', () => {
    const results = output.results.map((result) => ({ ...result, values: [NaN], foldChange: Infinity, fcSd: NaN }));
    const xml = buildPrismPzfx(results, { ...options, projectName: 'A\u0000\uD800B' });
    const document = parse(xml);
    expect(document.Info.Title).toBe('AB');
    expect(document.Table[0].YColumn[0].Subcolumn.d).toEqual(['']);
    expect(document.Table[1].YColumn[0].Subcolumn.d).toEqual(['', '']);
  });
});
