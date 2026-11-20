import { chromium } from '@playwright/test';

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(String(error)));
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text());
});
await page.goto('http://127.0.0.1:4317/library');
await page.waitForTimeout(3000);
console.log(JSON.stringify({
  url: page.url(),
  title: await page.title(),
  body: (await page.locator('body').innerText()).slice(0, 1200),
  rows: await page.locator('tbody tr').count(),
  errors,
}, null, 2));
await page.screenshot({ path: '.shots/library-debug.png' });
await context.close();
await browser.close();
