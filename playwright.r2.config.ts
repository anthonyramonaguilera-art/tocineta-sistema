import { defineConfig, devices } from '@playwright/test';
import * as path from 'node:path';

const PORT = 3100;
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: './tools/r2-harness/specs',
  timeout: 30000,
  expect: {
    timeout: 5000
  },
  fullyParallel: false,
  forbidOnly: false,
  retries: 0,
  workers: 1, // Ejecución secuencial determinista para no colisionar en la BD
  reporter: [
    ['list'],
    ['json', { outputFile: 'docs/r2/evidencia/r2-results.json' }],
    ['html', { outputFolder: 'docs/r2/evidencia/playwright-report', open: 'never' }]
  ],
  outputDir: './docs/r2/evidencia/artifacts',
  use: {
    baseURL: BASE_URL,
    trace: 'on',
    video: 'on',
    screenshot: 'on',
    locale: 'es-VE',
    timezoneId: 'America/Caracas'
  },
  projects: [
    {
      name: 'movil-360x800',
      use: {
        browserName: 'chromium',
        viewport: { width: 360, height: 800 },
        hasTouch: true,
        isMobile: true
      }
    },
    {
      name: 'escritorio-1280x800',
      use: {
        browserName: 'chromium',
        viewport: { width: 1280, height: 800 },
        hasTouch: false,
        isMobile: false
      }
    }
  ],
  webServer: {
    command: 'pnpm exec tsx tools/r2-harness/run-test-server.ts',
    url: `${BASE_URL}/api/health`,
    reuseExistingServer: false,
    timeout: 60000,
    env: {
      NODE_ENV: 'test',
      TOCINETA_DB_PATH: path.resolve(process.cwd(), './data/tocineta.r2-harness.db'),
      TEST_PORT: String(PORT),
      TEST_HOST: '127.0.0.1'
    }
  }
});
