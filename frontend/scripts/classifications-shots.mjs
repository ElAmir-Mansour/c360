// Screenshot the redesigned case-classifications admin page (light + dark).
import { chromium } from '@playwright/test';

const BASE = 'http://localhost:3002';
const IAM = 'http://localhost:8081';
const OUT = '/tmp/clario360-shots';
const PATH = '/lex/admin/classifications';

async function login(ctx) {
  const r = await ctx.request.post(`${IAM}/api/v1/auth/login`, {
    data: { email: 'admin@clario.dev', password: 'Cl@rio360Dev!' },
  });
  const { access_token, refresh_token } = await r.json();
  await ctx.request.post(`${BASE}/api/auth/session`, {
    data: { access_token, refresh_token },
    headers: { Origin: BASE, Referer: `${BASE}/login` },
  });
}

const browser = await chromium.launch();
for (const theme of ['light', 'dark']) {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1150 }, colorScheme: theme });
  await login(ctx);
  const page = await ctx.newPage();
  await page.addInitScript((t) => localStorage.setItem('theme', t), theme);
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 160)));
  await page.goto(`${BASE}${PATH}`, { waitUntil: 'networkidle', timeout: 45000 }).catch((e) => errors.push('NAV ' + e.message));
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${OUT}/classifications-${theme}.png`, fullPage: true });
  const h1 = await page.locator('h1').first().innerText().catch(() => '?');
  const kpis = await page.locator('text=/coverage|references|matters/i').count().catch(() => 0);
  console.log(`${theme}: h1="${h1}" viz-signals=${kpis} pageerrors=${errors.length}${errors.length ? ' :: ' + errors.join(' | ') : ''}`);
  await ctx.close();
}
await browser.close();
