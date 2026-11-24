import { expect, test, type Page } from 'playwright/test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const fixture = (name: string) => join(here, '../fixtures', name);

async function openCfxChart(page: Page) {
  await page.goto('/');
  await page.setInputFiles('input[type=file]', fixture('cfx-style.csv'));
  await page.getByText('已解析 cfx-style.csv').waitFor({ timeout: 15_000 });
  await page.getByRole('button', { name: '下一步：孔板与配置 →' }).click();
  await page.locator('.check-list label', { hasText: 'Control-1' }).locator('input').check();
  await page.getByRole('button', { name: '计算 ΔΔCt 并查看结果 →' }).click();
  await expect(page.locator('.chart-preview svg')).toBeVisible();
}

test('完整流程：导入 CFX 导出 → 映射 → 配置 → ΔΔCt 结果与导出', async ({ page }) => {
  await page.goto('/');

  // 第 1 步：上传（通过隐藏 input 注入文件）
  await page.setInputFiles('input[type=file]', fixture('cfx-style.csv'));
  await expect(page.getByText('已解析 cfx-style.csv')).toBeVisible({ timeout: 15_000 });

  // 第 2 步：映射确认（自动识别）→ 下一步
  await expect(page.getByText('确认表头与列映射')).toBeVisible();
  await page.getByRole('button', { name: '下一步：孔板与配置 →' }).click();

  // 第 3 步：配置。GAPDH 应被自动识别为内参；勾选一个对照组
  await expect(page.getByText('孔板布局（96孔）')).toBeVisible();
  await page.locator('.check-list label', { hasText: 'Control-1' }).locator('input').check();
  await expect(page.locator('.check-list label', { hasText: 'GAPDH' }).locator('input')).toBeChecked();
  await page.getByRole('button', { name: '计算 ΔΔCt 并查看结果 →' }).click();


  // 第 4 步：结果
  await expect(page.getByText('ΔΔCt 结果表')).toBeVisible();
  await expect(page.getByRole('button', { name: 'LDHA' })).toBeVisible();
  await expect(page.getByText('导出 Excel（多表，含 ΔΔCt）')).toBeVisible();

  // 图表渲染
  await expect(page.locator('svg[role=img]')).toBeVisible();

  // Excel 导出触发下载
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: '导出 Excel（多表，含 ΔΔCt）' }).click(),
  ]);
  expect(download.suggestedFilename()).toContain('xlsx');

  // CSV 导出
  const [csvDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: '导出结果 CSV' }).click(),
  ]);
  expect(csvDownload.suggestedFilename()).toContain('csv');
});

test('QuantStudio 风格（元数据行 + Tab 分隔）也能走通', async ({ page }) => {
  await page.goto('/');
  await page.setInputFiles('input[type=file]', fixture('quantstudio-style.txt'));
  await expect(page.getByText('已解析 quantstudio-style.txt')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('确认表头与列映射')).toBeVisible();
  await page.getByRole('button', { name: '下一步：孔板与配置 →' }).click();
  await page.locator('.check-list label', { hasText: 'WT-1' }).locator('input').check();
  await page.locator('.check-list label', { hasText: 'WT-2' }).locator('input').check();
  // GAPDH 自动识别为内参
  await expect(page.locator('.check-list label', { hasText: 'GAPDH' }).locator('input')).toBeChecked();
  await page.getByRole('button', { name: '计算 ΔΔCt 并查看结果 →' }).click();
  await expect(page.getByText('ΔΔCt 结果表')).toBeVisible();
  await expect(page.getByRole('button', { name: 'BAX2' })).toBeVisible();
});

test('真实 QuantStudio 384 孔导出（46 行元数据头）走通全流程', async ({ page }) => {
  await page.goto('/');
  await page.setInputFiles('input[type=file]', fixture('real/RELATIVE_example.csv'));
  await expect(page.getByText('已解析 RELATIVE_example.csv')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('确认表头与列映射')).toBeVisible();
  await page.getByRole('button', { name: '下一步：孔板与配置 →' }).click();
  await expect(page.getByText('孔板布局（384孔）')).toBeVisible();
  await page.locator('.check-list label', { hasText: 'AiW002-2-D0' }).locator('input').check();
  // GAPDH / ACTB 均被自动识别为内参（池化）
  await expect(page.locator('.check-list label', { hasText: 'GAPDH' }).locator('input')).toBeChecked();
  await expect(page.locator('.check-list label', { hasText: 'ACTB' }).locator('input')).toBeChecked();
  await page.getByRole('button', { name: '计算 ΔΔCt 并查看结果 →' }).click();
  await expect(page.getByText('ΔΔCt 结果表')).toBeVisible();
  await expect(page.getByRole('button', { name: 'GRIN1' })).toBeVisible();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: '导出 Excel（多表，含 ΔΔCt）' }).click(),
  ]);
  expect(download.suggestedFilename()).toContain('xlsx');
});

