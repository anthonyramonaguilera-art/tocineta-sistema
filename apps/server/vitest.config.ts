import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts'],
    testTimeout: 10000,
    fileParallelism: false,
    setupFiles: ['./test/setup.ts'],
    env: {
      NODE_ENV: 'test',
      VITEST: 'true',
      DB_PATH: './data/tocineta.test.db'
    }
  }
});
