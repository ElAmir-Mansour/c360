import { expect, test, type Page, type Route } from '@playwright/test';

import { mintE2EToken, signInWithToken } from './e2e-auth';

test.setTimeout(180_000);

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
const USER_ID = 'bbbbbbbb-0000-0000-0000-000000000001';
const CONTRACT_ID = 'cccccccc-0000-4000-8000-000000000001';
const WORKFLOW_ID = 'dddddddd-0000-4000-8000-000000000001';
const TASK_ID = 'eeeeeeee-0000-4000-8000-000000000001';
const permissions = ['lex:*'];

const user = {
  id: USER_ID,
  tenant_id: TENANT_ID,
  email: 'legal@watheeq.tech',
  first_name: 'Sarah',
  last_name: 'Al-Qahtani',
  full_name: 'Sarah Al-Qahtani',
  status: 'active',
  roles: [
    {
      id: 'legal-director',
      tenant_id: TENANT_ID,
      name: 'Legal Director',
      slug: 'legal-director',
      description: 'Legal contract approver',
      permissions,
      is_system: true,
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2026-07-26T00:00:00Z',
    },
  ],
};

let contract = {
  id: CONTRACT_ID,
  tenant_id: TENANT_ID,
  title: 'Enterprise Cloud Services Agreement',
  contract_number: 'CNT-2026-014',
  type: 'service_agreement',
  description: 'Managed cloud infrastructure and support services.',
  party_a_name: 'WatheeqTech',
  party_a_entity: 'Technology',
  party_b_name: 'Nimbus Cloud LLC',
  party_b_entity: 'Nimbus Cloud LLC',
  party_b_contact: 'contracts@nimbus.example',
  total_value: 2_400_000,
  currency: 'SAR',
  payment_terms: 'Quarterly in advance',
  effective_date: '2026-08-01T00:00:00Z',
  expiry_date: '2027-07-31T00:00:00Z',
  renewal_date: null,
  auto_renew: true,
  renewal_notice_days: 30,
  signed_date: null,
  status: 'internal_review',
  previous_status: 'draft',
  status_changed_at: '2026-07-26T10:00:00Z',
  status_changed_by: USER_ID,
  owner_user_id: USER_ID,
  owner_name: 'Sarah Al-Qahtani',
  legal_reviewer_id: USER_ID,
  legal_reviewer_name: 'Sarah Al-Qahtani',
  risk_score: 32,
  risk_level: 'low',
  analysis_status: 'completed',
  last_analyzed_at: '2026-07-26T10:00:00Z',
  document_file_id: 'file-contract-1',
  document_text: 'Cloud services agreement',
  current_version: 1,
  parent_contract_id: null,
  workflow_instance_id: WORKFLOW_ID as string | null,
  department: 'Technology',
  tags: ['figma-deep-draft'],
  metadata: {},
  created_by: USER_ID,
  created_at: '2026-07-26T10:00:00Z',
  updated_at: '2026-07-26T10:00:00Z',
  deleted_at: null,
};

let workflow = {
  workflow_instance_id: WORKFLOW_ID,
  task_id: TASK_ID,
  contract_id: CONTRACT_ID,
  contract_title: contract.title,
  contract_status: contract.status,
  workflow_status: 'running',
  current_step_id: 'legal-review',
  started_at: '2026-07-26T10:00:00Z',
  assignee_id: USER_ID,
  assignee_role: 'legal',
  task_status: 'pending',
  approval_policy: null,
  delegation: null,
};

const obligation = {
  id: 'obligation-1',
  tenant_id: TENANT_ID,
  title: 'Submit monthly service availability report',
  description: 'Provide SLA availability metrics to the business owner.',
  type: 'reporting',
  status: 'open',
  priority: 'high',
  contract_id: CONTRACT_ID,
  contract_title: contract.title,
  matter_id: null,
  matter_title: null,
  clause_id: null,
  owner_user_id: USER_ID,
  owner_name: 'Sarah Al-Qahtani',
  due_date: '2026-08-10T00:00:00Z',
  completed_at: null,
  reminder_enabled: true,
  reminder_lead_days: [7, 3],
  escalation_enabled: true,
  escalation_lead_days: [1],
  escalation_target: 'Legal Director',
  last_reminder_at: null,
  tags: ['sla'],
  metadata: {},
  created_by: USER_ID,
  created_at: '2026-07-20T00:00:00Z',
  updated_at: '2026-07-20T00:00:00Z',
  deleted_at: null,
  days_until_due: 15,
};

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
    email: user.email,
    fullName: user.full_name,
    roles: ['legal-director'],
    permissions,
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
        updated_at: '2026-07-26T00:00:00Z',
      },
      user,
    });
  });
  await page.route('**/api/v1/lex/me', (route) =>
    json(route, {
      data: {
        user_id: USER_ID,
        tenant_id: TENANT_ID,
        active_legal_role: {
          slug: 'legal-director',
          name_en: 'Legal Director',
          name_ar: 'مدير الشؤون القانونية',
          tier: 'Legal',
          org_unit: 'Legal',
          escalation_level: 1,
        },
        available_legal_roles: [],
        effective_permissions: permissions,
        permission_version: 'contracts-deep-figma-e2e',
        persona_landing: '/lex/contracts',
        capabilities: {},
        access_state: 'READY',
      },
    }),
  );
}

