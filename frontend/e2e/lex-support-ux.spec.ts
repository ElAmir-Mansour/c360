import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page, type ViewportSize } from '@playwright/test';
import { mintE2EToken } from './e2e-auth';

const WCAG_21_AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const supportID = 'df0d0fb2-bfd6-4e31-a712-23c54e831bed';
const caseID = '43cb6ac6-914d-4b24-a00b-86db08266897';
const entityID = '2cf2368d-fd52-47e8-aa01-68eb08e8320b';
const colleagueID = 'c6800e7a-1392-434b-8e89-30bfc6efbdef';
const supportToken = mintE2EToken({
  userId: 'bbbbbbbb-0000-0000-0000-000000000001',
  email: 'director@clario.dev',
  roles: ['legal-director'],
  permissions: ['*', 'lex:*'],
});

const supportRequest = {
  id: supportID,
  tenant_id: 'aaaaaaaa-0000-0000-0000-000000000001',
  requester_id: 'bbbbbbbb-0000-0000-0000-000000000003',
  requester_entity_id: entityID,
  target_entity_id: entityID,
  assignee_id: colleagueID,
  subject: 'Review the linked evidence package',
  body: 'Review every exhibit and confirm whether the chronology supports the position.\nThis complete second line must remain readable in the drawer.',
  priority: 'normal',
  subject_type: 'case',
  subject_id: caseID,
  status: 'open',
  resolution_note: '',
  expires_at: '2026-08-05T12:00:00Z',
  accepted_at: null,
  closed_at: null,
  created_at: '2026-08-01T08:00:00Z',
  updated_at: '2026-08-01T08:00:00Z',
  requester: { id: 'bbbbbbbb-0000-0000-0000-000000000003', first_name: 'Omar', last_name: 'Hassan' },
  assignee: { id: colleagueID, first_name: 'Aisha', last_name: 'Saleh' },
  target_entity: {
    id: entityID,
    code: 'CASES',
    entity_type: 'section',
    name: { en: 'Cases and Investigations', ar: 'القضايا والتحقيقات' },
  },
};

const surfaces: Array<{ name: string; locale: 'en' | 'ar'; viewport: ViewportSize }> = [
  { name: 'desktop EN', locale: 'en', viewport: { width: 1440, height: 1000 } },
  { name: 'mobile EN', locale: 'en', viewport: { width: 390, height: 844 } },
  { name: 'desktop AR', locale: 'ar', viewport: { width: 1440, height: 1000 } },
  { name: 'mobile AR', locale: 'ar', viewport: { width: 390, height: 844 } },
];

for (const surface of surfaces) {
  test(`${surface.name} support inbox is responsive, directional, and accessible`, async ({ page }) => {
    await page.setViewportSize(surface.viewport);
    await setLocale(page, surface.locale);
    await mockSupport(page);

    await page.goto('/lex/inbox?view=incoming', { waitUntil: 'domcontentloaded' });
    const incomingName = surface.locale === 'ar' ? 'الدعم الوارد' : 'Incoming support';
    await expect(page.getByRole('tab', { name: incomingName })).toHaveAttribute('data-state', 'active');
    await expect(page.getByText(supportRequest.subject)).toBeVisible();
    if (surface.locale === 'ar') {
      await expect(page.locator('[dir="rtl"]').first()).toBeVisible();
    } else {
      await expect(page.locator('[dir="ltr"]').first()).toBeVisible();
    }

    const tabs = page.getByTestId('lex-inbox-tabs-scroll');
    await expect(tabs).toHaveCSS('overflow-x', 'auto');
    await expect.poll(() => page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    )).toBe(true);

    const results = await new AxeBuilder({ page })
      .include('main')
      .withTags(WCAG_21_AA)
      .analyze();
    expect(seriousViolations(results.violations)).toEqual([]);
  });
}

test('desktop details drawer exposes the full request and linked case navigation', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await setLocale(page, 'en');
  await mockSupport(page);
  await page.goto('/lex/inbox?view=incoming', { waitUntil: 'domcontentloaded' });

  await page.getByRole('button', { name: 'View full details' }).click();
  const drawer = page.getByRole('dialog', { name: 'Support request details' });
  await expect(drawer).toContainText('This complete second line must remain readable');
  await expect(drawer.getByRole('link', { name: 'Open linked Case' })).toHaveAttribute(
    'href',
    `/lex/cases/${caseID}`,
  );

  const results = await new AxeBuilder({ page })
    .include('[role="dialog"]')
    .withTags(WCAG_21_AA)
    .analyze();
  expect(seriousViolations(results.violations)).toEqual([]);
});