test('NTC 自动识别：Task/样本名两种途径 + 污染分级告警', async ({ page }) => {
  await page.goto('/');
  await page.setInputFiles('input[type=file]', fixture('cfx-ntc-style.csv'));
  await expect(page.getByText('已解析 cfx-ntc-style.csv')).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: '下一步：孔板与配置 →' }).click();

  // NTC 检查卡片：GAPDH 通过（无扩增）、LDHA 疑似污染（Cq 33.10）、PKM 通过
  await expect(page.getByText('NTC 污染检查')).toBeVisible();
  await expect(page.locator('.ntc-row.ntc-pass', { hasText: 'GAPDH' })).toBeVisible();
  await expect(page.locator('.ntc-row.ntc-contaminated', { hasText: 'LDHA' })).toBeVisible();
  await expect(page.locator('.ntc-row.ntc-contaminated', { hasText: '33.1' })).toBeVisible();

  // NTC 不出现在对照组样本列表
  await expect(page.locator('.check-list label', { hasText: /^NTC/ })).toHaveCount(0);
  await page.locator('.check-list label', { hasText: 'Control-1' }).locator('input').check();
  await page.getByRole('button', { name: '计算 ΔΔCt 并查看结果 →' }).click();

  // 结果页告警横幅包含污染提示
  await expect(page.getByText('ΔΔCt 结果表')).toBeVisible();
  await expect(page.locator('.warning-banner')).toContainText('疑似');
});

test('QuantStudio Task=NTC（无扩增）显示通过', async ({ page }) => {
  await page.goto('/');
  await page.setInputFiles('input[type=file]', fixture('quantstudio-style.txt'));
  await expect(page.getByText('已解析 quantstudio-style.txt')).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: '下一步：孔板与配置 →' }).click();
  await expect(page.getByText('NTC 污染检查')).toBeVisible();
  await expect(page.locator('.ntc-row.ntc-pass', { hasText: 'GAPDH' })).toBeVisible();
  await expect(page.locator('.ntc-row.ntc-pass', { hasText: 'BAX2' })).toBeVisible();
  // Task=NTC 的行不进样本列表（样本名恰好也叫 NTC）
  await expect(page.locator('.check-list label', { hasText: /^NTC/ })).toHaveCount(0);
});

test('一键智能分析：跳过向导直接出结果与质量报告', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /一键智能分析/ }).click();
  await page.setInputFiles('input[type=file]', fixture('cfx-ntc-style.csv'));
  await page.getByText('一键智能分析报告').waitFor({ timeout: 15_000 });
  // 报告包含问题与优化方向
  await expect(page.getByText(/发现的问题/)).toBeVisible();
  await expect(page.getByText(/优化方向/)).toBeVisible();
  // 直接在第 4 步，结果表可用
  await expect(page.getByText('ΔΔCt 结果表')).toBeVisible();
  // NTC 污染作为严重问题出现在报告卡中
  await expect(page.locator('.issue-list li.sev-error', { hasText: 'NTC' })).toBeVisible();
});

test('多板合并：两个文件一起拖入，跨板计算 ΔΔCt', async ({ page }) => {
  await page.goto('/');
  await page.setInputFiles('input[type=file]', [fixture('merge-plate1.csv'), fixture('merge-plate2.csv')]);
  await page.getByRole('heading', { name: '合并 2 个文件' }).waitFor({ timeout: 15_000 });
  await expect(page.getByText('merge-plate1.csv')).toBeVisible();
  await expect(page.getByText('merge-plate2.csv')).toBeVisible();
  await page.getByRole('button', { name: '下一步：孔板与配置 →' }).click();
  await expect(page.getByText('孔板布局（2 块板合并分析）')).toBeVisible();
  await page.locator('.check-list label', { hasText: 'Control-1' }).locator('input').check();
  await page.getByRole('button', { name: '计算 ΔΔCt 并查看结果 →' }).click();
  await expect(page.getByText('ΔΔCt 结果表')).toBeVisible();
  // 跨板合并后 Fold Change ≈ 5.04（2^(16/3-3)）
  await expect(page.getByText('5.04')).toBeVisible();
});

