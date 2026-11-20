import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const base = 'http://127.0.0.1:4320';
const out = resolve('.shots/verify');
mkdirSync(out, { recursive: true });

async function waitForServer() {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${base}/api/tags`);
      if (response.ok) return;
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('server did not start');
}

await waitForServer();
const browser = await chromium.launch();

async function screenshot(name, run) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 2,
    colorScheme: 'light',
  });
  const page = await context.newPage();
  await run(page);
  await page.screenshot({ path: resolve(out, name) });
  await context.close();
  console.log('shot', name);
}

async function record(name, run) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    colorScheme: 'light',
    recordVideo: { dir: resolve(out, 'raw'), size: { width: 1280, height: 800 } },
  });
  const page = await context.newPage();
  await run(page);
  const video = page.video();
  await context.close();
  const source = await video.path();
  const target = resolve(out, name);
  writeFileSync(target, (await import('node:fs')).readFileSync(source));
  console.log('video', name);
}

// 1. Twitter filters: the tag filter applied, cards carrying AI suggestions.
await screenshot('twitter-filters.png', async (page) => {
  await page.goto(`${base}/`);
  await page.getByText('待处理').first().waitFor();
  await page.selectOption('select[aria-label="标签"]', 'AI');
  await page.getByText('AI 建议').first().waitFor();
  await page.waitForTimeout(300);
});

// 2. Detail panel with body, AI suggestion and editable summary.
await screenshot('twitter-detail.png', async (page) => {
  await page.goto(`${base}/`);
  await page.getByText('待处理').first().waitFor();
  await page.selectOption('select[aria-label="标签"]', 'AI');
  await page.getByText('AI 建议').first().waitFor();
  await page.getByRole('button', { name: '详情' }).first().click();
  await page.getByRole('dialog', { name: '条目详情' }).waitFor();
  await page.waitForTimeout(300);
});

// 3. Library top: AI suggestions with per-item accept and current-filter accept.
await screenshot('library-top.png', async (page) => {
  await page.goto(`${base}/library`);
  await page.getByRole('heading', { name: '库' }).waitFor();
  await page.getByTestId('library-row').first().waitFor();
  await page.waitForTimeout(300);
});

// 4. Library pagination: the 加载更多 button after the first 50 rows.
await screenshot('library-more.png', async (page) => {
  await page.goto(`${base}/library`);
  await page.getByTestId('library-row').first().waitFor();
  const more = page.getByRole('button', { name: '加载更多' });
  await more.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
});

// 5. Trash: batch selection with 恢复所选.
await screenshot('trash-selection.png', async (page) => {
  await page.goto(`${base}/library?deleted=1`);
  await page.getByRole('heading', { name: '回收站' }).waitFor();
  await page.getByRole('button', { name: '批量选择' }).click();
  await page.getByLabel('清理模式').waitFor();
  await page.evaluate(() => document.activeElement?.blur());
  await page.waitForTimeout(200);
  await page.keyboard.press('Space');
  await page.getByText('已选 1 条').waitFor();
  await page.keyboard.press('j');
  await page.waitForTimeout(300);
  await page.keyboard.press('Space');
  await page.getByText('已选 2 条').waitFor();
  await page.waitForTimeout(300);
});

// 6. Settings: existing tag rename/delete.
await screenshot('settings-tags.png', async (page) => {
  await page.goto(`${base}/settings`);
  await page.getByRole('heading', { name: '已有标签' }).scrollIntoViewIfNeeded();
  await page.getByLabel('已有标签 工具').waitFor();
  await page.waitForTimeout(300);
});

// Video: accept an AI suggestion in the library.
await record('ai-accept.webm', async (page) => {
  await page.goto(`${base}/library`);
  await page.getByTestId('library-row').first().waitFor();
  const accept = page.getByRole('button', { name: '接受 AI' }).first();
  await accept.scrollIntoViewIfNeeded();
  await page.waitForTimeout(800);
  await accept.click();
  await page.waitForTimeout(1500);
});

// Video: select, remove, then undo the batch in cleanup mode.
await record('undo.webm', async (page) => {
  await page.goto(`${base}/library`);
  await page.getByTestId('library-row').first().waitFor();
  await page.getByRole('button', { name: '清理模式' }).click();
  await page.evaluate(() => document.activeElement?.blur());
  await page.waitForTimeout(600);
  await page.keyboard.press('j');
  await page.waitForTimeout(200);
  await page.keyboard.press('Space');
  await page.getByText('已选 1 条').waitFor();
  await page.waitForTimeout(600);
  await page.keyboard.press('d');
  await page.waitForTimeout(900);
  await page.keyboard.press('u');
  await page.waitForTimeout(1200);
});

// Video: batch restore from the trash.
await record('trash-restore.webm', async (page) => {
  await page.goto(`${base}/library?deleted=1`);
  await page.getByRole('button', { name: '批量选择' }).click();
  await page.getByLabel('清理模式').waitFor();
  await page.evaluate(() => document.activeElement?.blur());
  await page.waitForTimeout(500);
  await page.keyboard.press('Space');
  await page.getByText('已选 1 条').waitFor();
  await page.keyboard.press('j');
  await page.waitForTimeout(200);
  await page.keyboard.press('Space');
  await page.getByText('已选 2 条').waitFor();
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: '恢复所选' }).click();
  await page.waitForTimeout(1400);
});

await browser.close();
console.log('done');
