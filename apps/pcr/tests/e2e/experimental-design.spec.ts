import { expect, test } from 'playwright/test';
import { readFile } from 'node:fs/promises';
import * as XLSX from 'xlsx';

// Synthetic acceptance fixture only; this is not independent biological validation.
const csv = ['Plate,Sample,Group,Target,Cq'];
for (const [prefix, group, baseline] of [['C', 'Control', 5], ['T', 'Treatment', 2]] as const) {
  for (let unit = 1; unit <= 3; unit++) for (let rep = 0; rep < 3; rep++) {
    csv.push(`P1,${prefix}${unit},${group},GAPDH,20`);
    csv.push(`P1,${prefix}${unit},${group},LDHA,${20 + baseline + unit / 2 + rep / 10}`);
  }
}
test('confirmed units control inference, charts and exported workbook', async ({ page }) => {
  await page.goto('/');
  await page.setInputFiles('input[type=file]', { name: 'synthetic-design.csv', mimeType: 'text/csv', buffer: Buffer.from(csv.join('\n')) });
  await page.getByText('已解析 synthetic-design.csv').waitFor();
  await page.getByRole('button', { name: '下一步：孔板与配置 →' }).click();
  const design = page.getByRole('region', { name: '实验单位与分组' });
  const confirm = design.getByRole('checkbox');
  await expect(confirm).not.toBeChecked();
  await design.getByLabel('推断统计的对照组').selectOption('Control');
  // Whitespace edits normalize only when the user explicitly confirms the design.
  await design.getByRole('textbox', { name: '组别 P1 C1', exact: true }).fill(' Control ');
  await confirm.check();
  await page.getByRole('button', { name: '计算 ΔΔCt 并查看结果 →' }).click();
  const groupTable = page.getByRole('region', { name: '组间统计与独立单位' });
  await expect(groupTable).toBeVisible();
  const treatment = groupTable.locator('tbody tr').filter({ hasText: 'Treatment' });
  await expect(treatment.locator('td').nth(1)).toHaveText('3');
  await expect(treatment.locator('td').nth(2)).toHaveText('9');
  await expect(page.locator('.chart-axis-labels')).toContainText('Treatment');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 Excel（多表，含 ΔΔCt）' }).click();
  const download = await downloadPromise;
  const wb = XLSX.read(await readFile((await download.path())!), { type: 'buffer' });
  const all = wb.SheetNames.flatMap((name) => XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1 }) as unknown[][]);
  expect(all.some((row) => row.includes('confirmed'))).toBe(true);
  expect(all.some((row) => row.some((cell) => typeof cell === 'string' && cell.includes('"unitId"')))).toBe(true);
  await page.getByRole('button', { name: '← 上一步' }).click();
  await design.getByRole('textbox', { name: '独立单位 ID P1 C1', exact: true }).fill('new-independent-unit');
  await expect(confirm).not.toBeChecked();
  await page.getByRole('button', { name: '计算 ΔΔCt 并查看结果 →' }).click();
  await expect(groupTable).toHaveCount(0);
  await expect(page.getByRole('region', { name: '统计设计状态' })).toContainText('当前仅提供描述性结果');
});
