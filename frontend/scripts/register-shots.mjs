// Screenshots of the redesigned /register (both wizard steps, light + dark).
import { chromium } from '@playwright/test';

const BASE = 'http://localhost:3002';
const OUT = '/tmp/clario360-shots';

const browser = await chromium.launch();
for (const theme of ['light', 'dark']) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 }, colorScheme: theme });
  const page = await ctx.newPage();
  await page.addInitScript((t) => localStorage.setItem('theme', t), theme);
  await page.goto(`${BASE}/register`, { waitUntil: 'networkidle', timeout: 45000 }).catch(() => {});
  await page.waitForTimeout(1800);
  await page.screenshot({ path: `${OUT}/register-step1-${theme}.png` });
  console.log(`captured register-step1-${theme}.png`);

  // Fill step 1 and advance to step 2 to capture the account step.
  try {
    await page.fill('#organization_name', 'Acme Holdings');
    await page.fill('#country', 'SA');
    // Click the primary "continue" button (last button in form on step 1).
    const cont = page.getByRole('button').filter({ hasText: /continue|next|account/i }).first();
    await cont.click({ timeout: 3000 });
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${OUT}/register-step2-${theme}.png` });
    console.log(`captured register-step2-${theme}.png`);
  } catch (e) {
    console.log(`step2 ${theme} skipped: ${e.message.slice(0, 80)}`);
  }
  await ctx.close();
}
await browser.close();
