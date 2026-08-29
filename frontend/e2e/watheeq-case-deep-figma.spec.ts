import { expect, test, type Page, type Route } from '@playwright/test';

import { mintE2EToken, signInWithToken } from './e2e-auth';

const CASE_ID = '11111111-1111-4111-8111-111111111111';
const TENANT_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
const USER_ID = 'bbbbbbbb-0000-0000-0000-000000000001';
const LITIGATOR_ID = 'bbbbbbbb-0000-0000-0000-000000000002';
const RESEARCHER_ID = 'bbbbbbbb-0000-0000-0000-000000000003';

const permissions = ['lex:*'];

const team = [
  {
    id: USER_ID,
    tenant_id: TENANT_ID,
    email: 'ahmad@clario.dev',
    first_name: 'Ahmad',
    last_name: 'Mahmoud',
    full_name: 'Ahmad Mahmoud',
    status: 'active',
    roles: [{ id: 'lead-role', name: 'Lead Consultant', permissions }],
  },
  {
    id: LITIGATOR_ID,
    tenant_id: TENANT_ID,
    email: 'latifa@clario.dev',
    first_name: 'Latifa',
    last_name: 'Al-Sudairy',
    full_name: 'Latifa Al-Sudairy',
    status: 'active',
    roles: [{ id: 'litigator-role', name: 'Litigation Lawyer', permissions }],
  },
  {
    id: RESEARCHER_ID,
    tenant_id: TENANT_ID,
    email: 'omar@clario.dev',
    first_name: 'Omar',
    last_name: 'Al-Rashid',
    full_name: 'Omar Al-Rashid',
    status: 'active',
    roles: [{ id: 'research-role', name: 'Legal Researcher', permissions }],
  },
];

const caseTask = {
  id: 'task-1',
  case_id: CASE_ID,
  title: 'File the statement of claim',
  priority: 'high',
  status: 'open',
  due_date: '2026-08-12T09:00:00Z',
  assignee_id: USER_ID,
  created_at: '2026-07-24T09:00:00Z',
  updated_at: '2026-07-24T09:00:00Z',
};

const legalCase = {
  id: CASE_ID,
  tenant_id: TENANT_ID,
  case_number: 'CASE-2024-045',
  court_number: 'RIY-COMM-045',
  case_type: 'commercial',
  classification_id: null,
  company_status: 'plaintiff',
  competent_court: 'Commercial Court in Riyadh',
  chamber: '5th Commercial Circuit',
  filing_date: '2024-02-22T09:00:00Z',
  claim_amount: 2_450_000,
  court_fees: 12_500,
  legal_fees: 185_000,
  currency: 'SAR',
  expected_resolution_date: '2026-09-30T09:00:00Z',
  title: {
    en: 'Compensation Claim against Horizon Corp',
    ar: 'دعوى تعويض ضد شركة هورايزن',
  },
  description: 'Compensation claim for material software-delivery breaches.',
  strength: 'strong',
  risk_rating: 'medium',
  status: 'under_procedure',
  priority: 'high',
  section_manager_id: USER_ID,
  supervisor_id: LITIGATOR_ID,
  handling_officer_id: RESEARCHER_ID,
  responsible_lawyer: 'Ahmad Mahmoud',
  department: 'Litigation',
  metadata: {},
  created_by: USER_ID,
  created_at: '2024-02-22T09:00:00Z',
  updated_at: '2026-07-24T09:00:00Z',
  parties: [
    {
      id: 'party-1',
      case_id: CASE_ID,
      role: 'plaintiff',
      name: 'WatheeqTech',
      created_at: '2024-02-22T09:00:00Z',
      updated_at: '2024-02-22T09:00:00Z',
    },
    {
      id: 'party-2',
      case_id: CASE_ID,
      role: 'defendant',
      name: 'Horizon Corp',
      created_at: '2024-02-22T09:00:00Z',
      updated_at: '2024-02-22T09:00:00Z',
    },
  ],
  hearings: [
    {
      id: 'hearing-upcoming',
      case_id: CASE_ID,
      hearing_date: '2026-08-18T10:00:00Z',
      location: 'Commercial Court in Riyadh',
      notes: 'Final judgment announcement.',
      decision: null,
      metadata: {
        session_number: 5,
        title: 'Final Ruling & Judgment Announcement',
        session_type: 'judgment',
        chamber: '3rd Appellate Circuit',
        presiding_judge: 'Sheikh Abdulrahman Al-Mofadi',
        presiding_judge_title: 'Judicial Panel Head',
        agenda: 'Pronouncement of the final judgment regarding compensation liability.',
        required_action: 'Ensure attendance of legal representatives.',
        attendees: [USER_ID, LITIGATOR_ID],
        attendee_names: ['Ahmad Mahmoud', 'Latifa Al-Sudairy'],
        status: 'scheduled',
        duration_minutes: 150,
        required_documents: [],
      },
      created_at: '2026-06-01T09:00:00Z',
      updated_at: '2026-07-24T09:00:00Z',
    },
    {
      id: 'hearing-complete',
      case_id: CASE_ID,
      hearing_date: '2026-06-30T10:00:00Z',
      location: 'Commercial Court in Riyadh',
      notes: 'The court heard expert evidence.',
      decision: 'Evidence admitted.',
      metadata: {
        session_number: 4,
        title: 'Expert Software Testimony Hearing',
        session_type: 'expert',
        chamber: '5th Commercial Circuit',
        presiding_judge: 'Sheikh Sulaiman Al-Ghamdi',
        agenda: 'Examination of the court-appointed software expert.',
        required_action: '',
        attendees: [USER_ID],
        attendee_names: ['Ahmad Mahmoud'],
        status: 'completed',
        duration_minutes: 150,
        required_documents: [],
      },
      created_at: '2026-05-01T09:00:00Z',
      updated_at: '2026-06-30T12:30:00Z',
    },
  ],
  tasks: [caseTask],
};

