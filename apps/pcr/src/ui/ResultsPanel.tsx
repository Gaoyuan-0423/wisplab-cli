import { useI18n } from '../i18n';
import { useEffect, useMemo, useState } from 'react';
import type { AnalysisOutput, SampleTargetResult } from '../core/types';
import { formatP } from '../core/stats';
import {
  downloadCsv,
  downloadSvg,
  downloadSvgAsPng,
  downloadWorkbook,
  buildWorkbook,
  resultAoa,
  downloadBlob,
} from '../core/export';
import { DEFAULT_CHART_OPTIONS, type ChartOptions } from '../core/chart-options';
import { buildBarsForGene } from '../core/chart-bars';
import { multiGeneChartSvg } from '../core/chart-svg';
import { getYAxisBreakError, suggestYAxisBreak } from '../core/chart-break';
import { buildPrismPzfx } from '../core/pzfx';

interface Props {
  out: AnalysisOutput;
  fileName: string;
  rows: import('../core/analysis').AnalysisRow[];
  flags: import('../core/types').QcFlags;
  autoReport?: import('../core/auto').QualityReport | null;
  guessBasis?: string;
  autoMelt?: import('../core/melt').MeltGeneSummary[];
}

const SEVERITY_LABEL: Record<string, { zh: string; cls: string }> = {
  error: { zh: '严重', cls: 'sev-error' },
  warning: { zh: '警告', cls: 'sev-warning' },
  info: { zh: '提示', cls: 'sev-info' },
};

