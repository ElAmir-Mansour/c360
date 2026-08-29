import { defineConfig, devices } from '@playwright/test';

// Like playwright.verify.config.ts but WITHOUT the setup dependency — reuses the
// already-saved e2e/.auth/user.json so multiple concurrent runs (workflow agents)
// don't race on writing the auth file. The app auto-refreshes the access token
// via the BFF refresh cookie carried in storageState, so the session stays valid.
export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  fullyParallel: false,
  use: {
    baseURL: 'http://localhost:3002',
    storageState: './e2e/.auth/user.json',
    trace: 'off',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
