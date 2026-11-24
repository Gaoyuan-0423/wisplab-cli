import type { ColumnMapping } from './types';

export type DecimalSeparator = '.' | ',';

export interface NumericColumnNote {
  column: 'quantity';
  /** Decimal mark applied to values whose own text does not decide it. */
  decimal: DecimalSeparator;
  basis: 'values' | 'cq-column' | 'default';
  /** Values with one separator followed by exactly three digits, e.g. "10,000". */
  ambiguousExamples: string[];
  /** Values in the column decide on different separators. */
  mixed: boolean;
  fileName?: string;
}

// Leading numeric token, mirroring parseFloat's tolerance of trailing text ("25.3*").
const LEADING_NUMBER = /^[+-]?[\d.,]*\d[\d.,]*(?:[eE][+-]?\d+)?/;
const PLAIN_NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

function numericToken(raw: string): string | null {
  const match = raw.replace(/[\s  ]/g, '').match(LEADING_NUMBER);
  return match ? match[0] : null;
}

function separators(token: string) {
  const mantissa = token.replace(/^[+-]/, '').replace(/[eE].*$/, '');
  return { mantissa, dots: mantissa.split('.').length - 1, commas: mantissa.split(',').length - 1 };
}

/**
 * The decimal mark a single value proves on its own, or null when the text has no
 * separator or reads validly both ways ("1,234" is 1234 or 1.234).
 */
export function decisiveSeparator(raw: string): DecimalSeparator | null {
  const token = numericToken(raw);
  if (!token) return null;
  const { mantissa, dots, commas } = separators(token);
  if (dots && commas) return mantissa.lastIndexOf('.') > mantissa.lastIndexOf(',') ? '.' : ',';
  if (commas > 1) return '.';
  if (dots > 1) return ',';
  if (!dots && !commas) return null;
  const [whole, fraction] = mantissa.split(dots ? '.' : ',');
  // Thousands grouping needs 1–3 leading digits (not a lone 0) and exactly three after.
  const groupingPossible = fraction.length === 3 && whole.length >= 1 && whole.length <= 3 && whole !== '0';
  return groupingPossible ? null : dots ? '.' : ',';
}

/** Parse with a known decimal mark, dropping the other mark as grouping. */
export function parseDecimal(raw: string, decimal: DecimalSeparator): number {
  const token = numericToken(raw);
  if (!token) return NaN;
  const grouping = decimal === '.' ? ',' : '.';
  const normalized = token.split(grouping).join('').replace(decimal, '.');
  return PLAIN_NUMBER.test(normalized) ? Number(normalized) : NaN;
}

/** Cq is below 1000, so even "25,123" can only carry a decimal mark. */
function cqSeparator(raw: string): DecimalSeparator | null {
  const own = decisiveSeparator(raw);
  if (own) return own;
  const token = numericToken(raw);
  if (!token) return null;
  const { dots, commas } = separators(token);
  return commas === 1 && !dots ? ',' : dots === 1 && !commas ? '.' : null;
}

export function parseCq(raw: string): number {
  return parseDecimal(raw, cqSeparator(raw) ?? '.');
}

/** Values that decide on their own keep that reading, even in a mixed column. */
export function parseQuantity(raw: string, columnDecimal: DecimalSeparator): number {
  return parseDecimal(raw, decisiveSeparator(raw) ?? columnDecimal);
}

function vote(values: string[], decide: (raw: string) => DecimalSeparator | null) {
  const votes = new Set(values.map(decide).filter((v): v is DecimalSeparator => v !== null));
  return { decimal: votes.size === 1 ? [...votes][0] : null, mixed: votes.size > 1 };
}

export interface ResolvedNumericColumns {
  quantityDecimal: DecimalSeparator;
  notes: NumericColumnNote[];
}

/**
 * Decide how the quantity column writes decimals. Evidence order: the column's own
 * values, then the Cq column of the same file, then the comma-as-grouping convention
 * that column detection already assumes. A note is produced whenever a value's
 * reading depends on an assumption the user should be able to check.
 */
export function resolveNumericColumns(rows: string[][], mapping: ColumnMapping): ResolvedNumericColumns {
  if (mapping.quantity < 0) return { quantityDecimal: '.', notes: [] };
  const quantities = rows.map((row) => row[mapping.quantity] ?? '').filter((v) => numericToken(v) !== null);
  const ambiguousExamples = quantities.filter((v) => /[.,]/.test(v) && decisiveSeparator(v) === null).slice(0, 3);
  const own = vote(quantities, decisiveSeparator);
  const cq = mapping.cq >= 0 ? vote(rows.map((row) => row[mapping.cq] ?? ''), cqSeparator) : { decimal: null, mixed: false };
  const decimal: DecimalSeparator = own.decimal ?? cq.decimal ?? '.';
  const basis: NumericColumnNote['basis'] = own.decimal ? 'values' : cq.decimal ? 'cq-column' : 'default';
  // Reading "10,000" as 10000 because the file's Cq uses "." is the expected case.
  const assumed = ambiguousExamples.length > 0 && (basis === 'default' || decimal === ',');
  const notes: NumericColumnNote[] = own.mixed || assumed
    ? [{ column: 'quantity', decimal, basis, ambiguousExamples, mixed: own.mixed }]
    : [];
  return { quantityDecimal: decimal, notes };
}

export function describeNumericNote(note: NumericColumnNote): string {
  const where = note.fileName ? `${note.fileName}：` : '';
  if (note.mixed) {
    return `${where}数量列同时出现"."与","两种小数写法，各值已按自身写法解析，请核对源文件后再使用标准曲线`;
  }
  const example = note.ambiguousExamples[0] ?? '';
  const reading = example ? `（如 "${example}" → ${parseDecimal(example, note.decimal)}）` : '';
  const why = note.basis === 'values'
    ? '依据数量列其他值的写法'
    : note.basis === 'cq-column'
      ? '依据同文件 Cq 列的写法'
      : '无法从文件判定，默认';
  const rule = note.decimal === ',' ? '按逗号为小数点解析' : '按逗号为千分位、点为小数点解析';
  return `${where}数量列存在两种读法都成立的数值，${why}${rule}${reading}；如与原意不符，请修改源文件后重新导入`;
}
