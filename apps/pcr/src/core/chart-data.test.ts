import { describe, expect, it } from 'vitest';
import { analyzeDeltaDeltaCt, type AnalysisRow } from './analysis';
import { DEFAULT_QC } from './types';
import { chartDataFromOutput } from './chart-data';
import { buildBarsForGene } from './chart-bars';
import { DEFAULT_CHART_OPTIONS } from './chart-options';

function makeOutput(confirmed: boolean) {
  const rows: AnalysisRow[] = [];
  const assignments = ['P1', 'P2'].flatMap((plate, index) => ['A', 'B', 'C'].map((sample, i) => {
    const group = index ? 'Treatment' : 'Control';
    for (let rep = 0; rep < 3; rep++) for (const target of ['REF', 'TARGET']) {
      rows.push({ id: rows.length, plate, sample, group, target, cq: target === 'REF' ? 20 : 24 + i - index + rep / 10,
        well: String(rows.length), excluded: false, task: '', pairId: '', quantity: NaN });
    }
    return { plate, sample, group, unitId: `${plate}-${sample}` };
  }));
  return analyzeDeltaDeltaCt(rows, { qc: DEFAULT_QC, refGenes: ['REF'], controlSamples: ['A'],
    experimentalDesign: { kind: 'independent', confirmed, controlGroup: 'Control', assignments } });
}
describe('chart measurement level', () => {
  it('uses one FC per independent unit for each confirmed group bar', () => {
    const out = makeOutput(true);
    const plotted = chartDataFromOutput(out);
    expect(plotted).toHaveLength(2);
    expect(plotted.map((r) => r.fcValues.length)).toEqual([3, 3]);
    const bars = buildBarsForGene(plotted, DEFAULT_CHART_OPTIONS, () => '#000');
    expect(bars.map((r) => r.value)).toEqual(out.groupResults.map((r) => r.fcMean));
  });
  it('keeps cross-plate names and conflicting raw groups separate without inferred p-values', () => {
    const out = makeOutput(false);
    out.results.push({ ...out.results[0], group: 'conflicting', pValue: 0.001, pAdjusted: 0.002 });
    const plotted = chartDataFromOutput(out);
    expect(new Set(plotted.map((r) => r.sample)).size).toBe(7);
    expect(plotted.every((r) => r.pValue === null && r.pAdjusted === null)).toBe(true);
  });
  it('does not draw missing measurements as zero in either mode', () => {
    for (const confirmed of [false, true]) {
      const out = makeOutput(confirmed);
      for (const r of out.results) r.fcValues = [];
      for (const r of out.groupResults) r.fcValues = [NaN];
      expect(chartDataFromOutput(out)).toEqual([]);
    }
  });
});
