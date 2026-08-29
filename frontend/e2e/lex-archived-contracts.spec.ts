import {
  expect,
  test,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
} from '@playwright/test';

const gatewayURL = process.env.PLAYWRIGHT_GATEWAY_URL ?? 'http://127.0.0.1:8092';
const managerEmail = 'contractmanager@alothaim.com';
const managerPassword = 'DemoPass123!';
const managerUserID = 'bbbbbbbb-0000-0000-0000-00000000000a';
const testReasonPrefix = 'Playwright archive verification';
const liveExpect = expect.configure({ timeout: 60_000 });

interface ContractRecord {
  id: string;
  title: string;
  contract_number?: string | null;
  type: string;
  status: string;
  department?: string | null;
  owner_user_id: string;
  tags?: string[];
}

test.afterEach(async ({ request }) => {
  const login = await request.post(`${gatewayURL}/api/v1/auth/login`, {
    data: { email: managerEmail, password: managerPassword, remember: false },
  });
  if (!login.ok()) return;
  const auth = (await login.json()) as { access_token: string };
  await cleanupTestArchives(request, { Authorization: `Bearer ${auth.access_token}` });
});

test('archive lifecycle is searchable, drillable, and restorable end to end', async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(180_000);
  const { context, page, accessToken } = await signedInManager(browser, baseURL);
  const request = context.request;
  const headers = { Authorization: `Bearer ${accessToken}` };
  await cleanupTestArchives(request, headers);
  const liveBefore = await getContracts(request, headers);
  const contract = liveBefore[0];
  expect(contract, 'the local tenant needs at least one live contract').toBeTruthy();

  const reason = `${testReasonPrefix} ${Date.now()}`;
  let needsCleanup = false;

  try {
    const archiveResponse = await request.post(
      `${gatewayURL}/api/v1/lex/contracts/${contract.id}/archive`,
      { headers, data: { reason } },
    );
    expect(archiveResponse.status(), await archiveResponse.text()).toBe(200);
    needsCleanup = true;

    const liveAfterArchive = await getContracts(request, headers);
    expect(liveAfterArchive.some((item) => item.id === contract.id)).toBe(false);

    const today = new Date().toISOString().slice(0, 10);
    const query = new URLSearchParams({
      page: '1',
      per_page: '50',
      archive_status: 'archived',
      search: contract.contract_number || contract.title,
      archive_date_from: today,
      archive_date_to: today,
      archived_by: managerUserID,
      status: contract.status,
      type: contract.type,
      owner_user_id: contract.owner_user_id,
    });
    if (contract.department) query.set('department', contract.department);
    if (contract.tags?.[0]) query.set('tag', contract.tags[0]);

    const filteredResponse = await request.get(
      `${gatewayURL}/api/v1/lex/contracts/archived?${query.toString()}`,
      { headers },
    );
    expect(filteredResponse.status(), await filteredResponse.text()).toBe(200);
    const filteredEnvelope = (await filteredResponse.json()) as {
      data: Array<ContractRecord & { archive_reason?: string | null }>;
    };
    expect(filteredEnvelope.data.map((item) => item.id)).toContain(contract.id);
    expect(filteredEnvelope.data.find((item) => item.id === contract.id)?.archive_reason).toBe(
      reason,
    );

    const detailWarmup = await request.get(`/lex/contracts/${contract.id}`);
    expect(detailWarmup.ok(), await detailWarmup.text()).toBeTruthy();

    await page.goto('/lex/contracts/archived', { waitUntil: 'domcontentloaded' });
    await liveExpect(page.getByRole('heading', { name: 'Archive', level: 1 })).toBeVisible();
    await page
      .getByRole('searchbox', { name: 'Search archived contracts' })
      .fill(contract.contract_number || contract.title);

    const viewLink = page.getByRole('link', { name: `View: ${contract.title}` }).first();
    await liveExpect(viewLink).toBeVisible();
    await liveExpect(page.getByText(reason).first()).toBeVisible();
    await liveExpect(page.getByText(/\d{2}:\d{2}/).first()).toBeVisible();

    await viewLink.click();
    await liveExpect(page).toHaveURL(new RegExp(`/lex/contracts/${contract.id}$`));
    await liveExpect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();

    await page.goto('/lex/contracts/archived', { waitUntil: 'domcontentloaded' });
    await page
      .getByRole('searchbox', { name: 'Search archived contracts' })
      .fill(contract.contract_number || contract.title);
    const restoreButton = page
      .getByRole('button', { name: `Unarchive: ${contract.title}` })
      .first();
    await liveExpect(restoreButton).toBeVisible();
    await restoreButton.click();
    await expect(page.getByRole('alertdialog')).toBeVisible();

    const restoreResponsePromise = page.waitForResponse(
      (response) =>
        response.url().includes(`/api/v1/lex/contracts/${contract.id}/unarchive`) &&
        response.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Restore contract' }).click();
    expect((await restoreResponsePromise).status()).toBe(200);
    needsCleanup = false;

    await liveExpect(
      page.getByRole('button', { name: `Unarchive: ${contract.title}` }),
    ).toHaveCount(0);
    const liveAfterRestore = await getContracts(request, headers);
    expect(liveAfterRestore.some((item) => item.id === contract.id)).toBe(true);
  } finally {
    if (needsCleanup) {
      await request.post(`${gatewayURL}/api/v1/lex/contracts/${contract.id}/unarchive`, {
        headers,
        data: {},
      });
    }
    await context.close();
  }
});