const milestone = {
  id: 'milestone-1',
  tenant_id: TENANT_ID,
  case_id: CASE_ID,
  title: 'Expert report received',
  description: 'Independent software impact assessment added to the court file.',
  milestone_type: 'submission',
  status: 'completed',
  milestone_date: '2026-07-20T09:00:00Z',
  completed_at: '2026-07-20T09:00:00Z',
  owner_id: USER_ID,
  source: 'manual',
  source_reference: 'COURT-EVID-88329',
  metadata: { attachment_file_name: 'Financial_Technical_Impact_Assessment.pdf' },
  created_by: USER_ID,
  created_at: '2026-07-20T09:00:00Z',
  updated_at: '2026-07-20T09:00:00Z',
};

const pleading = {
  id: 'pleading-1',
  case_id: CASE_ID,
  pleading_number: 'COURT-REQ-77218',
  type: 'motion',
  title: 'Motion to Extend Discovery Timeline',
  body: 'Requesting an extension to complete technical discovery.',
  direction: 'outgoing',
  recipient: 'Commercial Court in Riyadh - 5th Chamber',
  court_reference: 'COURT-REQ-77218',
  response_deadline: '2026-08-16T09:00:00Z',
  response_owner_id: LITIGATOR_ID,
  status: 'approved',
  ai_generated: false,
  current_version: 1,
  filed_at: '2026-07-18T09:00:00Z',
  metadata: {},
  created_at: '2026-07-17T09:00:00Z',
  updated_at: '2026-07-18T09:00:00Z',
  attachments: [
    {
      id: 'pleading-attachment-1',
      pleading_id: 'pleading-1',
      file_id: 'file-pleading-1',
      file_name: 'Lumen_Motion_Extend_Discovery_Signed.pdf',
      caption: 'Signed motion',
      created_at: '2026-07-18T09:00:00Z',
    },
  ],
};

const judgment = {
  id: 'judgment-1',
  case_id: CASE_ID,
  judgment_ref: 'RIY-COMM-JUD-11202',
  judgment_date: '2026-07-23T09:00:00Z',
  outcome: 'won',
  decision_type: 'substantive_ruling',
  impact: 'positive',
  judge_name: 'Sheikh Sulaiman Al-Ghamdi',
  court_name: 'Commercial Court in Riyadh - 5th Chamber',
  summary: 'Territorial and local jurisdiction confirmed.',
  implications: 'The panel can proceed immediately with the substantive claim.',
  document_reference: 'Court_Ruling_Jurisdiction_Challenge_Dismissed.pdf',
  next_expected_ruling_at: '2026-08-18T10:00:00Z',
  next_expected_ruling: 'Final judgment',
  study_notes: '',
  recommendation: 'accept',
  file_id: 'file-judgment-1',
  metadata: {},
  created_at: '2026-07-23T09:00:00Z',
  updated_at: '2026-07-23T09:00:00Z',
};

