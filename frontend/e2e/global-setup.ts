import { test as setup } from '@playwright/test';
import { mintAdminToken, signInWithToken } from './e2e-auth';

const AUTH_FILE = './e2e/.auth/user.json';

setup('authenticate', async ({ page, baseURL }) => {
  await signInWithToken(page, baseURL, mintAdminToken());

  // Navigate briefly to let browser context register the cookies.
  await page.goto('/login', { waitUntil: 'commit' });

  // Save the authenticated state (cookies).
  await page.context().storageState({ path: AUTH_FILE });
});
