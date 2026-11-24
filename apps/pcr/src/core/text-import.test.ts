import { describe, expect, it } from 'vitest';
import { extractRows } from './analysis';
import { readInputFile, sheetToRawMatrix } from './parse';
import { sniff } from './sniff';

/** Read a text export through the production path (readInputFile → sniff → extractRows). */
async function rowsFrom(name: string, text: string) {
  const input = await readInputFile(new File([text], name));
  if (input.kind !== 'workbook') throw new Error('expected workbook');
  const matrix = sheetToRawMatrix(input.wb, input.sheetNames[0]);
  const { headerRow, mapping } = sniff(matrix);
  return { matrix, rows: extractRows(matrix.slice(headerRow + 1), mapping) };
}

describe('text tables are read verbatim (no locale type guessing)', () => {
  it('comma CSV: quoted decimal comma and date-like sample names keep their values', async () => {
    const { rows } = await rowsFrom('plate.csv',
      'Well,Sample Name,Target Name,Cq\nA1,1/10,GAPDH,"18,5"\nA2,2-3,GAPDH,18.25\nA3,S1,ACTB,Undetermined\n');
    expect(rows.map((r) => r.sample)).toEqual(['1/10', '2-3', 'S1']);
    expect(rows[0].cq).toBe(18.5);
    expect(rows[1].cq).toBe(18.25);
    expect(rows[2].cq).toBeNaN();
  });
  it('semicolon CSV with decimal commas: 23,45 is 23.45, not 2345', async () => {
    const { rows } = await rowsFrom('plate.csv',
      'Well;Sample Name;Target Name;Cq\nA1;1/10;GAPDH;23,45\nA2;S2;GAPDH;24,10\nA3;S3;ACTB;19,875\n');
    expect(rows.map((r) => r.cq)).toEqual([23.45, 24.1, 19.875]);
    expect(rows[0].sample).toBe('1/10');
  });
  it('dilution names survive to the standard-curve quantity column', async () => {
    const { rows } = await rowsFrom('curve.csv',
      'Well,Sample Name,Target Name,Task,Cq,Quantity\nA1,1/10,GAPDH,Standard,20.1,"1,5"\nA2,1/100,GAPDH,Standard,23.4,"0,15"\n');
    expect(rows.map((r) => r.sample)).toEqual(['1/10', '1/100']);
    expect(rows.map((r) => r.quantity)).toEqual([1.5, 0.15]);
  });
  it('tab TXT: cells stay as typed (leading zeros, scientific notation)', async () => {
    const { matrix } = await rowsFrom('plate.txt',
      'Well\tSample Name\tTarget Name\tCq\nA1\t0042\tGAPDH\t23,45\nA2\t1.00E+05\tGAPDH\t24.10\n');
    expect(matrix[1]).toEqual(['A1', '0042', 'GAPDH', '23,45']);
    expect(matrix[2]).toEqual(['A2', '1.00E+05', 'GAPDH', '24.10']);
  });
});

describe('text encodings', () => {
  const TSV = 'Well\tSample Name\tTarget Name\tCq\nA1\t对照\tGAPDH\t18.5\nA2\t处理\tGAPDH\t24.25\nA3\tS3\tACTB\tUndetermined\n';
  const utf16le = (text: string) => Uint8Array.from(Buffer.from(text, 'utf16le'));
  const utf16be = (text: string) => utf16le(text).map((_, i, b) => b[i ^ 1]);
  const withBom = (bom: number[], body: Uint8Array) => Uint8Array.from([...bom, ...body]);

  async function rowsFromBytes(name: string, bytes: Uint8Array<ArrayBuffer>) {
    const input = await readInputFile(new File([bytes], name));
    if (input.kind !== 'workbook') throw new Error('expected workbook');
    const matrix = sheetToRawMatrix(input.wb, input.sheetNames[0]);
    const { headerRow, mapping } = sniff(matrix);
    return { matrix, rows: extractRows(matrix.slice(headerRow + 1), mapping) };
  }

  it.each([
    ['UTF-16LE with BOM (QuantStudio .txt)', withBom([0xff, 0xfe], utf16le(TSV))],
    ['UTF-16BE with BOM', withBom([0xfe, 0xff], utf16be(TSV))],
    ['UTF-16LE without BOM', utf16le(TSV)],
    ['UTF-8 with BOM', withBom([0xef, 0xbb, 0xbf], new TextEncoder().encode(TSV))],
    ['UTF-8', new TextEncoder().encode(TSV)],
  ])('%s', async (_label, bytes) => {
    const { matrix, rows } = await rowsFromBytes('results.txt', bytes);
    expect(matrix[0][0]).toBe('Well');
    expect(matrix.flat().join('')).not.toContain('\u0000');
    expect(rows.map((r) => r.sample)).toEqual(['对照', '处理', 'S3']);
    expect(rows.map((r) => r.cq)).toEqual([18.5, 24.25, NaN]);
  });

  it('GBK exports still decode', async () => {
    // "对照" / "处理" in GBK
    const gbk = (s: string) => s.replace('对照', '\u0001').replace('处理', '\u0002');
    const ascii = new TextEncoder().encode(gbk(TSV));
    const bytes = new Uint8Array([...ascii].flatMap((b) => (b === 1 ? [0xb6, 0xd4, 0xd5, 0xd5] : b === 2 ? [0xb4, 0xa6, 0xc0, 0xed] : [b])));
    const { rows } = await rowsFromBytes('results.txt', bytes);
    expect(rows.map((r) => r.sample)).toEqual(['对照', '处理', 'S3']);
  });
});
