import { chromium } from '@playwright/test';

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
  colorScheme: 'light',
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(String(error)));

await page.goto('http://127.0.0.1:4317/library');
await page.getByTestId('library-row').first().waitFor();
await page.getByTestId('library-row').first().click();
await page.getByRole('dialog', { name: '条目详情' }).waitFor();
await page.screenshot({ path: '.shots/tag-edit-detail.png' });
console.log({
  addTag: await page.getByLabel('添加标签').count(),
  errors,
});
await context.close();
await browser.close();
