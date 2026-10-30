/** Compare whole-image IHC output against explicitly sourced, hash-bound references. */
const metricLimits={totalNuclei:Infinity,positiveNuclei:Infinity,hScore:300,positiveFraction:1};
const hashPattern=/^[a-f0-9]{64}$/;
export function compareIhcReference(result, reference) {
  if(result?.provenance?.analysis!=='ihc'||!Array.isArray(result.files)||!result.files.length)
    throw new Error('Expected an IHC result with input provenance');
  if(reference?.schemaVersion!=='wisplab.ihc-reference/v1'||!Array.isArray(reference.images)||!reference.images.length)
    throw new Error('Expected wisplab.ihc-reference/v1 with nonempty images');
  const seen=new Set(),records=[];
  for(const ref of reference.images) {
    if(!ref||typeof ref.file!=='string'||!ref.file||seen.has(ref.file))throw new Error('Reference filenames must be nonempty and unique');
    seen.add(ref.file);
    if(!hashPattern.test(ref.sha256)||ref.scope!=='whole-image')throw new Error('Each reference needs SHA-256 and whole-image scope');
    if(!['manual','independent-computation','synthetic'].includes(ref.sourceKind)||typeof ref.method!=='string'||!ref.method.trim())
      throw new Error('Reference sourceKind and method are required');
    if(ref.sourceKind==='manual'&&(typeof ref.reviewer!=='string'||!ref.reviewer.trim()||!/^\d{4}-\d{2}-\d{2}$/.test(ref.reviewedOn??'')))
      throw new Error('Manual reference requires reviewer and reviewedOn (YYYY-MM-DD)');
    if(!['h_dab','h_eosin','masson'].includes(ref.profile))throw new Error('Reference profile is required');
    if(!ref.metrics||typeof ref.metrics!=='object'||Array.isArray(ref.metrics)||!Object.keys(ref.metrics).length)throw new Error('Reference metrics are required');
    for(const [name,value] of Object.entries(ref.metrics)) {
      if(!Object.hasOwn(metricLimits,name)||!Number.isFinite(value)||value<0||value>metricLimits[name]||
        (name.endsWith('Nuclei')&&!Number.isSafeInteger(value)))throw new Error(`Invalid reference metric: ${name}`);
    }
    if(ref.metrics.positiveNuclei>ref.metrics.totalNuclei)throw new Error('Positive nuclei cannot exceed total nuclei');
    if(ref.tolerances!==undefined&&(!ref.tolerances||typeof ref.tolerances!=='object'||Array.isArray(ref.tolerances)))throw new Error('Invalid tolerances');
    for(const [name,value] of Object.entries(ref.tolerances??{})) {
      if(!Object.hasOwn(ref.metrics,name)||!Number.isFinite(value)||value<0)throw new Error(`Invalid tolerance: ${name}`);
    }
    const files=result.files.filter(f=>f.file===ref.file);
    const inputs=(result.provenance.inputs??[]).filter(i=>i.file===ref.file&&i.role==='input');
    let reason=files.length!==1||inputs.length!==1?'missing-or-ambiguous-image':null;
    const actual=files[0],input=inputs[0];
    if(!reason&&(input.before?.sha256!==ref.sha256||input.after?.sha256!==ref.sha256||!input.unchanged))reason='image-hash-mismatch';
    if(!reason&&actual.error)reason='analysis-error';
    if(!reason&&actual.settings?.profile!==ref.profile)reason='profile-mismatch';
    const metrics={};
    if(!reason)for(const [name,expected] of Object.entries(ref.metrics)) {
      const observed=actual.overall?.[name],tolerance=ref.tolerances?.[name]??null;
      if(!Number.isFinite(observed)||observed<0||observed>metricLimits[name]){reason='unavailable-metric';break;}
      const error=observed-expected;
      metrics[name]={observed,reference:expected,error,absoluteError:Math.abs(error),
        relativeError:expected===0?null:error/expected,tolerance,withinTolerance:tolerance===null?null:Math.abs(error)<=tolerance};
    }
    records.push({file:ref.file,sha256:ref.sha256,sourceKind:ref.sourceKind,method:ref.method,reviewer:ref.reviewer??null,
      reviewedOn:ref.reviewedOn??null,profile:ref.profile,reason,metrics});
  }
  const unreferencedFiles=result.files.filter(f=>!seen.has(f.file)).map(f=>f.file);
  const summaries={};
  for(const name of Object.keys(metricLimits)) {
    const values=records.filter(r=>!r.reason&&r.metrics[name]).map(r=>r.metrics[name]);
    if(values.length)summaries[name]={n:values.length,meanAbsoluteError:values.reduce((s,v)=>s+v.absoluteError,0)/values.length,
      meanSignedError:values.reduce((s,v)=>s+v.error,0)/values.length,maxAbsoluteError:Math.max(...values.map(v=>v.absoluteError))};
  }
  const metrics=records.flatMap(r=>Object.values(r.metrics));
  const verifiedRun=['inputsUnchanged','engineUnchanged','bridgeUnchanged'].every(key=>result.provenance.checks?.[key]===true);
  const incomplete=!verifiedRun||unreferencedFiles.length>0||records.some(r=>r.reason)||result.provenance.status!=='success';
  const status=incomplete?'incomplete':metrics.some(m=>m.withinTolerance===false)?'outside-tolerance':metrics.every(m=>m.withinTolerance===true)?'within-tolerance':'ungraded';
  return {schemaVersion:'wisplab.ihc-comparison/v1',status,analysisRunId:result.provenance.runId??null,records,unreferencedFiles,summaries,
    note:'Whole-image measurement comparison only; counts do not measure instance-matching precision/recall. Tolerances are user supplied, not clinical acceptance criteria. / 仅整图指标对照；核总数不能证明分割匹配准确率。容差由用户指定。'};
}
