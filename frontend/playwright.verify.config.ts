import { defineConfig, devices } from '@playwright/test';

// One-off verification config: run against the live pm2 app on :3002 (the dev
// port; the base config's :3000 is stale) and reuse the IAM-login global-setup.
// No webServer — the app is already running.
export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  // Heavy data routes occasionally flake under sequential load (axe on a large
  // DOM, polling pages). Retries let transient timeouts self-heal; a genuine
  // violation still fails every attempt.
  retries: 2,
  fullyParallel: false,
  // The live Next.js dev host compiles large Watheeq routes on demand. Multiple
  // browser workers can force several 7k+ module graphs to compile at once and
  // exhaust the dev server heap, producing infrastructure failures instead of
  // useful integration results.
  workers: 1,
  // Tolerate AA / sub-pixel noise across a rebuild; tokenization is
  // color-preserving so real diffs should be ~0.
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.04, animations: 'disabled' } },
  use: {
    baseURL: 'http://localhost:3002',
    trace: 'off',
  },
  projects: [
    { name: 'setup', testMatch: /global-setup\.ts/ },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], storageState: './e2e/.auth/user.json' },
      dependencies: ['setup'],
    },
  ],
});
