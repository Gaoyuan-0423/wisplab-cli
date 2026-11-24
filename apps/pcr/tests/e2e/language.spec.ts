import { expect, test, type Page } from 'playwright/test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const fixture = (name: string) => fileURLToPath(new URL('../fixtures/' + name, import.meta.url));
const chinese = /\p{Script=Han}/u;
async function assertEnglishUi(page: Page) {
  const residual = await page.evaluate(() => {
    const root = document.querySelector('main')!;
    const found: string[] = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const parent = node.parentElement;
      if (parent && parent.getClientRects().length && /\p{Script=Han}/u.test(node.textContent ?? '')) found.push(node.textContent!.trim());
    }
    for (const element of document.querySelectorAll('[placeholder], [title], [aria-label]')) {
      for (const attr of ['placeholder','title','aria-label']) {
        const value = element.getAttribute(attr);
        if (value && /\p{Script=Han}/u.test(value) && value !== '中文 / English') found.push(attr + ': ' + value);
      }
    }
    return found;
  });
  expect(residual).toEqual([]);
}

test('language URL priority, persistence, navigation and responsive import screen', async ({ page }, testInfo) => {
  await page.goto('/?lang=zh');
  await page.evaluate(() => localStorage.setItem('wisplab.lang','zh'));
  await page.goto('/?lang=en&keep=1#guide');
  await expect(page.getByRole('heading',{name:'PCR Workbench',exact:true})).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang','en');
  expect(await page.evaluate(()=>localStorage.getItem('wisplab.lang'))).toBe('en');
  expect(page.url()).toContain('keep=1'); expect(page.url()).toContain('#guide');
  for (const link of await page.locator('.suite-nav a').all()) expect(await link.getAttribute('href')).toContain('lang=en');
  await page.getByText('❓ How does this step work?').click();
  await assertEnglishUi(page);
  await page.screenshot({path:testInfo.outputPath('pcr-en-home.png'),fullPage:true});
  for (const width of [320,390]) {
    await page.setViewportSize({width,height:844});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  }
  await page.screenshot({path:testInfo.outputPath('pcr-en-mobile.png'),fullPage:true});
  await page.goto('/?keep=1#guide');
  await expect(page.locator('html')).toHaveAttribute('lang','en');
  await page.getByRole('button',{name:'中文',exact:true}).click();
  await expect(page.getByRole('heading',{name:'PCR 工作台',exact:true})).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang','zh-CN');
  expect(page.url()).toContain('lang=zh'); expect(page.url()).toContain('keep=1'); expect(page.url()).toContain('#guide');
  await page.reload();
  await expect(page.getByRole('heading',{name:'PCR 工作台',exact:true})).toBeVisible();
});

