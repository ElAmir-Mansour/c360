import { expect, test, type Page, type Route } from '@playwright/test';
import { mintE2EToken, signInWithToken } from './e2e-auth';

test.setTimeout(90_000);

const controlPanelEnvelope = {
  data: {
    generated_at: '2026-07-23T09:00:00Z',
    resolution_window: {
      from: '2026-07-16T09:00:00Z',
      to: '2026-07-23T09:00:00Z',
    },
    cases: {
      total: 20,
      active: 15,
      under_review: 5,
      due_in_30_days: 3,
      closed: 4,
      cancelled: 1,
      on_hold: 2,
      resolved_last_7_days: 3,
      by_type: [
        { key: 'commercial', count: 10 },
        { key: 'regulatory', count: 5 },
        { key: 'employment', count: 3 },
        { key: 'tax', count: 1 },
        { key: 'property', count: 1 },
      ],
      by_status: [
        { key: 'under_procedure', count: 6 },
        { key: 'on_hold', count: 2 },
        { key: 'closed', count: 4 },
        { key: 'cancelled', count: 1 },
      ],
      by_company_role: [
        { key: 'defendant', count: 8 },
        { key: 'plaintiff', count: 6 },
      ],
      recent: [
        {
          id: '11111111-1111-4111-8111-111111111111',
          case_number: 'CASE-2026-001',
          title: { en: 'Supplier dispute', ar: 'نزاع مورد' },
          case_type: 'commercial',
          company_status: 'defendant',
          status: 'under_procedure',
          priority: 'high',
          responsible_lawyer: 'Amina Hassan',
          department: 'Procurement',
          next_hearing_date: '2026-08-01T09:00:00Z',
          party_count: 3,
          updated_at: '2026-07-23T08:00:00Z',
        },
      ],
    },
    investigations: {
      total: 4,
      ongoing: 2,
      by_case_type: [
        { key: 'commercial', count: 3 },
        { key: 'employment', count: 1 },
      ],
      by_status: [
        { key: 'in_progress', count: 1 },
        { key: 'pending_approval', count: 1 },
        { key: 'closed', count: 2 },
      ],
      active: [
        {
          id: '22222222-2222-4222-8222-222222222222',
          investigation_number: 'INV-2026-001',
          subject: 'Procurement process review',
          lead_investigator: 'Omar Saleh',
          status: 'in_progress',
          priority: 'medium',
          department: 'Compliance',
          findings: 'Review is progressing.',
          recommendations: '',
          created_at: '2026-07-20T09:00:00Z',
          updated_at: '2026-07-23T07:00:00Z',
        },
        {
          id: '33333333-3333-4333-8333-333333333333',
          investigation_number: 'INV-2026-002',
          subject: 'Policy exception review',
          lead_investigator: 'Sara Ahmed',
          status: 'pending_approval',
          priority: 'high',
          department: 'Legal',
          findings: '',
          recommendations: 'Submit for approval.',
          created_at: '2026-07-19T09:00:00Z',
          updated_at: '2026-07-22T07:00:00Z',
        },
      ],
      recent: [
        {
          id: '22222222-2222-4222-8222-222222222222',
          investigation_number: 'INV-2026-001',
          case_type: 'commercial',
          lead_investigator: 'Omar Saleh',
          status: 'in_progress',
          priority: 'medium',
          updated_at: '2026-07-23T07:00:00Z',
        },
        {
          id: '33333333-3333-4333-8333-333333333333',
          investigation_number: 'INV-2026-002',
          case_type: 'employment',
          lead_investigator: 'Sara Ahmed',
          status: 'pending_approval',
          priority: 'high',
          updated_at: '2026-07-22T07:00:00Z',
        },
      ],
    },
  },
};

interface ControlApiState {
  requests: URL[];
  legacyFanOut: URL[];
}

