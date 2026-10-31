/** Independent point-reference review. Coordinates are pixel-centre indices. */
const compareIds = (a,b) => a < b ? -1 : a > b ? 1 : 0;
const HASH = /^[a-f0-9]{64}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const validDate = value => DATE.test(value ?? '') && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value;
const dimensions = image => Number.isSafeInteger(image.sourceWidth) && image.sourceWidth > 0 && Number.isSafeInteger(image.sourceHeight) && image.sourceHeight > 0;

export function makeAnnotationTemplate(result) {
  if (result?.provenance?.analysis !== 'ihc' || !Array.isArray(result.files) || !result.files.length) throw new Error('Expected an IHC result');
  const seen = new Set();
  const images = result.files.map(file => {
    if (!nonempty(file.file) || seen.has(file.file) || file.error || !dimensions(file) || !['h_dab','h_eosin','masson'].includes(file.settings?.profile)) throw new Error('Use successful uniquely named IHC images with source dimensions');
    seen.add(file.file);
    const inputs = result.provenance.inputs?.filter(i => i.file === file.file && i.role === 'input') ?? [];
    if (inputs.length !== 1 || !inputs[0].unchanged || !HASH.test(inputs[0].before?.sha256 ?? '') || inputs[0].before.sha256 !== inputs[0].after?.sha256)
      throw new Error(`Missing stable input hash: ${file.file}`);
    return { file: file.file, sha256: inputs[0].before.sha256, profile: file.settings?.profile,
      coordinateSpace: 'source', sourceWidth: file.sourceWidth, sourceHeight: file.sourceHeight,
      reviewStatus: 'pending', sourceKind: 'manual', reviewer: '', reviewedOn: '', method: '', points: [] };
  });
  return { schemaVersion: 'wisplab.ihc-nuclei-reference/v1', images };
}

function validatePoints(points, width, height, label) {
  if (!Array.isArray(points) || points.length > 20000) throw new Error(`${label}: expected at most 20000 nuclei`);
  const ids = new Set();
  for (const point of points) {
    if (!nonempty(point.id) || ids.has(point.id) || !Number.isFinite(point.x) || !Number.isFinite(point.y) ||
      point.x < 0 || point.y < 0 || point.x >= width || point.y >= height || typeof point.positive !== 'boolean')
      throw new Error(`${label}: invalid/duplicate nucleus or out-of-bounds coordinate`);
    ids.add(point.id);
  }
}

/** Maximum cardinality matching within radius; distance/ID ordering makes it deterministic.
 * Class labels never influence matching. This is not a minimum-total-distance assignment. */