test('标准曲线自动拟合：Task=STANDARD + Quantity 一键应用效率', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /一键智能分析/ }).click();
  await page.setInputFiles('input[type=file]', fixture('standard-curve-style.csv'));
  await page.getByText('一键智能分析报告').waitFor({ timeout: 15_000 });
  // 报告含标准曲线应用信息（2 基因）
  await expect(page.locator('.issue-list li', { hasText: '标准曲线已应用' })).toHaveCount(2);
  // 效率非 100% → Pfaffl 口径
  await expect(page.getByText(/Pfaffl 效率校正 · /)).toBeVisible();
  await expect(page.getByText('ΔΔCt 结果表')).toBeVisible();
});

test('RDML 标准格式直接导入（真实 StepOne 文件）', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /一键智能分析/ }).click();
  await page.setInputFiles('input[type=file]', fixture('real/stepone_std.rdml'));
  await page.getByText('一键智能分析报告').waitFor({ timeout: 15_000 });
  // RDML 靶标声明效率已应用（RNase P 93.9%）
  await expect(page.locator('.issue-list li', { hasText: 'RDML 靶标声明效率已应用' })).toBeVisible();
  // 只有内参基因 → 明确提示
  await expect(page.locator('.issue-list li.sev-error', { hasText: '内参基因' })).toBeVisible();
});

test('熔解摘要表附加：LightCycler No. Tm 格式按孔位连接', async ({ page }) => {
  await page.goto('/');
  await page.setInputFiles('input[type=file]', fixture('cfx-style.csv'));
  await page.getByText('已解析 cfx-style.csv').waitFor({ timeout: 15_000 });
  await page.getByRole('button', { name: '下一步：孔板与配置 →' }).click();
  // 附加熔解摘要表
  await page.getByRole('button', { name: '附加熔解摘要表文件' }).click();
  await page.setInputFiles('input[type=file]', fixture('melt-summary.csv'));
  await page.getByText('已附加 melt-summary.csv').waitFor({ timeout: 10_000 });
  // F1（规范化孔位）Treat-3 双峰被点名
  await expect(page.locator('.qc-flag-row', { hasText: 'Treat-3' })).toContainText('2 个熔解峰');
});

test('示例数据一键体验 + 分步使用说明', async ({ page }) => {
  await page.goto('/');
  // 帮助面板
  await page.getByText('❓ 这一步怎么做？').click();
  await expect(page.getByText('怎么拿到分析用的文件？')).toBeVisible();
  // 示例数据一键分析
  await page.getByRole('button', { name: '标准曲线示例' }).click();
  await page.getByText('一键智能分析报告').waitFor({ timeout: 15_000 });
  await expect(page.getByText('ΔΔCt 结果表')).toBeVisible();
  // AI 解读卡片（未配置状态）
  await expect(page.getByText('还没有配置 AI')).toBeVisible();
  await page.getByRole('button', { name: '配置我的 API' }).click();
  await expect(page.getByText('🤖 AI 解读设置')).toBeVisible();
  await page.getByRole('button', { name: '取消' }).click();
});

test('课题管理：自动保存、我的课题列表、打开与删除', async ({ page }) => {
  await page.goto('/');
  // 用示例数据产生一个课题
  await page.getByRole('button', { name: '标准曲线示例' }).click();
  await page.getByText('一键智能分析报告').waitFor({ timeout: 15_000 });
  // 头部出现课题名，打开我的课题
  await page.getByRole('button', { name: /我的课题/ }).click();
  await page.getByText('1 个已保存').waitFor({ timeout: 10_000 });
  await expect(page.getByText('standard-curve-style.csv', { exact: true })).toBeVisible();
  // 新建课题（清空当前）
  await page.getByRole('button', { name: '＋ 新建课题' }).click();
  await expect(page.getByText('拖入文件，或点击选择')).toBeVisible();
  // 再开我的课题，打开刚才的课题 → 恢复到结果页
  await page.getByRole('button', { name: /我的课题/ }).click();
  await page.getByRole('button', { name: '打开' }).first().click();
  await page.getByText('一键智能分析报告').waitFor({ timeout: 15_000 });
  // 删除流程（两段确认）
  await page.getByRole('button', { name: /我的课题/ }).click();
  await page.getByRole('button', { name: '删除' }).first().click();
  await page.getByRole('button', { name: '确认删除' }).click();
  await expect(page.getByText('还没有保存的课题')).toBeVisible();
});