const evidenceLink = {
  id: 'document-link-1',
  tenant_id: TENANT_ID,
  case_id: CASE_ID,
  document_id: 'document-1',
  source: 'uploaded_reference',
  category: 'expert_report',
  notes: 'Court-appointed expert assessment.',
  evidence_status: 'admitted',
  court_reference: 'COURT-EVID-88329',
  submitted_by: 'Dr. Yousef Al-Harbi',
  submitted_at: '2026-07-20T09:00:00Z',
  metadata: { strength_score: 78, evidence_category: 'Expert Testimony Reports' },
  created_by: USER_ID,
  created_at: '2026-07-20T09:00:00Z',
  document: {
    id: 'document-1',
    tenant_id: TENANT_ID,
    title: 'Consolidated Software Expert Damage Assessment Report',
    type: 'report',
    description: 'Financial and technical impact assessment.',
    status: 'active',
    confidentiality: 'internal',
    tags: ['evidence', 'expert-report'],
    metadata: {},
    file_id: 'file-evidence-1',
    file_name: 'Financial_Technical_Impact_Assessment.pdf',
    file_size_bytes: 12_400_000,
    version: 1,
    created_by: USER_ID,
    created_at: '2026-07-20T09:00:00Z',
    updated_at: '2026-07-20T09:00:00Z',
  },
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
    email: 'ahmad@clario.dev',
    fullName: 'Ahmad Mahmoud',
    roles: ['legal-cases-manager'],
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
      user: {
        ...team[0],
        roles: [
          {
            id: 'legal-cases-manager',
            tenant_id: TENANT_ID,
            name: 'Legal Cases Manager',
            slug: 'legal-cases-manager',
            description: 'Litigation workspace manager',
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
          org_unit: 'Litigation',
          escalation_level: 1,
        },
        available_legal_roles: [],
        effective_permissions: permissions,
        permission_version: 'case-deep-figma-e2e',
        persona_landing: `/lex/cases/${CASE_ID}`,
        capabilities: {},
        access_state: 'READY',
      },
    }),
  );
}

async function mockCaseWorkspace(page: Page): Promise<void> {
  const milestones: Array<Record<string, unknown>> = [milestone];
  const basePath = `/api/v1/lex/legal-cases/${CASE_ID}`;

  await page.route('**/api/v1/users**', async (route) => {
    const url = new URL(route.request().url());
    const userId = url.pathname.split('/').at(-1);
    if (url.pathname !== '/api/v1/users' && userId) {
      await json(route, team.find((member) => member.id === userId) ?? team[0]);
      return;
    }
    await json(route, {
      data: team,
      meta: { page: 1, per_page: 200, total: team.length, total_pages: 1 },
    });
  });

  await page.route('**/api/v1/lex/documents**', (route) =>
    json(route, {
      data: [],
      meta: { page: 1, per_page: 100, total: 0, total_pages: 0 },
    }),
  );

  await page.route('**/api/v1/lex/legal-cases**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const path = url.pathname;

    if (path === '/api/v1/lex/legal-cases') {
      await json(route, {
        data: [{ ...legalCase, next_hearing_date: legalCase.hearings[0].hearing_date, party_count: 2 }],
        meta: { page: 1, per_page: 200, total: 1, total_pages: 1 },
      });
      return;
    }
    if (path === basePath) {
      await json(route, { data: legalCase });
      return;
    }
    if (path === `${basePath}/audit`) {
      await json(route, { data: [] });
      return;
    }
    if (path === `${basePath}/versions`) {
      await json(route, { data: [] });
      return;
    }
    if (path === `${basePath}/comments`) {
      await json(route, { data: [] });
      return;
    }
    if (path === `${basePath}/documents`) {
      await json(route, { data: [evidenceLink] });
      return;
    }
    if (path === `${basePath}/pleadings`) {
      await json(route, { data: [pleading] });
      return;
    }
    if (path === `${basePath}/experts`) {
      await json(route, { data: [] });
      return;
    }
    if (path === `${basePath}/judgments`) {
      await json(route, { data: [judgment] });
      return;
    }
    if (path === `${basePath}/milestones`) {
      if (method === 'POST') {
        const payload = request.postDataJSON() as Record<string, unknown>;
        const created = {
          ...milestone,
          ...payload,
          id: `milestone-${milestones.length + 1}`,
          created_at: '2026-07-26T12:00:00Z',
          updated_at: '2026-07-26T12:00:00Z',
        };
        milestones.push(created);
        await json(route, { data: created }, 201);
        return;
      }
      await json(route, { data: milestones });
      return;
    }
    if (path === `${basePath}/tasks/${caseTask.id}` && method === 'PUT') {
      const payload = request.postDataJSON() as { status?: string };
      if (payload.status) caseTask.status = payload.status;
      caseTask.updated_at = '2026-07-26T12:05:00Z';
      await json(route, { data: caseTask });
      return;
    }
    if (/\/hearings\/[^/]+\/reports$/.test(path)) {
      await json(route, { data: [] });
      return;
    }
    await json(route, { data: [] });
  });
}

