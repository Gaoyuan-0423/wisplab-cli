import { useI18n } from '../i18n';
import { useMemo } from 'react';
import type { AnalysisRow } from '../core/analysis';
import { isFlagged, isNtcRow, isStandardRow, NTC_CONTAMINATION_CQ } from '../core/analysis';
import { collectStandardPoints, fitStandardCurve, type StandardCurve } from '../core/standard';
import type { MeltTableState } from '../core/melt';
import { detectPlateLayout, parseWell } from '../core/plate';
import type { AnalysisConfig, NtcReportEntry, QcFlags, QcSettings } from '../core/types';
import PlateView, { type PlateCell, type PlateGrid } from './PlateView';
import MeltTableCard from './MeltTableCard';

interface Props {
  rows: AnalysisRow[];
  flags: QcFlags;
  config: AnalysisConfig;
  onConfig: (c: AnalysisConfig) => void;
  excluded: Record<number, boolean>;
  onExcluded: (next: Record<number, boolean>) => void;
  meltTable: MeltTableState | null;
  onMeltTableFile: (file: File) => Promise<void>;
}

function numOrNull(v: string): number {
  if (v.trim() === '') return NaN;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

export default function ConfigPanel({ rows, flags, config, onConfig, excluded, onExcluded, meltTable, onMeltTableFile }: Props) {
  const { t, language } = useI18n();
  const nonNtcRows = useMemo(() => rows.filter((r) => !isNtcRow(r)), [rows]);
  const samples = useMemo(
    () => [...new Set(nonNtcRows.filter((r) => !isStandardRow(r)).map((r) => r.sample).filter(Boolean))].sort(),
    [nonNtcRows],
  );
  const genes = useMemo(() => [...new Set(rows.map((r) => r.target).filter(Boolean))].sort(), [rows]);
  const ntcCount = rows.length - nonNtcRows.length;

  const plates = useMemo<PlateGrid[]>(() => {
    const byPlate = new Map<string, AnalysisRow[]>();
    for (const r of rows) {
      const key = r.plate || '';
      byPlate.set(key, [...(byPlate.get(key) ?? []), r]);
    }
    const out: PlateGrid[] = [];
    for (const [name, prows] of byPlate) {
      const layout = detectPlateLayout(prows.map((r) => r.well).filter(Boolean));
      if (!layout) continue;
      const cells = new Map<string, PlateCell>();
      for (const r of prows) {
        if (!parseWell(r.well)) continue;
        cells.set(wellKey(r.well), {
          sample: r.sample,
          target: r.target,
          excluded: excluded[r.id] ?? false,
          flagged: isFlagged(flags, r.id),
          isNtc: isNtcRow(r),
        });
      }
      out.push({ name, layout, cells });
    }
    return out;
  }, [rows, excluded, flags]);

  // 标准曲线拟合：每基因独立计算，点「应用」写入该基因效率（Pfaffl）
  const stdFits = useMemo<{ gene: string; curve: StandardCurve; applied: boolean; points: number }[]>(() => {
    const out: { gene: string; curve: StandardCurve; applied: boolean; points: number }[] = [];
    for (const [gene, points] of collectStandardPoints(rows)) {
      const curve = fitStandardCurve(points);
      if (!curve) continue;
      const applied = Math.abs((config.efficiencies?.[gene] ?? 100) - curve.effPct) < 0.15;
      out.push({ gene, curve, applied, points: points.length });
    }
    return out.sort((a, b) => a.gene.localeCompare(b.gene));
  }, [rows, config.efficiencies]);

  function applyStdCurve(gene: string, curve: StandardCurve) {
    onConfig({
      ...config,
      efficiencies: { ...(config.efficiencies ?? {}), [gene]: Math.round(curve.effPct * 10) / 10 },
    });
  }

  // NTC 检查预览：不依赖对照组/内参配置，直接按当前数据逐基因给出结论
  const ntcPreview = useMemo<NtcReportEntry[]>(() => {
    const genesWithData = [...new Set(nonNtcRows.map((r) => r.target).filter(Boolean))];
    const report: NtcReportEntry[] = [];
    for (const g of genesWithData) {
      const wells = rows.filter((r) => isNtcRow(r) && r.target === g);
      if (wells.length === 0) continue;
      const cqs = wells.map((r) => r.cq).filter((v) => Number.isFinite(v));
      const minCq = cqs.length ? Math.min(...cqs) : null;
      let verdict: NtcReportEntry['verdict'] = 'pass';
      let message = `NTC 无扩增（${wells.length} 孔），无污染迹象`;
      if (minCq !== null) {
        if (minCq < NTC_CONTAMINATION_CQ) {
          verdict = 'contaminated';
          message = `NTC 提前扩增（最低 Cq ${minCq.toFixed(1)}）——疑似污染，建议重做`;
        } else {
          verdict = 'late';
          message = `NTC 晚期扩增（最低 Cq ${minCq.toFixed(1)}）——通常无害`;
        }
      }
      report.push({
        target: g,
        wells: wells.map((r) => r.well).filter(Boolean),
        amplified: cqs.length,
        minCq,
        verdict,
        message,
      });
    }
    return report.sort((a, b) => a.target.localeCompare(b.target));
  }, [rows, nonNtcRows]);

  const flaggedRows = rows.filter((r) => isFlagged(flags, r.id) && !excluded[r.id]);
  const flagCount = Object.keys(flags).length;
  const excludedCount = Object.values(excluded).filter(Boolean).length;

  function toggleWell(plateName: string, well: string) {
    const ids = rows
      .filter((r) => (r.plate || '') === plateName && normalizeWell(r.well) === well)
      .map((r) => r.id);
    const anyIncluded = ids.some((id) => !excluded[id]);
    const next = { ...excluded };
    for (const id of ids) next[id] = anyIncluded;
    onExcluded(next);
  }

  function excludeFlagged() {
    const next = { ...excluded };
    for (const r of flaggedRows) next[r.id] = true;
    onExcluded(next);
  }

  function setQc(patch: Partial<QcSettings>) {
    onConfig({ ...config, qc: { ...config.qc, ...patch } });
  }

  const qcInput = (key: keyof QcSettings, label: string, placeholder: string) => (
    <label>
      {label}
      <input
        type="number"
        step="any"
        placeholder={placeholder}
        value={Number.isFinite(config.qc[key]) ? String(config.qc[key]) : ''}
        onChange={(e) => setQc({ [key]: numOrNull(e.target.value) } as Partial<QcSettings>)}
      />
    </label>
  );

  return (
    <div>
      {plates.length > 0 && (
        <div className="card">
          <h2>
            {t('孔板布局（{0}）', [plates.length > 1 ? t(`${plates.length} 块板合并分析`) : plates[0].layout.kind === '384' ? t('384孔') : plates[0].layout.kind === '96' ? t('96孔') : t('自定义孔')])}
            <span className="hint">{t("点击孔位可剔除 / 恢复整组复孔")}</span>
          </h2>
          <PlateView plates={plates} onToggle={toggleWell} />
        </div>
      )}

      <div className="card">
        <h2>{t("实验配置")}</h2>
        <div className="config-grid">
          <div>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>
              {t("对照组样本")}{' '}<span style={{ color: 'var(--danger)' }}>*</span>
            </div>
            <div className="check-list">
              {samples.map((s) => (
                <label key={s}>
                  <input
                    type="checkbox"
                    checked={config.controlSamples.includes(s)}
                    onChange={(e) => {
                      const next = e.target.checked
                        ? [...config.controlSamples, s]
                        : config.controlSamples.filter((x) => x !== s);
                      onConfig({ ...config, controlSamples: next });
                    }}
                  />
                  {s}
                  <span className="tag">{rows.filter((r) => r.sample === s).length} {' '}{t("孔")}</span>
                </label>
              ))}
            </div>
          </div>
          <div>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>
              {t("内参基因（可多选，池化）")}{' '}<span style={{ color: 'var(--danger)' }}>*</span>
            </div>
            <div className="check-list">
              {genes.map((g) => {
                const geneRows = rows.filter((r) => r.target === g);
                const detected = geneRows.filter((r) => Number.isFinite(r.cq)).length;
                const total = geneRows.length;
                return (
                  <label key={g} title={detected < total ? t(`该基因有 ${total - detected} 孔未检出 Cq，作内参会导致相关样本无法计算`) : undefined}>
                    <input
                      type="checkbox"
                      checked={config.refGenes.includes(g)}
                      onChange={(e) => {
                        const next = e.target.checked
                          ? [...config.refGenes, g]
                          : config.refGenes.filter((x) => x !== g);
                        onConfig({ ...config, refGenes: next });
                      }}
                    />
                    {g}
                    <span className="tag">
                      {detected < total ? t(`⚠️ 检出 ${detected}/${total}`) : t(`${total} 孔`)}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
        </div>

        <div style={{ marginTop: 16 }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>
            {t("扩增效率（Pfaffl 校正，选填）")}<span className="hint" style={{ fontWeight: 400 }}>{t("留空 = 100%（Livak 法）。效率% = (10^(−1/斜率) − 1) × 100，来自标准曲线")}</span>
          </div>
          <div className="eff-grid">
            {genes.map((g) => (
              <label key={g}>
                {g}
                <input
                  type="number"
                  step="any"
                  min={50}
                  max={250}
                  placeholder="100"
                  value={config.efficiencies?.[g] ?? ''}
                  onChange={(e) => {
                    const raw = e.target.value.trim();
                    const next = { ...(config.efficiencies ?? {}) };
                    if (raw === '') delete next[g];
                    else {
                      const v = Number(raw);
                      if (!Number.isFinite(v)) return;
                      next[g] = Math.min(250, Math.max(50, v));
                    }
                    onConfig({ ...config, efficiencies: next });
                  }}
                />
              </label>
            ))}
          </div>
        </div>

        <div style={{ marginTop: 16 }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>{t("QC 规则（留空 = 不启用）")}</div>
          <div className="qc-inputs">
            {qcInput('minCq', t("Cq 下限"), t("如 15"))}
            {qcInput('maxCq', t("Cq 上限"), t("如 35"))}
            {qcInput('absDev', t("复孔绝对偏差上限"), t("如 0.5"))}
            {qcInput('zScore', t("复孔 z 分数阈值"), t("如 1.1（三复孔建议 ≤1.15）"))}
          </div>
        </div>
      </div>

      <div className="card">
        <h2>
          {t("数据 QC")}<span className="hint">{t("标记不影响分析，剔除后才排除")}</span>
        </h2>
        <div className="qc-summary">
          <div className="qc-card">
            <div className="v">{rows.length}</div>
            <div className="l">{t("原始数据行")}</div>
          </div>
          <div className="qc-card">
            <div className="v">{flagCount}</div>
            <div className="l">{t("QC 标记")}</div>
          </div>
          <div className="qc-card">
            <div className="v">{excludedCount}</div>
            <div className="l">{t("已剔除")}</div>
          </div>
          <div className="qc-card">
            <div className="v">{rows.length - excludedCount}</div>
            <div className="l">{t("纳入分析")}</div>
          </div>
        </div>
        {flaggedRows.length > 0 ? (
          <div>
            <div className="qc-flag-list">
              {flaggedRows.map((r) => (
                <div className="qc-flag-row" key={r.id}>
                  <span>
                    <code>{r.well || `#${r.id}`}</code>
                  </span>
                  <span>
                    {r.sample} · {r.target} · Cq={Number.isFinite(r.cq) ? r.cq : '—'}
                  </span>
                  <span className="reasons">{(flags[r.id] ?? []).map((reason) => t(reason)).join(language === 'en' ? '; ' : '；')}</span>
                </div>
              ))}
            </div>
            <div className="row-actions">
              <button className="small danger" onClick={excludeFlagged}>
                {t("剔除全部")}{' '}{flaggedRows.length} {' '}{t("行标记数据")}</button>
              {excludedCount > 0 && (
                <button className="small" onClick={() => onExcluded({})}>
                  {t("恢复全部剔除")}</button>
              )}
            </div>
          </div>
        ) : (
          <p className="empty-note">{t("没有待处理的 QC 标记。")}</p>
        )}
      </div>

      <MeltTableCard rows={rows} meltTable={meltTable} onMeltTableFile={onMeltTableFile} />

      {stdFits.length > 0 && (
        <div className="card">
          <h2>
            {t("标准曲线（自动计算效率）")}<span className="hint">{t("由稀释系列 Cq ~ log10(浓度) 拟合；应用后该基因走 Pfaffl 校正")}</span>
          </h2>
          <div className="std-list">
            {stdFits.map(({ gene, curve, applied, points }) => {
              const good = curve.r2 >= 0.98 && curve.effPct >= 90 && curve.effPct <= 110;
              return (
                <div className={`std-row ${good ? 'std-good' : 'std-warn'}`} key={gene}>
                  <strong>{gene}</strong>
                  <span>
                    {points} {' '}{t("点 · 斜率")}{' '}{curve.slope.toFixed(3)} · R²={curve.r2.toFixed(4)} {' '}{t("· 效率")}{' '}
                    {curve.effPct.toFixed(1)}%
                    {!good && t("（R² 或效率超出常规范围，谨慎使用）")}
                  </span>
                  <button
                    className={`small ${applied ? '' : 'primary'}`}
                    onClick={() => applyStdCurve(gene, curve)}
                    disabled={applied}
                  >
                    {applied ? t("✓ 已应用") : t(`应用 ${curve.effPct.toFixed(1)}%`)}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}
      {ntcPreview.length > 0 && (
        <div className="card">
          <h2>
            {t("NTC 污染检查")}<span className="hint">{t("无模板对照孔；NTC 已自动排除在分析之外")}</span>
          </h2>
          <div className="ntc-list">
            {ntcPreview.map((e) => (
              <div className={`ntc-row ntc-${e.verdict}`} key={e.target}>
                <strong>{e.target}</strong>
                <span className={e.verdict === 'contaminated' ? 'reasons' : ''}>{t(e.message)}</span>
                <span className="tag">{e.wells.length} {' '}{t("孔")}{e.wells.length ? `：${e.wells.join(' ')}` : ''}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {ntcCount > 0 && ntcPreview.length === 0 && (
        <div className="card">
          <h2>
            {t("NTC 污染检查")}<span className="hint">{t("检测到")}{' '}{ntcCount} {' '}{t("个 NTC 孔，但这些孔的基因没有对应样本数据，跳过判定")}</span>
          </h2>
        </div>
      )}
    </div>
  );
}

function wellKey(well: string): string {
  const p = parseWell(well);
  if (!p) return well.trim().toUpperCase();
  return wellNameOf(p.row, p.col);
}

function normalizeWell(well: string): string {
  return wellKey(well);
}

function wellNameOf(row: number, col: number): string {
  let r = row + 1;
  let letters = '';
  while (r > 0) {
    const rem = (r - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    r = Math.floor((r - 1) / 26);
  }
  return `${letters}${col + 1}`;
}
