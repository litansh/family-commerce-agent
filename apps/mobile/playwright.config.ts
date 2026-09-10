import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'e2e',
  timeout: 120_000,
  retries: 0,
  use: { viewport: { width: 430, height: 932 }, locale: 'he-IL', screenshot: 'only-on-failure', video: 'off', trace: 'retain-on-failure' },
  reporter: [['list']],
  outputDir: 'e2e/results',
  // The exported web build, for specs that run against a mocked API (connect.spec.ts).
  webServer: { command: 'python3 -m http.server 4173 --directory dist', port: 4173, reuseExistingServer: true, timeout: 20_000 },
});
