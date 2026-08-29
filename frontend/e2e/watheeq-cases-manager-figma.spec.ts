import { expect, test, type Page, type Route } from '@playwright/test';

import { mintE2EToken, signInWithToken } from './e2e-auth';

const permissions = [
  'lex:case:view',
  'lex:case:edit',
  'lex:investigation:view',
  'lex:investigation:edit',
  'lex:contract:view',
  'lex:contract:edit',
  'lex:consultation:view',
  'lex:consultation:edit',
];

const user = {
  id: 'bbbbbbbb-0000-0000-0000-000000000001',
  tenant_id: 'aaaaaaaa-0000-0000-0000-000000000001',
  email: 'manager@clario.dev',
  first_name: 'Case',
  last_name: 'Manager',
  status: 'active',
  mfa_enabled: false,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-07-26T00:00:00Z',
  roles: [
    {
      id: 'role-manager',
      tenant_id: 'aaaaaaaa-0000-0000-0000-000000000001',
      name: 'Cases Manager',
      slug: 'legal-cases-manager',
      description: 'Cases manager',
      permissions,
      is_system: true,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-07-26T00:00:00Z',
    },
  ],
};

const cases = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    tenant_id: user.tenant_id,
    case_number: 'C-2026-001',
    case_type: 'commercial',
    company_status: 'plaintiff',
    title: { en: 'Apex contract claim', ar: 'مطالبة عقد أبكس' },
    description: 'Contract dispute',
    strength: 'strong',
    status: 'open',
    priority: 'high',
    section_manager_id: user.id,
    handling_officer_id: null,
    responsible_lawyer: null,
    competent_court: 'Commercial Court',
    metadata: { strength_score: 86, sla_compliance_pct: 92 },
    created_by: user.id,
    created_at: '2026-07-20T09:00:00Z',
    updated_at: '2026-07-25T09:00:00Z',
    next_hearing_date: '2026-07-28T09:30:00Z',
    party_count: 2,
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    tenant_id: user.tenant_id,
    case_number: 'C-2026-002',
    case_type: 'regulatory',
    company_status: 'defendant',
    title: { en: 'Regulatory response', ar: 'استجابة تنظيمية' },
    description: 'Regulatory matter',
    strength: 'weak',
    status: 'under_procedure',
    priority: 'medium',
    section_manager_id: user.id,
    handling_officer_id: 'dddddddd-0000-4000-8000-000000000001',
    responsible_lawyer: 'Amina Hassan',
    competent_court: 'Administrative Court',
    metadata: { sla_score: 58 },
    created_by: user.id,
    created_at: '2026-07-18T09:00:00Z',
    updated_at: '2026-07-24T09:00:00Z',
    next_hearing_date: null,
    party_count: 3,
  },
];

const investigations = [
  {
    id: '33333333-3333-4333-8333-333333333333',
    tenant_id: user.tenant_id,
    investigation_number: 'INV-2026-001',
    subject: 'Procurement review',
    lead_investigator: '',
    status: 'in_progress',
    priority: 'high',
    findings: '',
    recommendations: '',
    ai_drafted: false,
    department: 'Procurement',
    metadata: {},
    created_by: user.id,
    created_at: '2026-07-21T09:00:00Z',
    updated_at: '2026-07-25T09:00:00Z',
  },
];

const team = [
  {
    id: 'dddddddd-0000-4000-8000-000000000001',
    first_name: 'Amina',
    last_name: 'Hassan',
    email: 'amina@clario.dev',
    status: 'active',
    roles: [
      {
        id: 'advisor-role',
        name: 'Legal Advisor',
        permissions: ['lex:case:edit', 'lex:investigation:edit'],
      },
    ],
  },
  {
    id: 'dddddddd-0000-4000-8000-000000000002',
    first_name: 'Omar',
    last_name: 'Saleh',
    email: 'omar@clario.dev',
    status: 'active',
    roles: [
      {
        id: 'investigator-role',
        name: 'Legal Investigator',
        permissions: ['lex:case:edit', 'lex:investigation:edit'],
      },
    ],
  },
];