async function json(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

async function mockControlPanelApi(page: Page): Promise<ControlApiState> {
  const state: ControlApiState = { requests: [], legacyFanOut: [] };

  page.on('request', (request) => {
    const url = new URL(request.url());
    if (
      url.pathname === '/api/v1/lex/reports/cases' ||
      url.pathname === '/api/v1/lex/legal-cases' ||
      url.pathname === '/api/v1/lex/investigations'
    ) {
      state.legacyFanOut.push(url);
    }
  });

  await page.route('**/api/v1/lex/dashboard/cases-control*', async (route) => {
    state.requests.push(new URL(route.request().url()));
    await json(route, controlPanelEnvelope);
  });

  return state;
}

async function mockAuthenticatedSession(
  page: Page,
  baseURL: string | undefined,
  permissions: string[],
): Promise<void> {
  const accessToken = mintE2EToken({
    email: 'control-panel@clario.dev',
    roles: ['control-panel-test'],
    permissions,
  });

  // The real BFF write is required for Next middleware, which runs before any
  // browser route interception. The deterministic GET below then hydrates the
  // client auth store without depending on a live IAM profile lookup.
  await signInWithToken(page, baseURL, accessToken);

  await page.route('**/api/auth/session', async (route) => {
    if (route.request().method() !== 'GET') {
      await route.fallback();
      return;
    }
    await json(route, {
      access_token: accessToken,
      expires_at: '2099-01-01T00:00:00Z',
      tenant: {
        id: 'aaaaaaaa-0000-0000-0000-000000000001',
        name: 'Watheeq Test Tenant',
        slug: 'watheeq-test',
        domain: null,
        status: 'active',
        subscription_tier: 'enterprise',
        settings: {},
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-07-23T09:00:00Z',
      },
      user: {
        id: 'bbbbbbbb-0000-0000-0000-000000000001',
        tenant_id: 'aaaaaaaa-0000-0000-0000-000000000001',
        email: 'control-panel@clario.dev',
        first_name: 'Control',
        last_name: 'Panel',
        status: 'active',
        mfa_enabled: false,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-07-23T09:00:00Z',
        roles: [
          {
            id: 'role-control-panel',
            tenant_id: 'aaaaaaaa-0000-0000-0000-000000000001',
            name: 'Control Panel Test',
            slug: 'control-panel-test',
            description: 'Deterministic E2E role',
            permissions,
            is_system: true,
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-07-23T09:00:00Z',
          },
        ],
      },
    });
  });

  await page.route('**/api/v1/lex/me', async (route) => {
    await json(route, {
      data: {
        user_id: 'bbbbbbbb-0000-0000-0000-000000000001',
        tenant_id: 'aaaaaaaa-0000-0000-0000-000000000001',
        active_legal_role: {
          slug: 'control-panel-test',
          name_en: 'Control Panel Test',
          name_ar: 'اختبار لوحة التحكم',
          tier: 'Legal',
          org_unit: null,
          escalation_level: 0,
        },
        available_legal_roles: [],
        effective_permissions: permissions,
        permission_version: 'e2e-1',
        persona_landing: '/lex/cases/control',
        capabilities: {},
        access_state: 'READY',
      },
    });
  });
}

test('renders the control panel from one standard backend envelope', async ({
  page,
  baseURL,
}) => {
  await mockAuthenticatedSession(page, baseURL, [
    'lex:case:view',
    'lex:investigation:view',
    'lex:case:add',
  ]);
  const state = await mockControlPanelApi(page);
  const pageErrors: Error[] = [];
  page.on('pageerror', (error) => pageErrors.push(error));

  await page.goto('/lex/cases/control', { waitUntil: 'commit' });

  await expect(
    page.getByRole('heading', {
      level: 1,
      name: 'Welcome, Cases Manager',
    }),
  ).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Active Cases')).toBeVisible();
  await expect(page.getByText('Under Review')).toBeVisible();
  await expect(
    page.locator('#main').getByText('Investigations', { exact: true }),
  ).toBeVisible();
  await expect(page.getByText('Due in 30 Days')).toBeVisible();

  await expect(
    page.getByRole('link', { name: 'CASE-2026-001' }),
  ).toHaveAttribute(
    'href',
    '/lex/cases/11111111-1111-4111-8111-111111111111',
  );
  await expect(
    page.getByRole('link', { name: 'View Full Archive' }),
  ).toHaveAttribute('href', '/lex/cases');

  const progress = page.getByRole('progressbar', { name: /Commercial.*10 cases/ });
  await expect(progress).toHaveAttribute('aria-valuenow', '50');

  await expect(page.getByRole('link', { name: 'INV-2026-001' })).toHaveAttribute(
    'href',
    '/lex/investigations/22222222-2222-4222-8222-222222222222',
  );
  await expect(page.getByRole('link', { name: 'INV-2026-002' })).toHaveAttribute(
    'href',
    '/lex/investigations/33333333-3333-4333-8333-333333333333',
  );
  await expect(page.getByRole('heading', { name: 'Cases by Type' })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Investigations by Case Type' }),
  ).toBeVisible();

  await expect.poll(() => state.requests.length).toBe(1);
  expect(state.requests[0].search).toBe('');
  expect(state.legacyFanOut).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('requires both case and investigation view permissions', async ({
  page,
  baseURL,
}) => {
  await mockAuthenticatedSession(page, baseURL, ['lex:case:view']);
  const state = await mockControlPanelApi(page);

  await page.goto('/lex/cases/control', { waitUntil: 'commit' });

  // The route guard must withhold the page body before any sensitive query can
  // fire. Its router.replace may settle after the shell paints, so the security
  // assertion is the denied body + zero network access, not navigation timing.
  await expect(page.getByRole('banner')).toBeVisible({
    timeout: 20_000,
  });
  await expect(
    page.getByRole('heading', {
      level: 1,
      name: 'Welcome, Cases Manager',
    }),
  ).toHaveCount(0);
  await page.waitForTimeout(500);
  expect(state.requests).toHaveLength(0);
  expect(state.legacyFanOut).toHaveLength(0);
});