test('换新表后刷新：恢复的应是新表而不是旧课题', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '标准曲线示例' }).click();
  await page.getByText('一键智能分析报告').waitFor({ timeout: 15_000 });
  await page.waitForTimeout(800); // 等首次落盘
  // 换一张不同的表（回到第 1 步）
  await page.getByRole('button', { name: '← 上一步' }).click();
  await page.getByRole('button', { name: '← 上一步' }).click();
  await page.getByRole('button', { name: '← 上一步' }).click();
  await page.setInputFiles('input[type=file]', fixture('cfx-style.csv'));
  await page.getByText('已解析 cfx-style.csv').waitFor({ timeout: 15_000 });
  // 快速刷新（防抖可能未落盘，pagehide 应立即保存）
  await page.reload();
  await page.getByText('已恢复上次的项目「cfx-style.csv」').waitFor({ timeout: 15_000 });
  // 结果应是新表的数据（存在 ΔΔCt 结果表即证明不是旧示例）
  await expect(page.getByText('ΔΔCt 结果表')).toBeVisible();
});

test('图表定制：多基因分段 + 显著性模式 + Prism 导出', async ({ page }, testInfo) => {
  await page.goto('/');
  await page.setInputFiles('input[type=file]', fixture('cfx-style.csv'));
  await page.getByText('已解析 cfx-style.csv').waitFor({ timeout: 15_000 });
  await page.getByRole('button', { name: '下一步：孔板与配置 →' }).click();
  await page.locator('.check-list label', { hasText: 'Control-1' }).locator('input').check();
  await page.getByRole('button', { name: '计算 ΔΔCt 并查看结果 →' }).click();
  await page.getByText('ΔΔCt 结果表').waitFor({ timeout: 10_000 });

  // 打开图表设置：改标题 → SVG 内标题变化；开多基因合并 → 出现基因段标签
  await page.getByText('⚙️ 图表设置').click();
  await page.getByRole('textbox', { name: '标题', exact: true }).fill('我的qPCR结果');
  await expect(page.locator('.chart-preview svg text', { hasText: '我的qPCR结果' })).toBeVisible();
  await page.getByText('合并多基因作图').locator('input').check();
  await expect(page.locator('.chart-preview svg text', { hasText: 'PKM' })).toBeVisible();

  // 显著性模式切到 p 值
  await page.locator('select').filter({ has: page.locator('option[value="stars"]') }).first().selectOption('p');

  // Prism 导出触发下载
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: '导出 Prism 工程（.pzfx）' }).click(),
  ]);
  expect(download.suggestedFilename()).toContain('.pzfx');
  const path = await download.path();
  expect(path).not.toBeNull();
  const xml = await readFile(path!, 'utf8');
  await testInfo.attach('prism-export.pzfx', { body: xml, contentType: 'application/xml' });
  // Parse the downloaded bytes: filename/string checks missed the unbound w: prefix.
  const parsed = await page.evaluate((content) => {
    const document = new DOMParser().parseFromString(content, 'application/xml');
    return {
      error: document.querySelector('parsererror')?.textContent ?? null,
      root: document.documentElement.tagName,
      rowTitles: Array.from(document.querySelectorAll('Table')).map((table) =>
        Array.from(table.querySelectorAll('RowTitlesColumn > Subcolumn > d')).map((cell) => cell.textContent)),
      tableIds: Array.from(document.querySelectorAll('GraphPadPrismFile > Table')).map((table) => table.getAttribute('ID')),
      references: Array.from(document.querySelectorAll('TableSequence > Ref')).map((ref) => ref.getAttribute('ID')),
      values: Array.from(document.querySelectorAll('Table > YColumn')).map((column) =>
        Array.from(column.querySelectorAll('Subcolumn > d')).map((cell) => cell.textContent)),
    };
  }, xml);
  expect(parsed.error).toBeNull();
  expect(parsed.root).toBe('GraphPadPrismFile');
  expect(parsed.rowTitles).toEqual([['1', '2', '3'], ['1', '2', '3'], ['Mean', 'SD']]);
  expect(parsed.references).toEqual(parsed.tableIds);
  expect(parsed.tableIds).toHaveLength(3);
  expect(parsed.values).toHaveLength(20); // Ten sample/gene columns plus the same ten summary columns.
  expect(parsed.values[0].every((value) => Number.isFinite(Number(value)))).toBe(true);
});

