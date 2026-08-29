import { test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { A11Y_ROUTES } from './a11y-routes';

/* Parametrized axe probe for the a11y-remediation workflow.
 * Usage: A11Y_ROUTES="/cyber,/admin/users" npx playwright test e2e/axe-param.spec.ts \
 *   --config=playwright.verify.config.ts --project=chromium --reporter=line 2>&1 | grep AXEJSON
 * Emits one `AXEJSON <route> <json>` line per route with serious/critical violations,
 * each node's target selector + truncated outerHTML so the source can be grepped.
 * A11Y_ROUTES=all probes the full canonical list (e2e/a11y-routes.ts). When unset,
 * the file contributes no tests (so default `npm run test:e2e` sweeps stay fast). */

const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const raw = (process.env.A11Y_ROUTES || '').trim();
const routes =
  raw === 'all'
    ? A11Y_ROUTES
    : raw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

for (const route of routes) {
  test(`axe ${route}`, async ({ page }) => {
    await page.goto(route, { waitUntil: 'domcontentloaded' }).catch(() => undefined);
    await page.waitForLoadState('networkidle', { timeout: 6000 }).catch(() => undefined);
    await page
      .waitForFunction(() => !document.querySelector('[aria-busy="true"]'), undefined, {
        timeout: 8000,
      })
      .catch(() => undefined);
    await page.waitForTimeout(300);
    const r = await new AxeBuilder({ page }).withTags(WCAG).analyze();
    const s = r.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    const compact = s.map((v) => ({
      id: v.id,
      nodes: v.nodes.slice(0, 8).map((n) => ({
        target: n.target,
        html: (n.html || '').slice(0, 220),
      })),
    }));
    console.log(`AXEJSON ${route} ${JSON.stringify(compact)}`);
  });
}
