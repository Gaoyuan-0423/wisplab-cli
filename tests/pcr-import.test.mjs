import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizePcrImportOptions,parsePcrImport,worksheetSourceMatrix} from '../pcr-import.mjs';

const sheet={'!ref':'A2:D6',A2:{v:'Instrument export'},A3:{v:'Specimen'},B3:{v:'Gene code'},C3:{v:'Cycle'},D3:{v:'Cycle'},
  A4:{v:'C'},B4:{v:'R'},C4:{v:20},D4:{v:999},A6:{v:'S'},B6:{v:'T'},C6:{v:'21bad'},D6:{v:999}};
const input={kind:'workbook',sheetNames:['Summary','2','Results'],wb:{Sheets:{Summary:{'!ref':'A1',A1:{v:'Summary'}},'2':sheet,Results:sheet}}};
const api={sniff:()=>({headerRow:1,mapping:{sample:0,target:1,cq:2}}),extractRows:(rows,mapping)=>rows.map((r,i)=>({id:i+1,
  sample:r[mapping.sample]??'',target:r[mapping.target]??'',cq:parseFloat(r[mapping.cq]),excluded:false}))};
const explicit={sheet:'Results',headerRow:3,columns:{sample:'Specimen',target:'Gene code',cq:3}};

test('worksheet physical rows and blank rows survive; source mapping preserves legacy analysis ids',()=>{
  assert.equal(worksheetSourceMatrix(sheet).length,6);
  const r=parsePcrImport(input,explicit,api);
  assert.equal(r.report.headerRow,3);assert.equal(r.report.columns.cq.index,3);
  assert.equal(r.report.columns.cq.letter,'C');assert.equal(r.report.columns.cq.header,'Cycle');
  assert.deepEqual(r.report.rows.map(r=>[r.sourceRow,r.analysisRowId]),[[4,1],[5,null],[6,2]]);
  assert.equal(r.preview.preambleRows[1].rawValues[0],'Instrument export');
  assert.equal(r.preview.rows[2].rawValues[2],'21bad');
  assert.deepEqual(r.preview.rows[2].issues,['partially-parsed-cq']);
  assert.equal(r.rows[1].cq,21); // Legacy parser behavior is disclosed, not silently changed.
  assert.ok(r.preview.warnings.some(w=>w.includes('6')));
});
test('numeric-looking sheet names are names, never indices; explicit missing sheets never fall back',()=>{
  assert.equal(parsePcrImport(input,{...explicit,sheet:'2'},api).report.sheet,'2');
  assert.throws(()=>parsePcrImport(input,{...explicit,sheet:'1'},api),/Worksheet not found: 1; available names: Summary, 2, Results/);
  assert.throws(()=>normalizePcrImportOptions({sheet:2}),/name/);
  const r=parsePcrImport(input,{},api);assert.equal(r.report.sheet,'Summary');
  assert.ok(r.report.warnings.some(w=>w.includes('Only the first worksheet')));
});
test('explicit column names must be unambiguous; unknown, missing, overlapping and out-of-range mappings fail safely',()=>{
  assert.throws(()=>parsePcrImport(input,{...explicit,columns:{...explicit.columns,cq:'Cycle'}},api),/ambiguous/);
  assert.throws(()=>parsePcrImport(input,{...explicit,columns:{...explicit.columns,cq:'Absent'}},api),/not found/);
  assert.throws(()=>parsePcrImport(input,{...explicit,columns:{sample:1,target:2,cq:5}},api),/outside/);
  assert.throws(()=>normalizePcrImportOptions({columns:{sample:1,target:2}}),/include/);
  assert.throws(()=>normalizePcrImportOptions({headerRow:0}),/positive/);
  assert.throws(()=>normalizePcrImportOptions({headerRow:'3'}),/positive/);
  const r=parsePcrImport(input,{...explicit,columns:{sample:1,target:2,cq:2}},api);
  assert.equal(r.report.canAnalyze,false);assert.match(r.report.errors.join(),/both target and cq/);
});
test('explicit header rows never silently shift; unresolved automatic columns remain inspectable',()=>{
  const r=parsePcrImport(input,{sheet:'Results',headerRow:3},api);
  assert.equal(r.report.canAnalyze,false);assert.match(r.report.errors.join(),/selected headerRow/);
  const unresolved=parsePcrImport(input,{sheet:'Results'},{...api,sniff:()=>({headerRow:1,mapping:{}})});
  assert.equal(unresolved.preview.canAnalyze,false);assert.ok(unresolved.preview.rows.length);
  assert.match(unresolved.preview.errors.join(),/unresolved: sample, target, cq/);
});
test('RDML declares generated-table coordinates and rejects irrelevant sheet selection; Excel errors are not numeric Cq',()=>{
  const rdml={kind:'rdml',matrix:[['Sample','Target','Cq'],['C','T','20']]};
  assert.throws(()=>parsePcrImport(rdml,{sheet:'Results'},api),/RDML has no worksheets/);
  const r=parsePcrImport(rdml,{headerRow:1,columns:{sample:1,target:2,cq:3}},api);
  assert.equal(r.report.rowCoordinateSystem,'RDML-generated-table-1-based');
  assert.deepEqual(r.preview.rows[0].rawValues,['C','T','20']);
  assert.equal(worksheetSourceMatrix({'!ref':'A1',A1:{t:'e',v:7,w:'#DIV/0!'}})[0][0],'#DIV/0!');
});
