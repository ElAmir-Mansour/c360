import { expect, test, type Page, type Route } from '@playwright/test';

import { mintE2EToken, signInWithToken } from './e2e-auth';

test.setTimeout(180_000);

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
const USER_ID = 'bbbbbbbb-0000-0000-0000-000000000001';
const INVESTIGATION_ID = '11111111-2222-4333-8444-555555555555';
const permissions = ['lex:*'];

const evidence = [
  {
    id: 'evidence-1',
    tenant_id: TENANT_ID,
    investigation_id: INVESTIGATION_ID,
    file_id: 'file-1',
    title: 'Corporate mail server backup logs',
    description: 'Procurement communication archive from Exchange.',
    evidence_type: 'email',
    collected_by: 'Ahmad Mahmoud',
    collected_at: '2026-07-01T09:00:00Z',
    metadata: {
      evidence_number: 'EVID-2024-081',
      source: 'Exchange Server Backup',
      sha256: '8f4a7c00000000000000000000002e91',
      status: 'verified',
    },
    created_by: USER_ID,
    created_at: '2026-07-01T09:00:00Z',
    updated_at: '2026-07-01T09:00:00Z',
  },
  {
    id: 'evidence-2',
    tenant_id: TENANT_ID,
    investigation_id: INVESTIGATION_ID,
    file_id: 'file-2',
    title: 'ERP Transaction Database Dump',
    description: 'Q1 procurement ledger export.',
    evidence_type: 'financial_record',
    collected_by: 'Sara Al-Jamil',
    collected_at: '2026-07-03T09:00:00Z',
    metadata: {
      evidence_number: 'EVID-2024-083',
      source: 'ERP Backup Hub',
      sha256: 'd471b00000000000000000000000ac34',
      status: 'processing',
      processing_note: 'De-duplicating database rows.',
    },
    created_by: USER_ID,
    created_at: '2026-07-03T09:00:00Z',
    updated_at: '2026-07-03T09:00:00Z',
  },
  {
    id: 'evidence-3',
    tenant_id: TENANT_ID,
    investigation_id: INVESTIGATION_ID,
    file_id: 'file-3',
    title: 'Signed vendor contract PDF',
    description: 'John Doe Corp procurement contract.',
    evidence_type: 'document',
    collected_by: 'Ahmad Mahmoud',
    collected_at: '2026-07-05T09:00:00Z',
    metadata: {
      evidence_number: 'EVID-2024-082',
      source: 'Legal Department File Share',
      sha256: '3a9c2e0000000000000000000000f8a1',
      status: 'verified',
    },
    created_by: USER_ID,
    created_at: '2026-07-05T09:00:00Z',
    updated_at: '2026-07-05T09:00:00Z',
  },
];

const investigation = {
  id: INVESTIGATION_ID,
  tenant_id: TENANT_ID,
  investigation_number: 'INV-2024-001',
  subject: 'Unauthorized Financial Transactions in Procurement Division',
  lead_investigator: 'Ahmad Mahmoud',
  status: 'pending_approval',
  priority: 'critical',
  case_id: null,
  findings:
    'Unauthorized ERP Database Bypass Detected\nOverlapping Internal IP Credentials\nMissing Mandatory Compliance Affidavits',
  recommendations:
    'Admin Revocation\nInfrastructure Audit\nDeploy multi-signature validation protocol',
  ai_drafted: false,
  department: 'Procurement',
  workflow_instance_id: 'workflow-investigation-1',
  reminder_obligation_id: null,
  metadata: {
    investigation_type: 'Internal Fraud',
    financial_exposure: 850000,
    progress: 75,
    current_phase: 'Evidence Collection Phase',
    confidentiality: 'Restricted — Need-to-Know Basis',
    intake_source: 'Whistleblower Portal',
    report_version: 2.3,
    interview_preparation: ['review_case', 'prepare_questions'],
  },
  created_by: USER_ID,
  created_at: '2026-03-01T09:00:00Z',
  updated_at: '2026-07-26T09:00:00Z',
  parties: [
    {
      id: 'party-1',
      tenant_id: TENANT_ID,
      investigation_id: INVESTIGATION_ID,
      role: 'subject',
      name: 'Samer Al-Ghamdi',
      identifier: null,
      contact: null,
      metadata: { title: 'Procurement Director', access_level: 'Restricted Access' },
      created_by: USER_ID,
      created_at: '2026-03-10T09:00:00Z',
      updated_at: '2026-03-10T09:00:00Z',
    },
  ],
  statements: [
    {
      id: 'statement-scheduled',
      tenant_id: TENANT_ID,
      investigation_id: INVESTIGATION_ID,
      deponent_party_id: 'party-1',
      deponent_name: 'Samer Al-Ghamdi',
      statement: 'Procurement override workflow and vendor assignment.',
      taken_at: '2099-03-22T10:00:00Z',
      taken_by: 'Ahmad Mahmoud',
      metadata: {
        interview_status: 'scheduled',
        interview_role: 'Subject',
        location: 'Main Legal Conference Room A',
        assigned_interviewer: 'Ahmad Mahmoud',
      },
      created_by: USER_ID,
      created_at: '2026-07-20T09:00:00Z',
      updated_at: '2026-07-20T09:00:00Z',
    },
    {
      id: 'statement-complete',
      tenant_id: TENANT_ID,
      investigation_id: INVESTIGATION_ID,
      deponent_party_id: null,
      deponent_name: 'Hala Al-Farsi',
      statement:
        'Confirmed the primary requisition system was bypassed using emergency overrides.',
      taken_at: '2026-03-15T09:00:00Z',
      taken_by: 'Sara Al-Jamil',
      metadata: {
        interview_status: 'completed',
        transcript_status: 'Transcribed',
        duration: '45 mins',
        recording: 'Voice & Video Recorded',
      },
      created_by: USER_ID,
      created_at: '2026-03-15T09:00:00Z',
      updated_at: '2026-03-15T09:00:00Z',
    },
  ],
  evidence,
};