async function mockContractWorkspace(page: Page): Promise<void> {
  await page.route('**/api/v1/lex/contracts**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();

    if (path === '/api/v1/lex/contracts' && method === 'POST') {
      const payload = request.postDataJSON() as Record<string, unknown>;
      contract = {
        ...contract,
        ...payload,
        id: CONTRACT_ID,
        status: 'draft',
        workflow_instance_id: null,
      } as typeof contract;
      await json(route, { data: contract }, 201);
      return;
    }
    if (path === `/api/v1/lex/contracts/${CONTRACT_ID}/review` && method === 'POST') {
      contract = { ...contract, status: 'internal_review', workflow_instance_id: WORKFLOW_ID };
      workflow = {
        ...workflow,
        contract_title: contract.title,
        contract_status: contract.status,
        workflow_status: 'running',
        task_status: 'pending',
      };
      await json(route, { data: workflow }, 201);
      return;
    }
    if (path === `/api/v1/lex/contracts/${CONTRACT_ID}/timeline`) {
      await json(route, {
        data: {
          contract_id: CONTRACT_ID,
          generated_at: '2026-07-26T12:00:00Z',
          events: [
            {
              id: 'event-1',
              event_type: 'workflow_started',
              title: 'Legal review started',
              description: 'Sarah Al-Qahtani submitted the contract for approval.',
              occurred_at: '2026-07-26T10:00:00Z',
              actor: 'Sarah Al-Qahtani',
              source: 'workflow',
              metadata: {},
            },
          ],
        },
      });
      return;
    }
    if (path === `/api/v1/lex/contracts/${CONTRACT_ID}/versions`) {
      await json(route, {
        data: [
          {
            id: 'version-1',
            tenant_id: TENANT_ID,
            contract_id: CONTRACT_ID,
            version: 1,
            file_id: 'file-contract-1',
            file_name: 'Enterprise_Cloud_Services_Agreement.pdf',
            file_size_bytes: 860_000,
            content_hash: 'hash',
            change_summary: 'Initial draft',
            uploaded_by: USER_ID,
            uploaded_at: '2026-07-26T10:00:00Z',
          },
        ],
      });
      return;
    }
    if (path === `/api/v1/lex/contracts/${CONTRACT_ID}/renew` && method === 'POST') {
      contract = {
        ...contract,
        effective_date: '2027-08-01T00:00:00Z',
        expiry_date: '2028-07-31T00:00:00Z',
        status: 'renewed',
      };
      await json(route, { data: contract });
      return;
    }
    if (path === `/api/v1/lex/contracts/${CONTRACT_ID}`) {
      await json(route, {
        data: {
          contract,
          clauses: [],
          latest_analysis: null,
          version_count: 1,
        },
      });
      return;
    }
    if (path === '/api/v1/lex/contracts/renewal-warnings') {
      await json(route, {
        data: {
          tenant_id: TENANT_ID,
          generated_at: '2026-07-26T12:00:00Z',
          horizon_days: 90,
          lead_days: 30,
          total: 1,
          urgent: 0,
          warning: 1,
          items: [
            {
              contract_id: CONTRACT_ID,
              title: contract.title,
              status: 'active',
              counterparty: contract.party_b_name,
              owner: contract.owner_name,
              expiry_date: '2026-09-15T00:00:00Z',
              renewal_date: null,
              auto_renew: false,
              renewal_notice_days: 30,
              configured_lead_days: 30,
              trigger_date: '2026-08-16T00:00:00Z',
              days_until_trigger: 21,
              days_until_expiry: 51,
              severity: 'warning',
              reason: 'Renewal decision is due',
            },
          ],
        },
      });
      return;
    }
    await json(route, {
      data: [contract],
      meta: { page: 1, per_page: 100, total: 1, total_pages: 1 },
    });
  });

  await page.route('**/api/v1/lex/workflows**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path.endsWith(`/workflows/${WORKFLOW_ID}/tasks/${TASK_ID}/decision`)) {
      const payload = request.postDataJSON() as { decision: string; notes?: string };
      workflow = {
        ...workflow,
        workflow_status: payload.decision === 'approve' ? 'completed' : 'running',
        task_status: payload.decision === 'approve' ? 'approved' : payload.decision,
      };
      contract = {
        ...contract,
        status: payload.decision === 'approve' ? 'pending_signature' : 'internal_review',
      };
      await json(route, {
        data: {
          workflow_instance_id: WORKFLOW_ID,
          task_id: TASK_ID,
          contract_id: CONTRACT_ID,
          previous_contract_status: 'internal_review',
          contract_status: contract.status,
          workflow_status: workflow.workflow_status,
          task_status: workflow.task_status,
          decision: payload.decision,
          decided_by: USER_ID,
          decided_at: '2026-07-26T12:00:00Z',
          notes: payload.notes ?? null,
          metadata: {},
        },
      });
      return;
    }
    await json(route, {
      data: [workflow],
      meta: { page: 1, per_page: 100, total: 1, total_pages: 1 },
    });
  });

  await page.route('**/api/v1/lex/compliance/dashboard', (route) =>
    json(route, {
      data: {
        rules_by_type: { expiry: 3 },
        alerts_by_status: { open: 2, resolved: 18 },
        alerts_by_severity: { medium: 2 },
        active_alerts_by_severity: { medium: 2 },
        open_alerts: 2,
        resolved_alerts: 18,
        contracts_in_scope: 24,
        compliance_score: 92,
        calculated_at: '2026-07-26T12:00:00Z',
      },
    }),
  );
  await page.route('**/api/v1/lex/compliance/run', (route) =>
    json(route, {
      data: {
        tenant_id: TENANT_ID,
        score: 94,
        alerts_created: 0,
        alerts: [],
        calculated_at: '2026-07-26T12:05:00Z',
      },
    }),
  );
  await page.route('**/api/v1/lex/obligations**', async (route) => {
    if (route.request().method() === 'PUT') {
      obligation.status = 'completed';
      await json(route, { data: obligation });
      return;
    }
    await json(route, {
      data: [obligation],
      meta: { page: 1, per_page: 100, total: 1, total_pages: 1 },
    });
  });
}

