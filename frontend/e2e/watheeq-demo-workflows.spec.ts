import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { mintAdminToken } from './e2e-auth';

type ApiRecord = Record<string, unknown> & { id?: unknown };

const API_AUTH_HEADERS = { Authorization: `Bearer ${mintAdminToken()}` };

async function expectHealthyLexPage(page: Page, route: string) {
  await page.goto(route, { waitUntil: 'commit' });
  await expect(page).not.toHaveURL(/\/login(?:\?|\/|$)/);
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible({ timeout: 25_000 });
  await expect(page.getByText(/Couldn.t load|Something went wrong|Application error/i)).toHaveCount(0);
}

async function listApiRecords(page: Page, route: string): Promise<ApiRecord[]> {
  // The browser app's axios interceptor supplies this header at runtime. Raw
  // APIRequestContext calls bypass that interceptor, so use the same signed
  // admin identity as global setup for seed discovery.
  const response = await page.request.get(route, { headers: API_AUTH_HEADERS });
  expect(response.ok(), `${route} returned HTTP ${response.status()}`).toBeTruthy();

  const payload: unknown = await response.json();
  if (Array.isArray(payload)) return payload.filter(isApiRecord);
  if (!isApiRecord(payload)) return [];

  const direct = payload.data;
  if (Array.isArray(direct)) return direct.filter(isApiRecord);
  if (isApiRecord(direct) && Array.isArray(direct.data)) {
    return direct.data.filter(isApiRecord);
  }
  return [];
}

function isApiRecord(value: unknown): value is ApiRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function recordId(record: ApiRecord | undefined): string | null {
  return typeof record?.id === 'string' && record.id.trim() ? record.id : null;
}

