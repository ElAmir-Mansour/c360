import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { RegisterForm } from '@/components/auth/register-form';
import { LocaleProvider } from '@/components/providers/locale-provider';
import { getMessages } from '@/lib/i18n/messages';

const pushMock = vi.fn();
let searchParamsMock = new URLSearchParams();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
  usePathname: () => '/',
  useSearchParams: () => ({ get: (name: string) => searchParamsMock.get(name) }),
}));

const API_URL = 'http://localhost:8080';

const server = setupServer(
  http.post(`${API_URL}/api/v1/onboarding/register`, () =>
    HttpResponse.json({
      tenant_id: 'tenant-new',
      email: 'john@example.com',
      message: 'created',
      verification_ttl_seconds: 600,
    }, { status: 201 }),
  ),
  http.get(`${API_URL}/api/v1/auth/check-email`, () =>
    HttpResponse.json({ available: true }),
  ),
);

beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }));
afterEach(() => {
  server.resetHandlers();
  pushMock.mockClear();
  searchParamsMock = new URLSearchParams();
});
afterAll(() => server.close());

function renderRegister() {
  return render(
    <LocaleProvider locale="en" direction="ltr" messages={getMessages('en')}>
      <RegisterForm />
    </LocaleProvider>,
  );
}

async function fillRegisterForm() {
  const user = userEvent.setup();
  renderRegister();
  await advanceToAccountStep(user);
  await user.type(screen.getByLabelText('First name'), 'John');
  await user.type(screen.getByLabelText('Last name'), 'Doe');
  await user.type(screen.getByLabelText(/Work email/i), 'john@example.com');
  await user.type(screen.getByLabelText('Password'), 'Str0ng!Pass#word');
  await user.type(screen.getByLabelText('Confirm password'), 'Str0ng!Pass#word');
  return user;
}

// The form is a two-step wizard: step 1 (organization) → step 2 (admin account).
// Industry and country have valid defaults, so filling the org name is enough
// to advance. Step 2 fields render after the Continue click.
async function advanceToAccountStep(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Organization name'), 'Acme Corp');
  await user.click(screen.getByRole('button', { name: /continue/i }));
  await screen.findByLabelText('First name');
}

describe('Register flow integration', () => {
  it('test_registerSuccess: valid form → redirect to verify page', async () => {
    const user = await fillRegisterForm();
    const submitButton = screen.getByRole('button', { name: /create workspace/i });
    await user.click(submitButton);
    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith(
        expect.stringContaining('/verify'),
      );
    });
  });

  it('test_registerSignupBridge: preserves trial plan and suite query into verify page', async () => {
    searchParamsMock = new URLSearchParams('suites=lex,cyber,unknown,lex&plan=trial');
    const user = await fillRegisterForm();
    await user.click(screen.getByRole('button', { name: /create workspace/i }));

    await waitFor(() => {
      const pushed = String(pushMock.mock.calls[0]?.[0] ?? '');
      expect(pushed).toContain('/verify');
      expect(pushed).toContain('plan=trial');
      expect(pushed).toContain('suites=lex%2Ccyber');
      expect(pushed).not.toContain('unknown');
    });
  });

  it('test_registerDuplicateEmail: 409 → email field shows error', async () => {
    server.use(
      http.post(`${API_URL}/api/v1/onboarding/register`, () =>
        HttpResponse.json(
          { code: 'EMAIL_TAKEN', message: 'Email already registered' },
          { status: 409 },
        ),
      ),
    );
    const user = await fillRegisterForm();
    const submitButton = screen.getByRole('button', { name: /create workspace/i });
    await user.click(submitButton);
    await waitFor(() => {
      expect(screen.getByText(/already registered|Registration failed/i)).toBeInTheDocument();
    });
  });

  it('test_passwordStrengthUpdates: strength meter updates as user types', async () => {
    const user = userEvent.setup();
    renderRegister();
    await advanceToAccountStep(user);
    const passwordInput = screen.getByLabelText('Password');
    // Initially no meter
    expect(screen.queryByText(/weak|fair|good|strong/i)).toBeNull();
    // Type a weak password
    await user.type(passwordInput, 'abc');
    expect(screen.getByText('Weak')).toBeInTheDocument();
    // Type a strong password
    await user.clear(passwordInput);
    await user.type(passwordInput, 'C0mpl3x!P@ssw0rd#2026');
    expect(screen.getByText('Strong')).toBeInTheDocument();
  });
});
