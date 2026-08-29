// Core Web Vitals measurement against the local production build.
// Usage: node scripts/measure-cwv.mjs
// Requires: frontend prod server on :3002, IAM on :8081 (direct login).
// Measures TTFB / FCP / LCP / CLS / longtask-total per page, 3 runs, reports median.
import { chromium } from '@playwright/test';

const BASE = 'http://localhost:3002';
const IAM = 'http://localhost:8081';
const RUNS = 3;

const CREDS = { email: 'admin@clario.dev', password: 'Cl@rio360Dev!' };

const VITALS_INIT = `
  window.__vitals = { lcp: 0, cls: 0, fcp: 0, longtasks: 0 };
  new PerformanceObserver((l) => {
    for (const e of l.getEntries()) window.__vitals.lcp = e.startTime;
  }).observe({ type: 'largest-contentful-paint', buffered: true });
  new PerformanceObserver((l) => {
    for (const e of l.getEntries()) if (!e.hadRecentInput) window.__vitals.cls += e.value;
  }).observe({ type: 'layout-shift', buffered: true });
  new PerformanceObserver((l) => {
    for (const e of l.getEntries()) if (e.name === 'first-contentful-paint') window.__vitals.fcp = e.startTime;
  }).observe({ type: 'paint', buffered: true });
  new PerformanceObserver((l) => {
    for (const e of l.getEntries()) window.__vitals.longtasks += e.duration;
  }).observe({ type: 'longtask', buffered: true });
`;

async function login(context) {
  const resp = await context.request.post(`${IAM}/api/v1/auth/login`, { data: CREDS });
  if (!resp.ok()) throw new Error(`IAM login failed: ${resp.status()} ${await resp.text()}`);
  const { access_token, refresh_token } = await resp.json();
  const sess = await context.request.post(`${BASE}/api/auth/session`, {
    data: { access_token, refresh_token },
    // The BFF enforces same-origin (CSRF); API-context requests need it explicit.
    headers: { Origin: BASE, Referer: `${BASE}/login` },
  });
  if (!sess.ok()) throw new Error(`BFF session failed: ${sess.status()} ${await sess.text()}`);
}

async function measureOnce(browser, path, { auth }) {
  const context = await browser.newContext();
  try {
    if (auth) await login(context);
    const page = await context.newPage();
    await page.addInitScript(VITALS_INIT);
    await page.goto(`${BASE}${path}`, { waitUntil: 'load', timeout: 45000 });
    // Let late LCP candidates, hydration, data fetches and shifts settle.
    await page.waitForTimeout(3500);
    const m = await page.evaluate(() => {
      const nav = performance.getEntriesByType('navigation')[0];
      return {
        ttfb: nav ? nav.responseStart : 0,
        domContentLoaded: nav ? nav.domContentLoadedEventEnd : 0,
        load: nav ? nav.loadEventEnd : 0,
        finalUrl: location.pathname,
        ...window.__vitals,
      };
    });
    return m;
  } finally {
    await context.close();
  }
}

function median(arr) {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

const PAGES = [
  { path: '/login', auth: false, label: 'Login (unauthenticated)' },
  { path: '/dashboard', auth: true, label: 'Dashboard' },
  { path: '/cyber/alerts', auth: true, label: 'Cyber Alerts (data table)' },
  { path: '/cyber/cti', auth: true, label: 'CTI Overview (heavy viz)' },
  { path: '/admin/workflows/definitions', auth: true, label: 'Workflow Definitions' },
];

const browser = await chromium.launch();
const results = [];
for (const p of PAGES) {
  const runs = [];
  for (let i = 0; i < RUNS; i++) {
    try {
      runs.push(await measureOnce(browser, p.path, p));
    } catch (e) {
      runs.push({ error: String(e.message ?? e) });
    }
  }
  const ok = runs.filter((r) => !r.error);
  if (ok.length === 0) {
    results.push({ label: p.label, path: p.path, error: runs[0].error });
    continue;
  }
  results.push({
    label: p.label,
    path: p.path,
    finalUrl: ok[0].finalUrl,
    runs: ok.length,
    ttfb_ms: Math.round(median(ok.map((r) => r.ttfb))),
    fcp_ms: Math.round(median(ok.map((r) => r.fcp))),
    lcp_ms: Math.round(median(ok.map((r) => r.lcp))),
    cls: Number(median(ok.map((r) => r.cls)).toFixed(4)),
    longtasks_ms: Math.round(median(ok.map((r) => r.longtasks))),
    load_ms: Math.round(median(ok.map((r) => r.load))),
  });
}
await browser.close();

console.log(JSON.stringify(results, null, 2));
