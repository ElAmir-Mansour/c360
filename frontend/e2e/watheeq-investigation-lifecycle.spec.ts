import { expect, test, type Page, type Route } from '@playwright/test';

import { mintE2EToken, signInWithToken } from './e2e-auth';

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
const USER_ID = 'bbbbbbbb-0000-0000-0000-000000000001';
const AUTHOR_ID = 'cccccccc-0000-0000-0000-000000000001';
const INVESTIGATION_ID = '11111111-2222-4333-8444-555555555555';

test.setTimeout(120_000);

async function json(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

async function authenticate(page: Page, baseURL: string | undefined): Promise<void> {
  const token = mintE2EToken({
    userId: USER_ID,
    email: 'lifecycle-reviewer@clario.dev',
    fullName: 'Lifecycle Reviewer',
    roles: ['legal-cases-manager'],
    permissions: ['lex:*'],
  });
  await signInWithToken(page, baseURL, token);

  await page.route('**/api/auth/session', async (route) => {
    if (route.request().method() !== 'GET') {
      await route.fallback();
      return;
    }
    await json(route, {
      access_token: token,
      expires_at: '2099-01-01T00:00:00Z',
      tenant: {
        id: TENANT_ID,
        name: 'WatheeqTech',
        slug: 'watheeqtech',
        status: 'active',
        subscription_tier: 'enterprise',
        settings: {},
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2026-08-01T00:00:00Z',
      },
      user: {
        id: USER_ID,
        tenant_id: TENANT_ID,
        email: 'lifecycle-reviewer@clario.dev',
        first_name: 'Lifecycle',
        last_name: 'Reviewer',
        full_name: 'Lifecycle Reviewer',
        status: 'active',
        roles: [{
          id: 'legal-cases-manager',
          tenant_id: TENANT_ID,
          name: 'Legal Cases Manager',
          slug: 'legal-cases-manager',
          permissions: ['lex:*'],
          is_system: true,
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2026-08-01T00:00:00Z',
        }],
      },
    });
  });
  await page.route('**/api/v1/lex/me', (route) =>
    json(route, {
      data: {
        user_id: USER_ID,
        tenant_id: TENANT_ID,
        effective_permissions: ['lex:*'],
        permission_version: 'investigation-lifecycle-e2e',
        persona_landing: '/lex/investigations',
        capabilities: {},
        access_state: 'READY',
      },
    }),
  );
}

test('runs the narrated investigation lifecycle from registration through closure', async ({
  page,
  baseURL,
}) => {
  await authenticate(page, baseURL);

  const investigation = {
    id: INVESTIGATION_ID,
    tenant_id: TENANT_ID,
    investigation_number: 'INV-LIFECYCLE-001',
    subject: 'Lifecycle integration investigation',
    lead_investigator: 'Lead Investigator',
    status: 'registered',
    priority: 'high',
    case_id: null,
    findings: '',
    recommendations: '',
    ai_drafted: false,
    department: 'Legal',
    workflow_instance_id: null as string | null,
    reminder_obligation_id: null,
    metadata: { workspace: 'fraud', investigation_type: 'fraud' },
    created_by: AUTHOR_ID,
    created_at: '2026-08-01T08:00:00Z',
    updated_at: '2026-08-01T08:00:00Z',
    parties: [],
    statements: [],
    evidence: [],
  };
  const audit: Array<Record<string, unknown>> = [];

  const transition = (status: string) => {
    const from = investigation.status;
    investigation.status = status;
    investigation.updated_at = new Date().toISOString();
    audit.push({
      id: `audit-${audit.length + 1}`,
      tenant_id: TENANT_ID,
      investigation_id: INVESTIGATION_ID,
      action: 'investigation.status_changed',
      from_status: from,
      to_status: status,
      detail: {},
      actor_user_id: USER_ID,
      created_at: investigation.updated_at,
    });
  };

  await page.route('**/api/v1/lex/investigations/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const suffix = url.pathname.replace(`/api/v1/lex/investigations/${INVESTIGATION_ID}`, '');

    if (suffix === '' && request.method() === 'GET') {
      await json(route, { data: investigation });
      return;
    }
    if (suffix === '/audit' && request.method() === 'GET') {
      await json(route, { data: audit });
      return;
    }
    if (suffix === '/approval/tasks' && request.method() === 'GET') {
      await json(route, {
        data: investigation.status === 'pending_approval'
          ? [{
              id: 'approval-task-1',
              workflow_instance_id: investigation.workflow_instance_id,
              title: 'Results review',
              status: 'pending',
              assignee_role: 'legal-cases-manager',
            }]
          : [],
      });
      return;
    }
    if (suffix === '/status' && request.method() === 'POST') {
      transition(String((request.postDataJSON() as { status: string }).status));
      await json(route, { data: investigation });
      return;
    }
    if (suffix === '/results' && request.method() === 'POST') {
      investigation.findings = String((request.postDataJSON() as { findings: string }).findings);
      transition('results_recorded');
      await json(route, { data: investigation });
      return;
    }
    if (suffix === '/recommendations' && request.method() === 'POST') {
      investigation.recommendations = String(
        (request.postDataJSON() as { recommendations: string }).recommendations,
      );
      await json(route, { data: investigation });
      return;
    }
    if (suffix === '/approval/start' && request.method() === 'POST') {
      investigation.workflow_instance_id = 'workflow-1';
      transition('pending_approval');
      await json(route, { data: investigation });
      return;
    }
    if (/^\/approval\/[^/]+\/tasks\/[^/]+\/decision$/.test(suffix)) {
      investigation.workflow_instance_id = null;
      transition('approved');
      await json(route, {
        data: { previous_status: 'pending_approval', status: 'approved', resolution: 'advance' },
      });
      return;
    }
    await json(route, { data: investigation });
  });

  await page.goto(`/lex/investigations/${INVESTIGATION_ID}`);

  const rail = page.getByTestId('investigation-lifecycle-rail');
  await expect(rail).toBeVisible({ timeout: 30_000 });
  await rail.getByRole('button', { name: 'Start investigation' }).click();
  await expect(rail.getByRole('button', { name: 'Record findings' })).toBeVisible();

  await rail.getByRole('button', { name: 'Record findings' }).click();
  await page.getByRole('textbox', { name: 'Findings' }).fill(
    'The procurement controls were bypassed.',
  );
  await page.getByRole('button', { name: 'Accept brief' }).click();

  await expect(rail.getByText(/Record recommendations below/)).toBeVisible();
  await expect(rail.getByTestId('record-recommendations-remediation')).toBeVisible();
  await page.evaluate(() => {
    const button = document.querySelector<HTMLButtonElement>(
      '[data-testid="record-recommendations-remediation"]',
    );
    if (!button) throw new Error('Recommendation remediation action is unavailable');
    button.click();
  });
  await expect(page.getByRole('dialog', { name: 'Record recommendations' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Recommendations' }).fill(
    'Revoke access and complete a control review.',
  );
  await page.getByRole('button', { name: 'Accept brief' }).click();

  await expect(rail.getByRole('button', { name: 'Send for approval' })).toBeEnabled();
  await rail.getByRole('button', { name: 'Send for approval' }).click();
  await page.getByRole('button', { name: 'Submit' }).click();

  await expect(rail.getByRole('button', { name: 'Review and decide' })).toBeEnabled();
  await rail.getByRole('button', { name: 'Review and decide' }).click();
  await page.getByRole('button', { name: 'Approve', exact: true }).click();

  await expect(rail.getByRole('button', { name: 'Close investigation' })).toBeEnabled();
  await rail.getByRole('button', { name: 'Close investigation' }).click();
  await page.getByRole('button', { name: 'Submit' }).click();
  await expect(rail.getByText(new RegExp(`Closed on .* by ${USER_ID}`))).toBeVisible();
  await expect(rail.getByRole('button')).toHaveCount(0);
});
