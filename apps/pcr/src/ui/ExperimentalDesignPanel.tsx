import { useMemo } from 'react';
import { isNtcRow, isStandardRow, type AnalysisRow } from '../core/analysis';
import type { AnalysisConfig, ExperimentalDesign, ExperimentalUnitAssignment } from '../core/types';
import { useI18n } from '../i18n';

export default function ExperimentalDesignPanel({ rows, config, onConfig }: {
  rows: AnalysisRow[]; config: AnalysisConfig; onConfig: (next: AnalysisConfig) => void;
}) {
  const { t } = useI18n();
  const assignments = useMemo(() => {
    const sources = new Map<string, AnalysisRow[]>();
    for (const row of rows) {
      if (!row.sample || isNtcRow(row) || isStandardRow(row)) continue;
      const key = JSON.stringify([row.plate, row.sample]);
      sources.set(key, [...(sources.get(key) ?? []), row]);
    }
    const usedIds = new Set(config.experimentalDesign?.assignments.map((a) => a.unitId) ?? []);
    return [...sources.values()].map((source): ExperimentalUnitAssignment => {
      const { plate, sample } = source[0];
      const saved = config.experimentalDesign?.assignments.find((a) => a.plate === plate && a.sample === sample);
      if (saved) return saved;
      const groups = [...new Set(source.map((r) => r.group).filter(Boolean))];
      const baseId = plate ? `${plate} / ${sample}` : sample;
      let unitId = baseId;
      for (let suffix = 2; usedIds.has(unitId); suffix++) unitId = `${baseId} (${suffix})`;
      usedIds.add(unitId);
      return { plate, sample, unitId,
        group: groups.length === 1 ? groups[0] : config.controlSamples.includes(sample) ? 'Control' : '' };
    });
  }, [rows, config.experimentalDesign, config.controlSamples]);
  const draft: ExperimentalDesign = config.experimentalDesign ?? {
    kind: 'independent', confirmed: false, controlGroup: '', assignments,
  };
  const groups = [...new Set(assignments.map((a) => a.group.trim()).filter(Boolean))];
  const canConfirm = draft.kind === 'independent' && assignments.length > 0
    && assignments.every((a) => a.unitId.trim() && a.group.trim())
    && groups.includes(draft.controlGroup) && groups.length >= 2;
  function update(patch: Partial<ExperimentalDesign>) {
    onConfig({ ...config, experimentalDesign: { ...draft, assignments, ...patch, confirmed: false } });
  }
  function edit(index: number, patch: Partial<ExperimentalUnitAssignment>) {
    update({ assignments: assignments.map((a, i) => i === index ? { ...a, ...patch } : a) });
  }
  return <section className="card" aria-label={t('实验单位与分组')}>
    <h2>{t('实验单位与分组')}</h2>
    <p className="hint-line">{t('先核对每个板号与样本对应的独立实验单位。名称是填写建议，不代表已经确认独立性；同一单位的技术测量使用相同 ID。')}</p>
    <div className="config-grid">
      <label>{t('实验设计')}
        <select value={draft.kind} onChange={(e) => update({ kind: e.target.value as ExperimentalDesign['kind'] })}>
          <option value="independent">{t('独立组设计')}</option>
          <option value="paired">{t('配对设计（当前仅描述）')}</option>
          <option value="repeated">{t('重复测量设计（当前仅描述）')}</option>
        </select>
      </label>
      <label>{t('推断统计的对照组')}
        <select value={draft.controlGroup} onChange={(e) => update({ controlGroup: e.target.value })}>
          <option value="">{t('请选择组别')}</option>
          {groups.map((group) => <option key={group} value={group}>{group}</option>)}
        </select>
      </label>
    </div>
    <div className="preview-wrap" style={{ maxHeight: 360 }}><table className="results">
      <thead><tr><th>{t('板号')}</th><th>{t('样本 ID')}</th><th>{t('独立单位 ID')}</th><th>{t('组别')}</th></tr></thead>
      <tbody>{assignments.map((a, index) => <tr key={JSON.stringify([a.plate, a.sample])}>
        <td>{a.plate || '—'}</td><td>{a.sample}</td>
        <td><input aria-label={`${t('独立单位 ID')} ${a.plate} ${a.sample}`} value={a.unitId} onChange={(e) => edit(index, { unitId: e.target.value })} /></td>
        <td><input aria-label={`${t('组别')} ${a.plate} ${a.sample}`} value={a.group} onChange={(e) => edit(index, { group: e.target.value })} /></td>
      </tr>)}</tbody>
    </table></div>
    <label className="hint-line" style={{ display: 'block', marginTop: 12 }}>
      <input type="checkbox" checked={draft.confirmed} disabled={!canConfirm && !draft.confirmed}
        onChange={(e) => onConfig({ ...config, experimentalDesign: { ...draft,
          assignments: assignments.map((a) => ({ ...a, unitId: a.unitId.trim(), group: a.group.trim() })),
          confirmed: e.target.checked } })} />
      {' '}{t('我已核对独立单位、技术重复与组别，确认使用独立组统计。')}
    </label>
    <p className="hint-line">{t('未确认或不支持的设计只提供表达量描述，不生成组间 p 值。修改设计后需要重新确认。')}</p>
  </section>;
}
