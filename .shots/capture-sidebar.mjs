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
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text());
});

await page.goto('http://127.0.0.1:4317/library');
await page.getByText('全部收藏').first().waitFor();
await page.getByText('zurawiki/gptcommit').first().waitFor();
await page.screenshot({ path: '.shots/sidebar-library.png' });
console.log('library', {
  sidebar: await page.locator('.sidebar').count(),
  rows: await page.locator('tbody tr').count(),
  counts: await page.locator('.sidebar .count').allInnerTexts(),
});

await page.goto('http://127.0.0.1:4317/');
await page.getByText('推特流').first().waitFor();
await page.getByText('AI 建议').first().waitFor();
await page.screenshot({ path: '.shots/sidebar-twitter.png' });
console.log('twitter', {
  sidebar: await page.locator('.sidebar').count(),
  cards: await page.locator('[data-testid="item-card"]').count(),
});
console.log({ errors });
await context.close();
await browser.close();
