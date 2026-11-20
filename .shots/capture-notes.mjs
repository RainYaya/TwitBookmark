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

await page.goto('http://127.0.0.1:4320/library');
await page.getByText('全部收藏').first().waitFor();
await page.getByTestId('library-row').first().waitFor();
await page.screenshot({ path: '.shots/sidebar-library.png' });

const noted = page.locator('tbody tr', { hasText: '留着自己再读' }).first();
await noted.click();
await page.getByRole('dialog', { name: '条目详情' }).waitFor();
await page.screenshot({ path: '.shots/sidebar-note-detail.png' });
console.log({
  noteBlocks: await page.locator('.my-note').count(),
  errors,
});
await context.close();
await browser.close();
