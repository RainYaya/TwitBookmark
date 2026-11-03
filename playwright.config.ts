import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4319',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm build && pnpm exec tsx tests/e2e/serve.ts',
    url: 'http://127.0.0.1:4319',
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      PORT: '4319',
      DB_PATH: 'data/e2e.db',
    },
  },
});
