import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { extractRows } from './analysis';
import { analyzeAuto } from './auto';
import { decisiveSeparator, parseCq, parseDecimal, parseQuantity, resolveNumericColumns } from './number';
import { sheetToRawMatrix } from './parse';
import { emptyMapping } from './types';

const here = fileURLToPath(new URL('.', import.meta.url));
const FIXTURE = join(here, '../../tests/fixtures/standard-curve-style.csv');

function fixtureMatrix(): string[][] {
  return readFileSync(FIXTURE, 'utf-8').trim().split(/\r?\n/).map((line) => line.split(','));
}

/** Rewrite Cq / Quantity cells the way a localized instrument export would. */
function localized(cq: (v: string) => string, quantity: (v: string) => string): string[][] {
  return fixtureMatrix().map((row, i) => (i === 0 ? row : [...row.slice(0, 5), cq(row[5]), row[6] ? quantity(row[6]) : '']));
}

const US: Record<string, string> = { '100000': '100,000', '10000': '10,000', '1000': '1,000', '100': '100' };
const EFF_LDHA = (Math.pow(10, 1 / 3.2) - 1) * 100;

describe('decisiveSeparator', () => {
  it.each([
    ['1,234.5', '.'], ['1.234,5', ','], ['1,234,567', '.'], ['1.234.567', ','],
    ['25,12', ','], ['0,500', ','], ['1234,567', ','], ['25.12', '.'], ['.5', '.'],
  ] as const)('%s → %s', (raw, sep) => expect(decisiveSeparator(raw)).toBe(sep));

  it.each(['10,000', '1,000', '100.000', '42', '1e-12', 'Undetermined', ''])('%s does not decide', (raw) => {
    expect(decisiveSeparator(raw)).toBeNull();
  });
});

describe('parseDecimal / parseQuantity / parseCq', () => {
  it('thousands grouping is removed, not read as a decimal mark', () => {
    expect(parseQuantity('10,000', '.')).toBe(10000);
    expect(parseQuantity('1,234.5', '.')).toBe(1234.5);
    expect(parseQuantity('1,234.5', ',')).toBe(1234.5); // the value's own text wins
    expect(parseQuantity('1.234,5', '.')).toBe(1234.5);
    expect(parseQuantity('1 234 567', '.')).toBe(1234567);
  });
  it('decimal commas still parse', () => {
    expect(parseQuantity('25,12', '.')).toBe(25.12);
    expect(parseQuantity('10,000', ',')).toBe(10);
    expect(parseCq('25,123')).toBe(25.123);
    expect(parseCq('25.123')).toBe(25.123);
  });
  it('scientific notation, signs and non-numbers', () => {
    expect(parseDecimal('1e-12', '.')).toBe(1e-12);
    expect(parseDecimal('1,5E+03', ',')).toBe(1500);
    expect(parseDecimal('-0,25', ',')).toBe(-0.25);
    expect(parseCq('Undetermined')).toBeNaN();
    expect(parseCq('-')).toBeNaN();
    expect(parseCq('')).toBeNaN();
  });
  it('keeps parseFloat tolerance for trailing annotations', () => {
    expect(parseCq('25.3*')).toBe(25.3);
  });
});

describe('resolveNumericColumns', () => {
  const mapping = { ...emptyMapping(), cq: 0, quantity: 1 };
  it('the quantity column decides from its own values', () => {
    expect(resolveNumericColumns([['20', '1,000.5'], ['21', '10,000']], mapping)).toEqual({ quantityDecimal: '.', notes: [] });
  });
  it('falls back to the Cq column of the same file', () => {
    expect(resolveNumericColumns([['20.5', '10,000']], mapping)).toEqual({ quantityDecimal: '.', notes: [] });
    const eu = resolveNumericColumns([['20,5', '10,000']], mapping);
    expect(eu.quantityDecimal).toBe(',');
    expect(eu.notes[0]).toMatchObject({ basis: 'cq-column', ambiguousExamples: ['10,000'] });
  });
  it('an undecidable column is reported, not silently guessed', () => {
    const r = resolveNumericColumns([['20', '10,000'], ['21', '100']], mapping);
    expect(r.quantityDecimal).toBe('.');
    expect(r.notes[0]).toMatchObject({ basis: 'default', ambiguousExamples: ['10,000'], mixed: false });
  });
  it('mixed conventions in one column are reported', () => {
    expect(resolveNumericColumns([['20', '1,234.5'], ['21', '1.234,5']], mapping).notes[0]?.mixed).toBe(true);
  });
});

describe('standard curves with localized quantity columns', () => {
  it('US thousands separators give the same curve as plain integers', () => {
    const plain = analyzeAuto(fixtureMatrix(), { fileName: 'plain.csv' });
    const us = analyzeAuto(localized((v) => v, (v) => US[v] ?? v), { fileName: 'us.csv' });
    expect(us.config.efficiencies?.LDHA).toBeCloseTo(EFF_LDHA, 1);
    expect(us.config.efficiencies).toEqual(plain.config.efficiencies);
    expect(us.report.issues.some((i) => i.code === 'QUANTITY_DECIMAL_AMBIGUOUS')).toBe(false);
  });

  it('European decimal commas in both columns', () => {
    const eu = localized((v) => v.replace('.', ','), (v) => `${v},00`);
    const r = analyzeAuto(eu, { fileName: 'eu.csv' });
    expect(r.config.efficiencies?.LDHA).toBeCloseTo(EFF_LDHA, 1);
    const rows = extractRows(eu.slice(1), { ...emptyMapping(), sample: 2, target: 3, task: 4, cq: 5, quantity: 6 });
    expect(rows.find((x) => x.sample === 'Std_10000')?.quantity).toBe(10000);
    expect(rows[0].cq).toBe(15);
  });

  it('ambiguous quantities with integer Cq raise a visible warning', () => {
    const r = analyzeAuto(localized((v) => String(Math.round(Number(v))), (v) => US[v] ?? v), { fileName: 'ambiguous.csv' });
    const issue = r.report.issues.find((i) => i.code === 'QUANTITY_DECIMAL_AMBIGUOUS');
    expect(issue).toMatchObject({ severity: 'warning', target: 'ambiguous.csv' });
    expect(issue?.message).toContain('100,000');
  });
});

describe('Excel numeric cells', () => {
  it('keep full precision (no 1e-10 rounding)', () => {
    const ws = XLSX.utils.aoa_to_sheet([['Sample', 'Target', 'Cq', 'Quantity'], ['Std', 'GAPDH', 25.123456789012, 1e-12], ['Std', 'GAPDH', 28.5, 3.4e-11]]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Results');
    const m = sheetToRawMatrix(wb, 'Results');
    expect(m[1]).toEqual(['Std', 'GAPDH', '25.123456789012', '1e-12']);
    const rows = extractRows(m.slice(1), { ...emptyMapping(), sample: 0, target: 1, cq: 2, quantity: 3 });
    expect(rows.map((r) => r.quantity)).toEqual([1e-12, 3.4e-11]);
  });
});