test('图表定制进阶：基因勾选、名称修改、log2 刻度、统计学方法脚注', async ({ page }) => {
  await page.goto('/');
  await page.setInputFiles('input[type=file]', fixture('cfx-style.csv'));
  await page.getByText('已解析 cfx-style.csv').waitFor({ timeout: 15_000 });
  await page.getByRole('button', { name: '下一步：孔板与配置 →' }).click();
  await page.locator('.check-list label', { hasText: 'Control-1' }).locator('input').check();
  await page.getByRole('button', { name: '计算 ΔΔCt 并查看结果 →' }).click();
  await page.getByText('ΔΔCt 结果表').waitFor({ timeout: 10_000 });

  await page.getByText('⚙️ 图表设置').click();
  // 多基因 + 只勾 LDHA
  await page.getByText('合并多基因作图').locator('input').check();
  const geneLabels = page.locator('.gene-multiselect label');
  await geneLabels.filter({ hasText: 'PKM' }).locator('input').uncheck();
  // 图上应只剩 LDHA 段（GAPDH 是内参不进结果表，LDHA/PKM 是目标基因）
  await expect(page.locator('.chart-preview svg text', { hasText: 'LDHA' }).first()).toBeVisible();
  await expect(page.locator('.chart-preview svg text', { hasText: 'PKM' })).toHaveCount(0);
  // 名称修改：Control-1 → 对照组
  const nameInput = page.getByRole('textbox', { name: '修改 Control-1 的显示名' });
  await nameInput.fill('对照组');
  await expect(page.locator('.chart-preview svg text', { hasText: '对照组' }).first()).toBeVisible();
  // log2 刻度
  await page.getByLabel('Y 轴刻度').selectOption('log2');
  // 统计学方法脚注（图片下方文字）
  await expect(page.locator('.method-caption')).toContainText('统计学方法');
  await expect(page.locator('.method-caption')).toContainText('Dunnett');
});

test('多基因图例与基因重命名', async ({ page }) => {
  await page.goto('/');
  await page.setInputFiles('input[type=file]', fixture('cfx-style.csv'));
  await page.getByText('已解析 cfx-style.csv').waitFor({ timeout: 15_000 });
  await page.getByRole('button', { name: '下一步：孔板与配置 →' }).click();
  await page.locator('.check-list label', { hasText: 'Control-1' }).locator('input').check();
  await page.getByRole('button', { name: '计算 ΔΔCt 并查看结果 →' }).click();
  await page.getByText('⚙️ 图表设置').waitFor({ timeout: 10_000 });
  await page.getByText('合并多基因作图').locator('input').check();
  await page.waitForTimeout(300);
  // 基因重命名输入框出现并生效
  const geneInput = page.getByRole('textbox', { name: '修改 LDHA 的显示名' });
  await geneInput.fill('乳酸脱氢酶');
  await expect(page.locator('.chart-preview svg text', { hasText: '乳酸脱氢酶' }).first()).toBeVisible();
});

