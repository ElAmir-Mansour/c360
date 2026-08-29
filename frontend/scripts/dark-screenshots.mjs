// Capture light/dark screenshots of viz-heavy pages for visual verification.
import { chromium } from '@playwright/test';

const BASE = 'http://localhost:3002';
const IAM = 'http://localhost:8081';
const OUT = '/tmp/clario360-shots';

async function login(context) {
  const resp = await context.request.post(`${IAM}/api/v1/auth/login`, {
    data: { email: 'admin@clario.dev', password: 'Cl@rio360Dev!' },
  });
  const { access_token, refresh_token } = await resp.json();
  await context.request.post(`${BASE}/api/auth/session`, {
    data: { access_token, refresh_token },
    headers: { Origin: BASE, Referer: `${BASE}/login` },
  });
}

const PAGES = [
  ['cti', '/cyber/cti'],
  ['soc', '/cyber'],
  ['dashboard', '/dashboard'],
];

const browser = await chromium.launch();
for (const theme of ['light', 'dark']) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    colorScheme: theme,
  });
  await login(context);
  const page = await context.newPage();
  // next-themes persists choice in localStorage('theme'); set before app code runs.
  await page.addInitScript((t) => localStorage.setItem('theme', t), theme);
  for (const [name, path] of PAGES) {
    await page.goto(`${BASE}${path}`, { waitUntil: 'load', timeout: 45000 });
    await page.waitForTimeout(3000);
    await page.screenshot({ path: `${OUT}/${name}-${theme}.png` });
    console.log(`captured ${name}-${theme}.png`);
  }
  await context.close();
}
await browser.close();
