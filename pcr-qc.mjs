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
  const flags = computeQcFlags(rows.map(row => ({ ...row, excluded: manual.has(row.id) })), settings);
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
    const key = JSON.stringify([row.sample, row.target]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const replicateGroups = [...groups.values()].map(group => {
    const retained = group.filter(row => !excluded.has(row.id));
    const before = group.length > 1 ? sd(group.map(row => row.cq)) : null;
    const after = retained.length > 1 ? sd(retained.map(row => row.cq)) : null;
    return { sample: group[0].sample, target: group[0].target, rowIds: group.map(row => row.id),
      retainedRowIds: retained.map(row => row.id), wellCount: group.length, retainedWellCount: retained.length,
      sdCqBefore: before, sdCqAfter: after, highSD: qc.repSD !== null && before !== null && before > qc.repSD };
  });
  return {
    rows: rows.map(row => ({ ...row, excluded: excluded.has(row.id) })),
    settings,
    report: { mode: qcMode, thresholds: qc, rows: audited,
      flaggedRowIds: audited.filter(row => row.flags.length).map(row => row.rowId), excludedRowIds: [...excluded],
      replicateGroups, groupSdPolicy: 'report-only',
      replication: { aggregationUnit: 'sample-target', statisticalUnit: 'well', biologicalReplicateCount: null,
        note: 'Sample identifiers and technical wells do not establish independent biological replication. Engine p-values use well-level values; do not interpret them as biological-replicate inference. / 样本名与复孔不能证明生物学独立重复；引擎p值使用逐孔数据。' } },
  };
}
