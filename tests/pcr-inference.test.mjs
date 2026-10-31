import test from 'node:test';
import assert from 'node:assert/strict';
import { studentTCritical95,studentTTwoSidedP,expressionInterval95 } from '../pcr-inference.mjs';
const close=(actual,expected,tol=1e-10)=>assert.ok(Number.isFinite(actual)&&Math.abs(actual-expected)<=tol,`${actual} != ${expected}`);

// Independent reference: R 4.5.3 (2026-03-11), stats::qt(0.975, df).
// Source and exact regeneration script: docs/pcr-import-design.md.
test('Student t critical values match independent R for heavy, fractional and near-normal tails',()=>{
  const dfs=[1,2,4,9,30,2.4,10000];
  const expected=[12.7062047361746924,4.3026527297494619,2.7764451051977934,2.2621571627982049,2.0422724563012378,3.6835042896750192,1.9602012398906254];
  dfs.forEach((df,i)=>close(studentTCritical95(df),expected[i],1e-8));
});
test('paired p-value and 95% intervals match R t.test, not a self-generated oracle',()=>{
  // t.test(c(2,5,8,10),c(1,3,5,9),paired=TRUE)
  const estimate=1.75,se=Math.sqrt(11/12)/2;
  close(studentTTwoSidedP(estimate/se,3),0.035352847002517,1e-13);
  const actual=expressionInterval95(estimate,se,3);
  actual.log2FoldChangeCI95.forEach((v,i)=>close(v,[0.22651981917118771,3.27348018082881209][i]));
  actual.foldChangeCI95.forEach((v,i)=>close(v,[1.1700091555078791,9.6697606559101565][i]));
});
test('stable paired tail preserves representable tiny probabilities and symmetric null result',()=>{
  // R: 2*pt(200,18,lower.tail=FALSE) and 2*pt(0,3,lower.tail=FALSE).
  close(studentTTwoSidedP(0,3),1);
  close(studentTTwoSidedP(-3,4),studentTTwoSidedP(3,4));
  close(studentTTwoSidedP(200,18)/1.3980319048071821e-31,1,1e-12);
  assert.ok(Number.isNaN(studentTCritical95(0)));
  assert.deepEqual(expressionInterval95(0,0,3),{log2FoldChangeCI95:null,foldChangeCI95:null});
  assert.deepEqual(expressionInterval95(0,1,NaN),{log2FoldChangeCI95:null,foldChangeCI95:null});
});