function metadataString(record: ApiRecord, key: string): string | null {
  const metadata = record.metadata;
  if (!isApiRecord(metadata)) return null;
  const value = metadata[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

test('new cases require a readable organisational-unit picker', async ({ page }) => {
  await expectHealthyLexPage(page, '/lex/cases');

  await page.getByRole('button', { name: /New Case|إنشاء قضية/i }).click();
  const dialog = page.getByRole('dialog', { name: /Create Case|إنشاء قضية/i });
  await expect(dialog).toBeVisible();

  const picker = dialog.getByRole('combobox', {
    name: /Owning organisational unit|الوحدة التنظيمية المالكة/i,
  });
  await expect(picker).toBeVisible();
  await picker.click();

  const firstEntity = page.locator('[cmdk-item]').first();
  await expect(firstEntity).toBeVisible({ timeout: 15_000 });
  await firstEntity.click();

  await expect(picker).not.toContainText(/[0-9a-f]{8}-[0-9a-f-]{27,}/i);
  await dialog.getByRole('button', { name: /Cancel|إلغاء/i }).click();
  await expect(dialog).toBeHidden();
});

test('case approvals come from the Lex inbox and deep-link to their cases', async ({ page }) => {
  const caseQueueResponse = page.waitForResponse((response) =>
    response.url().includes('/api/v1/lex/legal-cases/intake/tasks'),
  );

  await expectHealthyLexPage(page, '/lex/inbox');
  const response = await caseQueueResponse;
  expect(response.ok(), `case-intake inbox returned HTTP ${response.status()}`).toBeTruthy();

  const payload: unknown = await response.json();
  const records = Array.isArray(payload)
    ? payload.filter(isApiRecord)
    : isApiRecord(payload) && Array.isArray(payload.data)
      ? payload.data.filter(isApiRecord)
      : [];

  if (records.length === 0) {
    await expect(
      page.getByRole('heading', { name: /Case approvals|اعتمادات القضايا/i }),
    ).toHaveCount(0);
    return;
  }

  const caseSection = page.getByRole('heading', { name: /Case approvals|اعتمادات القضايا/i });
  await expect(caseSection).toBeVisible({ timeout: 20_000 });
  const caseLink = caseSection
    .locator('xpath=ancestor::section[1]')
    .locator('a[href^="/lex/cases/"]')
    .first();
  await expect(caseLink).toBeVisible();
  await expect(caseLink).toHaveAttribute('href', /^\/lex\/cases\/[0-9a-f-]+$/i);
});

test('case assignment uses a readable user picker and honours org ownership when present', async ({ page }) => {
  await expectHealthyLexPage(page, '/lex/cases');
  const cases = await listApiRecords(page, '/api/v1/lex/legal-cases?page=1&per_page=100');
  const assignable = cases.find((record) =>
    typeof record.status === 'string' &&
    ['open', 'under_procedure', 'on_hold'].includes(record.status),
  );
  const caseId = recordId(assignable);
  test.skip(!assignable || !caseId, 'no operational case is available for assignment');

  await expectHealthyLexPage(page, `/lex/cases/${caseId}`);
  await page.getByRole('button', { name: /^Assign$|^تعيين$/i }).last().click();

  const dialog = page.getByRole('dialog', {
    name: /Assign responsible lawyer|تعيين المحامي المسؤول/i,
  });
  await expect(dialog).toBeVisible();

  const entityId = metadataString(assignable!, 'beneficiary_entity_id');
  const membershipResponse = entityId
    ? page.waitForResponse((response) =>
        response.url().includes(`/api/v1/lex/org-entities/${entityId}/memberships`),
      )
    : null;
  const picker = dialog.getByRole('combobox', {
    name: /Responsible lawyer|المحامي المسؤول/i,
  });
  await expect(picker).toBeVisible();
  await picker.click();

  if (membershipResponse) {
    const response = await membershipResponse;
    expect(
      response.ok(),
      `entity membership directory returned HTTP ${response.status()}`,
    ).toBeTruthy();
    await expect(
      dialog.getByText(/active employee from the case.s organisational unit|موظفاً نشطاً من الوحدة التنظيمية/i),
    ).toBeVisible();
  } else {
    await expect(
      dialog.getByText(/older case has no organisational unit|لا ترتبط هذه القضية القديمة بوحدة تنظيمية/i),
    ).toBeVisible();
  }

  const firstUser = page.locator('[cmdk-item]').first();
  await expect(firstUser).toBeVisible({ timeout: 15_000 });
  await expect(firstUser).not.toContainText(/[0-9a-f]{8}-[0-9a-f-]{27,}/i);
  // Select locally to close the picker popover; cancelling the parent dialog
  // still guarantees this smoke check performs no assignment mutation.
  await firstUser.click();
  await dialog.getByRole('button', { name: /Cancel|إلغاء/i }).click();
  await expect(dialog).toBeHidden();
});

test('a draft contract exposes the governed review dialog without submitting it', async ({ page }) => {
  await expectHealthyLexPage(page, '/lex/contracts');
  const contracts = await listApiRecords(page, '/api/v1/lex/contracts?page=1&per_page=100');
  const draft = contracts.find((record) => record.status === 'draft' && recordId(record));
  const contractId = recordId(draft);
  test.skip(!draft || !contractId, 'no draft contract is available to inspect the review workflow');

  await expectHealthyLexPage(page, `/lex/contracts/${contractId}`);
  const startReview = page.getByRole('button', {
    name: /Start Review Workflow|بدء سير عمل المراجعة/i,
  }).first();
  await expect(startReview).toBeVisible();
  await expect(startReview).toBeEnabled();
  await startReview.click();

  const dialog = page.getByRole('dialog', {
    name: /Start Review Workflow|بدء سير عمل المراجعة/i,
  });
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByText(/workflow-backed legal review task|مهمة مراجعة قانونية مدعومة بسير العمل/i),
  ).toBeVisible();
  await expect(dialog.getByLabel(/Approver role|دور المعتمِد/i)).toBeVisible();
  await dialog.getByRole('button', { name: /Cancel|إلغاء/i }).click();
  await expect(dialog).toBeHidden();
});

test('a contract opens a prefilled signature-envelope flow', async ({ page }) => {
  await expectHealthyLexPage(page, '/lex/contracts');
  const contracts = await listApiRecords(page, '/api/v1/lex/contracts?page=1&per_page=100');
  const contract = contracts.find((record) => recordId(record));
  const contractId = recordId(contract);
  const contractTitle = typeof contract?.title === 'string' ? contract.title.trim() : '';
  test.skip(!contract || !contractId, 'no seeded contract is available for the demo flow');

  await expectHealthyLexPage(page, `/lex/contracts/${contractId}`);
  const signatureLink = page.locator('a[href^="/lex/signatures?create=1&contract_id="]').first();
  await expect(signatureLink).toBeVisible();
  await expect(signatureLink).toHaveAttribute(
    'href',
    `/lex/signatures?create=1&contract_id=${contractId}`,
  );
  await signatureLink.click();

  await expect(page).toHaveURL(
    new RegExp(`/lex/signatures\\?create=1&contract_id=${contractId}`),
    { timeout: 20_000 },
  );
  const dialog = page.getByRole('dialog', {
    name: /New Signature Envelope|مظروف توقيع جديد/i,
  });
  await expect(dialog).toBeVisible({ timeout: 20_000 });
  if (contractTitle) {
    await expect(dialog.getByText(contractTitle, { exact: true }).first()).toBeVisible({
      timeout: 20_000,
    });
  }
});

test('PDF repository upload inspects embedded text and keeps the file previewable', async ({ page }) => {
  await expectHealthyLexPage(page, '/lex/documents');
  await page.getByRole('button', { name: /Create Document|إنشاء وثيقة/i }).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.locator('#initial_file').setInputFiles(
    path.resolve(process.cwd(), '../docs/ClarioWatheeq/Watheeq_Features_and_Capabilities.pdf'),
  );

  // The fixture contains both dense text pages and a sparse contents page, so
  // the truthful result may be complete text-layer extraction or partial text
  // with the sparse page left for server OCR.
  await expect(
    dialog.locator(
      '[data-pdf-processing-status="text_extracted"], [data-pdf-processing-status="partial_ocr_pending"]',
    ),
  ).toBeVisible({ timeout: 45_000 });
  await expect(
    dialog.getByText(
      /Text-layer extraction is not OCR|Searchable text was found|استخراج طبقة النص ليس OCR|عُثر على نص قابل للبحث/i,
    ),
  ).toBeVisible();
  await dialog.getByRole('button', { name: /Cancel|إلغاء/i }).click();
});

test('a repository PDF opens inline with its version history', async ({ page }) => {
  await expectHealthyLexPage(page, '/lex/documents');
  const documents = await listApiRecords(page, '/api/v1/lex/documents?page=1&per_page=100');
  const pdf = documents.find((record) =>
    typeof record.file_name === 'string' &&
    /\.pdf$/i.test(record.file_name) &&
    typeof record.file_id === 'string' &&
    record.file_id.trim() &&
    record.confidentiality !== 'privileged' &&
    typeof record.title === 'string' &&
    record.title.trim(),
  );
  test.skip(!pdf, 'no non-privileged repository PDF is available for inline preview');

  const title = pdf!.title as string;
  const fileName = pdf!.file_name as string;
  const search = page.getByRole('textbox', {
    name: /Search legal documents|البحث في الوثائق القانونية/i,
  });
  await search.fill(title);

  const titleCell = page.getByText(title, { exact: true }).first();
  await expect(titleCell).toBeVisible({ timeout: 20_000 });
  await titleCell.click();

  const sheet = page.getByRole('dialog');
  await expect(sheet).toBeVisible();
  await expect(sheet.locator(`iframe[title=${JSON.stringify(fileName)}]`)).toBeVisible({
    timeout: 20_000,
  });

  const history = sheet.getByRole('region', {
    name: /Version history|سجل النسخ/i,
  });
  await expect(history).toBeVisible();
  await expect(history.getByText(/Current|الحالي/i).first()).toBeVisible({ timeout: 20_000 });
});
