import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  outputDir: process.env.CHRONICLE_TEST_OUTPUT ?? './test-results',
  testMatch: /.*\.e2e\.ts/,
  // Cold Electron profiles, FULL-sync saves and the screenshot gallery use disk.
  timeout: 180_000,
  expect: { timeout: 30_000 },
  workers: 1,
  retries: 0,
  reporter: [['list']],
});
