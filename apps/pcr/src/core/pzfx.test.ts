import { describe, expect, it } from 'vitest';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { analyzeDeltaDeltaCt, extractRows } from './analysis';
import { DEFAULT_QC, emptyMapping, type GroupTargetResult } from './types';
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
    const [cq, summary, technicalSd] = document.Table;
    expect(cq.Title).toBe(`${target} — 技术孔 Cq；不用于组间推断`);
    expect(cq.RowTitlesColumn.Subcolumn.d).toEqual(['技术孔 1', '技术孔 2']);
    expect(cq.YColumn[0].Title).toContain(`${control} (对照)`);
    expect(cq.YColumn[1].Title).toContain(treatment);
    expect(cq.YColumn.map((column: { Subcolumn: { d: string[] } }) => column.Subcolumn.d))
      .toEqual([['25', '25'], ['23', '23']]);
    expect(summary.RowTitlesColumn.Subcolumn.d).toEqual(['描述值']);
    expect(summary.YColumn.map((column: { Subcolumn: { d: string[] } }) => column.Subcolumn.d))
      .toEqual([['1'], ['4']]);
    expect(technicalSd.RowTitlesColumn.Subcolumn.d).toEqual(['技术孔 FC SD']);
    expect(technicalSd.YColumn.map((column: { Subcolumn: { d: string[] } }) => column.Subcolumn.d)).toEqual([['0'], ['0']]);
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
    expect(document.Table[1].YColumn[0].Subcolumn.d).toEqual(['']);
    expect(document.Table[2].YColumn[0].Subcolumn.d).toEqual(['']);
  });

  const makeGroup = (group: string, unitIds: string[], values: number[]): GroupTargetResult => ({
    group, target, isControl: group === 'Control', unitIds, nBio: unitIds.length, nTech: 12, sampleIds: [],
    deltaCtValues: values, deltaCtMean: 2, deltaCtSd: 0.1, ddCt: -1, foldChange: 2,
    fcValues: values.map((v) => 2 ** (5 - v)), fcMean: 2, fcSd: 0.1,
    pValue: 0.02, pAdjusted: null, anovaPValue: null, significance: '*', statMethod: 'Welch t',
  });
  const groups = [makeGroup('Control', ['C-U1', 'C-U2'], [4.8, 5.2]), makeGroup('Treat', ['T-U1', 'T-U2'], [2.8, 3.2])];

  it('exports each independent unit exactly once with its identity, never technical wells as group replicates', () => {
    const xml = buildPrismPzfx(output.results, { ...options, groupResults: groups, designStatus: 'confirmed' });
    expect(XMLValidator.validate(xml)).toBe(true);
    const document = parse(xml);
    const delta = document.Table.find((table: { Title: string }) => table.Title.endsWith('独立单位 ΔCt'));
    const fc = document.Table.find((table: { Title: string }) => table.Title.endsWith('独立单位 FC'));
    expect(delta.RowTitlesColumn.Subcolumn.d).toEqual(['C-U1', 'C-U2', 'T-U1', 'T-U2']);
    expect(delta.YColumn.map((column: { Subcolumn: { d: string[] } }) => column.Subcolumn.d))
      .toEqual([['4.8', '5.2', '', ''], ['', '', '2.8', '3.2']]);
    expect(fc.YColumn[1].Subcolumn.d[2]).toBe(String(groups[1].fcValues[0]));
  });

  it('does not infer a confirmed design from supplied group arrays', () => {
    for (const designStatus of [undefined, 'unconfirmed', 'invalid', 'unsupported'] as const) {
      const document = parse(buildPrismPzfx(output.results, { ...options, groupResults: groups, designStatus }));
      expect(document.Table).toHaveLength(3);
    }
  });

  it('omits malformed group tables with an explanation instead of guessing unit identities', () => {
    const mismatch = { ...groups[0], unitIds: ['one'] };
    const duplicate = { ...groups[1], unitIds: ['C-U1', 'T-U2'] };
    for (const groupResults of [[mismatch], [groups[0], duplicate]]) {
      const document = parse(buildPrismPzfx(output.results, { ...options, groupResults, designStatus: 'confirmed' }));
      expect(document.Table).toHaveLength(3);
      expect(document.Info.Constant.some((entry: { Value: string }) => entry.Value.includes('已跳过'))).toBe(true);
    }
  });

  it('retains DeltaCt when no valid control exists and leaves unaligned FCs blank without guessing order', () => {
    for (const fcValues of [[], [7]]) {
      const missingControl = { ...groups[0], nBio: 0, nTech: 0, unitIds: [], deltaCtValues: [], fcValues: [] };
      const missingFc = { ...groups[1], fcValues };
      const document = parse(buildPrismPzfx(output.results, { ...options, groupResults: [missingControl, missingFc], designStatus: 'confirmed' }));
      const delta = document.Table.find((table: { Title: string }) => table.Title.endsWith('独立单位 ΔCt'));
      const fc = document.Table.find((table: { Title: string }) => table.Title.endsWith('独立单位 FC'));
      expect(delta.RowTitlesColumn.Subcolumn.d).toEqual(['T-U1', 'T-U2']);
      expect(delta.YColumn[1].Subcolumn.d).toEqual(['2.8', '3.2']);
      expect(fc.YColumn[1].Subcolumn.d).toEqual(['', '']);
      expect(document.Info.Constant.some((entry: { Value: string }) => entry.Value.includes('FC 缺失或无法按单位对齐'))).toBe(true);
    }
  });
});
