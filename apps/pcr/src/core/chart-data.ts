import type { AnalysisOutput } from './types';

/** Plot observations have an explicit measurement level; no invented sample result fields. */
export interface ChartInput {
  sample: string;
  displayLabel?: string;
  group: string;
  target: string;
  isControl: boolean;
  fcValues: number[];
  pValue: number | null;
  pAdjusted: number | null;
}

export function chartDataFromOutput(out: AnalysisOutput): ChartInput[] {
  if (out.designStatus === 'confirmed') return out.groupResults.filter((r) => r.fcValues.some(Number.isFinite)).map((r) => ({
    sample: JSON.stringify(['group', r.group]), displayLabel: r.group, group: r.group,
    target: r.target, isControl: r.isControl, fcValues: r.fcValues.filter(Number.isFinite),
    pValue: r.pValue, pAdjusted: r.pAdjusted,
  }));
  return out.results.filter((r) => r.fcValues.some(Number.isFinite)).map((r) => ({
    sample: JSON.stringify(['source', r.plate ?? '', r.sample, r.group]),
    displayLabel: (r.plate ? `${r.plate} / ${r.sample}` : r.sample)
      + (out.results.some((other) => other.plate === r.plate && other.sample === r.sample && other.group !== r.group) ? ` [${r.group}]` : ''), group: r.group,
    target: r.target, isControl: r.isControl, fcValues: r.fcValues.filter(Number.isFinite),
    pValue: null, pAdjusted: null,
  }));
}