test('mobile Arabic composer searches identity metadata and previews expiry before create', async ({ page }) => {
  const requestOrder: string[] = [];
  await page.setViewportSize({ width: 390, height: 844 });
  await setLocale(page, 'ar');
  await mockSupport(page, requestOrder);
  await page.goto('/lex/inbox?view=incoming', { waitUntil: 'domcontentloaded' });

  await page.locator('#main').getByRole('button', { name: 'طلب دعم' }).click();
  const dialog = page.getByRole('dialog', { name: 'طلب دعم' });
  await expect(dialog).toHaveAttribute('dir', 'rtl');

  await dialog.getByRole('combobox', { name: 'الفريق أو الإدارة' }).click();
  await page.getByPlaceholder('ابحث في الفرق والإدارات…').fill('القضايا');
  await page.getByRole('option', { name: /القضايا والتحقيقات/ }).click();

  await dialog.getByRole('combobox', { name: 'الزميل' }).click();
  await page.getByPlaceholder('ابحث بالاسم أو المسمى الوظيفي أو الرقم الوظيفي…').fill('مستشار');
  const colleague = page.getByRole('option', { name: /Aisha Saleh/ });
  await expect(colleague).toContainText('مستشار قانوني');
  await expect(colleague.locator('img')).toHaveCount(1);
  await colleague.click();

  await dialog.getByLabel('الموضوع').fill('مراجعة الأدلة');
  await dialog.getByLabel('مدة الصلاحية (أيام عمل)').fill('3');
  await expect(dialog.getByText(/الانتهاء المحسوب من الخادم:/)).toBeVisible();
  const results = await new AxeBuilder({ page })
    .include('[role="dialog"]')
    .withTags(WCAG_21_AA)
    .analyze();
  expect(seriousViolations(results.violations)).toEqual([]);
  await dialog.getByRole('button', { name: 'إرسال الطلب' }).click();
  await expect(dialog).toBeHidden();

  expect(requestOrder).toContain('preview');
  expect(requestOrder).toContain('create');
  expect(requestOrder.indexOf('preview')).toBeLessThan(requestOrder.indexOf('create'));
  await expect.poll(() => page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
  )).toBe(true);
});

async function setLocale(page: Page, locale: 'en' | 'ar') {
  await page.context().addCookies([{
    name: 'clario360_locale',
    value: locale,
    domain: 'localhost',
    path: '/',
    sameSite: 'Lax',
  }]);
}

async function mockSupport(page: Page, requestOrder: string[] = []) {
  await page.route('**/api/auth/session', async (route) => {
    if (route.request().method() !== 'GET') {
      await route.fallback();
      return;
    }
    const permissions = [
      'lex:read',
      'lex:support:view',
      'lex:support:create',
      'lex:support:respond',
    ];
    await route.fulfill({ json: {
      access_token: supportToken,
      expires_at: '2099-01-01T00:00:00Z',
      tenant: {
        id: supportRequest.tenant_id,
        name: 'Clario Legal',
        slug: 'clario-legal',
        status: 'active',
        subscription_tier: 'enterprise',
        settings: {},
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-08-01T00:00:00Z',
      },
      user: {
        id: 'bbbbbbbb-0000-0000-0000-000000000001',
        tenant_id: supportRequest.tenant_id,
        email: 'director@clario.dev',
        first_name: 'Legal',
        last_name: 'Director',
        status: 'active',
        mfa_enabled: false,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-08-01T00:00:00Z',
        roles: [{
          id: 'support-role',
          tenant_id: supportRequest.tenant_id,
          name: 'Legal Director',
          slug: 'legal-director',
          description: 'Legal Director',
          permissions,
          is_system: true,
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-08-01T00:00:00Z',
        }],
      },
    } });
  });
  await page.route('**/api/v1/lex/support-requests**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    if (path.endsWith('/directory')) {
      const selected = url.searchParams.get('entity_id');
      await route.fulfill({ json: { data: {
        entities: [{
          id: entityID,
          code: 'CASES',
          entity_type: 'section',
          name: { en: 'Cases and Investigations', ar: 'القضايا والتحقيقات' },
        }],
        selected_entity_id: selected || undefined,
        members: selected ? [{
          user_id: colleagueID,
          first_name: 'Aisha',
          last_name: 'Saleh',
          employee_code: 'E-10',
          title: { en: 'Legal Counsel', ar: 'مستشار قانوني' },
          manager_user_id: null,
          avatar_url: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg"/%3E',
        }] : [],
      } } });
      return;
    }
    if (path.endsWith('/expiry-preview')) {
      requestOrder.push('preview');
      await route.fulfill({ json: { data: { business_days: 3, expires_at: '2026-08-06T12:00:00Z' } } });
      return;
    }
    if (path === '/api/v1/lex/support-requests' && request.method() === 'POST') {
      requestOrder.push('create');
      await route.fulfill({ status: 201, json: { data: supportRequest } });
      return;
    }
    if (path === `/api/v1/lex/support-requests/${supportID}`) {
      await route.fulfill({ json: { data: supportRequest } });
      return;
    }
    await route.fulfill({ json: {
      data: [supportRequest],
      meta: { page: 1, per_page: 25, total: 1, total_pages: 1 },
    } });
  });
}

function seriousViolations(violations: Array<{ impact?: string | null }>) {
  return violations.filter((violation) =>
    violation.impact === 'serious' || violation.impact === 'critical');
}