function ChartNumberInput({ value, min, max, step = 1, onValueChange }: {
  value: number; min: number; max: number; step?: number; onValueChange: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  function commit() {
    const parsed = draft.trim() === '' ? value : Number(draft);
    const next = Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : value;
    setDraft(String(next));
    onValueChange(next);
  }
  return <input type="number" min={min} max={max} step={step} value={draft}
    onChange={(e) => {
      const raw = e.target.value;
      setDraft(raw);
      const parsed = Number(raw);
      // 允许先输入 2 再输入 4 得到 24，不能把编辑中的 2 立即改成最小值 8。
      if (raw.trim() !== '' && Number.isFinite(parsed) && parsed >= min && parsed <= max) onValueChange(parsed);
    }}
    onBlur={commit}
    onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
  />;
}

export default function ResultsPanel({ out, fileName, rows, flags, autoReport, guessBasis, autoMelt }: Props) {
  const { t, language } = useI18n();
  const genes = useMemo(() => [...new Set(out.results.map((r) => r.target))], [out.results]);
  const [gene, setGene] = useState(genes[0] ?? '');
  const [multiGene, setMultiGene] = useState(false);
  const [selectedGenes, setSelectedGenes] = useState<Set<string>>(new Set());
  const [chartOpts, setChartOpts] = useState<ChartOptions>(DEFAULT_CHART_OPTIONS);
  const [aspectRatio, setAspectRatio] = useState('custom');

  const activeGene = genes.includes(gene) ? gene : genes[0] ?? '';

  // 样本 → 组别 映射（名称修改处展示）
  const sampleGroup = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of out.results) {
      if (r.group && !m.has(r.sample)) m.set(r.sample, r.group);
    }
    return m;
  }, [out.results]);

  // 每样本颜色：对照用 controlColor，处理组统一 groupColor
  const colorFor = (r: SampleTargetResult): string =>
    r.isControl ? chartOpts.controlColor : chartOpts.groupColor;

  const geneResults = out.results.filter((r) => r.target === activeGene);

  // 多基因模式下的入图基因（默认全部选中）
  const chartGenes = useMemo(() => {
    if (!multiGene) return [activeGene];
    const chosen = genes.filter((g) => selectedGenes.has(g));
    return chosen.length > 0 ? chosen : genes;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [multiGene, genes, selectedGenes, activeGene]);

  function baseName(): string {
    const genesTag = multiGene ? 'multi' : activeGene;
    return (fileName.replace(/\.[^.]+$/, '') || 'pcr-workbench') + `-${genesTag || 'results'}`;
  }

  // 图表段（单基因或多基因分段）
  const segments = useMemo(() => {
    return chartGenes
      .filter(Boolean)
      .map((g) => ({
        gene: chartOpts.geneLabelOverrides[g] || g,
        bars: buildBarsForGene(
          out.results.filter((r) => r.target === g),
          chartOpts,
          colorFor,
        ),
      }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [out.results, chartGenes, chartOpts]);

  const svgString = useMemo(() => {
    return multiGeneChartSvg(segments, chartOpts, t('相对表达量图'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segments, chartOpts, t]);

  const chartValues = segments.flatMap((segment) => segment.bars.flatMap((bar) =>
    [bar.value, bar.value - bar.err, bar.value + bar.err],
  ));
  const breakError = getYAxisBreakError(chartOpts.yBreak, chartOpts.yMin ?? 0);
  const omittedEndpoints = chartOpts.yBreak && !breakError
    ? chartValues.filter((value) => value > chartOpts.yBreak!.bottomMax && value < chartOpts.yBreak!.topMin).length
    : 0;

  function recommendBreak() {
    setChartOpts({
      ...chartOpts,
      yScale: 'linear',
      yBreak: suggestYAxisBreak(chartValues, chartOpts.yMin ?? 0),
    });
  }

  function resizeChart(dimension: 'width' | 'height', value: number, ratio = aspectRatio) {
    if (ratio === 'custom') {
      setChartOpts({ ...chartOpts, [dimension]: Math.min(dimension === 'width' ? 2400 : 1600, Math.max(dimension === 'width' ? 400 : 260, value)) });
      return;
    }
    const [w, h] = ratio.split(':').map(Number);
    const r = w / h;
    const wantedWidth = dimension === 'width' ? value : value * r;
    const width = Math.round(Math.min(2400, 1600 * r, Math.max(400, 260 * r, wantedWidth)));
    setChartOpts({ ...chartOpts, width, height: Math.round(width / r) });
  }

  // 统计学方法脚注（图片下方文字，不画进图）
  const methodNote = useMemo(() => {
    const methods = [...new Set(out.results.filter((r) => !r.isControl).map((r) => r.statMethod).filter(Boolean))];
    if (methods.length === 0) return null;
    return t('统计学方法：') + methods.map((method) => t(method)).join(language === 'en' ? '; ' : '；') + t('；误差棒 = ') + (chartOpts.errorBar === 'sem' ? 'SEM' : chartOpts.errorBar === 'none' ? t('无') : 'SD') + (language === 'en' ? '.' : '。');
  }, [out.results, chartOpts.errorBar, language, t]);

  // 图上柱子的样本显示名覆盖（唯一样本列表）
  const chartSamples = useMemo(
    () => [...new Set(out.results.map((r) => r.sample))],
    [out.results],
  );

  function exportExcel() {
    const wb = buildWorkbook(out, rows, flags, {
      fileName,
      refGenes: out.refGenesUsed,
      controlSamples: out.controlSamples,
      efficiencies: out.efficiencies,
      melt: autoMelt,
    }, language);
    downloadWorkbook(wb, baseName() + '.xlsx');
  }

  function exportPng() {
    void downloadSvgAsPng(svgString, baseName() + '.png').catch((e) => alert(t(e instanceof Error ? e.message : String(e))));
  }

  function exportPrism() {
    const xml = buildPrismPzfx(out.results, {
      projectName: fileName,
      refGenes: out.refGenesUsed,
      controlSamples: out.controlSamples,
    });
    downloadBlob(xml, baseName() + '-prism.pzfx', 'application/xml');
  }

  return (
    <div>
      {autoReport && (
        <div className="card report-card">
          <div className="report-head">
            <div
              className="score-ring"
              style={{ backgroundImage: `conic-gradient(${autoReport.score >= 85 ? '#16a34a' : autoReport.score >= 60 ? '#d97706' : '#dc2626'} ${autoReport.score * 1}%, #e8eef0 0)` }}
            >
              <span className="score-num">{autoReport.score}</span>
              <span className="score-cap">{t("质量分")}</span>
            </div>
            <div className="report-summary">
              <h2 style={{ marginBottom: 4 }}>{t("🪄 一键智能分析报告")}</h2>
              <p>{t(autoReport.summary)}</p>
              {guessBasis && (
                <p className="hint-line">{t('实验配置为自动推断（{0}）。可在第 3 步调整后重新计算。', [t(guessBasis)])}</p>
              )}
            </div>
          </div>
          {autoReport.issues.length > 0 && (
            <div className="report-section">
              <strong>{t('发现的问题（{0}）', [autoReport.issues.length])}</strong>
              <ul className="issue-list">
                {autoReport.issues.map((i, idx) => (
                  <li key={idx} className={SEVERITY_LABEL[i.severity]?.cls}>
                    <span className="sev-chip">{t(SEVERITY_LABEL[i.severity]?.zh ?? i.severity)}</span>
                    <span>{t(i.message)}</span>
                    {i.target && <code>{i.target}</code>}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {autoReport.advice.length > 0 && (
            <div className="report-section">
              <strong>{t('优化方向（{0}）', [autoReport.advice.length])}</strong>
              <ul className="advice-list">
                {autoReport.advice.map((a, idx) => (
                  <li key={idx}>💡 {t(a.message)}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
      {autoMelt && autoMelt.length > 0 && (
        <div className="card">
          <h2>
            {t("熔解曲线检查")}<span className="hint">{t("由 RDML 原始熔解数据峰检测；多峰提示非特异扩增或引物二聚体")}</span>
          </h2>
          <div className="std-list">
            {autoMelt.map((m) => (
              <div className={`std-row ${m.multi.length > 0 ? 'std-warn' : 'std-good'}`} key={m.gene}>
                <strong>{m.gene}</strong>
                <span>
                  {m.checked} {' '}{t("孔：单峰")}{' '}{m.single} {' '}{t("· 多峰")}{' '}{m.multi.length}
                  {m.multi.length > 0 && m.multi[0].tm != null ? `（${m.multi.map((w) => `${w.well}@${w.tm}°C`).join('、')}）` : ''} {' '}{t("· 无峰")}{' '}{m.none}
                </span>
                <span className="tag" style={{ marginLeft: 'auto' }}>
                  {m.multi.length > 0 ? t("⚠️ 建议跑胶确认产物特异性") : t("✓ 通过")}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
      {out.warnings.length > 0 && (
        <div className="warning-banner">
          {out.warnings.map((w, i) => (
            <div key={i}>⚠️ {t(w)}</div>
          ))}
        </div>
      )}

      <div className="card">
        <h2>
          {t("ΔΔCt 结果表")}<span className="hint">
            {out.effMode ? t("Pfaffl 效率校正 · ") : 'Livak 2^-ΔΔCt · '}
            {t("统计基于每个生物学重复的 ΔCt")}</span>
        </h2>
        <div className="results-toolbar">
          <div className="gene-tabs" role="tablist" aria-label={t("选择基因")}>
            {genes.map((g) => (
              <button key={g} className={g === activeGene ? 'on' : ''} onClick={() => setGene(g)}>
                {g}
              </button>
            ))}
          </div>
          <span style={{ flex: 1 }} />
          <button className="primary" onClick={exportExcel}>
            {t("导出 Excel（多表，含 ΔΔCt）")}</button>
          <button onClick={() => downloadCsv(resultAoa(out, language), baseName() + '.csv')}>{t("导出结果 CSV")}</button>
        </div>

        <div className="preview-wrap" style={{ maxHeight: 420 }}>
          <table className="results">
            <thead>
              <tr>
                <th>{t("样本")}</th>
                <th>{t("组别")}</th>
                <th>n</th>
                <th>{t("平均 Cq")}</th>
                <th>{t("内参 Cq")}</th>
                <th>ΔCt</th>
                <th>ΔΔCt</th>
                <th>Fold Change</th>
                <th>{t("p 值（总体）")}</th>
                <th>Dunnett p</th>
                <th>{t("显著性")}</th>
                <th>{t("统计方法")}</th>
              </tr>
            </thead>
            <tbody>
              {geneResults.map((r) => (
                <tr key={r.sample + r.target} className={r.isControl ? 'ctrl' : ''}>
                  <td>
                    {r.isControl && t("对照 · ")}
                    {r.sample}
                  </td>
                  <td>{r.group || '—'}</td>
                  <td>{r.n}</td>
                  <td>{fmt(r.meanCq)}</td>
                  <td>{fmt(r.refCq)}</td>
                  <td>{fmt(r.deltaCt)}</td>
                  <td>{fmt(r.ddCt)}</td>
                  <td>
                    {fmt(r.foldChange)}±{fmt(r.fcSd)}
                  </td>
                  <td>{formatP(r.pValue)}</td>
                  <td>{formatP(r.pAdjusted)}</td>
                  <td className="sig">{r.significance || '—'}</td>
                  <td style={{ fontSize: '0.78rem', color: 'var(--muted-text)' }}>{t(r.statMethod || '—')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card chart-box">
        <h2>
          {t("柱状图")}{chartOpts.title ? `——${chartOpts.title}` : multiGene ? t("（多基因分段）") : language === 'en' ? ` (${activeGene})` : `（${activeGene}）`}
          <span className="hint">{t("均值 ±")}{' '}{chartOpts.errorBar === 'sem' ? 'SEM' : chartOpts.errorBar === 'none' ? t("无") : 'SD'}</span>
        </h2>

        <div className="chart-settings">
          <div style={{ fontWeight: 600, fontSize: '0.9rem', marginBottom: 8, color: 'var(--primary-dark)' }}>
            {t("⚙️ 图表设置")}</div>
          <div className="chart-settings-grid">
            <label>
              {t("标题")}<input type="text" value={chartOpts.title} placeholder={t("留空 = 基因名")} onChange={(e) => setChartOpts({ ...chartOpts, title: e.target.value })} />
            </label>
            <label>
              {t("副标题")}<input type="text" value={chartOpts.subtitle} placeholder={t("留空 = 不显示")} onChange={(e) => setChartOpts({ ...chartOpts, subtitle: e.target.value })} />
            </label>
            <label>
              {t("Y 轴标题")}<input type="text" value={chartOpts.yLabel} onChange={(e) => setChartOpts({ ...chartOpts, yLabel: e.target.value })} />
            </label>
            <label>
              {t("X 轴标题")}<input type="text" value={chartOpts.xLabel} placeholder={t("留空 = 不显示")} onChange={(e) => setChartOpts({ ...chartOpts, xLabel: e.target.value })} />
            </label>
            <label>
              {t("Y 轴下限")}<input type="number" step="any" placeholder={t("自动")} value={chartOpts.yMin ?? ''} onChange={(e) => setChartOpts({ ...chartOpts, yMin: e.target.value.trim() === '' ? null : Number(e.target.value) })} />
            </label>
            <label>
              {t("Y 轴上限")}<input type="number" step="any" placeholder={chartOpts.yBreak ? t("由断轴的上段上限决定") : t("自动")} disabled={!!chartOpts.yBreak} value={chartOpts.yBreak ? '' : chartOpts.yMax ?? ''} onChange={(e) => setChartOpts({ ...chartOpts, yMax: e.target.value.trim() === '' ? null : Number(e.target.value) })} />
            </label>
            <label>
              {t("误差棒")}<select value={chartOpts.errorBar} onChange={(e) => setChartOpts({ ...chartOpts, errorBar: e.target.value as 'sd' | 'sem' | 'none' })}>
                <option value="sd">SD</option>
                <option value="sem">SEM</option>
                <option value="none">{t("不显示")}</option>
              </select>
            </label>
            <label>
              {t("Y 轴刻度")}<select value={chartOpts.yScale} onChange={(e) => setChartOpts({ ...chartOpts, yScale: e.target.value as 'linear' | 'log2' | 'log10', yBreak: e.target.value === 'linear' ? chartOpts.yBreak : null })}>
                <option value="linear">{t("线性")}</option>
                <option value="log2">log2</option>
                <option value="log10">log10</option>
              </select>
            </label>
            <label>
              {t("显著性标注")}<select value={chartOpts.showP} onChange={(e) => setChartOpts({ ...chartOpts, showP: e.target.value as 'stars' | 'p' | 'both' | 'none' })}>
                <option value="stars">{t("星号（*/**/***）")}</option>
                <option value="p">{t("p 值")}</option>
                <option value="both">{t("星号 + p 值")}</option>
                <option value="none">{t("不显示")}</option>
              </select>
            </label>
            <label>
              {t("对照柱颜色")}<input type="color" value={chartOpts.controlColor} onChange={(e) => setChartOpts({ ...chartOpts, controlColor: e.target.value })} />
            </label>
            <label>
              {t("处理柱颜色")}<input type="color" value={chartOpts.groupColor} onChange={(e) => setChartOpts({ ...chartOpts, groupColor: e.target.value })} />
            </label>
            <label>
              {t("图表字体")}<select value={chartOpts.fontFamily} onChange={(e) => setChartOpts({ ...chartOpts, fontFamily: e.target.value as ChartOptions['fontFamily'] })}>
                <option value="sans-serif">{t("默认无衬线")}</option>
                <option value="Times New Roman">Times New Roman</option>
                <option value="Arial">Arial</option>
              </select>
            </label>
            <label>
              {t("字号（px）")}<ChartNumberInput min={8} max={28} value={chartOpts.fontSize} onValueChange={(fontSize) => setChartOpts({ ...chartOpts, fontSize })} />
            </label>
            <label>
              {t("组内总宽度（%）")}<ChartNumberInput min={20} max={100} step={5} value={Math.round(chartOpts.groupWidth * 100)} onValueChange={(value) => setChartOpts({ ...chartOpts, groupWidth: value / 100 })} />
            </label>
            <label>
              {t("图例位置")}<select value={chartOpts.legendPosition} disabled={segments.filter((segment) => segment.bars.length > 0).length < 2} onChange={(e) => setChartOpts({ ...chartOpts, legendPosition: e.target.value as ChartOptions['legendPosition'] })}>
                <option value="right">{t("右侧")}</option>
                <option value="top">{t("上方")}</option>
                <option value="bottom">{t("下方")}</option>
                <option value="left">{t("左侧")}</option>
                <option value="none">{t("隐藏")}</option>
              </select>
            </label>
            <label>
              {t("图片比例")}<select value={aspectRatio} onChange={(e) => { setAspectRatio(e.target.value); resizeChart('width', chartOpts.width, e.target.value); }}>
                <option value="custom">{t("自由设置")}</option>
                <option value="1:1">{t("1:1 · 正方形")}</option>
                <option value="4:3">{t("4:3 · 横图")}</option>
                <option value="3:2">{t("3:2 · 横图")}</option>
                <option value="16:9">{t("16:9 · 宽图")}</option>
                <option value="3:4">{t("3:4 · 竖图")}</option>
              </select>
            </label>
            <label>
              {t("整体缩放（%）")}<ChartNumberInput min={50} max={200} step={10} value={Math.round(chartOpts.imageScale * 100)} onValueChange={(value) => setChartOpts({ ...chartOpts, imageScale: value / 100 })} />
            </label>
            <label>
              {t("图宽（px）")}<ChartNumberInput min={400} max={2400} value={chartOpts.width} onValueChange={(value) => resizeChart('width', value)} />
            </label>
            <label>
              {t("图高（px）")}<ChartNumberInput min={260} max={1600} value={chartOpts.height} onValueChange={(value) => resizeChart('height', value)} />
            </label>
          </div>
          <p className="chart-setting-hint">{t("组内总宽度控制柱簇占每个基因位置的比例。选定图片比例后，宽高同步变化；整体缩放同时缩放字体和线条。单基因不显示图例。")}</p>
          <div className="chart-break-settings">
            <label className="chart-break-toggle">
              <input type="checkbox" checked={!!chartOpts.yBreak} disabled={chartOpts.yScale !== 'linear'} onChange={(e) => e.target.checked ? recommendBreak() : setChartOpts({ ...chartOpts, yBreak: null })} />
              {t("启用 Y 轴断轴")}</label>
            <p className="chart-setting-hint">{t("省略中间一段数值，同时保留高柱顶部和误差棒。仅适用于线性刻度。")}</p>
            {chartOpts.yBreak && (
              <>
                <div className="chart-settings-grid">
                  <label>
                    {t("省略区间起点")}<input type="number" step="any" value={chartOpts.yBreak.bottomMax} onChange={(e) => setChartOpts({ ...chartOpts, yBreak: { ...chartOpts.yBreak!, bottomMax: Number(e.target.value) } })} />
                  </label>
                  <label>
                    {t("省略区间终点")}<input type="number" step="any" value={chartOpts.yBreak.topMin} onChange={(e) => setChartOpts({ ...chartOpts, yBreak: { ...chartOpts.yBreak!, topMin: Number(e.target.value) } })} />
                  </label>
                  <label>
                    {t("上段上限")}<input type="number" step="any" value={chartOpts.yBreak.topMax} onChange={(e) => setChartOpts({ ...chartOpts, yBreak: { ...chartOpts.yBreak!, topMax: Number(e.target.value) } })} />
                  </label>
                  <label>
                    {t("下段高度占比（%）")}<input type="number" min={10} max={90} step={5} value={chartOpts.yBreak.bottomPct} onChange={(e) => setChartOpts({ ...chartOpts, yBreak: { ...chartOpts.yBreak!, bottomPct: Number(e.target.value) } })} />
                  </label>
                </div>
                <div className="chart-break-summary">
                  <button type="button" onClick={recommendBreak}>{t("按数据推荐断轴")}</button>
                  {!breakError && <span>{t("显示")}{' '}{chartOpts.yMin ?? 0}–{chartOpts.yBreak.bottomMax} {' '}{t("和")}{' '}{chartOpts.yBreak.topMin}–{chartOpts.yBreak.topMax}{t("；中间区间省略。")}</span>}
                </div>
                {breakError && <p role="alert" className="chart-setting-error">{t(breakError ?? "")} {' '}{t("修正后可导出；当前预览暂用连续坐标轴。")}</p>}
                {!!omittedEndpoints && <p className="chart-setting-hint">{t("有柱顶或误差棒端点落在省略区间内；可调整区间，或点击「按数据推荐断轴」完整显示这些端点。")}</p>}
              </>
            )}
          </div>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 10, fontSize: '0.88rem' }}>
            <input type="checkbox" checked={multiGene} onChange={(e) => setMultiGene(e.target.checked)} />
            {t("合并多基因作图（分段柱状图：每基因一段，段内为各样本 vs 对照）")}</label>
          {multiGene && (
            <div className="gene-multiselect">
              <span style={{ fontSize: '0.84rem', color: 'var(--muted-text)' }}>{t("入图基因：")}</span>
              {genes.map((g) => (
                <label key={g} style={{ display: 'inline-flex', gap: 4, alignItems: 'center', marginRight: 12, fontSize: '0.85rem' }}>
                  <input
                    type="checkbox"
                    checked={selectedGenes.size === 0 ? true : selectedGenes.has(g)}
                    onChange={(e) => {
                      const next = new Set(selectedGenes.size === 0 ? genes : selectedGenes);
                      if (e.target.checked) next.add(g);
                      else if (next.size > 1) next.delete(g); // 至少保留一个
                      setSelectedGenes(next);
                    }}
                  />
                  {g}
                </label>
              ))}
            </div>
          )}
          <div className="gene-multiselect" style={{ marginTop: 10 }}>
            <span style={{ fontSize: '0.84rem', color: 'var(--muted-text)' }}>
              {segments.length > 1 ? t("组别名称修改（图例显示名）：") : t("名称修改（柱子下方显示名）：")}
            </span>
            {chartSamples.map((s) => (
              <span key={s} style={{ display: 'inline-flex', gap: 4, alignItems: 'center', marginRight: 10 }}>
                <input
                  type="text"
                  className="label-input"
                  value={chartOpts.labelOverrides[s] ?? s}
                  onChange={(e) => {
                    const next = { ...chartOpts.labelOverrides };
                    next[s] = e.target.value; // 允许临时清空，失焦时回落默认名
                    setChartOpts({ ...chartOpts, labelOverrides: next });
                  }}
                  onBlur={(e) => {
                    if (e.target.value.trim() === '') {
                      const next = { ...chartOpts.labelOverrides };
                      delete next[s];
                      setChartOpts({ ...chartOpts, labelOverrides: next });
                    }
                  }}
                  aria-label={t("修改 ") + s + t(" 的显示名")}
                />
                {sampleGroup.get(s) && (
                  <span style={{ fontSize: '0.76rem', color: 'var(--muted-text)' }}>{sampleGroup.get(s)}</span>
                )}
              </span>
            ))}
          </div>
          {multiGene && (
            <div className="gene-multiselect" style={{ marginTop: 10 }}>
              <span style={{ fontSize: '0.84rem', color: 'var(--muted-text)' }}>{t("基因名称修改（段下方显示名）：")}</span>
              {genes.map((g) => (
                <span key={g} style={{ display: 'inline-flex', gap: 4, alignItems: 'center', marginRight: 10 }}>
                  <input
                    type="text"
                    className="label-input"
                    value={chartOpts.geneLabelOverrides[g] ?? g}
                    onChange={(e) => {
                      const next = { ...chartOpts.geneLabelOverrides };
                      next[g] = e.target.value; // 允许临时清空，失焦时回落默认名
                      setChartOpts({ ...chartOpts, geneLabelOverrides: next });
                    }}
                    onBlur={(e) => {
                      if (e.target.value.trim() === '') {
                        const next = { ...chartOpts.geneLabelOverrides };
                        delete next[g];
                        setChartOpts({ ...chartOpts, geneLabelOverrides: next });
                      }
                    }}
                    aria-label={t("修改 ") + g + t(" 的显示名")}
                  />
                </span>
              ))}
            </div>
          )}
        </div>

        <div
          className="chart-preview"
          // SVG 字符串由本仓库生成器产出（内容已转义）
          dangerouslySetInnerHTML={{ __html: svgString }}
        />
        {methodNote && (
          <p className="method-caption">{methodNote}</p>
        )}

        <div className="row-actions">
          <button disabled={!!breakError} onClick={() => downloadSvg(svgString, baseName() + '.svg')}>{t("导出 SVG（矢量）")}</button>
          <button className="primary" disabled={!!breakError} onClick={exportPng}>
            {t("导出 PNG")}</button>
          <span style={{ flex: 1 }} />
          <button onClick={exportPrism}>{t("导出 Prism 工程（.pzfx）")}</button>
        </div>
      </div>
    </div>
  );
}

function fmt(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return String(Math.round(v * 1000) / 1000);
}