test('柱状图轴标签实际绘制：单基因、多基因、重命名与模式切换', async ({ page }) => {
  await page.goto('/');
  await page.setInputFiles('input[type=file]', fixture('cfx-style.csv'));
  await page.getByText('已解析 cfx-style.csv').waitFor({ timeout: 15_000 });
  await page.getByRole('button', { name: '下一步：孔板与配置 →' }).click();
  await page.locator('.check-list label', { hasText: 'Control-1' }).locator('input').check();
  await page.getByRole('button', { name: '计算 ΔΔCt 并查看结果 →' }).click();
  await page.getByText('ΔΔCt 结果表').waitFor({ timeout: 10_000 });

  const chart = page.locator('.chart-preview svg');
  const expectPaintedAxisLabels = async (labels: string[]) => {
    // SVG clipPath 不改变文字的 bounding box；toBeVisible() 无法发现被裁掉的标签。
    // 像 PNG 导出一样栅格化 SVG，直接检查轴下标签位置是否实际绘制了文字。
    const measurements = await chart.evaluate(async (element, expectedLabels) => {
      const svg = element as SVGSVGElement;
      const plots = Array.from(svg.querySelectorAll<SVGRectElement>('clipPath[id^="plotclip"] rect'));
      const plotBottom = Math.max(...plots.map((plot) => plot.y.baseVal.value + plot.height.baseVal.value));
      const viewBox = svg.viewBox.baseVal;
      const canvas = document.createElement('canvas');
      canvas.width = viewBox.width;
      canvas.height = viewBox.height;
      const ctx = canvas.getContext('2d')!;
      const image = new Image();
      image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(svg));
      await image.decode();
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

      return expectedLabels.map((label) => ({
        label,
        matches: Array.from(svg.querySelectorAll('text'))
          .filter((text) => text.textContent === label && text.y.baseVal.getItem(0).value > plotBottom)
          .map((text) => {
            const local = text.getBBox();
            const transform = svg.getCTM()!.inverse().multiply(text.getCTM()!);
            const corners = [
              new DOMPoint(local.x, local.y),
              new DOMPoint(local.x + local.width, local.y),
              new DOMPoint(local.x, local.y + local.height),
              new DOMPoint(local.x + local.width, local.y + local.height),
            ].map((point) => point.matrixTransform(transform));
            const x = Math.min(...corners.map((point) => point.x));
            const y = Math.min(...corners.map((point) => point.y));
            const box = { x, y, width: Math.max(...corners.map((point) => point.x)) - x, height: Math.max(...corners.map((point) => point.y)) - y };
            const pixels = ctx.getImageData(Math.floor(box.x), Math.floor(box.y), Math.ceil(box.width), Math.ceil(box.height)).data;
            let ink = 0;
            for (let i = 0; i < pixels.length; i += 4) {
              if (pixels[i + 3] > 0 && (pixels[i] < 240 || pixels[i + 1] < 240 || pixels[i + 2] < 240)) ink++;
            }
            return {
              ink,
              clipped: Boolean(text.closest('[clip-path]')),
              belowAxis: box.y >= plotBottom,
              insideSvg: box.x >= 0 && box.x + box.width <= viewBox.width && box.y + box.height <= viewBox.height,
            };
          }),
      }));
    }, labels);

    for (const { label, matches } of measurements) {
      expect(matches.length, `${label} 应位于 X 轴下方`).toBeGreaterThan(0);
      for (const match of matches) {
        expect(match.ink, `${label} 的文字区域必须存在实际绘制的像素`).toBeGreaterThan(5);
        expect(match.clipped, `${label} 不应置于绘图区裁剪层内`).toBe(false);
        expect(match.belowAxis).toBe(true);
        expect(match.insideSvg).toBe(true);
      }
    }
  };

  await expectPaintedAxisLabels(['Control-1', 'Treat-1']);
  await expect(chart.locator('.chart-legend')).toHaveCount(0);

  const merge = page.getByText('合并多基因作图').locator('input');
  await merge.check();
  await expectPaintedAxisLabels(['LDHA', 'PKM']);
  await expect(chart.locator('.chart-legend')).toHaveCount(1);
  await expect(chart.locator('[stroke-dasharray]')).toHaveCount(0);

  await page.getByRole('textbox', { name: '修改 Control-1 的显示名' }).fill('对照组');
  await page.getByRole('textbox', { name: '修改 LDHA 的显示名' }).fill('乳酸脱氢酶');
  await expectPaintedAxisLabels(['乳酸脱氢酶', 'PKM']);
  await expect(chart.locator('.chart-axis-labels')).not.toContainText('对照组');
  await expect(chart.locator('.chart-legend')).toContainText('对照组');

  await merge.uncheck();
  await expectPaintedAxisLabels(['对照组', 'Treat-1']);
  await expect(chart.locator('.chart-legend')).toHaveCount(0);
});

test('图表字体、字号、组内总宽度及空副标题实际作用于输出 SVG', async ({ page }) => {
  await openCfxChart(page);
  const chart = page.locator('.chart-preview svg');
  const subtitle = page.getByRole('textbox', { name: '副标题', exact: true });
  await expect(subtitle).toHaveValue('');
  await expect(chart).not.toContainText('Relative expression');
  await subtitle.fill('测试副标题');
  await expect(chart.locator('text', { hasText: '测试副标题' })).toHaveCount(1);
  await subtitle.fill('');
  await expect(chart.locator('text', { hasText: '测试副标题' })).toHaveCount(0);

  for (const family of ['Times New Roman', 'Arial', 'sans-serif']) {
    await page.getByRole('combobox', { name: '图表字体', exact: true }).selectOption(family);
    await expect.poll(async () => chart.locator('text').evaluateAll((texts, selectedFamily) =>
      texts.length > 0 && texts.every((text) => getComputedStyle(text).fontFamily.includes(selectedFamily)), family),
    ).toBe(true);
  }

  const axisLabel = chart.locator('.chart-axis-labels text').first();
  await page.getByLabel('字号（px）', { exact: true }).fill('12');
  const originalSize = await axisLabel.evaluate((label) => Number.parseFloat(getComputedStyle(label).fontSize));
  await page.getByLabel('字号（px）', { exact: true }).fill('');
  await page.getByLabel('字号（px）', { exact: true }).pressSequentially('24');
  await expect(page.getByLabel('字号（px）', { exact: true })).toHaveValue('24');
  await expect.poll(async () => axisLabel.evaluate((label) => Number.parseFloat(getComputedStyle(label).fontSize))).toBeCloseTo(originalSize * 2);

  await page.getByText('合并多基因作图').locator('input').check();
  const barGeometry = () => chart.locator('.chart-data rect.chart-bar').evaluateAll((elements) => elements.map((element) => {
    const rect = element as SVGRectElement;
    return { x: rect.x.baseVal.value, width: rect.width.baseVal.value };
  }));
  await page.getByLabel('组内总宽度（%）', { exact: true }).fill('');
  await page.getByLabel('组内总宽度（%）', { exact: true }).pressSequentially('40');
  await expect(page.getByLabel('组内总宽度（%）', { exact: true })).toHaveValue('40');
  const narrow = await barGeometry();
  await page.getByLabel('组内总宽度（%）', { exact: true }).fill('100');
  const wide = await barGeometry();
  expect(narrow.length).toBeGreaterThan(1);
  expect(wide).toHaveLength(narrow.length);
  expect(wide[0].width).toBeGreaterThan(narrow[0].width);
  expect(wide[1].x - wide[0].x, '组内柱中心的距离应随组宽增大').toBeGreaterThan(narrow[1].x - narrow[0].x);
  await expect(chart.locator('.chart-axis-labels')).toContainText('LDHA');
  await expect(chart.locator('.chart-axis-labels')).toContainText('PKM');
});

