import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000';
const skipWebServer = process.env.PLAYWRIGHT_SKIP_WEB_SERVER === '1';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: 'html',
  timeout: 60_000,
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'setup', testMatch: /global-setup\.ts/ },
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        storageState: './e2e/.auth/user.json',
      },
      dependencies: ['setup'],
    },
  ],
  webServer: skipWebServer
    ? undefined
    : {
        command: 'npm run dev',
        url: baseURL,
        reuseExistingServer: true,
        timeout: 120_000,
      },
});
