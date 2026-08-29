import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

import { StepOrganization } from '@/app/(onboarding)/setup/_components/step-organization';
import { StepBranding } from '@/app/(onboarding)/setup/_components/step-branding';
import { StepTeam } from '@/app/(onboarding)/setup/_components/step-team';
import { StepSuites } from '@/app/(onboarding)/setup/_components/step-suites';
import type { OnboardingPlan, OnboardingProduct, RoleRecord } from '@/app/(onboarding)/setup/_components/shared';
import { API_ENDPOINTS } from '@/lib/constants';
import * as apiModule from '@/lib/api';
import { renderWithQuery as render } from '@/__tests__/utils/render-with-query';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/setup',
  useSearchParams: () => ({ get: () => null }),
}));

// Keep object URL behavior deterministic across jsdom versions so the branding
// preview useEffect never depends on host browser APIs.
// vi.clearAllMocks() in afterEach resets the mock call history between tests.
Object.defineProperty(URL, 'createObjectURL', {
  configurable: true,
  writable: true,
  value: vi.fn(() => 'blob:fake-preview'),
});
Object.defineProperty(URL, 'revokeObjectURL', {
  configurable: true,
  writable: true,
  value: vi.fn(),
});

const API_URL = 'http://localhost:8080';

const WIZARD_STEP_RESPONSE = {
  message: 'saved',
  current_step: 2,
  completed_steps: [1],
  invitations_sent: 0,
};

const ROLES: RoleRecord[] = [
  { id: 'r1', name: 'Admin', slug: 'admin' },
  { id: 'r2', name: 'Viewer', slug: 'viewer' },
];

const server = setupServer(
  http.post(`${API_URL}/api/v1/onboarding/wizard/organization`, () =>
    HttpResponse.json(WIZARD_STEP_RESPONSE, { status: 200 }),
  ),
  http.post(`${API_URL}/api/v1/onboarding/wizard/branding`, () =>
    HttpResponse.json({ ...WIZARD_STEP_RESPONSE, current_step: 3, completed_steps: [1, 2] }, { status: 200 }),
  ),
  http.post(`${API_URL}/api/v1/onboarding/wizard/team`, () =>
    HttpResponse.json({ ...WIZARD_STEP_RESPONSE, current_step: 4, completed_steps: [1, 2, 3], invitations_sent: 1 }, { status: 200 }),
  ),
  http.post(`${API_URL}/api/v1/onboarding/wizard/suites`, () =>
    HttpResponse.json({ ...WIZARD_STEP_RESPONSE, current_step: 5, completed_steps: [1, 2, 3, 4] }, { status: 200 }),
  ),
);

beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }));
afterEach(() => {
  server.resetHandlers();
  vi.clearAllMocks();
  // Always restore real timers in case a test used fake timers.
  vi.useRealTimers();
});
afterAll(() => server.close());

// ─── Step 1: Organization ──────────────────────────────────────────────────

