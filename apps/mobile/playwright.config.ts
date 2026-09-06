import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'e2e',
  timeout: 120_000,
  retries: 0,
  use: { viewport: { width: 430, height: 932 }, locale: 'he-IL', screenshot: 'only-on-failure', video: 'off', trace: 'retain-on-failure' },
  reporter: [['list']],
  outputDir: 'e2e/results',
});
