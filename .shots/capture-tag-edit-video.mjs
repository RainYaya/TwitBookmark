import { chromium } from '@playwright/test';

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 1,
  colorScheme: 'light',
  recordVideo: { dir: '.shots/video', size: { width: 1280, height: 800 } },
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(String(error)));

await page.goto('http://127.0.0.1:4320/library');
await page.getByTestId('library-row').first().waitFor();
await page.waitForTimeout(400);
await page.getByTestId('library-row').first().click();
await page.getByRole('dialog', { name: '条目详情' }).waitFor();
await page.waitForTimeout(500);

const input = page.getByLabel('添加标签');
await input.fill('验收标签');
await page.waitForTimeout(300);
await input.press('Enter');
await page.getByRole('button', { name: '移除标签 验收标签' }).waitFor();
await page.waitForTimeout(700);
await page.screenshot({ path: '.shots/tag-edit-demo.png' });

await page.getByRole('button', { name: '移除标签 验收标签' }).click();
await page.waitForTimeout(700);

const video = page.video();
await context.close();
console.log({ video: video ? await video.path() : null, errors });
await browser.close();
