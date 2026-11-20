import { chromium } from '@playwright/test';

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
  colorScheme: 'light',
});
const page = await context.newPage();

await page.goto('http://127.0.0.1:4320/library');
await page.getByText('全部收藏').first().waitFor();
if ((await page.getByText('拖拽测试').count()) === 0) {
  await page.getByRole('button', { name: '新建收藏夹' }).click();
  await page.getByLabel('收藏夹名称').fill('拖拽测试');
  await page.getByLabel('收藏夹名称').press('Enter');
  await page.getByText('拖拽测试').waitFor();
}
const row = page.locator('tbody tr').nth(1);
const title = await row.locator('.cell-title a').innerText();
await row.dragTo(page.getByText('拖拽测试'));
await page.waitForTimeout(1000);
await page.screenshot({ path: '.shots/sidebar-drag.png' });

const facets = await (await fetch('http://127.0.0.1:4320/api/facets')).json();
console.log({
  title,
  folder: facets.collections.find((entry) => entry.name === '拖拽测试'),
});
await context.close();
await browser.close();
