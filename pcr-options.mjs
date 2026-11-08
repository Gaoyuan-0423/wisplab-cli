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

/** Validate structure only; the engine owns assignment coverage and design semantics. */
export function normalizeExperimentalDesign(value) {
  if (value === undefined || value === null) return undefined;
  const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  if (!object(value) || Object.keys(value).some(key => !['kind', 'confirmed', 'controlGroup', 'assignments'].includes(key))
    || !['independent', 'paired', 'repeated'].includes(value.kind) || typeof value.confirmed !== 'boolean'
    || typeof value.controlGroup !== 'string' || !Array.isArray(value.assignments)) {
    throw new Error('experimentalDesign requires kind, confirmed, controlGroup and assignments');
  }
  const assignments = value.assignments.map((assignment) => {
    if (!object(assignment) || Object.keys(assignment).some(key => !['plate', 'sample', 'unitId', 'group'].includes(key))
      || typeof assignment.plate !== 'string' || ['sample', 'unitId', 'group'].some(key => typeof assignment[key] !== 'string' || !assignment[key].trim())) {
      throw new Error('experimentalDesign.assignments require plate, sample, unitId and group');
    }
    return { plate: assignment.plate, sample: assignment.sample, unitId: assignment.unitId, group: assignment.group };
  });
  return { kind: value.kind, confirmed: value.confirmed, controlGroup: value.controlGroup, assignments };
}
