import { useI18n } from '../i18n';
import { useMemo } from 'react';
import { sniff } from '../core/sniff';
import { COLUMN_KEYS, COLUMN_LABELS, mappingComplete, type ColumnKey, type ColumnMapping } from '../core/types';

interface Props {
  matrix: string[][];
  headerRow: number;
  mapping: ColumnMapping;
  onHeaderRow: (idx: number) => void;
  onMapping: (m: ColumnMapping) => void;
}

const SNIFFED = '自动识别';

export default function MappingPanel({ matrix, headerRow, mapping, onHeaderRow, onMapping }: Props) {
  const { t, language } = useI18n();
  const maxScan = Math.min(30, Math.max(0, matrix.length - 1));
  const headers = matrix[headerRow] ?? [];
  const dataRows = matrix.slice(headerRow + 1);

  const autoSuggest = useMemo(() => (matrix.length ? sniff(matrix) : null), [matrix]);

  function setKey(key: ColumnKey, colIdx: number) {
    onMapping({ ...mapping, [key]: colIdx });
  }

  const width = headers.length;
  const colIndex = Array.from({ length: width }, (_, i) => i);
  const previewRows = dataRows.slice(0, 12);

  return (
    <div className="card">
      <h2>
        {t("确认表头与列映射")}<span className="hint">{t("多数导出文件会自动识别，仅需确认无误")}</span>
      </h2>

      <div className="header-row-row">
        <span style={{ fontWeight: 600, fontSize: '0.88rem' }}>{t("表头所在行")}</span>
        <input
          type="range"
          min={0}
          max={Math.max(maxScan, 0)}
          value={headerRow}
          onChange={(e) => onHeaderRow(Number(e.target.value))}
          aria-label={t("表头所在行")}
        />
        <code>{t('第 {0} 行', [headerRow + 1])}</code>
        {autoSuggest && autoSuggest.headerRow !== headerRow && (
          <button className="small" onClick={() => onHeaderRow(autoSuggest.headerRow)}>
            {t('跳到自动识别的第 {0} 行', [autoSuggest.headerRow + 1])}</button>
        )}
      </div>

      <div className="mapping-grid">
        {COLUMN_KEYS.map((key) => {
          const label = COLUMN_LABELS[key];
          const col = mapping[key];
          const autoVal = autoSuggest?.mapping[key] ?? -1;
          const isAuto = col === autoVal && col >= 0;
          return (
            <div className="mapping-field" key={key}>
              <label>
                {t(label.zh)} <span style={{ color: 'var(--muted-text)' }}>{language === "zh" ? label.en : ""}</span>
                {label.required && <span className="req"> *</span>}
              </label>
              <select
                className={isAuto ? 'auto-ok' : ''}
                value={col}
                onChange={(e) => setKey(key, Number(e.target.value))}
                aria-label={t(label.zh)}
              >
                <option value={-1}>{t("— 未映射 —")}</option>
                {colIndex.map((ci) => (
                  <option key={ci} value={ci}>
                    {headers[ci] || t(`（第 ${ci + 1} 列，无表头）`)}
                  </option>
                ))}
              </select>
              {isAuto && <span className="score">{t(SNIFFED)} ✓</span>}
            </div>
          );
        })}
      </div>

      {!mappingComplete(mapping) && (
        <p className="hint-line" style={{ color: 'var(--warning)' }}>
          {t("还差必需列：样本 ID / 目标基因 / Cq。若文件里基因嵌在样本名等非标准位置，请先在仪器软件里整理后再导出，或手动指定以上三列。")}</p>
      )}

      <div className="preview-wrap">
        <table className="preview">
          <thead>
            <tr>
              {colIndex.map((ci) => {
                const mappedKey = COLUMN_KEYS.find((k) => mapping[k] === ci);
                return (
                  <th key={ci} className={mappedKey ? 'mapped' : ''}>
                    {headers[ci] || '—'}
                    {mappedKey ? ` · ${t(COLUMN_LABELS[mappedKey].zh)}` : ''}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {previewRows.map((row, ri) => (
              <tr key={ri}>
                {colIndex.map((ci) => (
                  <td key={ci} title={row[ci]}>
                    {row[ci] || ''}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="hint-line">{t('共 {0} 行数据（表头下方），预览前 {1} 行。', [dataRows.length, previewRows.length])}</p>
    </div>
  );
}