describe('StepOrganization', () => {
  const defaultValues = {
    organization_name: '',
    industry: 'financial',
    country: 'SA',
    city: '',
    organization_size: '1-50',
  };

  it('test_org_submit_valid: valid payload calls onSaved', async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn().mockResolvedValue(undefined);
    const onPersist = vi.fn();

    render(
      <StepOrganization
        initialValues={defaultValues}
        onSaved={onSaved}
        onPersist={onPersist}
      />,
    );

    await user.clear(screen.getByLabelText('Organization name'));
    await user.type(screen.getByLabelText('Organization name'), 'Acme Corp');

    await user.click(screen.getByRole('button', { name: /continue/i }));

    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledTimes(1);
    });
  });

  it('test_org_validation_short_name: name < 2 chars blocks submit', async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    const onPersist = vi.fn();

    render(
      <StepOrganization
        initialValues={{ ...defaultValues, organization_name: 'X' }}
        onSaved={onSaved}
        onPersist={onPersist}
      />,
    );

    await user.click(screen.getByRole('button', { name: /continue/i }));

    await waitFor(() => {
      // Zod error message for min(2)
      expect(screen.getByText(/at least/i)).toBeInTheDocument();
    });
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('test_org_validation_country_length: country not 2 chars blocks submit', async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    const onPersist = vi.fn();

    render(
      <StepOrganization
        initialValues={{ ...defaultValues, organization_name: 'Acme Corp', country: 'SAU' }}
        onSaved={onSaved}
        onPersist={onPersist}
      />,
    );

    await user.click(screen.getByRole('button', { name: /continue/i }));

    // Zod length(2) error: "String must contain exactly 2 character(s)"
    await waitFor(() => {
      expect(screen.getByText(/exactly 2|2 character/i)).toBeInTheDocument();
    });
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('test_org_api_error: 400 from backend shows error message', async () => {
    server.use(
      http.post(`${API_URL}/api/v1/onboarding/wizard/organization`, () =>
        HttpResponse.json({ error: 'invalid organization size' }, { status: 400 }),
      ),
    );

    const user = userEvent.setup();
    const onSaved = vi.fn();
    const onPersist = vi.fn();

    render(
      <StepOrganization
        initialValues={{ ...defaultValues, organization_name: 'Acme Corp' }}
        onSaved={onSaved}
        onPersist={onPersist}
      />,
    );

    await user.click(screen.getByRole('button', { name: /continue/i }));

    await waitFor(() => {
      expect(screen.getByText(/invalid organization size/i)).toBeInTheDocument();
    });
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('test_org_persist_on_change: typing triggers onPersist', async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    const onPersist = vi.fn();

    render(
      <StepOrganization
        initialValues={defaultValues}
        onSaved={onSaved}
        onPersist={onPersist}
      />,
    );

    await user.type(screen.getByLabelText('Organization name'), 'Test');

    await waitFor(() => {
      expect(onPersist).toHaveBeenCalled();
    });
  });
});

// ─── Step 2: Branding ─────────────────────────────────────────────────────

describe('StepBranding', () => {
  const brandingDefaults = {
    primary_color: '#005E5E',
    accent_color: '#ABB705',
  };

  it('test_branding_continue: valid colors call API and then onSaved', async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn().mockResolvedValue(undefined);
    const onPersist = vi.fn();
    const onBack = vi.fn();

    render(
      <StepBranding
        initialValues={brandingDefaults}
        savedLogoFileId={null}
        onBack={onBack}
        onSaved={onSaved}
        onPersist={onPersist}
      />,
    );

    await user.click(screen.getByRole('button', { name: /^continue$/i }));

    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledTimes(1);
    });
  });

  it('test_branding_skip_calls_onSaved: Skip button calls onSaved without API', async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn().mockResolvedValue(undefined);
    const onBack = vi.fn();
    const onPersist = vi.fn();

    render(
      <StepBranding
        initialValues={brandingDefaults}
        savedLogoFileId={null}
        onBack={onBack}
        onSaved={onSaved}
        onPersist={onPersist}
      />,
    );

    await user.click(screen.getByRole('button', { name: /skip/i }));

    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledTimes(1);
    });
  });

  it('test_branding_skip_error: Skip shows error when onSaved rejects', async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn().mockRejectedValue(new Error('network error'));
    const onBack = vi.fn();
    const onPersist = vi.fn();

    render(
      <StepBranding
        initialValues={brandingDefaults}
        savedLogoFileId={null}
        onBack={onBack}
        onSaved={onSaved}
        onPersist={onPersist}
      />,
    );

    await user.click(screen.getByRole('button', { name: /skip/i }));

    await waitFor(() => {
      expect(screen.getByText(/failed to proceed/i)).toBeInTheDocument();
    });
  });

  it('test_branding_invalid_color: malformed hex blocks submit', async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    const onBack = vi.fn();
    const onPersist = vi.fn();

    render(
      <StepBranding
        initialValues={{ primary_color: 'not-a-color', accent_color: '#ABB705' }}
        savedLogoFileId={null}
        onBack={onBack}
        onSaved={onSaved}
        onPersist={onPersist}
      />,
    );

    await user.click(screen.getByRole('button', { name: /^continue$/i }));

    await waitFor(() => {
      // Zod regex validation error displayed
      expect(onSaved).not.toHaveBeenCalled();
    });
  });

  it('test_branding_skip_disables_buttons: buttons disabled during skip', async () => {
    // Keep onSaved unresolved so we can check the disabled state mid-flight.
    let resolveSkip!: () => void;
    const onSaved = vi.fn().mockImplementation(
      () => new Promise<void>((resolve) => { resolveSkip = resolve; }),
    );
    const user = userEvent.setup();
    const onBack = vi.fn();
    const onPersist = vi.fn();

    render(
      <StepBranding
        initialValues={brandingDefaults}
        savedLogoFileId={null}
        onBack={onBack}
        onSaved={onSaved}
        onPersist={onPersist}
      />,
    );

    // Click skip — don't await so we can inspect the in-flight state
    const skipBtn = screen.getByRole('button', { name: /skip/i });
    void user.click(skipBtn);

    // While skipping, Continue must be disabled
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^continue$/i })).toBeDisabled();
    });

    // Resolve the pending onSaved to clean up
    await act(async () => { resolveSkip(); });
  });

  it('test_branding_back_calls_onBack', async () => {
    const user = userEvent.setup();
    const onBack = vi.fn();
    const onSaved = vi.fn();
    const onPersist = vi.fn();

    render(
      <StepBranding
        initialValues={brandingDefaults}
        savedLogoFileId={null}
        onBack={onBack}
        onSaved={onSaved}
        onPersist={onPersist}
      />,
    );

    await user.click(screen.getByRole('button', { name: /back/i }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('test_branding_saved_logo_id_shown: savedLogoFileId shows stored indicator', () => {
    const onSaved = vi.fn();
    const onBack = vi.fn();
    const onPersist = vi.fn();

    render(
      <StepBranding
        initialValues={brandingDefaults}
        savedLogoFileId="some-uuid-here"
        onBack={onBack}
        onSaved={onSaved}
        onPersist={onPersist}
      />,
    );

    expect(screen.getByText(/already stored/i)).toBeInTheDocument();
  });

  it('test_branding_logo_upload_sends_multipart: PNG file appends logo field as multipart/form-data', async () => {
    // URL.createObjectURL is globally stubbed at file level (jsdom doesn't implement it).
    // Override the return value for this test so the preview img src is deterministic.
    vi.mocked(URL.createObjectURL).mockReturnValue('blob:fake-preview-url');

    const user = userEvent.setup();
    const onSaved = vi.fn().mockResolvedValue(undefined);
    const onBack = vi.fn();
    const onPersist = vi.fn();
    const appendSpy = vi.spyOn(FormData.prototype, 'append');
    const apiPostSpy = vi.spyOn(apiModule, 'apiPost').mockResolvedValue({
      message: 'saved',
      current_step: 3,
      completed_steps: [1, 2],
    });

    try {
      render(
        <StepBranding
          initialValues={brandingDefaults}
          savedLogoFileId={null}
          onBack={onBack}
          onSaved={onSaved}
          onPersist={onPersist}
        />,
      );

      // Locate the hidden <input type="file"> and simulate selecting a PNG.
      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
      expect(fileInput).not.toBeNull();

      const fakeFile = new File(['fake-png-content'], 'company-logo.png', { type: 'image/png' });
      await user.upload(fileInput, fakeFile);

      // After selection the filename chip should appear in the UI.
      await waitFor(() => {
        expect(screen.getByText('company-logo.png')).toBeInTheDocument();
      });

      // Submit — this calls apiPost with a FormData body.
      await user.click(screen.getByRole('button', { name: /^continue$/i }));

      await waitFor(() => {
        expect(onSaved).toHaveBeenCalledTimes(1);
      });

      expect(apiPostSpy).toHaveBeenCalledWith(API_ENDPOINTS.ONBOARDING_BRANDING, expect.any(FormData));
      expect(appendSpy).toHaveBeenCalledWith('primary_color', brandingDefaults.primary_color);
      expect(appendSpy).toHaveBeenCalledWith('accent_color', brandingDefaults.accent_color);
      expect(appendSpy).toHaveBeenCalledWith('logo', fakeFile);
    } finally {
      apiPostSpy.mockRestore();
    }
  });

  it('test_branding_invalid_file_type: non-image file shows error and does not set logoFile', async () => {
    // URL.createObjectURL is globally stubbed; no additional setup needed.

    const user = userEvent.setup();
    const onSaved = vi.fn();
    const onBack = vi.fn();
    const onPersist = vi.fn();

    render(
      <StepBranding
        initialValues={brandingDefaults}
        savedLogoFileId={null}
        onBack={onBack}
        onSaved={onSaved}
        onPersist={onPersist}
      />,
    );

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const badFile = new File(['data'], 'document.pdf', { type: 'application/pdf' });
    await user.upload(fileInput, badFile);

    await waitFor(() => {
      expect(screen.getByText(/PNG or SVG/i)).toBeInTheDocument();
    });

    // File name chip must NOT appear — logoFile was rejected.
    expect(screen.queryByText('document.pdf')).not.toBeInTheDocument();
  });
});

// ─── Step 3: Team ─────────────────────────────────────────────────────────

describe('StepTeam', () => {
  const initialRows = [{ email: '', role_slug: 'viewer', message: '' }];

  it('test_team_skip_sends_empty_invitations: Skip sends {invitations:[]} to API', async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn().mockResolvedValue(undefined);
    const onBack = vi.fn();
    const onPersist = vi.fn();

    let capturedBody: unknown;
    server.use(
      http.post(`${API_URL}/api/v1/onboarding/wizard/team`, async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json({ message: 'saved', current_step: 4, completed_steps: [1, 2, 3], invitations_sent: 0 });
      }),
    );

    render(
      <StepTeam
        roles={ROLES}
        initialRows={initialRows}
        onBack={onBack}
        onSaved={onSaved}
        onPersist={onPersist}
      />,
    );

    await user.click(screen.getByRole('button', { name: /skip/i }));

    await waitFor(() => {
      expect(capturedBody).toEqual({ invitations: [] });
    });
  });

  it('test_team_submit_valid: filled email row sends correct payload', async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn().mockResolvedValue(undefined);
    const onBack = vi.fn();
    const onPersist = vi.fn();

    let capturedBody: unknown;
    server.use(
      http.post(`${API_URL}/api/v1/onboarding/wizard/team`, async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json({ message: 'saved', current_step: 4, completed_steps: [1, 2, 3], invitations_sent: 1 });
      }),
    );

    render(
      <StepTeam
        roles={ROLES}
        initialRows={initialRows}
        onBack={onBack}
        onSaved={onSaved}
        onPersist={onPersist}
      />,
    );

    // InviteRow email input has placeholder "alice@company.com"
    const emailInput = screen.getByPlaceholderText(/alice@company\.com/i);
    await user.type(emailInput, 'alice@example.com');

    await user.click(screen.getByRole('button', { name: /^continue$/i }));

    await waitFor(() => {
      expect(capturedBody).toMatchObject({
        invitations: [{ email: 'alice@example.com', role_slug: 'viewer' }],
      });
    });
  });

  it('test_team_success_count_shown: non-zero count is visible before navigation', async () => {
    // This test verifies the count alert text appears before onSaved navigates away.
    // We hold onSaved so we can inspect the UI mid-flight without fake timers.
    let resolveNav!: () => void;
    // onSaved is called only after the 1200ms delay inside step-team; we resolve it
    // immediately once the mock is invoked to avoid dangling promises.
    const onSaved = vi.fn().mockImplementation(
      () => new Promise<void>((resolve) => { resolveNav = resolve; }),
    );
    const user = userEvent.setup();
    const onBack = vi.fn();
    const onPersist = vi.fn();

    server.use(
      http.post(`${API_URL}/api/v1/onboarding/wizard/team`, () =>
        HttpResponse.json({ message: 'saved', current_step: 4, completed_steps: [1, 2, 3], invitations_sent: 2 }),
      ),
    );

    render(
      <StepTeam
        roles={ROLES}
        initialRows={[
          { email: 'alice@example.com', role_slug: 'viewer' },
          { email: 'bob@example.com', role_slug: 'admin' },
        ]}
        onBack={onBack}
        onSaved={onSaved}
        onPersist={onPersist}
      />,
    );

    await user.click(screen.getByRole('button', { name: /^continue$/i }));

    // Count alert must appear after API resolves (before the 1200ms hold expires)
    await waitFor(() => {
      expect(screen.getByText(/2 invitation/i)).toBeInTheDocument();
    });

    // onSaved is called after the 1200ms hold; wait for it (real timer, up to 3s)
    await waitFor(() => { expect(onSaved).toHaveBeenCalledTimes(1); }, { timeout: 3000 });
    // Resolve to clean up the pending promise
    await act(async () => { resolveNav(); });
  }, 8000);

  it('test_team_add_row: Add another adds a new row up to 10', async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    const onBack = vi.fn();
    const onPersist = vi.fn();

    render(
      <StepTeam
        roles={ROLES}
        initialRows={initialRows}
        onBack={onBack}
        onSaved={onSaved}
        onPersist={onPersist}
      />,
    );

    const addBtn = screen.getByRole('button', { name: /add another/i });
    expect(screen.getByText('1/10 rows')).toBeInTheDocument();

    await user.click(addBtn);
    expect(screen.getByText('2/10 rows')).toBeInTheDocument();
  });

  it('test_team_api_error: backend error shows alert, does not navigate', async () => {
    server.use(
      http.post(`${API_URL}/api/v1/onboarding/wizard/team`, () =>
        HttpResponse.json({ error: 'duplicate email' }, { status: 409 }),
      ),
    );

    const user = userEvent.setup();
    const onSaved = vi.fn();
    const onBack = vi.fn();
    const onPersist = vi.fn();

    render(
      <StepTeam
        roles={ROLES}
        initialRows={[{ email: 'alice@example.com', role_slug: 'viewer' }]}
        onBack={onBack}
        onSaved={onSaved}
        onPersist={onPersist}
      />,
    );

    await user.click(screen.getByRole('button', { name: /^continue$/i }));

    await waitFor(() => {
      expect(screen.getByText(/duplicate email|failed to send/i)).toBeInTheDocument();
    });
    expect(onSaved).not.toHaveBeenCalled();
  });
});

