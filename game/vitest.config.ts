import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // Allow FULL-sync SQLite fixtures to complete on busy disks.
    testTimeout: 60_000,
    fileParallelism: false,
  },
});