test('implements every Figma case-lifecycle deep screen in one live workspace', async ({
  page,
  baseURL,
}) => {
  test.setTimeout(90_000);
  await authenticate(page, baseURL);
  await mockCaseWorkspace(page);

  const errors: Error[] = [];
  page.on('pageerror', (error) => errors.push(error));

  await page.goto(`/lex/cases/${CASE_ID}`);

  await expect(
    page.getByRole('heading', { level: 1, name: 'Compensation Claim against Horizon Corp' }),
  ).toBeVisible();
  await expect(page.getByText('Financial Details')).toBeVisible();
  await expect(page.getByText(/2,450,000\.00/)).toBeVisible();
  await expect(page.getByText('Key Dates')).toBeVisible();
  await expect(page.getByText('Assigned Team')).toBeVisible();

  await page.getByRole('tab', { name: /timeline/i }).click();
  await expect(page.getByText('Expert report received')).toBeVisible();
  await expect(page.getByRole('button', { name: /add milestone/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /export full timeline/i })).toBeVisible();

  await page.getByRole('tab', { name: /hearings/i }).click();
  await expect(page.getByText('Final Ruling & Judgment Announcement')).toBeVisible();
  await expect(page.getByText('Session Statistics')).toBeVisible();
  await expect(page.getByText('Session Calendar')).toBeVisible();

  await page.getByRole('tab', { name: /documents/i }).click();
  await expect(
    page.getByText('Consolidated Software Expert Damage Assessment Report'),
  ).toBeVisible();
  await expect(page.getByText('Evidence Summary')).toBeVisible();
  await expect(page.getByText('Evidence strength meter', { exact: true })).toBeVisible();

  await page.getByRole('tab', { name: /statement of claim|requests|pleadings/i }).click();
  await expect(
    page.getByRole('article').filter({ hasText: 'Motion to Extend Discovery Timeline' }).first(),
  ).toBeVisible();
  await expect(page.getByText('Requests Overview')).toBeVisible();
  await expect(page.getByText('COURT-REQ-77218').first()).toBeVisible();

  await page.getByRole('tab', { name: /judgments/i }).click();
  await expect(
    page.getByRole('article').filter({ hasText: 'RIY-COMM-JUD-11202' }),
  ).toBeVisible();
  await expect(page.getByText('Decisions Summary')).toBeVisible();
  await expect(page.getByText(/positive trajectory/i)).toBeVisible();

  await page.getByRole('tab', { name: /tasks/i }).click();
  const taskStatus = page.getByRole('combobox', { name: /File the statement of claim/i });
  await expect(taskStatus).toBeVisible();
  await taskStatus.click();
  await page.getByRole('option', { name: 'In progress' }).click();
  await expect(taskStatus).toContainText('In progress');

  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    )
    .toBe(true);
  expect(errors).toEqual([]);
});