async function fulfillJson(route: Route, body: unknown): Promise<void> {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

async function authenticate(page: Page, baseURL: string | undefined): Promise<void> {
  const token = mintE2EToken({
    userId: user.id,
    email: user.email,
    roles: ['legal-cases-manager'],
    permissions,
  });
  await signInWithToken(page, baseURL, token);

  await page.route('**/api/auth/session', async (route) => {
    if (route.request().method() !== 'GET') {
      await route.fallback();
      return;
    }
    await fulfillJson(route, {
      access_token: token,
      expires_at: '2099-01-01T00:00:00Z',
      tenant: {
        id: user.tenant_id,
        name: 'Clario Legal',
        slug: 'clario-legal',
        status: 'active',
        subscription_tier: 'enterprise',
        settings: {},
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-07-26T00:00:00Z',
      },
      user,
    });
  });
  await page.route('**/api/v1/lex/me', (route) =>
    fulfillJson(route, {
      data: {
        user_id: user.id,
        tenant_id: user.tenant_id,
        active_legal_role: {
          slug: 'legal-cases-manager',
          name_en: 'Cases Manager',
          name_ar: 'مدير القضايا',
          tier: 'Manager',
          org_unit: null,
          escalation_level: 1,
        },
        available_legal_roles: [],
        effective_permissions: permissions,
        permission_version: 'figma-e2e',
        persona_landing: '/lex/cases/control',
        capabilities: {},
        access_state: 'READY',
      },
    }),
  );
}

async function mockWorkspaceData(page: Page): Promise<void> {
  await page.route('**/api/v1/lex/legal-cases*', (route) =>
    fulfillJson(route, {
      data: cases,
      meta: { page: 1, per_page: 200, total: cases.length, total_pages: 1 },
    }),
  );
  await page.route('**/api/v1/lex/investigations*', (route) =>
    fulfillJson(route, {
      data: investigations,
      meta: {
        page: 1,
        per_page: 200,
        total: investigations.length,
        total_pages: 1,
      },
    }),
  );
  await page.route('**/api/v1/roles/*/users', (route) => fulfillJson(route, team));
}

for (const route of [
  {
    path: '/lex/cases/control/overview',
    heading: 'Cases & Investigations Dashboard',
  },
  {
    path: '/lex/cases/control/assignment',
    heading: 'Cases & Investigations Allocation',
  },
  {
    path: '/lex/cases/control/litigation',
    heading: 'Litigation Monitor',
  },
]) {
  test(`${route.path} renders the Figma manager surface without overflow`, async ({
    page,
    baseURL,
  }) => {
    await authenticate(page, baseURL);
    await mockWorkspaceData(page);
    const errors: Error[] = [];
    page.on('pageerror', (error) => errors.push(error));

    await page.goto(route.path);

    await expect(page.getByRole('heading', { level: 1, name: route.heading })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Cases manager workspaces' })).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        ),
      )
      .toBe(true);
    expect(errors).toEqual([]);
  });
}

test('the overview mirrors into the Arabic RTL layout', async ({ page, baseURL }) => {
  await authenticate(page, baseURL);
  await page.context().addCookies([
    {
      name: 'clario360_locale',
      value: 'ar',
      domain: 'localhost',
      path: '/',
      sameSite: 'Lax',
    },
  ]);
  await mockWorkspaceData(page);

  await page.goto('/lex/cases/control/overview');

  await expect(
    page.getByRole('heading', { level: 1, name: 'لوحة تحكم القضايا والتحقيقات' }),
  ).toBeVisible();
  await expect(
    page.getByRole('navigation', { name: 'مساحات عمل مدير القضايا والتحقيقات' }),
  ).toBeVisible();
  await expect(page.locator('[lang="ar"][dir="rtl"]').first()).toBeVisible();
});

test('the contracts and consultations allocation frame is implemented', async ({
  page,
  baseURL,
}) => {
  await authenticate(page, baseURL);
  await page.route('**/api/v1/lex/dashboard/overview*', (route) =>
    fulfillJson(route, { data: { kpis: {} } }),
  );
  await page.route('**/api/v1/lex/reports/contracts*', (route) =>
    fulfillJson(route, { data: { total: 0, by_type: [] } }),
  );
  await page.route('**/api/v1/lex/reports/consultations*', (route) =>
    fulfillJson(route, { data: { total: 0, by_type: [] } }),
  );
  await page.route('**/api/v1/lex/contracts*', (route) =>
    fulfillJson(route, {
      data: [],
      meta: { page: 1, per_page: 100, total: 0, total_pages: 0 },
    }),
  );
  await page.route('**/api/v1/lex/consultations*', (route) =>
    fulfillJson(route, {
      data: [],
      meta: { page: 1, per_page: 100, total: 0, total_pages: 0 },
    }),
  );
  await page.route('**/api/v1/roles/*/users', (route) => fulfillJson(route, team));
  const errors: Error[] = [];
  page.on('pageerror', (error) => errors.push(error));

  await page.goto('/lex/contracts/control/assignment');

  await expect(
    page.getByRole('heading', { level: 1, name: 'Contracts & Consultations Allocation' }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Consultant Allocations & Live Capacity' }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    )
    .toBe(true);
  expect(errors).toEqual([]);
});
