import path from 'node:path';

import { defineConfig, devices } from '@playwright/test';

const baseURL = 'http://127.0.0.1:3107';

/** Focused public-gallery verification with no authentication dependency. */
export default defineConfig({
  testDir: './e2e',
  testMatch: /legal-director-(?:panels|dashboard)-gallery\.spec\.ts/,
  outputDir: 'test-results/public-gallery',
  timeout: 180_000,
  fullyParallel: false,
  workers: 1,
  reporter: 'line',
  use: {
    baseURL,
    trace: 'off',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run dev -- --port 3107',
    url: `${baseURL}/ui-gallery`,
    reuseExistingServer: true,
    timeout: 240_000,
    env: {
      NEXT_FONT_GOOGLE_MOCKED_RESPONSES: path.resolve(
        process.cwd(),
        'e2e/next-font-mocks.cjs',
      ),
    },
  },
});
