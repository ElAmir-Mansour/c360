import {
  expect,
  test,
  type APIResponse,
  type Browser,
  type BrowserContext,
  type Page,
} from '@playwright/test';

const managerEmail = 'contractssmanager@alothaim.com';
const directorEmail = 'director@alothaim.com';
const casesManagerEmail = 'casesmanager@alothaim.com';
const caseOfficerEmail = 'officer@almashura.demo';
const businessEmail = 'business@alothaim.com';
const password = 'OthDemo123!';
const legacyPassword = 'DemoPass123!';
const managerUserID = 'bbbbbbbb-0000-0000-0000-00000000000e';
const watheeqTenantID = '1924590c-ad74-4ca7-b802-118c82de26da';
const liveExpect = expect.configure({ timeout: 60_000 });

test.describe.serial('Watheeq Contracts & Consultations Manager live integration', () => {
  test.setTimeout(180_000);

  test('uses the exact persona navigation, scoped dashboard, and scoped reports', async ({
    browser,
    baseURL,
  }) => {
    const { context, page } = await signedInPage(browser, baseURL, managerEmail);
    const failedLexResponses: string[] = [];
    page.on('response', (response) => {
      const url = new URL(response.url());
      if (url.pathname.startsWith('/api/v1/lex/') && response.status() >= 400) {
        failedLexResponses.push(`${response.status()} ${url.pathname}`);
      }
    });

    try {
      await page.goto('/lex/contracts/control', { waitUntil: 'domcontentloaded' });
      await liveExpect(
        page.getByRole('heading', { level: 1, name: 'Control & Monitoring Panel' }),
      ).toBeVisible();
      await liveExpect(page.getByText('Active Contracts', { exact: true })).toBeVisible();
      await liveExpect(page.getByText('Consultations', { exact: true }).first()).toBeVisible();
      await liveExpect(page.getByText(/satisfaction/i)).toHaveCount(0);

      const topbarLinks = page.locator('header nav').first().locator('a');
      await liveExpect(topbarLinks).toHaveCount(8);
      const topbarHrefs = await topbarLinks
        .evaluateAll((links) => links.map((link) => new URL((link as HTMLAnchorElement).href).pathname));
      liveExpect(topbarHrefs).toEqual([
        '/lex/contracts/control',
        '/lex/tasks',
        '/lex/service-desk',
        '/lex/contracts',
        '/lex/consultations',
        '/lex/reports',
        '/lex/library',
        '/lex/inbox',
      ]);

      await page.goto('/lex/reports', { waitUntil: 'domcontentloaded' });
      await liveExpect(
        page.getByRole('heading', { level: 1, name: 'Contracts & consultations reports' }),
      ).toBeVisible();
      await liveExpect(page.getByRole('tab', { name: 'Contracts' })).toBeVisible();
      await liveExpect(page.getByRole('tab', { name: 'Consultations' })).toBeVisible();
      await liveExpect(
        page.getByRole('link', { name: 'Report builder', exact: true }),
      ).toHaveAttribute(
        'href',
        '/lex/reports/builder',
      );
      await liveExpect(page.getByRole('button', { name: 'Download PDF' })).toBeVisible();
      await liveExpect(page.getByText('Report period', { exact: true })).toBeVisible();
      await liveExpect(page.getByRole('button', { name: 'Today' })).toBeVisible();
      await liveExpect(page.getByRole('button', { name: 'All time' })).toBeVisible();
      await liveExpect(page.getByText(/satisfaction/i)).toHaveCount(0);

      await page.getByRole('tab', { name: 'Consultations' }).click();
      await liveExpect(page.getByText('Total consultations', { exact: true })).toBeVisible();
      liveExpect(failedLexResponses).toEqual([]);
    } finally {
      await context.close();
    }
  });

  test('renders the published Business, Director, and Cases Manager navigation contracts', async ({
    browser,
    baseURL,
  }) => {
    const personas = [
      {
        email: businessEmail,
        paths: ['/lex', '/lex/tasks', '/lex/service-desk'],
      },
      {
        email: directorEmail,
        paths: ['/lex', '/lex/tasks', '/lex/reports', '/lex/knowledge-hub'],
      },
      {
        email: casesManagerEmail,
        paths: [
          '/lex/cases/control',
          '/lex/tasks',
          '/lex/service-desk',
          '/lex/cases',
          '/lex/investigations',
          '/lex/reports',
          '/lex/library',
          '/lex/inbox',
        ],
      },
    ];

    for (const persona of personas) {
      const signedIn = await signedInPage(browser, baseURL, persona.email);
      try {
        await signedIn.page.goto('/lex/tasks', { waitUntil: 'domcontentloaded' });
        const topbarLinks = signedIn.page.locator('header nav').first().locator('a');
        await liveExpect(topbarLinks).toHaveCount(persona.paths.length);
        const paths = await topbarLinks.evaluateAll((links) =>
          links.map((link) => new URL((link as HTMLAnchorElement).href).pathname),
        );
        liveExpect(paths).toEqual(persona.paths);

        if (persona.email === businessEmail) {
          const support = signedIn.page.getByRole('button', {
            name: /Ask for support|طلب دعم/,
          });
          await liveExpect(support).toBeVisible();
          await support.click();
          await liveExpect(
            signedIn.page.getByRole('dialog', { name: /Ask for support|طلب دعم/ }),
          ).toBeVisible();
        }
      } finally {
        await signedIn.context.close();
      }
    }
  });

  test('runs create, assignee submission, and director acceptance through the Tasks UI', async ({
    browser,
    baseURL,
  }) => {
    const manager = await signedInPage(browser, baseURL, managerEmail);
    const title = `Live manager task ${Date.now()}`;

    try {
      const create = await manager.page.request.post('/api/v1/lex/manager-tasks', {
        headers: { Authorization: `Bearer ${manager.accessToken}` },
        data: {
          title,
          description: 'Created for the browser-to-backend lifecycle test.',
          assignee_id: managerUserID,
        },
      });
      liveExpect(create.status(), await create.text()).toBe(201);

      await manager.page.goto('/lex/tasks', { waitUntil: 'domcontentloaded' });
      await liveExpect(manager.page.getByRole('heading', { level: 1, name: 'Tasks' })).toBeVisible();
      const managerCard = manager.page.locator('article').filter({ hasText: title });
      await liveExpect(managerCard).toBeVisible();
      await managerCard.getByRole('button', { name: 'Start task' }).click();
      await liveExpect(managerCard.getByText('In progress', { exact: true })).toBeVisible();
      await managerCard.getByRole('button', { name: 'Submit result' }).click();
      const submitDialog = manager.page.getByRole('dialog', { name: 'Submit task result' });
      await submitDialog
        .getByLabel('Result and evidence')
        .fill('Completed with live browser and backend evidence.');
      await submitDialog.getByRole('button', { name: 'Submit for review' }).click();
      await liveExpect(managerCard.getByText('Submitted', { exact: true })).toBeVisible();

      const director = await signedInPage(browser, baseURL, directorEmail);
      try {
        await director.page.goto('/lex/tasks', { waitUntil: 'domcontentloaded' });
        const directorCard = director.page.locator('article').filter({ hasText: title });
        await liveExpect(directorCard).toBeVisible();
        await directorCard.getByRole('button', { name: 'Review submission' }).click();
        const reviewDialog = director.page.getByRole('dialog', {
          name: 'Review task submission',
        });
        await reviewDialog.getByRole('button', { name: 'Accept' }).click();
        await liveExpect(directorCard.getByText('Accepted', { exact: true })).toBeVisible();
      } finally {
        await director.context.close();
      }
    } finally {
      await manager.context.close();
    }
  });

  test('lets the Cases Manager create, assign, and accept a task through the UI', async ({
    browser,
    baseURL,
  }) => {
    const casesManager = await signedInPage(browser, baseURL, casesManagerEmail);
    const title = `Live cases-manager task ${Date.now()}`;

    try {
      await casesManager.page.goto('/lex/tasks', { waitUntil: 'domcontentloaded' });
      await liveExpect(
        casesManager.page.getByRole('button', { name: 'Create task', exact: true }),
      ).toBeVisible();
      await casesManager.page.getByRole('button', { name: 'Create task', exact: true }).click();

      const createDialog = casesManager.page.getByRole('dialog', {
        name: 'Create and assign task',
      });
      await createDialog.getByLabel('Task title').fill(title);
      await createDialog
        .getByLabel('Description')
        .fill('Review the case evidence chronology and return a concise finding.');
      await createDialog.getByLabel('Assignee').click();
      await casesManager.page
        .getByRole('option', { name: /officer@almashura\.demo/i })
        .click();
      await createDialog.getByRole('button', { name: 'Create task' }).click();

      const createdCard = casesManager.page.locator('article').filter({ hasText: title });
      await liveExpect(createdCard).toBeVisible();
      await liveExpect(createdCard.getByText('Assigned', { exact: true })).toBeVisible();

      const assignee = await signedInPage(browser, baseURL, caseOfficerEmail);
      try {
        await assignee.page.goto('/lex/tasks', { waitUntil: 'domcontentloaded' });
        const assigneeCard = assignee.page.locator('article').filter({ hasText: title });
        await liveExpect(assigneeCard).toBeVisible();
        await assigneeCard.getByRole('button', { name: 'Start task' }).click();
        await liveExpect(assigneeCard.getByText('In progress', { exact: true })).toBeVisible();
        await assigneeCard.getByRole('button', { name: 'Submit result' }).click();
        const submitDialog = assignee.page.getByRole('dialog', { name: 'Submit task result' });
        await submitDialog
          .getByLabel('Result and evidence')
          .fill('Evidence chronology reviewed; findings are ready for the Cases Manager.');
        await submitDialog.getByRole('button', { name: 'Submit for review' }).click();
        await liveExpect(assigneeCard.getByText('Submitted', { exact: true })).toBeVisible();
      } finally {
        await assignee.context.close();
      }

      await casesManager.page.reload({ waitUntil: 'domcontentloaded' });
      const reviewCard = casesManager.page.locator('article').filter({ hasText: title });
      await liveExpect(reviewCard).toBeVisible();
      await reviewCard.getByRole('button', { name: 'Review submission' }).click();
      const reviewDialog = casesManager.page.getByRole('dialog', {
        name: 'Review task submission',
      });
      await reviewDialog.getByRole('button', { name: 'Accept' }).click();
      await liveExpect(reviewCard.getByText('Accepted', { exact: true })).toBeVisible();
    } finally {
      await casesManager.context.close();
    }
  });

  test('creates a numbered contract, preserves milestone time, and starts director review', async ({
    browser,
    baseURL,
  }) => {
    const { context, page } = await signedInPage(browser, baseURL, managerEmail);
    const suffix = Date.now();
    const title = `Live workflow contract ${suffix}`;
    const contractNumber = `E2E-${suffix}`;

    try {
      await page.goto('/lex/contracts/new', { waitUntil: 'domcontentloaded' });
      await liveExpect(
        page.getByRole('heading', { level: 1, name: 'Contract Drafting Workspace' }),
      ).toBeVisible();
      await page.getByLabel('Contract Title').fill(title);
      await page.getByLabel('Contract ID').fill(contractNumber);
      await liveExpect(page.getByText('Approved Request Source', { exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Next Step' }).click();

      await page.getByLabel('Legal Name').nth(0).fill('Al Othaim Markets');
      await page.getByLabel('Legal Name').nth(1).fill('Live Integration Vendor');
      await page.getByRole('button', { name: 'Next Step' }).click();

      await page.getByLabel('Start Date').fill('2026-08-10T09:30');
      await page.getByLabel('End Date').fill('2027-08-10T17:45');
      await page.getByRole('button', { name: 'Next Step' }).click();
      await page.getByRole('button', { name: 'Next Step' }).click();

      const createResponsePromise = page.waitForResponse((response) =>
        new URL(response.url()).pathname === '/api/v1/lex/contracts' &&
        response.request().method() === 'POST',
      );
      const reviewResponsePromise = page.waitForResponse((response) =>
        /\/api\/v1\/lex\/contracts\/[0-9a-f-]+\/review$/.test(
          new URL(response.url()).pathname,
        ) && response.request().method() === 'POST',
      );
      await page.getByRole('button', { name: 'Submit for Approval' }).click();

      const createResponse = await createResponsePromise;
      liveExpect(createResponse.status(), await createResponse.text()).toBe(201);
      const created = (await createResponse.json()) as {
        data: { id: string; contract_number: string; effective_date: string };
      };
      liveExpect(created.data.contract_number).toBe(contractNumber);
      liveExpect(new Date(created.data.effective_date).getUTCHours()).not.toBe(0);

      const reviewResponse = await reviewResponsePromise;
      liveExpect(reviewResponse.status(), await reviewResponse.text()).toBe(202);
      await liveExpect(page).toHaveURL(
        new RegExp(`/lex/contracts/${created.data.id}/approval(?:\\?|$)`),
      );

      await page.goto(`/lex/contracts/${created.data.id}`, {
        waitUntil: 'domcontentloaded',
      });
      await liveExpect(
        page.getByRole('heading', { name: 'Signature Handoff', exact: true }),
      ).toBeVisible();
      await page.getByRole('tab', { name: 'Details' }).click();
      const effectiveDate = page.getByText('Effective date', { exact: true }).locator('..');
      await liveExpect(effectiveDate).toContainText(/\d{1,2}:\d{2}/);
    } finally {
      await context.close();
    }
  });
});

async function signedInPage(
  browser: Browser,
  baseURL: string | undefined,
  email: string,
): Promise<{ context: BrowserContext; page: Page; accessToken: string }> {
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();
  const login = await page.request.post('/api/v1/auth/login', {
    data: {
      email,
      password: email.endsWith('@almashura.demo') ? legacyPassword : password,
      remember: false,
    },
  });
  liveExpect(login.ok(), await login.text()).toBeTruthy();
  const auth = (await login.json()) as {
    access_token: string;
    refresh_token: string;
    user: { email: string; tenant_id: string; roles: Array<{ slug: string }> };
  };
  liveExpect(auth.user.email).toBe(email);
  liveExpect(auth.user.tenant_id).toBe(watheeqTenantID);
  if (email === managerEmail) {
    liveExpect(auth.user.roles.map((role) => role.slug)).toEqual([
      'legal-contracts-manager',
    ]);
  }

  let session: APIResponse | undefined;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    session = await page.request.post('/api/auth/session', {
      data: {
        access_token: auth.access_token,
        refresh_token: auth.refresh_token,
        remember: false,
      },
      headers: {
        Origin: new URL(baseURL ?? 'http://localhost:3002').origin,
        Referer: `${new URL(baseURL ?? 'http://localhost:3002').origin}/login`,
      },
    });
    if (session.ok() || ![404, 500, 502, 503].includes(session.status())) break;
    await page.waitForTimeout(1_000);
  }
  liveExpect(session).toBeDefined();
  liveExpect(session!.ok(), await session!.text()).toBeTruthy();
  return { context, page, accessToken: auth.access_token };
}
