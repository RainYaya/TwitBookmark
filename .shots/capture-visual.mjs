import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const base = 'http://127.0.0.1:4320';
const out = resolve('.shots/visual-verify');
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

async function screenshot(name, run, scheme = 'light') {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 2,
    colorScheme: scheme,
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
  const target = resolve(out, name);
  writeFileSync(target, readFileSync(await video.path()));
  console.log('video', name);
}

const streamReady = async (page) => {
  await page.goto(`${base}/`);
  await page.getByText('待处理').first().waitFor();
  await page.waitForTimeout(400);
};

await screenshot('twitter-light.png', streamReady);
await screenshot('twitter-dark.png', streamReady, 'dark');

await screenshot('library-light.png', async (page) => {
  await page.goto(`${base}/library`);
  await page.getByRole('heading', { name: '库' }).waitFor();
  await page.getByTestId('library-row').first().waitFor();
  await page.waitForTimeout(400);
});
await screenshot(
  'library-dark.png',
  async (page) => {
    await page.goto(`${base}/library`);
    await page.getByTestId('library-row').first().waitFor();
    await page.waitForTimeout(400);
  },
  'dark',
);

await screenshot('settings-light.png', async (page) => {
  await page.goto(`${base}/settings`);
  await page.getByRole('heading', { name: '设置' }).waitFor();
  await page.waitForTimeout(400);
});
await screenshot('settings-tags.png', async (page) => {
  await page.goto(`${base}/settings`);
  await page.getByRole('heading', { name: '已有标签' }).scrollIntoViewIfNeeded();
  await page.getByLabel('已有标签 工具').waitFor();
  await page.waitForTimeout(400);
});

await screenshot('detail-light.png', async (page) => {
  await page.goto(`${base}/`);
  await page.getByText('待处理').first().waitFor();
  await page.selectOption('select[aria-label="标签"]', 'AI');
  await page.getByText('AI 建议').first().waitFor();
  await page.getByRole('button', { name: '详情' }).first().click();
  await page.getByRole('dialog', { name: '条目详情' }).waitFor();
  await page.waitForTimeout(400);
});

await screenshot('quickpass-light.png', async (page) => {
  await page.goto(`${base}/`);
  await page.getByText('待处理').first().waitFor();
  await page.getByRole('button', { name: '快速过一遍' }).click();
  await page.waitForTimeout(500);
});

await screenshot('trash-light.png', async (page) => {
  await page.goto(`${base}/library?deleted=1`);
  await page.getByRole('heading', { name: '回收站' }).waitFor();
  await page.getByRole('button', { name: '批量选择' }).click();
  await page.getByLabel('清理模式').waitFor();
  await page.evaluate(() => document.activeElement?.blur());
  await page.waitForTimeout(250);
  await page.keyboard.press('Space');
  await page.getByText('已选 1 条').waitFor();
  await page.keyboard.press('j');
  await page.waitForTimeout(250);
  await page.keyboard.press('Space');
  await page.getByText('已选 2 条').waitFor();
  await page.waitForTimeout(400);
});

await record('undo.webm', async (page) => {
  await page.goto(`${base}/library`);
  await page.getByTestId('library-row').first().waitFor();
  await page.getByRole('button', { name: '清理模式' }).click();
  await page.evaluate(() => document.activeElement?.blur());
  await page.waitForTimeout(600);
  await page.keyboard.press('j');
  await page.waitForTimeout(250);
  await page.keyboard.press('Space');
  await page.getByText('已选 1 条').waitFor();
  await page.waitForTimeout(600);
  await page.keyboard.press('d');
  await page.waitForTimeout(900);
  await page.keyboard.press('u');
  await page.waitForTimeout(1400);
});

await browser.close();
console.log('done');
