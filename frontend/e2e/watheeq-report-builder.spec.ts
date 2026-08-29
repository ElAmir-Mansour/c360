import { expect, test, type Page, type Route } from '@playwright/test';

const OWNER_USER_ID = 'bbbbbbbb-0000-0000-0000-000000000001';
const NOW = '2026-07-23T09:00:00Z';

interface SavedReport {
  id: string;
  tenant_id: string;
  owner_user_id: string;
  namespace: string;
  name: string;
  scope: 'personal' | 'team' | 'org';
  payload: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

interface MockApiState {
  savedReports: SavedReport[];
  createBodies: Record<string, unknown>[];
  updateBodies: Record<string, unknown>[];
  deleteCount: number;
}

const contracts = [
  {
    id: 'contract-1',
    title: 'Master Services Agreement',
    status: 'active',
    type: 'services',
    risk_level: 'medium',
    party_b_name: 'Acme Saudi',
    expiry_date: '2026-12-31',
    current_version: 3,
    created_at: NOW,
  },
  {
    id: 'contract-2',
    title: 'Office Lease',
    status: 'draft',
    type: 'lease',
    risk_level: 'low',
    party_b_name: 'Riyadh Properties',
    expiry_date: '2027-06-30',
    current_version: 1,
    created_at: NOW,
  },
];

async function json(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

async function mockReportBuilderApi(page: Page): Promise<MockApiState> {
  const state: MockApiState = {
    savedReports: [],
    createBodies: [],
    updateBodies: [],
    deleteCount: 0,
  };

  await page.route('**/api/v1/lex/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const path = url.pathname;

    if (path === '/api/v1/lex/report-definitions') {
      if (method === 'GET') {
        await json(route, { data: state.savedReports });
        return;
      }
      if (method === 'POST') {
        const body = request.postDataJSON() as Record<string, unknown>;
        state.createBodies.push(body);
        const created: SavedReport = {
          id: `report-${state.createBodies.length}`,
          tenant_id: 'aaaaaaaa-0000-0000-0000-000000000001',
          owner_user_id: OWNER_USER_ID,
          namespace: 'lex-report-builder',
          name: String(body.name),
          scope: body.scope as SavedReport['scope'],
          payload: body.payload as Record<string, unknown>,
          created_at: NOW,
          updated_at: NOW,
        };
        state.savedReports.push(created);
        await json(route, { data: created }, 201);
        return;
      }
    }

    const reportIdMatch = path.match(/^\/api\/v1\/lex\/report-definitions\/([^/]+)$/);
    if (reportIdMatch && method === 'PUT') {
      const body = request.postDataJSON() as Record<string, unknown>;
      state.updateBodies.push(body);
      const index = state.savedReports.findIndex(
        (report) => report.id === reportIdMatch[1],
      );
      const current = state.savedReports[index];
      const updated = {
        ...current,
        ...body,
        updated_at: NOW,
      } as SavedReport;
      state.savedReports[index] = updated;
      await json(route, { data: updated });
      return;
    }
    if (reportIdMatch && method === 'DELETE') {
      state.deleteCount += 1;
      state.savedReports = state.savedReports.filter(
        (report) => report.id !== reportIdMatch[1],
      );
      await json(route, { data: { status: 'deleted' } });
      return;
    }

    if (path === '/api/v1/lex/reports/contracts') {
      if (url.searchParams.get('format') === 'xlsx') {
        await route.fulfill({
          status: 200,
          contentType:
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          body: Buffer.from('PK mock report workbook'),
        });
        return;
      }
      await json(route, {
        data: {
          generated_at: NOW,
          total: contracts.length,
          filters: {},
          contracts,
          by_status: { active: 1, draft: 1 },
          by_type: { services: 1, lease: 1 },
          by_risk_level: { medium: 1, low: 1 },
        },
      });
      return;
    }

    if (path === '/api/v1/lex/reports/matters') {
      await json(route, {
        data: {
          generated_at: NOW,
          total: 1,
          filters: {},
          matters: [
            {
              id: 'matter-1',
              matter_number: 'MAT-2026-001',
              title: 'Employment dispute',
              status: 'open',
              type: 'litigation',
              priority: 'high',
              owner_user_id: OWNER_USER_ID,
              owner_name: 'Handling Lawyer',
              department: 'People',
              opened_at: NOW,
              due_date: '2026-08-15',
              created_at: NOW,
            },
          ],
          by_status: { open: 1 },
          by_type: { litigation: 1 },
          by_priority: { high: 1 },
        },
      });
      return;
    }

    if (path === '/api/v1/lex/reports/obligations') {
      await json(route, {
        data: {
          generated_at: NOW,
          total: 1,
          filters: {},
          obligations: [
            {
              id: 'obligation-1',
              title: 'Issue renewal notice',
              type: 'notice',
              status: 'open',
              priority: 'critical',
              owner_user_id: OWNER_USER_ID,
              owner_name: 'Contracts Team',
              due_date: '2026-08-01',
              days_until_due: 9,
              created_at: NOW,
            },
          ],
          by_status: { open: 1 },
          by_type: { notice: 1 },
          by_priority: { critical: 1 },
          overdue: 0,
          due_soon: 1,
          completed: 0,
        },
      });
      return;
    }

    const paginated = (data: Record<string, unknown>[]) => ({
      data,
      meta: {
        total: data.length,
        page: 1,
        per_page: 25,
        total_pages: 1,
      },
    });

    if (path === '/api/v1/lex/legal-requests') {
      await json(
        route,
        paginated([
          {
            id: 'request-1',
            request_number: 'REQ-2026-001',
            title: 'Review supplier agreement',
            request_type: 'contract_review',
            requester_name: 'Requester Demo',
            department: 'Procurement',
            priority: 'normal',
            status: 'routed',
            created_at: NOW,
            updated_at: NOW,
          },
        ]),
      );
      return;
    }

    if (path === '/api/v1/lex/legal-cases') {
      await json(
        route,
        paginated([
          {
            id: 'case-1',
            case_number: 'CASE-2026-001',
            title: 'Commercial claim',
            case_type: 'commercial',
            company_status: 'plaintiff',
            status: 'active',
            priority: 'high',
            risk_rating: 'medium',
            department: 'Legal',
            responsible_lawyer: 'Officer Demo',
            created_at: NOW,
            updated_at: NOW,
          },
        ]),
      );
      return;
    }

    if (path === '/api/v1/lex/consultations') {
      await json(
        route,
        paginated([
          {
            id: 'consultation-1',
            consultation_number: 'CON-2026-001',
            title: 'Employment policy advice',
            type: 'employment',
            status: 'submitted',
            priority: 'medium',
            requester_name: 'HR Manager',
            department: 'People',
            advisor_name: 'Legal Advisor',
            created_at: NOW,
            updated_at: NOW,
          },
        ]),
      );
      return;
    }

    await json(route, {
      data: [],
      meta: { total: 0, page: 1, per_page: 25, total_pages: 0 },
    });
  });

  return state;
}

test('builds, previews, visualizes, saves, updates, exports, and deletes a report', async ({
  page,
}) => {
  const state = await mockReportBuilderApi(page);
  const pageErrors: Error[] = [];
  page.on('pageerror', (error) => pageErrors.push(error));

  await page.goto('/lex/reports/builder', { waitUntil: 'commit' });

  await expect(
    page.getByRole('heading', { level: 1, name: 'Report Builder' }),
  ).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Master Services Agreement').first()).toBeVisible();
  await expect(page.getByText('Office Lease').first()).toBeVisible();

  const sourceChecks: Array<[string, string]> = [
    ['Matters', 'MAT-2026-001'],
    ['Obligations', 'Issue renewal notice'],
    ['Legal requests', 'REQ-2026-001'],
    ['Cases', 'CASE-2026-001'],
    ['Consultations', 'CON-2026-001'],
    ['Contracts', 'Master Services Agreement'],
  ];
  for (const [source, rowText] of sourceChecks) {
    await page
      .locator('aside')
      .getByRole('button', { name: new RegExp(`^${source}`) })
      .click();
    await expect(page.getByText(rowText).first()).toBeVisible();
  }

  await page.getByLabel('Report name').fill('Quarterly contract portfolio');
  await page.getByLabel('Search records').fill('Acme');

  const addFilter = page.getByText('Add filter', { exact: true }).locator('..');
  await addFilter.click();
  await page.getByRole('option', { name: 'Status' }).click();
  await expect(page.getByRole('button', { name: 'Remove filter' })).toBeVisible();

  const viewSelect = page
    .getByText('View', { exact: true })
    .locator('..')
    .getByRole('combobox');
  await viewSelect.click();
  await page.getByRole('option', { name: 'Bar chart' }).click();
  await expect(page.locator('.recharts-wrapper').first()).toBeVisible({
    timeout: 10_000,
  });

  const csvDownloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export CSV' }).click();
  const csvDownload = await csvDownloadPromise;
  expect(csvDownload.suggestedFilename()).toMatch(
    /^quarterly-contract-portfolio-\d{4}-\d{2}-\d{2}\.csv$/,
  );
  const csvStream = await csvDownload.createReadStream();
  const csvChunks: Buffer[] = [];
  for await (const chunk of csvStream) csvChunks.push(Buffer.from(chunk));
  const csv = Buffer.concat(csvChunks).toString('utf8');
  expect(csv).toContain('Master Services Agreement');
  expect(csv).toContain('Office Lease');

  const xlsxDownloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export Excel' }).click();
  const xlsxDownload = await xlsxDownloadPromise;
  expect(xlsxDownload.suggestedFilename()).toMatch(
    /^quarterly-contract-portfolio-\d{4}-\d{2}-\d{2}\.xlsx$/,
  );

  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const saveDialog = page.getByRole('dialog', {
    name: 'Save report definition',
  });
  await expect(saveDialog).toBeVisible();
  await saveDialog.getByText('Only me', { exact: true }).locator('..').click();
  await page.getByRole('option', { name: 'Organization' }).click();
  await saveDialog.getByRole('button', { name: 'Save report' }).click();
  await expect(page.getByText('Report saved')).toBeVisible();
  expect(state.createBodies).toHaveLength(1);
  expect(state.createBodies[0]).toMatchObject({
    name: 'Quarterly contract portfolio',
    scope: 'org',
  });

  await page.getByLabel('Report name').fill('Updated contract portfolio');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Report updated')).toBeVisible();
  expect(state.updateBodies).toHaveLength(1);
  expect(state.updateBodies[0]).toMatchObject({
    name: 'Updated contract portfolio',
  });

  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  const deleteDialog = page.getByRole('alertdialog', {
    name: 'Delete saved report?',
  });
  await expect(deleteDialog).toBeVisible();
  await deleteDialog.getByRole('button', { name: 'Delete report' }).click();
  await expect(page.getByText('Report deleted')).toBeVisible();
  expect(state.deleteCount).toBe(1);

  expect(pageErrors).toEqual([]);
});
