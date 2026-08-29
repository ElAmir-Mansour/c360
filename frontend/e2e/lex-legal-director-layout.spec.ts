import { expect, test, type Browser } from '@playwright/test';

const directorEmail = 'director@almashura.demo';
const password = 'DemoPass123!';

test('Legal Director analytics panels stay inside their dashboard columns', async ({
  browser,
  baseURL,
}) => {
  const context = await signedInDirector(browser, baseURL);
  const page = await context.newPage();
  await page.setViewportSize({ width: 2_048, height: 1_200 });

  try {
    await page.goto('/lex', { waitUntil: 'domcontentloaded' });

    const serviceRequests = page.getByRole('region', {
      name: 'Service Request Distribution',
    });
    const teamWorkload = page.getByRole('region', { name: 'Load distribution' });
    await expect(serviceRequests).toBeVisible({ timeout: 60_000 });
    await expect(teamWorkload).toBeVisible({ timeout: 60_000 });
    await expect(teamWorkload).toHaveAttribute('data-workforce-state', 'ready', {
      timeout: 60_000,
    });

    await expect(
      teamWorkload.getByText(/No Legal Director organisation role is configured/),
    ).toHaveCount(0);
    await expect(teamWorkload.getByText('Partial data', { exact: true })).toHaveCount(0);
    await expect(
      teamWorkload.getByText(/the domain could not be queried/),
    ).toHaveCount(0);

    const [serviceBox, workloadBox] = await Promise.all([
      serviceRequests.boundingBox(),
      teamWorkload.boundingBox(),
    ]);
    expect(serviceBox).not.toBeNull();
    expect(workloadBox).not.toBeNull();

    // These panels intentionally share vertical space in the two-column
    // masonry. The wide workforce table must scroll inside its left card,
    // never widen that card underneath the right-hand analytics column.
    expect(workloadBox!.x + workloadBox!.width).toBeLessThan(serviceBox!.x);

    const horizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(horizontalOverflow).toBeLessThanOrEqual(1);
  } finally {
    await context.close();
  }
});

test('Legal Director dashboard aggregates expose working drill-downs', async ({
  browser,
  baseURL,
}) => {
  const context = await signedInDirector(browser, baseURL);
  const page = await context.newPage();
  await page.setViewportSize({ width: 2_048, height: 1_200 });

  try {
    await page.goto('/lex', { waitUntil: 'domcontentloaded' });

    const workload = page.getByRole('region', { name: 'Load distribution' });
    await expect(workload).toHaveAttribute('data-workforce-state', 'ready', {
      timeout: 60_000,
    });

    const kpis = page.locator('[data-legal-director-kpi-strip] a');
    await expect(kpis).toHaveCount(6);
    await expect(kpis.nth(0)).toHaveAttribute('href', '/lex/service-desk/sla-board');
    await expect(kpis.nth(2)).toHaveAttribute('href', '/lex/cases');
    await expect(kpis.nth(4)).toHaveAttribute('href', '/lex/contracts');

    const escalations = page.getByRole('region', {
      name: 'Escalation & Risk Warnings',
    });
    await expect(escalations.locator('a[href^="/lex/inbox?severity="]').first()).toBeVisible();

    const serviceRequests = page.getByRole('region', {
      name: 'Service Request Distribution',
    });
    await expect(serviceRequests.locator('a[href="/lex/contracts"]').first()).toBeVisible();

    const resolution = page.getByRole('region', {
      name: 'Legal Teams Resolution Rate',
    });
    await expect(resolution.locator('a[href="/lex/reports/analytics"]').first()).toBeVisible();
    await expect(workload.getByRole('link', { name: 'View reports' })).toHaveAttribute(
      'href',
      '/lex/reports',
    );

    const memberDisclosure = workload.getByRole('button', {
      name: /Show .+ workload breakdown/,
    }).first();
    await memberDisclosure.click();
    await expect(workload.getByRole('button', {
      name: /Hide .+ workload breakdown/,
    }).first()).toHaveAttribute('aria-expanded', 'true');
    await expect(workload.locator('a[href^="/lex/"]').last()).toBeVisible();

    await serviceRequests.locator('a[href="/lex/contracts"]').last().click({
      noWaitAfter: true,
    });
    await expect(page).toHaveURL(/\/lex\/contracts(?:\?.*)?$/, { timeout: 30_000 });
  } finally {
    await context.close();
  }
});

async function signedInDirector(browser: Browser, baseURL: string | undefined) {
  const context = await browser.newContext({ baseURL });
  const request = context.request;
  const gateway = process.env.PLAYWRIGHT_GATEWAY_URL ?? 'http://127.0.0.1:8092';
  const login = await request.post(`${gateway}/api/v1/auth/login`, {
    data: { email: directorEmail, password, remember: false },
  });
  expect(login.ok(), await login.text()).toBeTruthy();
  const auth = (await login.json()) as { access_token: string; refresh_token: string };

  const origin = new URL(baseURL ?? 'http://localhost:3002').origin;
  const session = await request.post('/api/auth/session', {
    data: {
      access_token: auth.access_token,
      refresh_token: auth.refresh_token,
      remember: false,
    },
    headers: { Origin: origin, Referer: `${origin}/login` },
  });
  expect(session.ok(), await session.text()).toBeTruthy();
  return context;
}