const portfolio = [
  investigation,
  {
    ...investigation,
    id: '22222222-2222-4333-8444-555555555555',
    investigation_number: 'INV-2024-002',
    subject: 'SAMA Cybersecurity Framework Compliance Audit',
    department: 'Information Security',
    lead_investigator: 'Hassan Al-Zahrani',
    priority: 'high',
    status: 'in_progress',
    workflow_instance_id: null,
    metadata: {
      investigation_type: 'Compliance Audit',
      due_date: '2026-11-05T09:00:00Z',
      audit_type: 'Scheduled',
      progress: 40,
    },
    parties: [],
    statements: [],
    evidence: [
      {
        ...evidence[0],
        id: 'evidence-4',
        investigation_id: '22222222-2222-4333-8444-555555555555',
        title: 'Firewall system traffic logs',
        collected_by: 'Hassan Al-Zahrani',
      },
    ],
  },
  {
    ...investigation,
    id: '33333333-2222-4333-8444-555555555555',
    investigation_number: 'INV-2024-003',
    subject: 'Invoice Manipulation and Duplicate Expense Reporting',
    department: 'Finance',
    lead_investigator: 'Sara Al-Mogren',
    priority: 'high',
    status: 'in_progress',
    workflow_instance_id: null,
    metadata: {
      investigation_type: 'Financial Fraud',
      financial_exposure: 1200000,
      progress: 45,
    },
    parties: [],
    statements: [],
    evidence: [],
  },
];

async function json(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

async function authenticate(
  page: Page,
  baseURL: string | undefined,
  locale: 'en' | 'ar',
): Promise<void> {
  const appURL = baseURL ?? 'http://localhost:3000';
  await page.context().addCookies([
    { name: 'clario360_locale', value: locale, url: appURL },
  ]);
  const token = mintE2EToken({
    userId: USER_ID,
    email: 'ahmad@clario.dev',
    fullName: 'Ahmad Mahmoud',
    roles: ['legal-cases-manager'],
    permissions,
  });
  await signInWithToken(page, baseURL, token);
  // The sign-in helper establishes a fresh authenticated browser state. Set the
  // locale afterwards so the first application navigation receives the intended
  // server-rendered language and direction.
  await page.context().addCookies([
    { name: 'clario360_locale', value: locale, url: appURL },
  ]);

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
      user: {
        id: USER_ID,
        tenant_id: TENANT_ID,
        email: 'ahmad@clario.dev',
        first_name: 'Ahmad',
        last_name: 'Mahmoud',
        full_name: 'Ahmad Mahmoud',
        status: 'active',
        roles: [
          {
            id: 'legal-cases-manager',
            tenant_id: TENANT_ID,
            name: 'Legal Cases Manager',
            slug: 'legal-cases-manager',
            description: 'Investigation workspace manager',
            permissions,
            is_system: true,
            created_at: '2024-01-01T00:00:00Z',
            updated_at: '2026-07-26T00:00:00Z',
          },
        ],
      },
    });
  });

  await page.route('**/api/v1/lex/me', (route) =>
    json(route, {
      data: {
        user_id: USER_ID,
        tenant_id: TENANT_ID,
        active_legal_role: {
          slug: 'legal-cases-manager',
          name_en: 'Legal Cases Manager',
          name_ar: 'مدير القضايا القانونية',
          tier: 'Legal',
          org_unit: 'Investigations',
          escalation_level: 1,
        },
        available_legal_roles: [],
        effective_permissions: permissions,
        permission_version: 'investigations-deep-figma-e2e',
        persona_landing: '/lex/investigations',
        capabilities: {},
        access_state: 'READY',
      },
    }),
  );
}

