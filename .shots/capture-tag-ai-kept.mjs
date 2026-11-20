import { chromium } from '@playwright/test';

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
  colorScheme: 'light',
  recordVideo: { dir: '.shots/video', size: { width: 1440, height: 900 } },
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(String(error)));

await page.goto('http://127.0.0.1:4320/library?ai=suggested&q=SQLite');
const row = page.locator('[data-testid="library-row"]', {
  hasText: 'SQLite 的 WAL 模式与实践',
});
await row.waitFor();
await page.waitForTimeout(400);

await page.getByRole('button', { name: '清理模式' }).click();
await page.waitForTimeout(300);
await page.keyboard.press(' ');
await page.keyboard.press('t');

const dialog = page.getByRole('dialog', { name: '选择标签' });
await dialog.waitFor();
await page.waitForTimeout(300);
await page.getByLabel('新标签').fill('验收标签');
await page.getByLabel('新标签').press('Enter');
await dialog.waitFor({ state: 'detached' });
await page.waitForTimeout(500);

const suggestion = row.locator('[data-testid="ai-suggest"]');
await suggestion.waitFor();
await page.screenshot({ path: '.shots/tag-ai-kept.png' });
console.log({ aiKept: await suggestion.count() });

await page.keyboard.press('t');
await dialog.waitFor();
await page.waitForTimeout(300);
await dialog.getByRole('checkbox', { name: /验收标签/ }).uncheck();
await page.getByRole('button', { name: '保存' }).click();
await dialog.waitFor({ state: 'detached' });
await page.waitForTimeout(500);

const video = page.video();
await context.close();
console.log({ video: video ? await video.path() : null, errors });
await browser.close();
