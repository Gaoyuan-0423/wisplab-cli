/** JSON-safe QC settings shared by CLI, MCP and the engine runner. */
export function normalizePcrOptions({ qc = {}, qcMode = 'report', excludeRows = [] } = {}) {
  if (!qc || typeof qc !== 'object' || Array.isArray(qc)) throw new Error('qc must be an object');
  const thresholds = { minCq: null, maxCq: null, absDev: null, zScore: null, repSD: null };
  for (const [name, value] of Object.entries(qc)) {
    if (!Object.hasOwn(thresholds, name)) throw new Error(`Unknown QC threshold: ${name}`);
    if (value !== null && (!Number.isFinite(value) || value < 0 || (['absDev', 'zScore', 'repSD'].includes(name) && value === 0)))
      throw new Error(`Invalid QC threshold: ${name}`);
    thresholds[name] = value;
  }
  if (thresholds.minCq !== null && thresholds.maxCq !== null && thresholds.minCq > thresholds.maxCq)
    throw new Error('minCq must be <= maxCq');
  if (!['report', 'exclude'].includes(qcMode)) throw new Error('qcMode: report | exclude');
  if (!Array.isArray(excludeRows) || excludeRows.some(id => !Number.isSafeInteger(id) || id < 1))
    throw new Error('excludeRows must contain positive integer row IDs');
  return { qc: thresholds, qcMode, excludeRows: [...new Set(excludeRows)].sort((a, b) => a - b) };
}
