import { expect, test, type Page } from '@playwright/test';

const demoUsers = [
  'admin@almashura.demo',
  'director@almashura.demo',
];
const watheeqTenantID = '1924590c-ad74-4ca7-b802-118c82de26da';

for (const email of demoUsers) {
  test(`${email} can sign in and administer Watheeq`, async ({ baseURL, browser }) => {
    const context = await browser.newContext({ baseURL });
    const page = await context.newPage();

    try {
      await signInIntoBrowser(page, email);

      await page.goto('/lex/admin/org-entities', { waitUntil: 'domcontentloaded' });
      await expect(page).toHaveURL(/\/lex\/admin\/org-entities/, { timeout: 30_000 });
      await expect(page.getByRole('button', { name: 'Import structure' })).toBeVisible();

      await page.goto('/admin/workflows/definitions', { waitUntil: 'domcontentloaded' });
      await expect(page).toHaveURL(/\/admin\/workflows\/definitions/, { timeout: 30_000 });
      await expect(page.getByRole('button', { name: 'Create Definition' })).toBeVisible();

      await page.goto('/admin/users', { waitUntil: 'domcontentloaded' });
      await expect(page).not.toHaveURL(/\/login(?:\?|\/|$)/);
      await expect(page.getByRole('button', { name: 'Add User' })).toBeVisible();

      // Check the server-side create-user gate without creating any data. A
      // validation response proves the request reached IAM past users:* RBAC;
      // a restricted user would receive 403 before request parsing.
      const status = await page.evaluate(async () => {
        const response = await fetch('/api/v1/users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        });
        return response.status;
      });
      expect(status).not.toBe(403);
      expect(status).toBeGreaterThanOrEqual(400);
      expect(status).toBeLessThan(500);
    } finally {
      await context.close();
    }
  });
}

async function signInIntoBrowser(page: Page, email: string): Promise<void> {
  const login = await page.request.post('/api/v1/auth/login', {
    data: { email, password: 'DemoPass123!', remember: false },
  });
  expect(login.ok(), await login.text()).toBeTruthy();
  const auth = (await login.json()) as {
    access_token: string;
    refresh_token: string;
    user: {
      email: string;
      tenant_id: string;
      roles: Array<{ slug: string; permissions: string[] }>;
    };
  };

  expect(auth.user.email).toBe(email);
  expect(auth.user.tenant_id).toBe(watheeqTenantID);
  expect(auth.user.roles.map((role) => role.slug)).toEqual(
    expect.arrayContaining(['tenant-admin', 'legal-director']),
  );
  const tenantAdmin = auth.user.roles.find((role) => role.slug === 'tenant-admin');
  expect(tenantAdmin?.permissions).toEqual(
    expect.arrayContaining(['lex:*', 'workflow:*', 'workflows:*', 'automation:*', 'users:*']),
  );

  const session = await page.request.post('/api/auth/session', {
    data: {
      access_token: auth.access_token,
      refresh_token: auth.refresh_token,
      remember: false,
    },
    headers: {
      Origin: new URL(page.url() === 'about:blank' ? 'http://localhost:3002' : page.url()).origin,
      Referer: 'http://localhost:3002/login',
    },
  });
  expect(session.ok(), await session.text()).toBeTruthy();
}
