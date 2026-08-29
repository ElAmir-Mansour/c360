import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { randomUUID } from 'crypto';
import path from 'path';
import { mintAdminToken, mintE2EToken, signInWithToken } from './e2e-auth';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8092';

const requesterPermissions = [
  'lex:request:view',
  'lex:request:add',
  'lex:request:edit',
  'lex:read',
];

const approverPermissions = [
  'lex:request:view',
  'lex:request:add',
  'lex:request:edit',
  'lex:request:approve',
  'lex:approval:write',
  'lex:write',
  'lex:read',
];

test.describe('Watheeq request approval workflow UI', () => {
  test('creates a designer workflow first, then approves a linked service request to routed status', async ({
    page,
    request,
    baseURL,
  }) => {
    // This verification config targets the live Next.js dev server, where the
    // workflow designer and request-detail route may each require a cold
    // on-demand compile before React can hydrate.
    test.setTimeout(360_000);

    const runId = Date.now().toString(36);
    const serviceCode = `PW_UI_APPROVAL_${runId}`.toUpperCase();
    const requestType = `pw_ui_approval_${runId}`;
    const requestTitleEn = `Playwright approval workflow ${runId}`;
    const requestTitleAr = 'اختبار سير عمل الموافقة عبر واجهة المستخدم';
    const evidenceDir = test.info().outputPath('lex-request-approval-ui');

    const adminToken = mintAdminToken();
    const workflowDefinition = await createWorkflowDefinitionFromDesignerUI(
      page,
      request,
      baseURL,
      adminToken,
      evidenceDir,
    );
    const service = await createServiceCatalogEntry(request, adminToken, {
      code: serviceCode,
      requestType,
    });
    const department = await createOrgEntity(request, adminToken, runId);
    const policy = await createRequestApprovalPolicy(request, adminToken, {
      serviceId: service.id,
      requestType,
      name: `${serviceCode} requester approval`,
      workflowDefinitionId: workflowDefinition.id,
    });
    test.info().annotations.push(
      { type: 'workflow_definition_id', description: workflowDefinition.id },
      { type: 'service_id', description: service.id },
      { type: 'policy_id', description: policy.id },
    );

    const requesterToken = mintE2EToken({
      userId: randomUUID(),
      email: `requester-${runId}@lex.ui.test`,
      fullName: 'مستخدم اختبار طلبات الخدمة',
      roles: ['legal-requester'],
      permissions: requesterPermissions,
    });
    const approverToken = mintE2EToken({
      userId: randomUUID(),
      email: `approver-${runId}@lex.ui.test`,
      fullName: 'مستخدم اختبار الموافقات',
      // The configured approver is the department-manager role; legal-director is
      // also assigned so the same UI actor can press Start Approval, whose route
      // is still gated by the approval-write/lex-write tier.
      roles: ['legal-dept-manager', 'legal-director', 'requester'],
      permissions: approverPermissions,
    });

    let requestId = '';

    await test.step('Requester creates and submits a legal request from the service catalog UI', async () => {
      await signInWithToken(page, baseURL, requesterToken);
      await page.goto('/lex/service-desk/new', { waitUntil: 'commit' });
      await expect(page).toHaveURL(/\/lex\/service-desk\/new(?:[/?#]|$)/);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 60_000 });

      // The dashboard header also exposes a global searchbox. Target the
      // service-catalog search explicitly so filling it cannot open the global
      // command palette and leave an overlay above the wizard.
      await page
        .getByRole('searchbox', { name: /Search services|البحث عن الخدمات/i })
        .fill(serviceCode);
      await page.getByRole('radio', { name: new RegExp(serviceCode, 'i') }).click();
      await page.screenshot({ path: path.join(evidenceDir, '01-service-selected.png'), fullPage: true });

      await page
        .getByRole('button', { name: /Next: Request Details|التالي: تفاصيل الطلب/ })
        .click();
      await page.getByRole('textbox', { name: /Title \(English\)|Request Title|العنوان/i }).fill(requestTitleEn);
      await page.getByRole('button', { name: /Add Arabic title|أضف العنوان بالعربية/i }).click();
      await page.getByRole('textbox', { name: /Arabic title|العنوان بالعربية/i }).fill(requestTitleAr);
      await page
        .getByRole('textbox', { name: /Description|الوصف/i })
        .fill('يرجى اعتماد طلب اختبار سير عمل الموافقة الشامل عبر واجهة المستخدم.');
      await page
        .getByRole('combobox', { name: /Beneficiary department|الجهة.*الإدارة/i })
        .click();
      await page.getByRole('option', { name: new RegExp(department.code, 'i') }).click();
      await page
        .getByLabel(/Requested due date|تاريخ الاستحقاق المطلوب/i)
        .fill(localDateDaysFromNow(10));

      await page
        .getByRole('button', { name: /Next: Attachments|التالي: المرفقات/ })
        .click();
      await page
        .getByRole('button', { name: /Next: Review & Confirm|التالي: المراجعة والتأكيد/ })
        .click();
      await expect(page.getByText(requestTitleEn)).toBeVisible();
      await expect(page.getByText(requestTitleAr)).toBeVisible();
      await page.getByRole('checkbox').check();
      await page.screenshot({ path: path.join(evidenceDir, '02-review-before-create.png'), fullPage: true });

      const createResponse = page.waitForResponse(
        (response) =>
          /\/api\/v1\/lex\/legal-requests$/.test(new URL(response.url()).pathname) &&
          response.request().method() === 'POST' &&
          response.status() >= 200 &&
          response.status() < 300,
      );
      const submitResponse = page.waitForResponse(
        (response) =>
          /\/api\/v1\/lex\/legal-requests\/[^/]+\/submit$/.test(
            new URL(response.url()).pathname,
          ) &&
          response.request().method() === 'POST' &&
          response.status() >= 200 &&
          response.status() < 300,
      );
      await page
        .getByRole('button', { name: /Submit Request|إرسال الطلب/ })
        .click();
      const [createResult, submitResult] = await Promise.all([createResponse, submitResponse]);
      const created = unwrap(await createResult.json()) as { id: string; request_number?: string };
      const submitted = unwrap(await submitResult.json()) as { id: string; status: string };
      requestId = created.id;
      expect(requestId).toBeTruthy();
      expect(submitted.id).toBe(requestId);
      expect(submitted.status).toBe('pending_requester_approval');

      await expect(page.getByRole('link', { name: /View request|عرض الطلب/ })).toBeVisible({
        timeout: 15_000,
      });
      await page.screenshot({ path: path.join(evidenceDir, '03-submitted-success.png'), fullPage: true });
    });

    await test.step('Approver sees the automatically-started approval workflow', async () => {
      await signInWithToken(page, baseURL, approverToken);
      await page.goto(`/lex/service-desk/${requestId}`, { waitUntil: 'commit' });
      await expect(page.getByRole('heading', { name: new RegExp(requestTitleEn) })).toBeVisible({
        timeout: 60_000,
      });
      await expect(
        page.getByRole('button', { name: /^Approve request$|^اعتماد الطلب$/ }),
      ).toBeVisible({ timeout: 30_000 });
      await page.screenshot({ path: path.join(evidenceDir, '04-workflow-task-visible.png'), fullPage: true });
    });

    await test.step('Approver approves the visible workflow task and the request reaches Routed', async () => {
      await page
        .getByRole('textbox', {
          name: /^Approval \/ rejection comments|^ملاحظات الموافقة \/ الرفض/i,
        })
        .fill('Approved by Playwright UI test.');
      const [decisionResponse] = await Promise.all([
        page.waitForResponse(
          (response) =>
            response.url().includes(`/api/v1/lex/requests/${requestId}/approval/`) &&
            response.url().includes('/decision') &&
            response.request().method() === 'POST',
        ),
        page.getByRole('button', { name: /^Approve request$|^اعتماد الطلب$/ }).click(),
      ]);
      expect(decisionResponse.ok(), await decisionResponse.text()).toBeTruthy();
      const decisionOutcome = unwrap(await decisionResponse.json()) as {
        decision: string;
        resolution: string;
        task_status: string;
        workflow_status: string;
        status: string;
      };
      expect(decisionOutcome.decision).toBe('approve');
      expect(decisionOutcome.resolution).toBe('advance');
      expect(decisionOutcome.task_status).toBe('completed');
      expect(decisionOutcome.workflow_status).toBe('completed');
      expect(decisionOutcome.status).toBe('approved');

      await expect(page.getByText(/^Routed$|^موجّه$/).first()).toBeVisible({ timeout: 20_000 });
      await page.screenshot({ path: path.join(evidenceDir, '05-routed-final.png'), fullPage: true });

      const finalResponse = await request.get(`${API_BASE}/api/v1/lex/legal-requests/${requestId}`, {
        headers: { Authorization: `Bearer ${approverToken}` },
      });
      expect(finalResponse.ok(), await finalResponse.text()).toBeTruthy();
      const finalRequest = unwrap(await finalResponse.json()) as {
        id: string;
        status: string;
        workflow_instance_id?: string | null;
      };
      expect(finalRequest.status).toBe('routed');

      const tasksResponse = await request.get(`${API_BASE}/api/v1/lex/requests/${requestId}/approval/tasks`, {
        headers: { Authorization: `Bearer ${approverToken}` },
      });
      expect(tasksResponse.ok(), await tasksResponse.text()).toBeTruthy();
      const tasks = unwrap(await tasksResponse.json()) as { id: string; status: string }[];
      expect(tasks.length).toBeGreaterThan(0);
      expect(tasks.filter((task) => task.status === 'pending' || task.status === 'claimed')).toEqual([]);
      expect(tasks.every((task) => task.status === 'completed')).toBeTruthy();
    });
  });
});

async function createWorkflowDefinitionFromDesignerUI(
  page: Page,
  request: APIRequestContext,
  baseURL: string | undefined,
  token: string,
  evidenceDir: string,
): Promise<{ id: string; name: string; status: string; published_at?: string | null }> {
  await signInWithToken(page, baseURL, token);
  await page.goto('/admin/workflows/definitions', { waitUntil: 'commit' });
  await expect(page.getByRole('button', { name: /Create Definition|إنشاء تعريف/i }).first()).toBeVisible({
    timeout: 60_000,
  });

  const createResponsePromise = page.waitForResponse(
    (response) =>
      response.url().includes('/api/v1/workflows/definitions') &&
      !response.url().includes('/publish') &&
      response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: /Create Definition|إنشاء تعريف/i }).first().click();
  const createResponse = await createResponsePromise;
  expect(createResponse.ok(), await createResponse.text()).toBeTruthy();
  const created = unwrap(await createResponse.json()) as {
    id: string;
    name: string;
    status: string;
  };
  expect(created.id).toBeTruthy();
  expect(created.status).toBe('draft');

  const designerURL = `/admin/workflows/definitions/${created.id}/designer`;
  await page.waitForURL(new RegExp(`${designerURL}(?:[/?#]|$)`), { timeout: 5_000 }).catch(async () => {
    await page.goto(designerURL, { waitUntil: 'commit' });
  });
  await expect(page).toHaveURL(new RegExp(`${designerURL}(?:[/?#]|$)`), { timeout: 20_000 });
  await expect(page.getByRole('heading', { name: created.name })).toBeVisible({ timeout: 20_000 });
  await page.screenshot({
    path: path.join(evidenceDir, '00-workflow-designer-created.png'),
    fullPage: true,
  });

  const publishResponsePromise = page.waitForResponse(
    (response) =>
      response.url().includes(`/api/v1/workflows/definitions/${created.id}/publish`) &&
      response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: /^Publish$|^نشر$/ }).click();
  const publishResponse = await publishResponsePromise;
  expect(publishResponse.ok(), await publishResponse.text()).toBeTruthy();
  const published = unwrap(await publishResponse.json()) as {
    id: string;
    name: string;
    status: string;
    published_at?: string | null;
  };
  expect(published.id).toBe(created.id);
  expect(published.status).toBe('active');
  expect(published.published_at).toBeTruthy();

  await expect(page.getByText(/Read-only|للقراءة فقط/i)).toBeVisible({ timeout: 20_000 });
  await page.screenshot({
    path: path.join(evidenceDir, '00-workflow-designer-published.png'),
    fullPage: true,
  });

  const getResponse = await request.get(`${API_BASE}/api/v1/workflows/definitions/${created.id}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(getResponse.ok(), await getResponse.text()).toBeTruthy();
  const fetched = unwrap(await getResponse.json()) as {
    id: string;
    name: string;
    status: string;
    published_at?: string | null;
  };
  expect(fetched.id).toBe(created.id);
  expect(fetched.status).toBe('active');
  expect(fetched.published_at).toBeTruthy();
  return fetched;
}

async function createServiceCatalogEntry(
  request: APIRequestContext,
  token: string,
  input: { code: string; requestType: string },
): Promise<{ id: string; code: string }> {
  const response = await request.post(`${API_BASE}/api/v1/lex/service-catalog`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      code: input.code,
      request_type: input.requestType,
      name: {
        en: `Playwright Approval ${input.code}`,
        ar: 'اختبار الموافقة عبر واجهة المستخدم',
      },
      description: {
        en: 'Playwright end-to-end approval workflow service',
        ar: 'خدمة اختبار سير عمل الموافقة الشامل عبر واجهة المستخدم',
      },
      available_to: ['all'],
      requester_approval_required: true,
      provider_approval_required: false,
      channel: 'platform',
      active: true,
      eligibility_rules: [{ rule_type: 'all', value: '' }],
    },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return unwrap(await response.json()) as { id: string; code: string };
}

async function createOrgEntity(
  request: APIRequestContext,
  token: string,
  runId: string,
): Promise<{ id: string; code: string }> {
  const code = `PW-PROC-${runId}`.toUpperCase();
  const response = await request.post(`${API_BASE}/api/v1/lex/org-entities`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      entity_type: 'department',
      code,
      name: {
        en: `Playwright Procurement ${runId}`,
        ar: 'إدارة المشتريات لاختبار الواجهة',
      },
      active: true,
      metadata: { source: 'playwright-request-lifecycle' },
    },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return unwrap(await response.json()) as { id: string; code: string };
}

function localDateDaysFromNow(days: number): string {
  const value = new Date();
  value.setDate(value.getDate() + days);
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

async function createRequestApprovalPolicy(
  request: APIRequestContext,
  token: string,
  input: { serviceId: string; requestType: string; name: string; workflowDefinitionId: string },
): Promise<{ id: string; metadata?: Record<string, unknown> }> {
  const response = await request.post(`${API_BASE}/api/v1/lex/request-approval/policies`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      name: input.name,
      description: 'Playwright UI end-to-end request approval policy',
      status: 'active',
      priority: 1000,
      request_type: input.requestType,
      service_id: input.serviceId,
      stage: 'requester',
      currency: 'SAR',
      mode: 'sequential',
      quorum: 'all',
      approvers: [{ type: 'role', ref: 'legal-dept-manager' }],
      metadata: {
        workflow_definition_id: input.workflowDefinitionId,
        workflow_definition_source: 'workflow_designer',
      },
    },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  const createResult = unwrap(await response.json()) as {
    policy?: {
      id: string;
      metadata?: Record<string, unknown>;
    };
    id: string;
    metadata?: Record<string, unknown>;
  };
  const policy = createResult.policy ?? createResult;
  expect(policy.id).toBeTruthy();

  const getResponse = await request.get(`${API_BASE}/api/v1/lex/request-approval/policies/${policy.id}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(getResponse.ok(), await getResponse.text()).toBeTruthy();
  const persistedPolicy = unwrap(await getResponse.json()) as {
    id: string;
    metadata?: Record<string, unknown>;
  };
  expect(persistedPolicy.metadata?.workflow_definition_id).toBe(input.workflowDefinitionId);
  return policy;
}

function unwrap(value: unknown): unknown {
  if (
    value &&
    typeof value === 'object' &&
    'data' in value &&
    Object.keys(value).every((key) => key === 'data' || key === 'meta')
  ) {
    return (value as { data: unknown }).data;
  }
  return value;
}
