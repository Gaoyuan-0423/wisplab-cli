import { useI18n } from '../i18n';
import type { PerFileInfo } from '../core/merge';

interface Props {
  perFile: PerFileInfo[];
}

/** 多文件合并模式的"映射确认"步：逐文件展示自动识别结果（合并模式下列映射不可逐列编辑）。 */
export default function MergeSummaryPanel({ perFile }: Props) {
  const { t } = useI18n();
  const okCount = perFile.filter((f) => f.ok).length;
  return (
    <div className="card">
      <h2>
        {t('合并 {0} 个文件', [perFile.length])}<span className="hint">{t("每个文件已独立识别列映射；同样本同基因的复孔将跨板汇总")}</span>
      </h2>
      <div className="merge-list">
        {perFile.map((f) => (
          <div key={f.fileName} className={`merge-row ${f.ok ? '' : 'merge-bad'}`}>
            <span>{f.ok ? '✅' : '⛔'}</span>
            <div style={{ flex: 1 }}>
              <div>
                <strong>{f.fileName}</strong>
                <span className="hint" style={{ marginLeft: 8 }}>
                  {t('板名「{0}」 · 表头第 {1} 行 · {2} 行数据', [f.plate, f.headerRow + 1, f.rowCount])}</span>
              </div>
              {f.ok ? (
                <div className="hint-line" style={{ margin: 0 }}>
                  {t("样本列")}{' '}<code>{f.cols.sample}</code> {' '}{t("· 基因列")}{' '}<code>{f.cols.target}</code> {' '}{t("· Cq 列")}{' '}
                  <code>{f.cols.cq}</code>
                </div>
              ) : (
                <div style={{ color: 'var(--danger)', fontSize: '0.86rem' }}>{t(f.problem ?? "")}</div>
              )}
            </div>
          </div>
        ))}
      </div>
      {okCount < perFile.length && (
        <p className="hint-line" style={{ color: 'var(--warning)' }}>
          {t("有文件未能识别必需列，已被跳过。如需修正，请单独重新上传该文件（单文件模式可手动调列映射）。")}</p>
      )}
      <p className="hint-line">
        {t("合并语义：复孔聚合与 ΔCt 计算都在合并后的数据上进行——例如内参在板 1、目标基因在板 2 时，同一样本的两者会自动配对。")}</p>
    </div>
  );
}