test('真正 Y 轴断轴：推荐区间保留上下柱段并在导出像素中留白', async ({ page }) => {
  await openCfxChart(page);
  const chart = page.locator('.chart-preview svg');
  const clipRects = chart.locator('clipPath[id^="plotclip"] rect');
  const toggle = page.getByLabel('启用 Y 轴断轴', { exact: true });
  await toggle.check();
  await expect(clipRects).toHaveCount(2);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(chart.locator('.chart-axis-break')).toHaveCount(1);

  // 真断轴必须同时保留两个可见数值段；检查实际栅格化图像，避免仅验证隐藏的 SVG 节点。
  const painted = await chart.evaluate(async (element) => {
    const svg = element as SVGSVGElement;
    const ranges = Array.from(svg.querySelectorAll<SVGRectElement>('clipPath[id^="plotclip"] rect'))
      .map((rect) => ({ x: rect.x.baseVal.value, y: rect.y.baseVal.value, width: rect.width.baseVal.value, height: rect.height.baseVal.value }))
      .sort((a, b) => a.y - b.y);
    const canvas = document.createElement('canvas');
    canvas.width = svg.viewBox.baseVal.width;
    canvas.height = svg.viewBox.baseVal.height;
    const ctx = canvas.getContext('2d')!;
    const image = new Image();
    image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(svg));
    await image.decode();
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    const countInk = (x: number, y: number, width: number, height: number, barsOnly = false) => {
      const pixels = ctx.getImageData(x, y, width, height).data;
      let ink = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        const isBarFill = pixels[i] === pixels[i + 1] && pixels[i] === pixels[i + 2] && (pixels[i] === 26 || pixels[i] === 201);
        if (pixels[i + 3] > 0 && (barsOnly ? isBarFill : pixels[i] < 240 || pixels[i + 1] < 240 || pixels[i + 2] < 240)) ink++;
      }
      return ink;
    };
    const [upper, lower] = ranges;
    const gapStart = Math.ceil(upper.y + upper.height) + 1;
    const gapEnd = Math.floor(lower.y) - 1;
    return {
      gap: lower.y - upper.y - upper.height,
      gapInk: countInk(Math.ceil(upper.x) + 12, gapStart, Math.floor(upper.width) - 24, gapEnd - gapStart),
      upperInk: countInk(Math.ceil(upper.x) + 12, Math.ceil(upper.y) + 1, Math.floor(upper.width) - 24, Math.floor(upper.height) - 2, true),
      lowerInk: countInk(Math.ceil(lower.x) + 12, Math.ceil(lower.y) + 1, Math.floor(lower.width) - 24, Math.floor(lower.height) - 2, true),
    };
  });
  expect(painted.gap).toBeGreaterThan(4);
  expect(painted.gapInk, '省略区间必须留白，不能绘制连续的柱子或误差棒').toBe(0);
  expect(painted.upperInk, '高柱顶部必须保留在上段').toBeGreaterThan(20);
  expect(painted.lowerInk, '低柱及高柱下部必须保留在下段').toBeGreaterThan(20);

  await page.getByLabel('下段高度占比（%）', { exact: true }).fill('40');
  const heights = await clipRects.evaluateAll((rects) => rects.map((element) => {
    const rect = element as SVGRectElement;
    return { y: rect.y.baseVal.value, height: rect.height.baseVal.value };
  }).sort((a, b) => a.y - b.y).map((rect) => rect.height));
  expect(heights[1] / (heights[0] + heights[1])).toBeCloseTo(0.4);
  await toggle.uncheck();
  await expect(clipRects).toHaveCount(1);
  await expect(chart.locator('.chart-axis-break')).toHaveCount(0);
  await expect(chart.locator('.chart-axis-labels')).toContainText('Control-1');
});

