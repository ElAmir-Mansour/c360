import { expect, test } from '@playwright/test';
import { mintE2EToken, signInWithToken } from './e2e-auth';

test.setTimeout(120_000);

test('renders the cases-manager dashboard from the live PM2 gateway and Lex backend', async ({
  page,
  baseURL,
}) => {
  const accessToken = mintE2EToken({
    userId: 'bbbbbbbb-0000-0000-0000-000000000001',
    email: 'admin@clario.dev',
    fullName: 'E2E Cases Manager',
    roles: ['tenant-admin', 'legal-cases-manager'],
    permissions: [
      'lex:case:view',
      'lex:investigation:view',
      'lex:case:add',
      'lex:case:assign',
    ],
  });
  await signInWithToken(page, baseURL, accessToken);

  const dashboardRequests: string[] = [];
  const legacyFanOut: string[] = [];
  const pageErrors: Error[] = [];
  page.on('pageerror', (error) => pageErrors.push(error));
  page.on('request', (request) => {
    const pathname = new URL(request.url()).pathname;
    if (pathname === '/api/v1/lex/dashboard/cases-control') {
      dashboardRequests.push(request.url());
    }
    if (
      pathname === '/api/v1/lex/reports/cases' ||
      pathname === '/api/v1/lex/legal-cases' ||
      pathname === '/api/v1/lex/investigations'
    ) {
      legacyFanOut.push(request.url());
    }
  });

  const dashboardResponsePromise = page.waitForResponse((response) => {
    return (
      new URL(response.url()).pathname ===
        '/api/v1/lex/dashboard/cases-control' &&
      response.request().method() === 'GET'
    );
  });

  await page.goto('/lex/cases/control', { waitUntil: 'domcontentloaded' });
  const dashboardResponse = await dashboardResponsePromise;
  expect(dashboardResponse.status()).toBe(200);

  const envelope = (await dashboardResponse.json()) as {
    data: {
      cases: {
        active: number;
        under_review: number;
        due_in_30_days: number;
        recent: Array<{ case_number: string }>;
      };
      investigations: {
        ongoing: number;
        recent: Array<{ investigation_number: string }>;
      };
    };
  };

  await expect(
    page.getByRole('heading', { level: 1, name: 'Welcome, Cases Manager' }),
  ).toBeVisible();

  const activeCard = page.getByText('Active Cases', { exact: true }).locator('..');
  const reviewCard = page.getByText('Under Review', { exact: true }).locator('..');
  const investigationCard = page
    .locator('#main')
    .getByText('Investigations', { exact: true })
    .locator('..');
  const dueCard = page.getByText('Due in 30 Days', { exact: true }).locator('..');
  await expect(activeCard).toContainText(String(envelope.data.cases.active));
  await expect(reviewCard).toContainText(String(envelope.data.cases.under_review));
  await expect(investigationCard).toContainText(
    String(envelope.data.investigations.ongoing),
  );
  await expect(dueCard).toContainText(String(envelope.data.cases.due_in_30_days));

  for (const item of envelope.data.cases.recent) {
    await expect(page.getByRole('link', { name: item.case_number })).toBeVisible();
  }
  for (const item of envelope.data.investigations.recent) {
    await expect(
      page.getByRole('link', { name: item.investigation_number }),
    ).toBeVisible();
  }

  expect(dashboardRequests).toHaveLength(1);
  expect(legacyFanOut).toEqual([]);
  expect(pageErrors).toEqual([]);
});
