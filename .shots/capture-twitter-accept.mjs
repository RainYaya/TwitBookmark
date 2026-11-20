import { chromium } from '@playwright/test';

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1400, height: 900 },
  deviceScaleFactor: 2,
  colorScheme: 'light',
});
const page = await context.newPage();
await page.goto('http://127.0.0.1:4317/');
await page.getByText('AI 建议').first().waitFor({ timeout: 20000 });
const accept = page.getByRole('button', { name: '接受 AI' }).first();
await accept.scrollIntoViewIfNeeded();
await page.screenshot({ path: '.shots/ai-classified-twitter.png' });
console.log({
  acceptButtons: await page.getByRole('button', { name: '接受 AI' }).count(),
  bulk: await page.getByRole('button', { name: '接受当前筛选建议' }).count(),
  firstSuggestion: (await page.locator('[data-testid="ai-suggest"]').first().innerText())
    .replace(/\s+/g, ' ')
    .slice(0, 200),
});
await context.close();
await browser.close();
