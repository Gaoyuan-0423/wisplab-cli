const columnKeys=['plate','well','sample','group','pairId','target','task','cq','quantity'];
const required=['sample','target','cq'];
const numeric=/^[+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+)(?:[eE][+-]?\d+)?$/;

export function normalizePcrImportOptions(options={}) {
  if(!options||typeof options!=='object'||Array.isArray(options)||Object.keys(options).some(k=>!['sheet','headerRow','columns'].includes(k)))
    throw new Error('importOptions: expected sheet, headerRow and/or columns');
  const {sheet,headerRow,columns}=options;
  if(sheet!==undefined&&(typeof sheet!=='string'||!sheet.length))throw new Error('importOptions.sheet must be an exact worksheet name (a string, never an index)');
  if(headerRow!==undefined&&(!Number.isSafeInteger(headerRow)||headerRow<1))throw new Error('importOptions.headerRow must be a positive 1-based row number');
  if(columns!==undefined) {
    if(!columns||typeof columns!=='object'||Array.isArray(columns)||Object.keys(columns).some(k=>!columnKeys.includes(k)))
      throw new Error(`importOptions.columns accepts only: ${columnKeys.join(', ')}`);
    if(required.some(k=>!Object.hasOwn(columns,k)))throw new Error('Explicit columns must include sample, target and cq');
    for(const [key,value] of Object.entries(columns)) {
      if(!(typeof value==='string'&&value.length)&&!(Number.isSafeInteger(value)&&value>=1))
        throw new Error(`columns.${key} must be an exact header name or positive 1-based column number`);
    }
  }
  return {...(sheet===undefined?{}:{sheet}),...(headerRow===undefined?{}:{headerRow}),...(columns===undefined?{}:{columns:{...columns}})};
}

function addressParts(address) {
  const match=/^\$?([A-Z]+)\$?([1-9]\d*)$/.exec(address);
  if(!match)throw new Error(`Invalid worksheet cell address: ${address}`);
  let col=0;for(const c of match[1])col=col*26+c.charCodeAt(0)-64;
  return {row:Number(match[2]),col};
}
function columnLetter(col) {
  let out='';for(;col>0;col=Math.floor((col-1)/26))out=String.fromCharCode(65+(col-1)%26)+out;
  return out;
}
function cellText(value) {
  if(value==null)return '';
  if(value instanceof Date)return value.toISOString().slice(0,10);
  if(typeof value==='number')return Number.isInteger(value)?String(value):String(Math.round(value*1e10)/1e10);
  return String(value).trim();
}

/** Keep blank rows and leading offsets; engine sheetToRawMatrix discards them. */
export function worksheetSourceMatrix(worksheet) {
  if(!worksheet)throw new Error('Selected worksheet does not exist');
  if(!worksheet['!ref'])return [];
  const end=addressParts(worksheet['!ref'].split(':').at(-1));
  const matrix=Array.from({length:end.row},()=>Array(end.col).fill(''));
  for(const [address,cell] of Object.entries(worksheet)) {
    if(address.startsWith('!'))continue;
    const {row,col}=addressParts(address);
    if(row<=end.row&&col<=end.col)matrix[row-1][col-1]=cell?.t==='e'?String(cell.w??'#ERROR!'):cellText(cell?.v);
  }
  return matrix;
}