export function matchNuclei(reference, predicted, radius) {
  if (!Number.isFinite(radius) || radius <= 0) throw new Error('Match radius must be positive source pixels');
  const refs = [...reference].sort((a,b) => compareIds(a.id,b.id));
  const preds = [...predicted].sort((a,b) => compareIds(a.id,b.id));
  const grid = new Map();
  const key = (x,y) => `${x},${y}`;
  for (let j=0;j<preds.length;j++) {
    const p=preds[j], k=key(Math.floor(p.x/radius),Math.floor(p.y/radius));
    if (!grid.has(k)) grid.set(k,[]); grid.get(k).push(j);
  }
  let edgeCount=0;
  const edges = refs.map(r => {
    const found=[], gx=Math.floor(r.x/radius), gy=Math.floor(r.y/radius);
    for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)for(const j of grid.get(key(gx+dx,gy+dy))??[]) {
      const distance=Math.hypot(r.x-preds[j].x,r.y-preds[j].y);
      if(distance<=radius)found.push({j,distance});
    }
    edgeCount+=found.length;
    if(edgeCount>2000000)throw new Error('Too many candidate matches; use smaller reviewed image tiles or a narrower matching radius');
    return found.sort((a,b)=>a.distance-b.distance||compareIds(preds[a.j].id,preds[b.j].id));
  });
  const refToPred=new Map(), predToRef=new Map();
  for(let start=0;start<refs.length;start++) {
    const queue=[start], visitedRefs=new Set([start]), via=new Map();let free=null;
    for(let q=0;q<queue.length&&free===null;q++)for(const {j} of edges[queue[q]]) {
      if(via.has(j))continue;via.set(j,queue[q]);
      if(!predToRef.has(j)){free=j;break;}
      const next=predToRef.get(j);if(!visitedRefs.has(next)){visitedRefs.add(next);queue.push(next);}
    }
    while(free!==null) {
      const i=via.get(free), previous=refToPred.get(i);
      refToPred.set(i,free);predToRef.set(free,i);free=previous===undefined?null:previous;
    }
  }
  const matches=[...refToPred].map(([i,j])=>({referenceId:refs[i].id,predictedId:preds[j].id,
    distance:Math.hypot(refs[i].x-preds[j].x,refs[i].y-preds[j].y),referencePositive:refs[i].positive,predictedPositive:preds[j].positive}));
  return {matches,missedReferenceIds:refs.filter((_,i)=>!refToPred.has(i)).map(p=>p.id),
    unmatchedPredictionIds:preds.filter((_,i)=>!predToRef.has(i)).map(p=>p.id)};
}
function scores(tp,fp,fn) {
  return {truePositives:tp,falsePositives:fp,falseNegatives:fn,precision:tp+fp?tp/(tp+fp):null,
    recall:tp+fn?tp/(tp+fn):null,f1:2*tp+fp+fn?2*tp/(2*tp+fp+fn):null};
}
export function compareNucleiReference(result, reference, {radius}={}) {
  if(result?.provenance?.analysis!=='ihc'||!Array.isArray(result.files))throw new Error('Expected an IHC result');
  if(reference?.schemaVersion!=='wisplab.ihc-nuclei-reference/v1'||!Array.isArray(reference.images)||!reference.images.length)
    throw new Error('Expected nonempty wisplab.ihc-nuclei-reference/v1');
  if(!Number.isFinite(radius)||radius<=0)throw new Error('Specify a positive matching radius in source pixels before inspecting predictions');
  const seen=new Set(),records=[];
  for(const ref of reference.images) {
    if(!nonempty(ref.file)||seen.has(ref.file)||!HASH.test(ref.sha256??'')||!dimensions(ref)||ref.coordinateSpace!=='source'||
      !['h_dab','h_eosin','masson'].includes(ref.profile)||!['manual','independent-computation','synthetic'].includes(ref.sourceKind)||!['pending','complete'].includes(ref.reviewStatus))
      throw new Error('Invalid reference identity, coordinate space, review status or source');
    seen.add(ref.file);validatePoints(ref.points,ref.sourceWidth,ref.sourceHeight,ref.file);
    if(ref.hScore!==undefined&&(!Number.isFinite(ref.hScore)||ref.hScore<0||ref.hScore>300))throw new Error('Reference H-score must be between 0 and 300');
    if(ref.reviewStatus==='pending'){records.push({file:ref.file,status:'pending-review',sourceKind:ref.sourceKind});continue;}
    if(!nonempty(ref.method)||!nonempty(ref.reviewer)||!validDate(ref.reviewedOn))throw new Error('Completed references require method, reviewer and valid review date');
    const files=result.files.filter(f=>f.file===ref.file),inputs=(result.provenance.inputs??[]).filter(i=>i.file===ref.file&&i.role==='input');
    const actual=files[0],input=inputs[0];let reason=null;
    if(files.length!==1||inputs.length!==1)reason='missing-or-ambiguous-image';
    else if(!input.unchanged||input.before?.sha256!==ref.sha256||input.after?.sha256!==ref.sha256)reason='image-hash-mismatch';
    else if(actual.error)reason='analysis-error';
    else if(actual.settings?.profile!==ref.profile||actual.sourceWidth!==ref.sourceWidth||actual.sourceHeight!==ref.sourceHeight)reason='image-scope-mismatch';
    else if(!actual.nuclei||actual.nuclei.coordinateSpace!=='working'||actual.nuclei.width!==actual.width||actual.nuclei.height!==actual.height||
      !Number.isSafeInteger(actual.width)||actual.width<1||!Number.isSafeInteger(actual.height)||actual.height<1)reason='missing-nucleus-export';
    else if(ref.hScore!==undefined&&(!Number.isFinite(actual.overall?.hScore)||actual.overall.hScore<0||actual.overall.hScore>300))reason='unavailable-h-score';
    if(reason){records.push({file:ref.file,status:'incomplete',reason});continue;}
    validatePoints(actual.nuclei.items,actual.width,actual.height,`${ref.file} predictions`);
    const predicted=actual.nuclei.items.map(p=>({...p,x:(p.x+0.5)*ref.sourceWidth/actual.width-0.5,y:(p.y+0.5)*ref.sourceHeight/actual.height-0.5}));
    const matched=matchNuclei(ref.points,predicted,radius),classifications={truePositive:0,trueNegative:0,falsePositive:0,falseNegative:0};
    for(const m of matched.matches)classifications[m.referencePositive?(m.predictedPositive?'truePositive':'falseNegative'):(m.predictedPositive?'falsePositive':'trueNegative')]++;
    records.push({file:ref.file,status:'compared',sourceKind:ref.sourceKind,reviewer:ref.reviewer,reviewedOn:ref.reviewedOn,method:ref.method,...matched,
      detection:scores(matched.matches.length,matched.unmatchedPredictionIds.length,matched.missedReferenceIds.length),
      ...(ref.hScore===undefined?{}:{hScore:{reference:ref.hScore,observed:actual.overall.hScore,error:actual.overall.hScore-ref.hScore,absoluteError:Math.abs(actual.overall.hScore-ref.hScore)}}),
      classificationOnMatched:{...classifications,n:matched.matches.length,accuracy:matched.matches.length?(classifications.truePositive+classifications.trueNegative)/matched.matches.length:null}});
  }
  const unreferencedFiles=result.files.filter(f=>!seen.has(f.file)).map(f=>f.file);
  const stable=result.provenance.status==='success'&&['inputsUnchanged','engineUnchanged','bridgeUnchanged'].every(k=>result.provenance.checks?.[k]===true);
  const good=records.filter(r=>r.status==='compared');
  const totals=good.reduce((a,r)=>[a[0]+r.detection.truePositives,a[1]+r.detection.falsePositives,a[2]+r.detection.falseNegatives],[0,0,0]);
  const scoresAvailable=good.filter(r=>r.hScore);
  return {schemaVersion:'wisplab.ihc-nuclei-comparison/v1',status:!stable||unreferencedFiles.length||records.some(r=>r.status==='incomplete')?'incomplete':records.some(r=>r.status==='pending-review')?'pending-review':'compared',
    matchRadiusSourcePixels:radius,matchingMethod:'Maximum cardinality within radius, distance/ID ordered; labels ignored',records,unreferencedFiles,
    summaries:good.length?{nImages:good.length,detection:scores(...totals)}:null,
    hScoreSummary:scoresAvailable.length?{nImages:scoresAvailable.length,meanAbsoluteError:scoresAvailable.reduce((sum,r)=>sum+r.hScore.absoluteError,0)/scoresAvailable.length,
      meanSignedError:scoresAvailable.reduce((sum,r)=>sum+r.hScore.error,0)/scoresAvailable.length}:null,
    note:'Centroid detection matching, not mask overlap accuracy. Classification is conditional on matched nuclei. No acceptance threshold is implied. / 核中心检测匹配，不是分割轮廓精度；分类仅评价匹配核，无内置通过标准。'};
}