test('implements the Figma contracts deep flow from drafting through approval and compliance', async ({
  page,
  baseURL,
}) => {
  await authenticate(page, baseURL);
  await mockContractWorkspace(page);

  await page.goto('/lex/contracts/new');
  await expect(page.getByRole('heading', { name: 'Contract Drafting Workspace' })).toBeVisible();
  await page.getByLabel('Contract Title').fill('Enterprise Cloud Services Agreement');
  await page.getByLabel('Contract ID').fill('CNT-2026-014');
  await page.getByRole('button', { name: 'Next Step' }).click();

  await page.getByLabel('Legal Name').first().fill('WatheeqTech');
  await page.getByLabel('Legal Name').nth(1).fill('Nimbus Cloud LLC');
  await page.getByRole('button', { name: 'Next Step' }).click();

  await page.getByLabel('Start Date').fill('2026-08-01');
  await page.getByLabel('End Date').fill('2027-07-31');
  await page.getByRole('button', { name: 'Next Step' }).click();
  await page.getByRole('button', { name: 'Next Step' }).click();
  await page.getByRole('button', { name: 'Submit for Approval' }).click();

  await expect(page).toHaveURL(
    new RegExp(`/lex/contracts/${CONTRACT_ID}/approval`),
    { timeout: 60_000 },
  );
  await expect(page.getByRole('heading', { name: 'Contract Approval' })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText('Enterprise Cloud Services Agreement').first()).toBeVisible();
  await page.getByPlaceholder(/Add the reasoning/).fill('Commercial and legal review completed.');
  await page.getByRole('button', { name: 'Approve Document' }).click();
  await expect(page.getByText('Decision recorded')).toBeVisible();

  await page.goto('/lex/contracts/compliance');
  await expect(page.getByRole('heading', { name: 'Contract Compliance & Renewals' })).toBeVisible();
  await expect(page.getByText('92%').first()).toBeVisible();
  await expect(page.getByText('Submit monthly service availability report')).toBeVisible();
  await page.getByRole('button', { name: 'Run Compliance' }).click();
  await expect(page.getByText('Compliance updated')).toBeVisible();
  await page.getByRole('button', { name: 'Mark Complete' }).click();
  await expect(page.getByText('Obligation completed')).toBeVisible();
  await page.getByRole('button', { name: 'Renew' }).click();
  await expect(page.getByText('Contract renewed')).toBeVisible();
});
