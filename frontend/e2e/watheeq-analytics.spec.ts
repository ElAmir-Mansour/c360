import { test, expect, type Locator, type Page } from '@playwright/test';

/* ==================================================================
 *  Watheeq legal suite — ANALYTICS, REPORTS & DASHBOARD (demo-prep).
 *
 *  Highest visual-embarrassment risk: charts must actually render.
 *  recharts previously shipped a blank-chart ResponsiveContainer bug,
 *  so the key assertion here is that a real chart surface (a sizeable
 *  <svg> / recharts container / <canvas>) is painted on every analytics
 *  page — not just the lucide icon <svg>s that live in headers/buttons.
 *
 *  For every route we also assert:
 *    - we are NOT bounced to /login (auth/storageState is wired)
 *    - the route-level error boundary (RouteError) did NOT trip
 *    - a real top-level <h1> heading is visible
 *    - the <html> element carries a dir (ltr/rtl) — RTL is the default
 *
 *  Authenticated storageState + baseURL come from playwright.config.ts.
 * ================================================================== */

interface AnalyticsRoute {
  path: string;
  /** Chart-bearing analytics surfaces must paint a real chart svg/canvas. */
  charts: boolean;
}

const ROUTES: AnalyticsRoute[] = [
  { path: '/lex', charts: false }, // command center (persona-gated charts)
  { path: '/lex/analytics', charts: true }, // workload heatmap + velocity charts
  { path: '/lex/analytics/risk', charts: true }, // gauges + donut + histogram
  { path: '/lex/reports', charts: false }, // KPI + CSS breakdown bars + tables
  { path: '/lex/reports/analytics', charts: true }, // 10-chart analytics hub
];

/** RouteError boundary headings (src/components/common/route-error.tsx). */
const ERROR_BOUNDARY_TEXT = /Something went wrong|Couldn.t load/i;

/** Let react-query settle and loading skeletons clear before asserting. */
async function settle(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => undefined);
  await page
    .waitForFunction(() => !document.querySelector('[aria-busy="true"]'), undefined, {
      timeout: 10_000,
    })
    .catch(() => undefined);
  await page.waitForTimeout(300);
}

/**
 * The core anti-blank-chart check. A lucide icon is an <svg> too, so a naive
 * `locator('svg')` would pass even on a broken page. We instead require a
 * genuine chart surface: a recharts container/surface, a <canvas>, or any
 * <svg> whose painted box is chart-sized (>= 120x80) — icons are ~16-36px.
 */
async function expectChartRendered(page: Page, route: string): Promise<void> {
  const rendered = await page
    .waitForFunction(
      () => {
        if (
          document.querySelector(
            '.recharts-surface, .recharts-wrapper, .recharts-responsive-container',
          )
        ) {
          return true;
        }
        if (document.querySelector('canvas')) return true;
        const svgs = Array.from(document.querySelectorAll('svg'));
        return svgs.some((el) => {
          const r = el.getBoundingClientRect();
          return r.width >= 120 && r.height >= 80;
        });
      },
      undefined,
      { timeout: 20_000 },
    )
    .then(() => true)
    .catch(() => false);

  expect(
    rendered,
    `no chart surface (svg/canvas/recharts container) rendered on ${route}`,
  ).toBe(true);
}

for (const route of ROUTES) {
  test(`${route.path} — loads, no error boundary, heading + dir${route.charts ? ' + charts render' : ''}`, async ({
    page,
  }) => {
    // In Next dev mode these dashboard routes can stream the initial shell
    // before DOMContentLoaded settles. The assertions below wait for the real
    // page heading and chart surfaces, so commit is the right navigation gate.
    await page.goto(route.path, { waitUntil: 'commit' });
    await settle(page);

    // Auth is wired: we must not be redirected to the login screen.
    expect(page.url(), `redirected to /login from ${route.path}`).not.toContain('/login');

    // The route-level error boundary must not have tripped.
    await expect(
      page.getByText(ERROR_BOUNDARY_TEXT).first(),
      `error boundary rendered on ${route.path}`,
    ).toHaveCount(0);

    // A real, visible top-level heading (PageHeader / CommandHero both emit <h1>).
    await expect(page.locator('h1').first()).toBeVisible({ timeout: 15_000 });

    // The document carries a direction (RTL is the Watheeq default).
    const dir = await page.evaluate(() => document.documentElement.getAttribute('dir'));
    expect(dir, `<html> missing dir on ${route.path}`).toMatch(/^(rtl|ltr)$/);

    // KEY CHECK — charts must actually paint on the analytics surfaces.
    if (route.charts) {
      await expectChartRendered(page, route.path);
    }
  });
}

