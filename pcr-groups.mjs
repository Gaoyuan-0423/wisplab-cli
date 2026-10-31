import { expressionInterval95, studentTTwoSidedP } from './pcr-inference.mjs';

/** Explicit biological units and optional pairing; never inferred from well names or columns. */
export function normalizeBiologicalDesign(design) {
  if (design == null) return null;
  if (typeof design !== 'object' || Array.isArray(design) || Object.keys(design).some(k => !['samples','controlGroup','paired','pairIds'].includes(k)))
    throw new Error('biologicalDesign: expected samples, controlGroup and optional paired/pairIds');
  const { samples, controlGroup, paired=false, pairIds } = design;
  if (!samples || typeof samples !== 'object' || Array.isArray(samples) || !Object.keys(samples).length)
    throw new Error('biologicalDesign.samples: expected sample-to-group mapping');
  for (const [sample, group] of Object.entries(samples)) {
    if (!sample.trim() || sample !== sample.trim() || typeof group !== 'string' || !group.trim() || group !== group.trim())
      throw new Error('Biological sample/group names must be nonempty without surrounding whitespace');
  }
  if (typeof controlGroup !== 'string' || !Object.values(samples).includes(controlGroup)) throw new Error('Unknown biological controlGroup');
  if (new Set(Object.values(samples)).size < 2) throw new Error('Biological design needs a control and a treatment group');
  if(typeof paired!=='boolean')throw new Error('biologicalDesign.paired must be boolean');
  if(!paired&&pairIds!==undefined)throw new Error('biologicalDesign.pairIds requires paired: true');
  if(paired) {
    if(!pairIds||typeof pairIds!=='object'||Array.isArray(pairIds))throw new Error('paired design requires an explicit sample-to-pairId mapping');
    const missing=Object.keys(samples).filter(s=>!Object.hasOwn(pairIds,s));
    const unknown=Object.keys(pairIds).filter(s=>!Object.hasOwn(samples,s));
    if(missing.length||unknown.length)throw new Error(`pairIds must exactly cover biological samples; missing: ${missing.join(', ') || 'none'}; unknown: ${unknown.join(', ') || 'none'}`);
    const pairGroups=new Map();
    for(const [sample,pairId] of Object.entries(pairIds)) {
      if(typeof pairId!=='string'||!pairId.trim()||pairId!==pairId.trim())throw new Error('pairIds values must be nonempty strings without surrounding whitespace');
      if(!pairGroups.has(pairId))pairGroups.set(pairId,new Set());
      const groups=pairGroups.get(pairId),group=samples[sample];
      if(groups.has(group))throw new Error(`Duplicate biological samples for pairId ${pairId}, group ${group}`);
      groups.add(group);
    }
    const groups=[...new Set(Object.values(samples))];
    for(const [pairId,present] of pairGroups) {
      const absent=groups.filter(g=>!present.has(g));
      if(absent.length)throw new Error(`Incomplete pairId ${pairId}; missing groups: ${absent.join(', ')}`);
    }
  }
  return { samples: { ...samples }, controlGroup, ...(paired?{paired:true,pairIds:{...pairIds}}:{}) };
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
  const unmapped = [...present].filter(s => !Object.hasOwn(design.samples, s));
  const unknown = Object.keys(design.samples).filter(s => !present.has(s));
  if (unmapped.length || unknown.length) throw new Error([
    unmapped.length ? `Unmapped biological samples: ${unmapped.join(', ')}` : null,
    unknown.length ? `Unknown biological samples: ${unknown.join(', ')}` : null,
  ].filter(Boolean).join('; '));
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
      // Normalize each selected reference with its own efficiency before geometric pooling.
      const referenceLog2Scale=reason?null:mean(refValues.map((values,i)=>mean(values)*Math.log2(1+eff(refs[i])/100)));
      const meanCq=reason?null:mean(targetValues);
      const unit={sample,group,target,...(design.paired?{pairId:design.pairIds[sample]}:{}),technicalWellCount:targetValues.length,missingRefs,reason,
        deltaCt:reason?null:meanCq-refCq,
        log2Expression:reason?null:-meanCq*Math.log2(1+eff(target)/100)+referenceLog2Scale};
      targetUnits.push(unit);units.push(unit);
    }
    const controlUnits=targetUnits.filter(u=>u.group===design.controlGroup);
    const controls=controlUnits.filter(u=>u.reason===null).map(u=>u.log2Expression);
    const controlMean=controls.length?mean(controls):null;
    for(const group of groups) {
      const all=targetUnits.filter(u=>u.group===group);
      let usable=all.filter(u=>u.reason===null), comparisonControls=controls, pairing=null;
      if(design.paired&&group!==design.controlGroup) {
        const matches=all.map(unit=>({unit,control:controlUnits.find(c=>c.pairId===unit.pairId)}));
        const complete=matches.filter(({unit,control})=>!unit.reason&&!control.reason);
        usable=complete.map(p=>p.unit);
        comparisonControls=complete.map(p=>p.control.log2Expression);
        pairing={declaredPairIds:matches.map(p=>p.unit.pairId),usedPairIds:complete.map(p=>p.unit.pairId),
          omittedPairs:matches.filter(({unit,control})=>unit.reason||control.reason).map(({unit,control})=>({
            pairId:unit.pairId,sample:unit.sample,controlSample:control.sample,sampleReason:unit.reason,controlReason:control.reason}))};
      }
      const vals=usable.map(u=>u.log2Expression);
      const log2FoldChange=vals.length&&controlMean!==null?mean(vals)-controlMean:null;
      const estimate=pairing?(vals.length?mean(vals.map((v,i)=>v-comparisonControls[i])):null):log2FoldChange;
      const summary={target,group,nBiological:vals.length,nDeclared:all.length,samples:usable.map(u=>u.sample),
        missingSamples:all.filter(u=>!usable.includes(u)).map(u=>u.sample),meanDeltaCt:usable.length?mean(usable.map(u=>u.deltaCt)):null,
        sdLog2Expression:vals.length>1?sd(vals):null,log2FoldChange:estimate,foldChange:estimate===null?null:2**estimate,
        confidenceLevel:0.95,log2FoldChangeCI95:null,foldChangeCI95:null,...(pairing?{nPairs:vals.length,pairing}:{})};
      summaries.push(summary);
      if(group===design.controlGroup)continue;
      const differences=pairing?vals.map((v,i)=>v-comparisonControls[i]):null;
      let reason=vals.length<2||comparisonControls.length<2?(pairing?'insufficient-complete-pairs':'insufficient-biological-replicates'):
        (pairing?sd(differences)===0:sd(vals)===0&&sd(comparisonControls)===0)?'zero-variance':null;
      const se=reason?null:pairing?sd(differences)/Math.sqrt(differences.length):Math.sqrt(sd(vals)**2/vals.length+sd(comparisonControls)**2/comparisonControls.length);
      const stat=reason?null:pairing?{t:estimate/se,df:vals.length-1,p:studentTTwoSidedP(estimate/se,vals.length-1)}:welchTTest(vals,comparisonControls);
      if(stat&&![stat.t,stat.df,stat.p].every(Number.isFinite))reason='nonfinite-statistic';
      const interval=reason?{log2FoldChangeCI95:null,foldChangeCI95:null}:expressionInterval95(estimate,se,stat.df);
      Object.assign(summary,interval);
      comparisons.push({target,group,controlGroup:design.controlGroup,nBiological:vals.length,nControl:comparisonControls.length,
        log2FoldChange:estimate,foldChange:summary.foldChange,confidenceLevel:0.95,...interval,
        pValue:reason?null:stat.p,pAdjusted:null,t:reason?null:stat.t,df:reason?null:stat.df,standardError:reason?null:se,reason,
        inferenceMethod:pairing?'paired-t':'welch-t',...(pairing?{nPairs:vals.length,pairing}:{})});
    }
  }
  const adjusted=holmAdjust(comparisons.map(c=>c.pValue));comparisons.forEach((c,i)=>c.pAdjusted=adjusted[i]);
  return { statisticalUnit:'biological-sample',design,referenceGenes:refs,units,summaries,comparisons,
    method:`Two-sided ${design.paired?'paired t-test on complete within-pair differences':'Welch on per-sample log2 normalized expression'}; Holm across all planned target/group comparisons in this file; unadjusted 95% confidence intervals`,
    multiplicityFamilySize:comparisons.length,
    note:'Biological units and pairing are explicitly declared, never inferred from wells. Technical wells do not increase biological n. 95% intervals are per comparison, not multiplicity-adjusted; control self-ratios have no interval. / 生物学单位和配对须显式声明；技术孔不增加生物学n；95%区间为单次比较、未作多重校正；对照自身比值不提供区间。' };
}
