/** Explicit independent biological units; no inference from well names or Group columns. */
export function normalizeBiologicalDesign(design) {
  if (design == null) return null;
  if (typeof design !== 'object' || Array.isArray(design) || Object.keys(design).some(k => !['samples','controlGroup'].includes(k)))
    throw new Error('biologicalDesign: expected samples and controlGroup');
  const { samples, controlGroup } = design;
  if (!samples || typeof samples !== 'object' || Array.isArray(samples) || !Object.keys(samples).length)
    throw new Error('biologicalDesign.samples: expected sample-to-group mapping');
  for (const [sample, group] of Object.entries(samples)) {
    if (!sample.trim() || sample !== sample.trim() || typeof group !== 'string' || !group.trim() || group !== group.trim())
      throw new Error('Biological sample/group names must be nonempty without surrounding whitespace');
  }
  if (typeof controlGroup !== 'string' || !Object.values(samples).includes(controlGroup)) throw new Error('Unknown biological controlGroup');
  if (new Set(Object.values(samples)).size < 2) throw new Error('Biological design needs a control and a treatment group');
  return { samples: { ...samples }, controlGroup };
}

export function holmAdjust(values) {
  // Include planned but untestable comparisons in the family as p=1; preserve their null outputs.
  const ranked = values.map((p,i) => ({p:p ?? 1,i})).sort((a,b)=>a.p-b.p);
  const out = values.map(()=>null); let previous = 0;
  ranked.forEach(({p,i},rank)=>{ previous=Math.max(previous,Math.min(1,p*(values.length-rank))); if(values[i]!==null)out[i]=previous; });
  return out;
}

export function analyzeBiologicalGroups(rows, options, { mean, sd, welchTTest, isNtcRow, isStandardRow }) {
  const design=normalizeBiologicalDesign(options.biologicalDesign);
  if (!design) return null;
  const refs=[...new Set(options.refGenes)];
  if (!refs.length) throw new Error('Select a reference gene / 请选择一个内参基因');
  const sampleRows=rows.filter(r=>!isNtcRow(r)&&!isStandardRow(r)&&r.sample&&r.target);
  const present=new Set(sampleRows.map(r=>r.sample));
  for(const s of present)if(!Object.hasOwn(design.samples,s))throw new Error(`Unmapped biological sample: ${s}`);
  for(const s of Object.keys(design.samples))if(!present.has(s))throw new Error(`Unknown biological sample: ${s}`);
  const targets=[...new Set(sampleRows.map(r=>r.target))].filter(g=>!refs.includes(g)).sort();
  const eff = gene => options.efficiencies?.[gene] ?? 100;
  const groups=[...new Set(Object.values(design.samples))];
  const units=[], summaries=[], comparisons=[];
  for(const target of targets) {
    const targetUnits=[];
    for(const [sample,group] of Object.entries(design.samples)) {
      const values = gene => sampleRows.filter(r=>r.sample===sample&&r.target===gene&&!r.excluded&&Number.isFinite(r.cq)).map(r=>r.cq);
      const targetValues=values(target), refValues=refs.map(values);
      const missingRefs=refs.filter((_,i)=>!refValues[i].length);
      const reason=!targetValues.length?'missing-target':missingRefs.length?'missing-reference':null;
      const refCq=reason?null:mean(refValues.map(mean));
      const meanCq=reason?null:mean(targetValues);
      const unit={sample,group,target,technicalWellCount:targetValues.length,missingRefs,reason,
        deltaCt:reason?null:meanCq-refCq,
        log2Expression:reason?null:-meanCq*Math.log2(1+eff(target)/100)+refCq*Math.log2(1+mean(refs.map(eff))/100)};
      targetUnits.push(unit);units.push(unit);
    }
    const controls=targetUnits.filter(u=>u.group===design.controlGroup&&u.reason===null).map(u=>u.log2Expression);
    const controlMean=controls.length?mean(controls):null;
    for(const group of groups) {
      const all=targetUnits.filter(u=>u.group===group), usable=all.filter(u=>u.reason===null);
      const vals=usable.map(u=>u.log2Expression);
      const log2FoldChange=vals.length&&controlMean!==null?mean(vals)-controlMean:null;
      summaries.push({target,group,nBiological:vals.length,nDeclared:all.length,samples:usable.map(u=>u.sample),
        missingSamples:all.filter(u=>u.reason).map(u=>u.sample),meanDeltaCt:usable.length?mean(usable.map(u=>u.deltaCt)):null,
        sdLog2Expression:vals.length>1?sd(vals):null,log2FoldChange,foldChange:log2FoldChange===null?null:2**log2FoldChange});
      if(group===design.controlGroup)continue;
      let reason=vals.length<2||controls.length<2?'insufficient-biological-replicates':sd(vals)===0&&sd(controls)===0?'zero-variance':null;
      const stat=reason?null:welchTTest(vals,controls);
      if(stat&&![stat.t,stat.df,stat.p].every(Number.isFinite))reason='nonfinite-statistic';
      comparisons.push({target,group,controlGroup:design.controlGroup,nBiological:vals.length,nControl:controls.length,
        log2FoldChange,pValue:reason?null:stat.p,pAdjusted:null,t:reason?null:stat.t,df:reason?null:stat.df,reason});
    }
  }
  const adjusted=holmAdjust(comparisons.map(c=>c.pValue));comparisons.forEach((c,i)=>c.pAdjusted=adjusted[i]);
  return { statisticalUnit:'biological-sample',design,referenceGenes:refs,units,summaries,comparisons,
    method:'Two-sided Welch on per-sample log2 normalized expression; Holm across all planned target/group comparisons in this file',
    multiplicityFamilySize:comparisons.length,
    note:'Independence is declared by the sample mapping, not inferred. Technical wells do not increase biological n. Unpaired design only. / 独立性由样本映射声明；技术孔不增加生物学n；仅支持非配对设计。' };
}