test('/lex/reports/analytics — KPI opens its contributing requests', async ({
  page,
}) => {
  await page.route(
    '**/api/v1/lex/reports/detailed-analytics/contributors**',
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [
            {
              request_id: '11111111-1111-4111-8111-111111111111',
              request_number: 'LR-2026-0042',
              title: {
                en: 'Contract review for strategic supplier',
                ar: 'مراجعة عقد المورد الاستراتيجي',
              },
              department: 'Procurement',
              request_type: 'contract_review',
              priority: 'urgent',
              status: 'in_execution',
              requester_name: 'Demo Requester',
              created_at: '2026-07-20T09:00:00Z',
            },
          ],
          meta: { page: 1, per_page: 20, total: 1, total_pages: 1 },
        }),
      });
    },
  );

  await page.goto('/lex/reports/analytics', { waitUntil: 'commit' });
  await expect(
    page.getByRole('button', {
      name: 'View requests contributing to Total requests',
    }),
  ).toBeVisible({ timeout: 60_000 });

  await page
    .getByRole('button', {
      name: 'View requests contributing to Total requests',
    })
    .click();

  await expect(
    page.getByRole('heading', { name: 'Total requests', exact: true }),
  ).toBeVisible();
  await expect(page.getByText('LR-2026-0042')).toBeVisible();
  await expect(
    page.getByText('Contract review for strategic supplier'),
  ).toBeVisible();
});

test('/lex/reports/analytics — every KPI resolves its real contributor sample', async ({
  page,
}) => {
  await page.goto('/lex/reports/analytics', { waitUntil: 'commit' });
  const metrics = [
    'Total requests',
    'Completion rate',
    'Average processing time',
    'Satisfaction',
    'SLA compliance',
    'Pending requests',
  ];

  for (const metric of metrics) {
    const trigger = page.getByRole('button', {
      name: `View requests contributing to ${metric}`,
    });
    await expect(trigger).toBeVisible({ timeout: 60_000 });
    await trigger.click();

    const dialog = page.getByRole('dialog', { name: metric });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/\d+ contributing requests/i)).toBeVisible({
      timeout: 30_000,
    });
    await dialog.getByRole('button', { name: 'Close' }).click();
    await expect(dialog).toBeHidden();
  }
});

test('/lex/reports/analytics — available chart families resolve contributing requests', async ({
  page,
}) => {
  await page.goto('/lex/reports/analytics', { waitUntil: 'commit' });

  async function expectSuccessfulDrilldown(
    trigger: Locator,
  ): Promise<void> {
    await expect(trigger).toBeVisible({ timeout: 60_000 });
    await trigger.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/\d+ contributing requests/i)).toBeVisible({
      timeout: 30_000,
    });
    await dialog.getByRole('button', { name: 'Close' }).click();
    await expect(dialog).toBeHidden();
  }

  await expectSuccessfulDrilldown(
    page.getByTestId('analytics-month-drilldown').first(),
  );
  await expectSuccessfulDrilldown(
    page.getByTestId('analytics-department-drilldown').first(),
  );
  const advisorDrilldowns = page.getByTestId('analytics-advisor-drilldown');
  if ((await advisorDrilldowns.count()) > 0) {
    await expectSuccessfulDrilldown(advisorDrilldowns.first());
  }

  const serviceCard = page
    .getByRole('heading', { name: 'Distribution by service type' })
    .locator('..');
  await expectSuccessfulDrilldown(serviceCard.getByRole('button').first());
});