test('English automatic results, all steps and dialogs; switching retains analysis and chart settings', async ({page},testInfo)=>{
  const errors:string[]=[]; page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/?lang=en');
  await page.getByRole('button',{name:'CFX demo',exact:true}).click();
  await expect(page.locator('.results tbody tr')).toHaveCount(6);
  await expect(page.locator('.chart-preview svg')).toBeVisible();
  await assertEnglishUi(page);
  const values=await page.locator('.results tbody tr').evaluateAll(rows=>rows.map(row=>Array.from(row.querySelectorAll('td')).slice(2,9).map(cell=>cell.textContent)));
  const svg=await page.locator('.chart-preview svg').evaluate(el=>el.outerHTML.replace(/plotclip\d+/g, 'plotclip'));
  await page.getByRole('button',{name:'中文',exact:true}).click();
  await expect(page.getByRole('heading',{name:/ΔΔCt 结果表/})).toBeVisible();
  await page.getByRole('button',{name:'EN',exact:true}).click();
  expect(await page.locator('.results tbody tr').evaluateAll(rows=>rows.map(row=>Array.from(row.querySelectorAll('td')).slice(2,9).map(cell=>cell.textContent)))).toEqual(values);
  expect(await page.locator('.chart-preview svg').evaluate(el=>el.outerHTML.replace(/plotclip\d+/g, 'plotclip'))).toBe(svg);
  await page.getByPlaceholder('Blank = gene name').fill('用户图题');
  await page.getByRole('button',{name:'中文',exact:true}).click();
  await expect(page.getByPlaceholder('留空 = 基因名')).toHaveValue('用户图题');
  await page.getByRole('button',{name:'EN',exact:true}).click();
  await expect(page.locator('.chart-preview svg')).toContainText('用户图题');
  await page.getByPlaceholder('Blank = gene name').fill('');
  const [download]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:'Export results CSV',exact:true}).click()]);
  const csv=await readFile((await download.path())!,'utf8');
  expect(csv).toContain('Target,Sample,Group,Control'); expect(csv).toContain('Control-1'); expect(csv).not.toMatch(chinese);
  await page.screenshot({path:testInfo.outputPath('pcr-en-results.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({path:testInfo.outputPath('pcr-en-mobile-results.png'),fullPage:true});
  await page.setViewportSize({width:1280,height:900});
  for(const step of ['Plate & settings','Confirm mapping']){
    await page.locator('.steps button').filter({hasText:step}).click();
    await assertEnglishUi(page);
    await page.getByText('❓ How does this step work?').click();
    await assertEnglishUi(page);
  }
  await page.getByRole('button',{name:'AI settings',exact:true}).click();
  await assertEnglishUi(page);
  await page.getByRole('button',{name:'Save',exact:true}).click();
  await expect(page.getByRole('alert')).toHaveText('Enter an API key');
  await page.getByRole('button',{name:'Cancel',exact:true}).click();
  await page.getByRole('button',{name:'My projects',exact:true}).click();
  await assertEnglishUi(page);
  await page.getByRole('button',{name:'Close',exact:true}).click();
  expect(errors).toEqual([]);
});

test('English manual import preserves Chinese sample/file names and selected mapping',async({page})=>{
  await page.goto('/?lang=en');
  const csv=(await readFile(fixture('cfx-style.csv'),'utf8')).replaceAll('Control-1','中文对照样本');
  await page.setInputFiles('input[type=file]',{name:'我的实验.csv',mimeType:'text/csv',buffer:Buffer.from(csv)});
  await expect(page.getByRole('heading',{name:/Confirm headers and column mapping/})).toBeVisible();
  await expect(page.locator('.preview')).toContainText('中文对照样本');
  const mapping=await page.getByRole('combobox',{name:'Sample ID',exact:true}).inputValue();
  await page.getByRole('button',{name:'中文',exact:true}).click();
  await expect(page.getByRole('combobox',{name:'样本 ID',exact:true})).toHaveValue(mapping);
  await page.getByRole('button',{name:'EN',exact:true}).click();
  await page.getByRole('button',{name:'Next: plate & settings →',exact:true}).click();
  await page.locator('.check-list label').filter({hasText:'中文对照样本'}).locator('input').check();
  await page.getByRole('button',{name:'Calculate ΔΔCt and view results →',exact:true}).click();
  await expect(page.locator('.results')).toContainText('中文对照样本');
  await expect(page.locator('.chart-preview svg')).toContainText('中文对照样本');
});

test('English standard curves, NTC/QC messages, merge and parse errors have no untranslated UI',async({page})=>{
  await page.goto('/?lang=en');
  await page.getByRole('button',{name:'Standard curve demo',exact:true}).click();
  await expect(page.locator('.results tbody tr')).not.toHaveCount(0);
  await assertEnglishUi(page);
  await page.locator('.steps button').filter({hasText:'Plate & settings'}).click();
  await assertEnglishUi(page);
  await page.goto('/?lang=en');
  await page.getByRole('button',{name:'My projects',exact:true}).click();
  await page.getByRole('button',{name:'＋ New project',exact:true}).click();
  await page.setInputFiles('input[type=file]',[fixture('merge-plate1.csv'),fixture('merge-plate2.csv')]);
  await expect(page.getByRole('heading',{name:/Merged 2 files/})).toBeVisible();
  await assertEnglishUi(page);
  await page.getByRole('button',{name:'My projects',exact:true}).click();
  await page.getByRole('button',{name:'＋ New project',exact:true}).click();
  await page.getByRole('button',{name:'Automatic analysis',exact:true}).click();
  await page.setInputFiles('input[type=file]',fixture('cfx-ntc-style.csv'));
  await expect(page.locator('.issue-list li.sev-error')).not.toHaveCount(0);
  await assertEnglishUi(page);
  await page.locator('.steps button').filter({hasText:'Plate & settings'}).click();
  await assertEnglishUi(page);
  await page.getByRole('button',{name:'My projects',exact:true}).click();
  await page.getByRole('button',{name:'＋ New project',exact:true}).click();
  await page.setInputFiles('input[type=file]',{name:'bad.rdml',mimeType:'application/xml',buffer:Buffer.from('<bad/>')});
  await expect(page.getByRole('alert')).toContainText('Parsing failed: Invalid RDML file');
  await assertEnglishUi(page);
});

test('English melt summary and RDML reports, axis warnings and multi-sheet dialog',async({page})=>{
  await page.goto('/?lang=en');
  await page.getByRole('button',{name:'CFX demo',exact:true}).click();
  await expect(page.locator('.chart-preview svg')).toHaveAttribute('aria-label','Relative expression chart');
  await page.getByLabel('Enable Y-axis break',{exact:true}).check();
  await page.getByLabel('Omitted range start',{exact:true}).fill('99');
  await page.getByLabel('Omitted range end',{exact:true}).fill('5');
  await expect(page.locator('.chart-setting-error')).toContainText('Axis break requires');
  await assertEnglishUi(page);
  await page.locator('.steps button').filter({hasText:'Plate & settings'}).click();
  await page.setInputFiles('input[type=file]',fixture('melt-summary.csv'));
  await expect(page.locator('.qc-flag-row').filter({hasText:'Treat-3'})).toContainText('2 melt peaks');
  await assertEnglishUi(page);
  await page.getByRole('button',{name:'My projects',exact:true}).click();
  await page.getByRole('button',{name:'＋ New project',exact:true}).click();
  await page.getByRole('button',{name:'Automatic analysis',exact:true}).click();
  await page.setInputFiles('input[type=file]',fixture('real/stepone_std.rdml'));
  await expect(page.locator('.issue-list')).toContainText('Efficiencies declared in RDML targets applied');
  await assertEnglishUi(page);
  await page.getByRole('button',{name:'My projects',exact:true}).click();
  await page.getByRole('button',{name:'＋ New project',exact:true}).click();
  const XLSX=await import('xlsx');
  const workbook=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook,XLSX.utils.aoa_to_sheet([['Sample','Target','Cq'],['Ctrl','GAPDH',18]]),'Plate1');
  XLSX.utils.book_append_sheet(workbook,XLSX.utils.aoa_to_sheet([['Sample','Target','Cq'],['Ctrl','LDHA',23]]),'Plate2');
  await page.setInputFiles('input[type=file]',{name:'two-plates.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:XLSX.write(workbook,{type:'buffer',bookType:'xlsx'})});
  await expect(page.getByRole('dialog',{name:'Choose worksheet'})).toBeVisible();
  await assertEnglishUi(page);
});

test('blocked storage still permits language switching; active error and toast follow current language',async({page})=>{
  await page.addInitScript(()=>{
    Storage.prototype.getItem=()=>{throw new DOMException('Blocked','SecurityError')};
    Storage.prototype.setItem=()=>{throw new DOMException('Blocked','SecurityError')};
  });
  await page.goto('/?lang=en&keep=1#test');
  await page.setInputFiles('input[type=file]',{name:'bad.rdml',mimeType:'application/xml',buffer:Buffer.from('<bad/>')});
  await expect(page.getByRole('alert')).toContainText('Parsing failed: Invalid RDML file');
  await page.getByRole('button',{name:'中文',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('解析失败：不是有效的 RDML 文件');
  await page.getByRole('button',{name:'EN',exact:true}).click();
  await page.getByRole('button',{name:'CFX demo',exact:true}).click();
  await expect(page.getByRole('status')).toContainText('Automatic analysis complete');
  await page.getByRole('button',{name:'中文',exact:true}).click();
  await expect(page.getByRole('status')).toContainText('一键分析完成');
  expect(page.url()).toContain('keep=1');expect(page.url()).toContain('#test');
});