export function parsePcrImport(input, rawOptions, {sniff,extractRows}) {
  const options=normalizePcrImportOptions(rawOptions),warnings=[],errors=[];
  const sheetNames=input.kind==='workbook'?[...input.sheetNames]:[];
  if(input.kind==='rdml'&&options.sheet!==undefined)throw new Error('RDML has no worksheets; --sheet is not applicable');
  const sheet=input.kind==='workbook'?(options.sheet??sheetNames[0]):null;
  if(input.kind==='workbook'&&!sheetNames.includes(sheet))throw new Error(`Worksheet not found: ${sheet??'(none)'}; available names: ${sheetNames.join(', ')}`);
  if(input.kind==='workbook'&&options.sheet===undefined&&sheetNames.length>1)
    warnings.push(`仅分析首个工作表 / Only the first worksheet was analyzed: ${sheet}; use --sheet with its exact name to select another`);
  const matrix=input.kind==='rdml'?input.matrix:worksheetSourceMatrix(input.wb.Sheets[sheet]);
  if(options.headerRow!==undefined&&options.headerRow>matrix.length)throw new Error(`headerRow ${options.headerRow} is outside the source (${matrix.length} rows)`);
  // Default sniffing uses the same nonempty matrix as before. Convert its result back to a physical source row.
  const nonempty=matrix.map((values,i)=>({values,sourceRow:i+1})).filter(r=>r.values.some(v=>String(v??'').trim()));
  const detected=options.headerRow===undefined?sniff(nonempty.map(r=>r.values)):sniff(matrix.slice(options.headerRow-1));
  const headerRow=options.headerRow??nonempty[detected.headerRow]?.sourceRow??1;
  if(options.headerRow!==undefined&&!options.columns&&detected.headerRow!==0)
    errors.push('The selected headerRow could not be mapped automatically; provide explicit columns / 指定表头行无法自动匹配，请提供显式列映射');
  const header=matrix[headerRow-1]??[];
  const preambleRows=matrix.slice(0,headerRow-1).map((rawValues,i)=>({sourceRow:i+1,rawValues}));
  if(preambleRows.some(r=>r.rawValues.some(v=>String(v??'').trim())))
    warnings.push(`Rows before headerRow ${headerRow} are not analysis data; inspect preambleRows in preview / 表头之前的行不进入分析，请在预览中复核`);
  let mapping=Object.fromEntries(columnKeys.map(k=>[k,detected.mapping[k]??-1]));
  if(options.columns) {
    mapping=Object.fromEntries(columnKeys.map(k=>[k,-1]));
    for(const [key,value] of Object.entries(options.columns)) {
      let index;
      if(typeof value==='number')index=value-1;
      else {
        const matches=header.map((h,i)=>h===value?i:-1).filter(i=>i>=0);
        if(matches.length!==1)throw new Error(`columns.${key}: header ${JSON.stringify(value)} ${matches.length?'is ambiguous; use a 1-based column number':'was not found'}`);
        index=matches[0];
      }
      if(index>=header.length)throw new Error(`columns.${key}: column ${index+1} is outside the selected header (${header.length} columns)`);
      mapping[key]=index;
    }
  }
  const used=new Map();
  for(const [key,index] of Object.entries(mapping))if(index>=0) {
    if(used.has(index))errors.push(`Column ${index+1} maps to both ${used.get(index)} and ${key}; provide distinct explicit columns`);
    used.set(index,key);
  }
  const missingColumns=required.filter(k=>mapping[k]<0);
  if(missingColumns.length)errors.push(`Sample, target and Cq columns are required; unresolved: ${missingColumns.join(', ')} / 无法识别必要数据列`);
  const sourceRows=matrix.slice(headerRow).map((rawValues,i)=>({sourceRow:headerRow+i+1,rawValues,
    blank:!rawValues.some(v=>String(v??'').trim())}));
  const dataRows=sourceRows.filter(r=>!r.blank);
  const rows=extractRows(dataRows.map(r=>r.rawValues),mapping);
  if(rows.length!==dataRows.length)throw new Error('Parser row count changed unexpectedly; source-row mapping would be unsafe');
  let index=0;
  for(const source of sourceRows) {
    source.analysisRowId=source.blank?null:rows[index].id;
    source.parsed=source.blank?null:rows[index++];
    source.issues=[];
    if(source.blank){source.issues.push('blank-row');continue;}
    const row=source.parsed;
    if(!row.sample)source.issues.push('missing-sample');
    if(!row.target)source.issues.push('missing-target');
    const rawCq=String(source.rawValues[mapping.cq]??'').trim();
    if(!Number.isFinite(row.cq))source.issues.push('nonfinite-cq');
    else if(!numeric.test(rawCq))source.issues.push('partially-parsed-cq');
  }
  const blanks=sourceRows.filter(r=>r.blank).map(r=>r.sourceRow);
  if(blanks.length)warnings.push(`Blank source rows retained in preview and omitted from analysis / 空白源行保留预览但不进入分析: ${blanks.join(', ')}`);
  const invalid=sourceRows.filter(r=>r.issues.some(x=>x!=='blank-row')).map(r=>r.sourceRow);
  if(invalid.length)warnings.push(`Source rows require review (missing labels, nonnumeric or partially parsed Cq) / 以下源行需复核: ${invalid.join(', ')}`);
  if(!rows.length)errors.push('No analyzable rows / 没有可分析的数据行');
  const metadata={inputKind:input.kind,sheet,sheetNames,sheetSelection:input.kind==='rdml'?'not-applicable':options.sheet===undefined?'default-first':'explicit-name',
    rowCoordinateSystem:input.kind==='rdml'?'RDML-generated-table-1-based':'worksheet-1-based',headerRow,
    mappingMode:options.columns?'explicit':'automatic',headerSelection:options.headerRow===undefined?'automatic':'explicit',
    columns:Object.fromEntries(columnKeys.map(key=>[key,mapping[key]<0?null:{index:mapping[key]+1,letter:columnLetter(mapping[key]+1),header:header[mapping[key]]??''}])),
    headers:header,preambleRowCount:preambleRows.length,totalSourceRows:matrix.length,analysisRowCount:rows.length,canAnalyze:errors.length===0,warnings,errors};
  return {rows,mapping,format:detected.format??null,
    report:{...metadata,rows:sourceRows.map(({sourceRow,analysisRowId,issues})=>({sourceRow,analysisRowId,issues}))},
    preview:{...metadata,preambleRows,rows:sourceRows}};
}