async function mockInvestigations(page: Page): Promise<void> {
  const byId = new Map(portfolio.map((item) => [item.id, item]));

  await page.route('**/api/v1/users**', (route) =>
    json(route, {
      data: [],
      meta: { page: 1, per_page: 100, total: 0, total_pages: 0 },
    }),
  );
  await page.route('**/api/v1/lex/legal-cases**', (route) =>
    json(route, {
      data: [],
      meta: { page: 1, per_page: 100, total: 0, total_pages: 0 },
    }),
  );
  await page.route('**/api/v1/lex/investigations**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();

    if (path === '/api/v1/lex/investigations') {
      await json(route, {
        data: portfolio.map(({ parties: _parties, statements: _statements, evidence: _evidence, ...row }) => row),
        meta: { page: 1, per_page: 100, total: portfolio.length, total_pages: 1 },
      });
      return;
    }

    const match = path.match(/^\/api\/v1\/lex\/investigations\/([^/]+)(.*)$/);
    if (!match) {
      await json(route, { data: [] });
      return;
    }
    const [, id, suffix] = match;
    const record = byId.get(id) ?? investigation;

    if (!suffix && method === 'GET') {
      await json(route, { data: record });
      return;
    }
    if (!suffix && method === 'PUT') {
      await json(route, { data: { ...record, ...(request.postDataJSON() as object) } });
      return;
    }
    if (suffix === '/audit') {
      await json(route, { data: [] });
      return;
    }
    if (suffix === '/approval/tasks') {
      await json(route, {
        data: [
          {
            id: 'approval-task-1',
            workflow_instance_id: record.workflow_instance_id,
            title: 'Board review',
            status: 'pending',
            assignee_role: 'legal-cases-manager',
          },
        ],
      });
      return;
    }
    if (/^\/approval\/[^/]+\/tasks\/[^/]+\/decision$/.test(suffix)) {
      await json(route, { data: { status: 'approved' } });
      return;
    }
    if (suffix === '/statements' && method === 'POST') {
      await json(route, { data: request.postDataJSON() }, 201);
      return;
    }
    if (suffix === '/evidence' && method === 'POST') {
      await json(route, { data: request.postDataJSON() }, 201);
      return;
    }
    await json(route, { data: record });
  });
}

const englishScreens = [
  ['/lex/investigations', 'Investigations Registry'],
  [`/lex/investigations/${INVESTIGATION_ID}`, 'INV-2024-001'],
  [`/lex/investigations/${INVESTIGATION_ID}/interviews`, 'Interview & Witness Management'],
  [`/lex/investigations/${INVESTIGATION_ID}/evidence`, 'Evidence Collection & Analysis'],
  [`/lex/investigations/${INVESTIGATION_ID}/report`, 'Investigation Report & Findings'],
  ['/lex/investigations/fraud', 'Fraud Investigation Dashboard'],
  ['/lex/investigations/compliance', 'Compliance Audit Investigations'],
  ['/lex/investigations/forensics', 'Digital Forensics & Evidence Lab'],
  ['/lex/investigations/board-review', 'Board Review & Governance'],
] as const;

const arabicScreens = [
  ['/lex/investigations', 'سجل التحقيقات'],
  [`/lex/investigations/${INVESTIGATION_ID}`, 'INV-2024-001'],
  [`/lex/investigations/${INVESTIGATION_ID}/interviews`, 'إدارة المقابلات والشهود'],
  [`/lex/investigations/${INVESTIGATION_ID}/evidence`, 'جمع الأدلة والتحليل الفني'],
  [`/lex/investigations/${INVESTIGATION_ID}/report`, 'تقرير التحقيق والنتائج'],
  ['/lex/investigations/fraud', 'لوحة تحقيقات الاحتيال المالي'],
  ['/lex/investigations/compliance', 'تحقيقات التزام التدقيق والأنظمة'],
  ['/lex/investigations/forensics', 'مختبر الأدلة الرقمية والتحقيق الجنائي'],
  ['/lex/investigations/board-review', 'مراجعة مجلس الإدارة واللجان الرقابية'],
] as const;

test('implements all nine English investigation-deep Figma screens', async ({ page, baseURL }) => {
  await authenticate(page, baseURL, 'en');
  await mockInvestigations(page);
  const errors: Error[] = [];
  page.on('pageerror', (error) => errors.push(error));

  for (const [path, heading] of englishScreens) {
    await page.goto(path);
    await expect(page.getByRole('heading', { name: heading }).first()).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        ),
      )
      .toBe(true);
  }

  expect(errors).toEqual([]);
});

test('implements all nine Arabic RTL investigation-deep Figma screens', async ({ page, baseURL }) => {
  await authenticate(page, baseURL, 'ar');
  await mockInvestigations(page);
  const errors: Error[] = [];
  page.on('pageerror', (error) => errors.push(error));

  for (const [path, heading] of arabicScreens) {
    await page.goto(path);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { name: heading }).first()).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        ),
      )
      .toBe(true);
  }

  expect(errors).toEqual([]);
});
