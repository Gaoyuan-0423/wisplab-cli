import { useI18n } from '../i18n';
import { useState } from 'react';

const HELP: Record<number, { title: string; items: string[] }[]> = {
  1: [
    {
      title: '怎么拿到分析用的文件？',
      items: [
        '在仪器电脑上打开随机分析软件（如 Bio-Rad CFX Manager、QuantStudio Design & Analysis、LightCycler 软件），把"量化/Quantification"结果导出为 Excel 或 CSV。',
        '直接拖入本页即可：Excel(.xlsx/.xls)、CSV、TSV、TXT 都支持，UTF-8 与 GBK 编码自动识别，多工作表会弹出选择。',
        '.rdml 标准格式文件也可直接拖入（Agilent AriaMx 原生支持，多家仪器有导出插件）。',
        '没有现成文件？点下方"载入示例数据"先体验完整流程。',
      ],
    },
    {
      title: '想一次分析多块板？',
      items: ['同时拖入多个文件：每块板独立识别列映射，同样本同基因的复孔跨板自动汇总——典型场景"板 1 做内参、板 2 做目标基因"。'],
    },
  ],
  2: [
    {
      title: '这一步在确认什么？',
      items: [
        '表头行：仪器导出常带元数据头，已自动定位真正的表头行；不对可用滑块手动调整。',
        '三个必需列：样本 ID（谁的结果）、目标基因（测的什么）、Cq/Ct（数值）；可选列：板号、孔位（用于孔板视图）、组别、配对 ID。',
        '自动识别结果不对时，在下方下拉框手动指定；悬停预览可核对数据。',
      ],
    },
  ],
  3: [
    {
      title: '怎么设置实验？',
      items: [
        '对照组：至少勾 1 个（如 Control/Sham/WT），它是 ΔΔCt 的比较基准。',
        '内参基因：单个即可（如 GAPDH）；多个内参为可选池化功能。请确认所选内参在本实验中的稳定性。',
        '孔板视图：点击孔位整组剔除/恢复复孔；QC 标记（黄框）建议先人工复核。',
      ],
    },
    {
      title: '效率与标准曲线',
      items: [
        '有稀释系列（标准品）时自动拟合标准曲线，点"应用"即启用 Pfaffl 效率校正。',
        '也可手动填各基因扩增效率%（标准曲线斜率换算：效率% = (10^(−1/斜率) − 1) × 100）。',
        '留空 = 全部 100% = 经典 Livak 法。',
      ],
    },
  ],
  4: [
    {
      title: '结果怎么看？',
      items: [
        'Fold Change > 1 上调、< 1 下调；显著性：* p<0.05，** p<0.01，*** p<0.001。',
        '统计口径：每组 vs 对照。2 组 Welch t；多组 ANOVA + Dunnett 校正。均在每个生物学重复的 ΔCt 上计算。',
        '导出：Excel 含 ΔΔCt 完整表格、原始数据与 QC、NTC/熔解检查；图表 SVG 矢量适合投稿。',
        '配置了 AI 后可点"AI 解读"生成自然语言结论（仅发送分析摘要到你自己的 API）。',
      ],
    },
  ],
};

/** 分步使用说明（折叠面板，默认收起）。 */
export function StepHelp({ step }: { step: number }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const content = HELP[step];
  if (!content) return null;
  return (
    <details className="help-box" open={open}>
      <summary
        onClick={(e) => {
          e.preventDefault();
          setOpen(!open);
        }}
      >
        {t("❓ 这一步怎么做？")}</summary>
      <div className="help-body">
        {content.map((section, i) => (
          <div key={i}>
            <strong>{t(section.title)}</strong>
            <ul>
              {section.items.map((item, j) => (
                <li key={j}>{t(item)}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </details>
  );
}