test('断轴参数非法时提示原因并安全回退，切换对数轴会关闭断轴', async ({ page }) => {
  await openCfxChart(page);
  const chart = page.locator('.chart-preview svg');
  const clipRects = chart.locator('clipPath[id^="plotclip"] rect');
  const toggle = page.getByLabel('启用 Y 轴断轴', { exact: true });
  await toggle.check();
  await page.getByLabel('省略区间起点', { exact: true }).fill('8');
  await page.getByLabel('省略区间终点', { exact: true }).fill('2');
  await expect(page.getByRole('alert')).toContainText('省略区间');
  await expect(clipRects).toHaveCount(1);
  expect(await chart.evaluate((svg) => svg.outerHTML)).not.toMatch(/NaN|Infinity/);
  await page.getByRole('button', { name: '按数据推荐断轴', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(clipRects).toHaveCount(2);
  await page.getByRole('combobox', { name: 'Y 轴刻度', exact: true }).selectOption('log2');
  await expect(toggle).not.toBeChecked();
  await expect(clipRects).toHaveCount(1);
  await expect(chart.locator('.chart-axis-break')).toHaveCount(0);
  expect(await chart.evaluate((svg) => svg.outerHTML)).not.toMatch(/NaN|Infinity/);
});

test('多基因图例位置、图片比例及整体缩放同步应用于 SVG 和 PNG 导出', async ({ page }) => {
  await openCfxChart(page);
  await page.getByText('合并多基因作图').locator('input').check();
  const chart = page.locator('.chart-preview svg');
  const geometry = () => chart.evaluate((element) => {
    const svg = element as SVGSVGElement;
    const plot = svg.querySelector<SVGRectElement>('clipPath[id^="plotclip"] rect')!;
    const legend = svg.querySelector<SVGGElement>('.chart-legend');
    const box = legend?.getBBox();
    return {
      width: svg.width.baseVal.value,
      height: svg.height.baseVal.value,
      viewBox: { width: svg.viewBox.baseVal.width, height: svg.viewBox.baseVal.height },
      plot: { left: plot.x.baseVal.value, right: plot.x.baseVal.value + plot.width.baseVal.value, bottom: plot.y.baseVal.value + plot.height.baseVal.value },
      legend: box ? { left: box.x, top: box.y, right: box.x + box.width, bottom: box.y + box.height } : null,
    };
  });

  await page.getByRole('combobox', { name: '图例位置', exact: true }).selectOption('right');
  const right = await geometry();
  expect(right.legend).not.toBeNull();
  expect(right.legend!.left).toBeGreaterThanOrEqual(right.plot.right);
  await page.getByRole('combobox', { name: '图例位置', exact: true }).selectOption('bottom');
  const bottom = await geometry();
  expect(bottom.legend).not.toBeNull();
  expect(bottom.legend!.top).toBeGreaterThan(bottom.plot.bottom);
  expect(bottom.legend!.bottom).toBeLessThanOrEqual(bottom.viewBox.height);
  await page.getByRole('combobox', { name: '图例位置', exact: true }).selectOption('none');
  await expect(chart.locator('.chart-legend')).toHaveCount(0);

  await page.getByRole('combobox', { name: '图片比例', exact: true }).selectOption('1:1');
  const square = await geometry();
  expect(square.viewBox.width).toBe(square.viewBox.height);
  await page.getByRole('combobox', { name: '图片比例', exact: true }).selectOption('16:9');
  // 锁定比例后修改图宽，图高也应更新，容许整数像素舍入。
  await page.getByLabel('图宽（px）', { exact: true }).fill('960');
  const wide = await geometry();
  expect(Math.abs(wide.viewBox.width / wide.viewBox.height - 16 / 9)).toBeLessThan(0.005);
  await page.getByLabel('整体缩放（%）', { exact: true }).fill('150');
  const scaled = await geometry();
  expect(scaled.viewBox).toEqual(wide.viewBox);
  expect(scaled.width).toBeCloseTo(wide.width * 1.5);
  expect(scaled.height).toBeCloseTo(wide.height * 1.5);

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: '导出 PNG', exact: true }).click(),
  ]);
  const path = await download.path();
  expect(path).not.toBeNull();
  const png = await readFile(path!);
  expect(png.subarray(1, 4).toString()).toBe('PNG');
  expect(png.readUInt32BE(16), 'PNG 宽度应包含整体缩放及 2 倍导出分辨率').toBe(Math.round(scaled.width * 2));
  expect(png.readUInt32BE(20), 'PNG 高度应包含整体缩放及 2 倍导出分辨率').toBe(Math.round(scaled.height * 2));
});
