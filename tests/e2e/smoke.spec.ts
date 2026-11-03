import { expect, test } from '@playwright/test';

test('library cleanup removes a row with the keyboard', async ({ page }) => {
  await page.goto('/library');
  await expect(page.getByRole('heading', { name: '库' })).toBeVisible();
  await expect(page.getByTestId('library-row')).toHaveCount(3);

  await page.getByRole('button', { name: '清理模式' }).click();
  await expect(page.getByLabel('清理模式')).toBeVisible();

  await page.keyboard.press('j');
  await page.keyboard.press(' ');
  await expect(page.getByText('已选 1 条')).toBeVisible();

  await page.keyboard.press('d');
  await expect(page.getByTestId('library-row')).toHaveCount(2);
  await expect(page.getByText('浏览器条目一')).toHaveCount(0);
});

test('twitter quick pass advances on x and returns on Escape', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('待处理 2 条')).toBeVisible();

  await page.getByRole('button', { name: '快速过一遍' }).click();
  const quick = page.getByLabel('快速过一遍');
  await expect(quick).toBeVisible();
  await expect(quick.getByText('1 / 2')).toBeVisible();

  await page.keyboard.press('x');
  await expect(quick.getByText('2 / 2')).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(page.getByLabel('快速过一遍')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '推特流' })).toBeVisible();
});

test('the reading-desk palette follows the color scheme', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/library');
  const light = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);

  await page.emulateMedia({ colorScheme: 'dark' });
  const dark = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);

  expect(light).not.toBe(dark);
});
