import { useI18n } from '../i18n';
import { useMemo, useRef, useState } from 'react';
import type { AnalysisRow } from '../core/analysis';
import { summarizeMeltTable, type MeltTableState, type MeltTableSummary } from '../core/melt';

interface Props {
  rows: AnalysisRow[];
  meltTable: MeltTableState | null;
  onMeltTableFile: (file: File) => Promise<void>;
}

/** 熔解摘要表（LightCycler No. Tm 格式）附加导入与 QC 概况。 */
export default function MeltTableCard({ rows, meltTable, onMeltTableFile }: Props) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState('');

  const summary: MeltTableSummary | null = useMemo(() => {
    if (!meltTable) return null;
    return summarizeMeltTable(meltTable.byWell, rows);
  }, [meltTable, rows]);

  return (
    <div className="card">
      <h2>
        {t("熔解摘要表（可选附加）")}<span className="hint">{t("LightCycler \"No. Tm\" 格式导出；按孔位与主数据集连接")}</span>
      </h2>
      <input
        ref={inputRef}
        type="file"
        accept=".csv,.txt,.tsv,.xlsx,.xls"
        hidden
        aria-label={t("附加熔解摘要表文件")}
        onChange={(e) => {
          const f = e.target.files?.[0];
          setError('');
          if (f) void onMeltTableFile(f).catch((error) => setError(error instanceof Error ? error.message : String(error)));
          e.target.value = '';
        }}
      />
      {error && <p role="alert" className="chart-setting-error">{t(error)}</p>}
      {!meltTable ? (
        <button onClick={() => inputRef.current?.click()}>{t("附加熔解摘要表文件")}</button>
      ) : (
        <div>
          <p className="hint-line">
            {t("已附加")}{' '}<code>{meltTable.fileName}</code>
            {summary && (
              <>
                {t("：连接")}{' '}{summary.checked} {' '}{t("孔 —— 单峰")}{' '}{summary.single} ·{' '}
                <span style={{ color: summary.multi.length ? 'var(--danger)' : undefined }}>
                  {t("多峰")}{' '}{summary.multi.length}
                </span>{' '}
                {t("· 无峰")}{' '}{summary.none}
              </>
            )}
          </p>
          {summary && summary.multi.length > 0 && (
            <div className="qc-flag-list">
              {summary.multi.map((w) => (
                <div className="qc-flag-row" key={w.well}>
                  <span>
                    <code>{w.well}</code>
                  </span>
                  <span>{w.sample}</span>
                  <span className="reasons">
                    {w.peaks} {' '}{t("个熔解峰")}{w.tm != null ? `（Tm ${w.tm}°C）` : ''}
                  </span>
                </div>
              ))}
            </div>
          )}
          <div className="row-actions">
            <button onClick={() => inputRef.current?.click()}>{t("更换文件")}</button>
          </div>
        </div>
      )}
    </div>
  );
}