async function getContracts(
  request: APIRequestContext,
  headers: Record<string, string>,
): Promise<ContractRecord[]> {
  const response = await request.get(
    `${gatewayURL}/api/v1/lex/contracts?page=1&per_page=200`,
    { headers },
  );
  expect(response.status(), await response.text()).toBe(200);
  const envelope = (await response.json()) as { data: ContractRecord[] };
  return envelope.data;
}

async function cleanupTestArchives(
  request: APIRequestContext,
  headers: Record<string, string>,
) {
  const response = await request.get(
    `${gatewayURL}/api/v1/lex/contracts/archived?page=1&per_page=200`,
    { headers },
  );
  if (!response.ok()) return;
  const envelope = (await response.json()) as {
    data: Array<ContractRecord & { archive_reason?: string | null }>;
  };
  for (const contract of envelope.data) {
    if (contract.archive_reason?.startsWith(testReasonPrefix)) {
      await request.post(`${gatewayURL}/api/v1/lex/contracts/${contract.id}/unarchive`, {
        headers,
        data: {},
      });
    }
  }
}

async function signedInManager(
  browser: Browser,
  baseURL: string | undefined,
): Promise<{ context: BrowserContext; page: Awaited<ReturnType<BrowserContext['newPage']>>; accessToken: string }> {
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();
  const login = await context.request.post(`${gatewayURL}/api/v1/auth/login`, {
    data: { email: managerEmail, password: managerPassword, remember: false },
  });
  expect(login.ok(), await login.text()).toBeTruthy();
  const auth = (await login.json()) as { access_token: string; refresh_token: string };
  const origin = new URL(baseURL ?? 'http://localhost:3002').origin;
  const session = await context.request.post('/api/auth/session', {
    data: {
      access_token: auth.access_token,
      refresh_token: auth.refresh_token,
      remember: false,
    },
    headers: { Origin: origin, Referer: `${origin}/login` },
  });
  expect(session.ok(), await session.text()).toBeTruthy();

  const sessionCheck = await context.request.get('/api/auth/session');
  expect(sessionCheck.ok(), await sessionCheck.text()).toBeTruthy();

  const archiveWarmup = await context.request.get('/lex/contracts/archived');
  expect(archiveWarmup.ok(), await archiveWarmup.text()).toBeTruthy();

  return { context, page, accessToken: auth.access_token };
}
