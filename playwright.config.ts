import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e', testMatch: '**/*.e2e.ts', workers: 1,
  timeout: process.env.CI ? 90000 : 45000,
  expect: { timeout: process.env.CI ? 15000 : 5000 },
  reporter: [['list'], ['json', { outputFile: 'test-results/results.json' }], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  use: { trace: 'retain-on-failure', screenshot: 'only-on-failure' },
});
