/** Bridge contract: legacy/sample statistics never become independent-unit inference. */
export function normalizePcrResult(output, design) {
  const hasDesignContract = ['unconfirmed', 'invalid', 'unsupported', 'confirmed'].includes(output.designStatus)
    && Array.isArray(output.groupResults) && Array.isArray(output.designIssues);
  let designStatus = hasDesignContract ? output.designStatus : 'unsupported';
  const designIssues = hasDesignContract ? [...output.designIssues] : [{
    code: 'ENGINE_DESIGN_UNSUPPORTED',
    message: 'Configured engine lacks the experimental-design contract; only descriptive results are exposed / 当前引擎未实现实验设计契约，仅提供描述结果',
  }];
  if (designStatus === 'confirmed' && (!design?.confirmed || design.kind !== 'independent')) {
    designStatus = 'invalid';
    designIssues.push({ code: 'UNREQUESTED_INFERENCE', message: 'Engine reported confirmation without a confirmed independent design / 引擎确认状态与请求设计不一致' });
  }
  const confirmed = designStatus === 'confirmed';
  const groupResults = confirmed ? output.groupResults : [];
  const results = (output.results ?? []).map((row) => ({
    ...row,
    nTech: row.nTech ?? row.n ?? null,
    nBio: confirmed ? row.nBio ?? null : null,
    pValue: null, pAdjusted: null, significance: '', statMethod: 'descriptive_only',
  }));
  const inferenceMode = confirmed && groupResults.some(row =>
    [row.pValue, row.pAdjusted, row.anovaPValue].some(value => typeof value === 'number' && Number.isFinite(value)))
    ? 'independent_units' : 'descriptive_only';
  return { results, groupResults, designStatus, designIssues, inferenceMode,
    replication: {
      aggregationUnit: confirmed ? 'experimental-unit-target' : hasDesignContract ? 'plate-sample-group-target' : 'legacy-engine-defined',
      statisticalUnit: confirmed ? 'experimental_unit' : 'descriptive_only',
      biologicalReplicateCount: null,
      byTargetGroup: groupResults.map(({ target, group, nBio, nTech }) => ({ target, group, nBio, nTech })),
      note: confirmed
        ? 'Group calculations use confirmed experimental units; technical well counts are reported separately / 组计算使用已确认实验单位，技术孔数单列'
        : 'Design is unconfirmed, invalid or unsupported; technical wells do not establish biological n and no inferential p-values are exposed / 设计未确认、无效或不支持；技术孔不确定生物学n，不输出推断p值',
    },
  };
}
