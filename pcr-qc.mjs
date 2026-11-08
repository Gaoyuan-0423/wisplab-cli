import { normalizePcrOptions } from './pcr-options.mjs';

/** Apply explicit QC policy using the owning engine's QC and SD implementations. */
export function preparePcrRows(rows, options, { computeQcFlags, sd, isNtcRow, isStandardRow }) {
  const { qc, qcMode, excludeRows } = normalizePcrOptions(options);
  const settings = Object.fromEntries(Object.entries(qc).filter(([key]) => key !== 'repSD').map(([key, value]) => [key, value ?? NaN]));
  const ids = new Set(rows.map(row => row.id));
  for (const id of excludeRows) {
    if (!ids.has(id)) throw new Error(`Unknown excluded row ID: ${id}`);
    if (isNtcRow(rows.find(row => row.id === id))) throw new Error(`NTC row ${id} must remain visible in the contamination report`);
  }
  const manual = new Set(excludeRows);
  // Partition here too: older engine QC implementations omit plate from their key.
  const plateRows = new Map();
  for (const row of rows) {
    const plate = row.plate ?? '';
    if (!plateRows.has(plate)) plateRows.set(plate, []);
    plateRows.get(plate).push({ ...row, excluded: manual.has(row.id) });
  }
  const flags = Object.assign({}, ...[...plateRows.values()].map(group => computeQcFlags(group, settings)));
  const audited = rows.map(row => {
    const reasons = flags[row.id] ?? [];
    const ntc = isNtcRow(row);
    const standard = isStandardRow(row);
    const exclusionReason = manual.has(row.id) ? 'manual-row-id'
      : qcMode === 'exclude' && reasons.length && !ntc && !standard ? 'qc-flag' : null;
    return { rowId: row.id, plate: row.plate, well: row.well, sample: row.sample, target: row.target,
      cq: Number.isFinite(row.cq) ? row.cq : null, role: ntc ? 'ntc' : standard ? 'standard' : 'sample',
      flags: reasons, excluded: exclusionReason !== null, exclusionReason,
      usableForExpression: !ntc && !standard && !exclusionReason && Boolean(row.sample && row.target) && Number.isFinite(row.cq) };
  });
  const excluded = new Set(audited.filter(row => row.excluded).map(row => row.rowId));
  const groups = new Map();
  for (const row of rows) {
    if (isNtcRow(row) || isStandardRow(row) || !row.sample || !row.target || !Number.isFinite(row.cq)) continue;
    const key = JSON.stringify([row.plate ?? '', row.sample, row.target]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const replicateGroups = [...groups.values()].map(group => {
    const retained = group.filter(row => !excluded.has(row.id));
    const before = group.length > 1 ? sd(group.map(row => row.cq)) : null;
    const after = retained.length > 1 ? sd(retained.map(row => row.cq)) : null;
    return { plate: group[0].plate ?? '', sample: group[0].sample, target: group[0].target, rowIds: group.map(row => row.id),
      retainedRowIds: retained.map(row => row.id), wellCount: group.length, retainedWellCount: retained.length,
      sdCqBefore: before, sdCqAfter: after, highSD: qc.repSD !== null && before !== null && before > qc.repSD };
  });
  return {
    rows: rows.map(row => ({ ...row, excluded: excluded.has(row.id) })),
    settings,
    report: { mode: qcMode, thresholds: qc, rows: audited,
      flaggedRowIds: audited.filter(row => row.flags.length).map(row => row.rowId), excludedRowIds: [...excluded],
      replicateGroups, groupSdPolicy: 'report-only',
      replication: { aggregationUnit: 'plate-sample-target', statisticalUnit: 'descriptive_only', biologicalReplicateCount: null,
        note: 'QC describes technical wells only; independent-unit inference requires a separately confirmed and supported design / QC仅描述技术孔；独立单位推断需另行确认且引擎支持实验设计' } },
  };
}
