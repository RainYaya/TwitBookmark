import { chromium } from '@playwright/test';
import { resolve } from 'node:path';

const base = 'http://127.0.0.1:4317';
const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1400, height: 900 },
  deviceScaleFactor: 2,
  colorScheme: 'light',
});
const page = await context.newPage();
await page.goto(`${base}/library`);
await page.getByText('AI 建议').first().waitFor({ timeout: 20000 });
await page.screenshot({ path: resolve('.shots/ai-classified-library.png') });
const count = await page.getByText('AI 建议').count();
const first = await page.locator('tbody tr').first().innerText();
console.log({ suggestions: count, first: first.replace(/\s+/g, ' ').slice(0, 300) });
await context.close();
await browser.close();
