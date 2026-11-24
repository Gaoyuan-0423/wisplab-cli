import { useI18n } from '../i18n';
import { allWellNames, type PlateLayout } from '../core/plate';

export interface PlateCell {
  sample: string;
  target: string;
  excluded: boolean;
  flagged: boolean;
  isNtc: boolean;
}

export interface PlateGrid {
  /** 板名（单文件无名板为空字符串，不显示标题） */
  name: string;
  layout: PlateLayout;
  cells: Map<string, PlateCell>;
}

interface Props {
  plates: PlateGrid[];
  onToggle: (plate: string, well: string) => void;
}

const GENE_COLORS = ['#0e7c66', '#2563eb', '#b45309', '#7c3aed', '#be185d', '#0e7490', '#4d7c0f', '#b91c1c'];

export default function PlateView({ plates, onToggle }: Props) {
  const { t } = useI18n();
  const genes = [...new Set(plates.flatMap((p) => [...p.cells.values()].map((c) => c.target)))].sort();
  const colorOf = (gene: string) => GENE_COLORS[genes.indexOf(gene) % GENE_COLORS.length];
  const showHeadings = plates.some((p) => p.name) || plates.length > 1;

  return (
    <div>
      {plates.map((plate) => (
        <div key={plate.name || '_'} style={plates.length > 1 ? { marginBottom: 22 } : undefined}>
          {showHeadings && (
            <div style={{ fontWeight: 600, fontSize: '0.9rem', margin: '4px 0 8px' }}>
              🧫 {plate.name || t("未命名板")}
              <span className="hint" style={{ marginLeft: 8 }}>
                {plate.layout.kind === '384' ? '384' : plate.layout.kind === '96' ? '96' : t("自定义")}{t("孔 ·")}{' '}
                {[...plate.cells.values()].filter((c) => !c.excluded).length} {' '}{t("孔纳入")}</span>
            </div>
          )}
          <div className="plate-wrap">
            <table className="plate">
              <thead>
                <tr>
                  <th></th>
                  {Array.from({ length: plate.layout.colCount }, (_, i) => (
                    <th key={i}>{i + 1}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {plateGridRows(plate.layout).map((row, ri) => (
                  <tr key={ri}>
                    <th>{plate.layout.rowLabels[ri]}</th>
                    {row.map((well) => {
                      const cell = plate.cells.get(well);
                      if (!cell) {
                        return (
                          <td key={well} className="well empty" title={t(`${well}（空孔）`)}>
                            <span className="wellname">{well}</span>
                          </td>
                        );
                      }
                      const cls = [
                        'well',
                        cell.excluded ? 'excluded' : '',
                        cell.flagged && !cell.excluded ? 'flagged' : '',
                        cell.isNtc && !cell.excluded ? 'ntc' : '',
                      ]
                        .filter(Boolean)
                        .join(' ');
                      return (
                        <td
                          key={well}
                          className={cls}
                          title={`${plate.name || t("板")} · ${well} · ${cell.isNtc ? t("NTC（无模板对照）") : cell.sample} · ${cell.target}${cell.excluded ? t("（已剔除）") : ''}`}
                          onClick={() => onToggle(plate.name, well)}
                        >
                          <span className="wellname">{well}</span>
                          <span style={{ color: cell.excluded ? undefined : cell.isNtc ? '#5f7480' : colorOf(cell.target) }}>
                            {cell.isNtc ? 'NTC' : cell.sample.length > 6 ? cell.sample.slice(0, 6) : cell.sample}
                          </span>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
      <div className="legend">
        <span>
          <span className="chip" style={{ background: '#f3f4f6', border: '1px solid #e5e7eb' }}></span>{t("空孔")}</span>
        <span>
          <span className="chip" style={{ background: '#9fb3ba' }}></span>{t("对照组样本")}</span>
        <span>
          <span className="chip" style={{ background: 'repeating-linear-gradient(45deg,#f3f4f6,#f3f4f6 2px,#e5e7eb 2px,#e5e7eb 4px)', border: '1px solid #e5e7eb' }}></span>
          {t("已剔除（点击切换）")}</span>
        <span>
          <span className="chip" style={{ background: '#dce6ec', border: '1px solid #b9c9d2' }}></span>
          {t("NTC 无模板对照")}</span>
        <span>
          <span className="chip" style={{ boxShadow: 'inset 0 0 0 2px #d97706' }}></span>{t("QC 标记")}</span>
        {genes.map((g) => (
          <span key={g}>
            <span className="chip" style={{ background: colorOf(g) }}></span>
            {g}
          </span>
        ))}
      </div>
    </div>
  );
}

function plateGridRows(layout: PlateLayout): string[][] {
  const names = allWellNames(layout);
  const rows: string[][] = [];
  for (let r = 0; r < layout.rowCount; r++) {
    rows.push(names.slice(r * layout.colCount, (r + 1) * layout.colCount));
  }
  return rows;
}