// ─── Step 4: Products & Plan ───────────────────────────────────────────────

describe('StepSuites', () => {
  it('test_suites_default_selection: renders trial plan and all self-serve products', () => {
    const onSaved = vi.fn();
    const onBack = vi.fn();
    const onPersist = vi.fn();

    render(
      <StepSuites
        initialSelected={['cyber', 'data', 'visus']}
        onBack={onBack}
        onSaved={onSaved}
        onPersist={onPersist}
      />,
    );

    expect(screen.getByText('Trial included by default')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /trial plan/i })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByLabelText(/seats/i)).toHaveValue(5);
    expect(screen.getByText('Cybersecurity')).toBeInTheDocument();
    expect(screen.getByText('Data Intelligence')).toBeInTheDocument();
    expect(screen.getByText('SIEM')).toBeInTheDocument();
    expect(screen.getByText('DataStream')).toBeInTheDocument();
    expect(screen.getByText('Board Governance')).toBeInTheDocument();
    expect(screen.getByText('Legal Operations')).toBeInTheDocument();
    expect(screen.getByText('Executive Intelligence')).toBeInTheDocument();
  });

  it('test_suites_product_catalog: renders server product names and gates by entitlement keys', () => {
    const products: OnboardingProduct[] = [
      {
        id: 'cyber',
        name: 'ClarioSec',
        description: 'Security operations from the catalog',
        entitlement_key: 'suite.cyber',
      },
      {
        id: 'lex',
        name: 'Watheeq',
        description: 'Legal workflows from the catalog',
        entitlement_key: 'app.watheeq',
      },
    ];
    const plans: OnboardingPlan[] = [
      {
        key: 'trial',
        name: 'Trial',
        self_serve: true,
        default: true,
        seat_limit: 5,
        entitlement_keys: ['suite.cyber', 'seats.users'],
      },
    ];

    render(
      <StepSuites
        initialSelected={['cyber', 'lex']}
        products={products}
        plans={plans}
        onBack={vi.fn()}
        onSaved={vi.fn()}
        onPersist={vi.fn()}
      />,
    );

    expect(screen.getByText('ClarioSec')).toBeInTheDocument();
    expect(screen.getByText('Security operations from the catalog')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Watheeq/i })).toBeDisabled();
  });

  it('test_suites_submit_sends_active: payload contains selected suite IDs', async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn().mockResolvedValue(undefined);
    const onBack = vi.fn();
    const onPersist = vi.fn();

    let capturedBody: unknown;
    server.use(
      http.post(`${API_URL}/api/v1/onboarding/wizard/suites`, async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json({ message: 'saved', current_step: 5, completed_steps: [1, 2, 3, 4] });
      }),
    );

    render(
      <StepSuites
        initialSelected={['cyber']}
        onBack={onBack}
        onSaved={onSaved}
        onPersist={onPersist}
      />,
    );

    await user.click(screen.getByRole('button', { name: /^continue$/i }));

    await waitFor(() => {
      expect(capturedBody).toEqual({ active_suites: ['cyber'], plan_key: 'trial', seats: 5 });
    });
    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledTimes(1);
    });
  });

  it('test_suites_seats_cap: clamps seats to the selected plan limit', async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    const onBack = vi.fn();
    const onPersist = vi.fn();

    render(
      <StepSuites
        initialSelected={['cyber']}
        onBack={onBack}
        onSaved={onSaved}
        onPersist={onPersist}
      />,
    );

    const seatsInput = screen.getByLabelText(/seats/i);
    await user.clear(seatsInput);
    await user.type(seatsInput, '12');

    expect(seatsInput).toHaveValue(5);
  });

  it('test_suites_plan_grants: disables products outside selected plan grants', () => {
    const plans: OnboardingPlan[] = [
      {
        key: 'trial',
        name: 'Trial',
        description: 'Limited trial',
        self_serve: true,
        default: true,
        seat_limit: 3,
        trial_days: 14,
        grace_days: 7,
        included_suites: ['cyber'],
        entitlement_keys: [],
      },
    ];
    const onSaved = vi.fn();
    const onBack = vi.fn();
    const onPersist = vi.fn();

    render(
      <StepSuites
        initialSelected={['cyber', 'data']}
        plans={plans}
        onBack={onBack}
        onSaved={onSaved}
        onPersist={onPersist}
      />,
    );

    expect(screen.getByRole('button', { name: /Data Intelligence/i })).toBeDisabled();
    expect(screen.getAllByText('Not included in selected plan').length).toBeGreaterThan(0);
    expect(screen.getByLabelText(/seats/i)).toHaveValue(3);
  });

  it('test_suites_minimum_one: empty selection disables continue', async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    const onBack = vi.fn();
    const onPersist = vi.fn();

    render(
      <StepSuites
        initialSelected={['cyber']}
        onBack={onBack}
        onSaved={onSaved}
        onPersist={onPersist}
      />,
    );

    await user.click(screen.getByRole('button', { name: /Cybersecurity/i }));

    const continueBtn = screen.getByRole('button', { name: /^continue$/i });
    expect(continueBtn).toBeDisabled();
  });

  it('test_suites_api_error: backend 400 shows error alert', async () => {
    server.use(
      http.post(`${API_URL}/api/v1/onboarding/wizard/suites`, () =>
        HttpResponse.json({ error: 'invalid suite' }, { status: 400 }),
      ),
    );

    const user = userEvent.setup();
    const onSaved = vi.fn();
    const onBack = vi.fn();
    const onPersist = vi.fn();

    render(
      <StepSuites
        initialSelected={['cyber']}
        onBack={onBack}
        onSaved={onSaved}
        onPersist={onPersist}
      />,
    );

    await user.click(screen.getByRole('button', { name: /^continue$/i }));

    await waitFor(() => {
      expect(screen.getByText(/invalid suite|failed to save/i)).toBeInTheDocument();
    });
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('test_suites_back_calls_onBack', async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    const onBack = vi.fn();
    const onPersist = vi.fn();

    render(
      <StepSuites
        initialSelected={['cyber']}
        onBack={onBack}
        onSaved={onSaved}
        onPersist={onPersist}
      />,
    );

    await user.click(screen.getByRole('button', { name: /back/i }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('test_suites_payload_field_name: sends active_suites not suites', async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn().mockResolvedValue(undefined);
    const onBack = vi.fn();
    const onPersist = vi.fn();

    let capturedBody: Record<string, unknown> = {};
    server.use(
      http.post(`${API_URL}/api/v1/onboarding/wizard/suites`, async ({ request }) => {
        capturedBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ message: 'saved', current_step: 5, completed_steps: [1, 2, 3, 4] });
      }),
    );

    render(
      <StepSuites
        initialSelected={['cyber', 'data']}
        onBack={onBack}
        onSaved={onSaved}
        onPersist={onPersist}
      />,
    );

    await user.click(screen.getByRole('button', { name: /^continue$/i }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());

    // Contract: must use "active_suites" not "suites", while carrying plan intent.
    expect(Object.keys(capturedBody)).toContain('active_suites');
    expect(capturedBody).toMatchObject({ plan_key: 'trial', seats: 5 });
    expect(Object.keys(capturedBody)).not.toContain('suites');
  });
});
