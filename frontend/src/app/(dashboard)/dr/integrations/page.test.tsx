import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import type {
  DRCreateIntegrationRequest,
  DRIntegration,
} from '@/lib/clario-dr';
import DRIntegrationsPage from './page';

// ---------------------------------------------------------------------------
// next/navigation — pages in this route read useRouter/useSearchParams/etc.
// PermissionRedirect (wrapping the page) calls useRouter().replace.
// ---------------------------------------------------------------------------
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    prefetch: vi.fn(),
    refresh: vi.fn(),
  }),
  usePathname: () => '/dr/integrations',
  useSearchParams: () => new URLSearchParams(''),
}));

// ---------------------------------------------------------------------------
// Auth / permission gating. `canWrite` toggles per test through this flag.
// PermissionRedirect requires dr:read + isHydrated, so dr:read is always true;
// only dr:write is toggled to exercise the gated control.
// ---------------------------------------------------------------------------
let canWrite = true;
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    hasPermission: (perm: string) =>
      perm === 'dr:write' ? canWrite : true,
    isHydrated: true,
    isAuthenticated: true,
    user: { id: 'u1' },
  }),
}));

// Toasts owned by the page; mock so calls don't blow up jsdom / sonner portals.
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Shared integrations hook — isolate the page from the network. We capture the
// create / test mutation fns so we can assert they are called with real args.
// ---------------------------------------------------------------------------
const createMutateAsync =
  vi.fn<(payload: DRCreateIntegrationRequest) => Promise<DRIntegration>>();
const updateMutateAsync = vi.fn();
const deleteMutateAsync = vi.fn();
const testMutateAsync = vi.fn<(id: string) => Promise<DRIntegration>>();
const refetch = vi.fn();

const integrationsState: {
  data: DRIntegration[];
  isLoading: boolean;
  isError: boolean;
  isFetching: boolean;
  error: unknown;
} = {
  data: [],
  isLoading: false,
  isError: false,
  isFetching: false,
  error: null,
};

const createState = { isPending: false };
const updateState = { isPending: false };
const deleteState = { isPending: false };
const testState: { isPending: boolean; variables: string | undefined } = {
  isPending: false,
  variables: undefined,
};

vi.mock('@/hooks/use-dr-integrations', () => ({
  useDRIntegrations: () => ({
    data: integrationsState.data,
    isLoading: integrationsState.isLoading,
    isError: integrationsState.isError,
    isFetching: integrationsState.isFetching,
    error: integrationsState.error,
    refetch,
  }),
  useCreateDRIntegration: () => ({
    mutateAsync: createMutateAsync,
    isPending: createState.isPending,
  }),
  useUpdateDRIntegration: () => ({
    mutateAsync: updateMutateAsync,
    isPending: updateState.isPending,
  }),
  useDeleteDRIntegration: () => ({
    mutateAsync: deleteMutateAsync,
    isPending: deleteState.isPending,
  }),
  useTestDRIntegration: () => ({
    mutateAsync: testMutateAsync,
    isPending: testState.isPending,
    variables: testState.variables,
  }),
}));

// Real DRIntegration shape (matches backend / @/types/clario-dr).
function makeIntegration(overrides: Partial<DRIntegration> = {}): DRIntegration {
  return {
    id: 'int-1',
    tenant_id: 'tenant-1',
    name: 'Primary vSphere cluster',
    kind: 'hypervisor',
    vendor: 'vmware_vsphere',
    endpoint: 'https://vcenter.corp.local',
    status: 'active',
    enabled: true,
    last_tested_at: '2026-06-10T12:00:00Z',
    last_test_error: null,
    created_at: '2026-06-01T00:00:00Z',
    updated_at: '2026-06-10T12:00:00Z',
    ...overrides,
  };
}

describe('DRIntegrationsPage', () => {
  beforeEach(() => {
    canWrite = true;
    integrationsState.data = [
      makeIntegration(),
      makeIntegration({
        id: 'int-2',
        name: 'NetApp array',
        kind: 'storage_array',
        vendor: 'netapp_ontap',
        endpoint: 'https://netapp.corp.local',
        status: 'untested',
        enabled: false,
        last_tested_at: null,
      }),
    ];
    integrationsState.isLoading = false;
    integrationsState.isError = false;
    integrationsState.isFetching = false;
    integrationsState.error = null;
    createState.isPending = false;
    updateState.isPending = false;
    deleteState.isPending = false;
    testState.isPending = false;
    testState.variables = undefined;

    createMutateAsync.mockReset();
    createMutateAsync.mockResolvedValue(makeIntegration({ id: 'int-new' }));
    updateMutateAsync.mockReset();
    deleteMutateAsync.mockReset();
    testMutateAsync.mockReset();
    testMutateAsync.mockResolvedValue(makeIntegration({ status: 'active' }));
    refetch.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders a table row for each integration from useDRIntegrations()', () => {
    renderWithQuery(<DRIntegrationsPage />);

    expect(screen.getByText('Primary vSphere cluster')).toBeInTheDocument();
    expect(screen.getByText('https://vcenter.corp.local')).toBeInTheDocument();
    expect(screen.getByText('NetApp array')).toBeInTheDocument();
    expect(screen.getByText('https://netapp.corp.local')).toBeInTheDocument();

    // Pretty-printed kind / vendor / enabled cells come straight from the rows.
    expect(screen.getByText('Hypervisor')).toBeInTheDocument();
    expect(screen.getByText('Storage Array')).toBeInTheDocument();
    expect(screen.getByText('VMware vSphere')).toBeInTheDocument();
    expect(screen.getByText('NetApp ONTAP')).toBeInTheDocument();

    // One per-row Test/Edit/Delete control set per row (2 rows => 2 of each).
    // The exact "Test" name excludes the roll-up "Test all connections" button.
    expect(screen.getAllByRole('button', { name: 'Test' })).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: /edit/i })).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: /delete/i })).toHaveLength(2);
  });

  it('shows the dr:write-gated "Add integration" control only when permitted', () => {
    const { unmount } = renderWithQuery(<DRIntegrationsPage />);
    expect(
      screen.getByRole('button', { name: /add integration/i }),
    ).toBeInTheDocument();
    unmount();

    canWrite = false;
    renderWithQuery(<DRIntegrationsPage />);
    expect(
      screen.queryByRole('button', { name: /add integration/i }),
    ).not.toBeInTheDocument();
  });

  it('disables the per-row write actions when dr:write is denied', () => {
    canWrite = false;
    renderWithQuery(<DRIntegrationsPage />);

    const testButtons = screen.getAllByRole('button', { name: 'Test' });
    const editButtons = screen.getAllByRole('button', { name: /edit/i });
    const deleteButtons = screen.getAllByRole('button', { name: /delete/i });

    expect(testButtons).toHaveLength(2);
    testButtons.forEach((btn) => expect(btn).toBeDisabled());
    // The roll-up "Test all connections" control is also gated off entirely.
    expect(
      screen.queryByRole('button', { name: /test all connections/i }),
    ).not.toBeInTheDocument();
    editButtons.forEach((btn) => expect(btn).toBeDisabled());
    deleteButtons.forEach((btn) => expect(btn).toBeDisabled());
  });

  it('opens the create dialog and submits, calling the create mutation with the form payload', async () => {
    const user = userEvent.setup();
    renderWithQuery(<DRIntegrationsPage />);

    await user.click(screen.getByRole('button', { name: /add integration/i }));

    // Dialog (Radix portal) renders the create form.
    const dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).getByText('New recovery integration'),
    ).toBeInTheDocument();

    // Fill the required fields (name + endpoint; kind/vendor default to a valid pair).
    await user.type(
      within(dialog).getByLabelText('Name'),
      'Edge vSphere',
    );
    await user.type(
      within(dialog).getByLabelText('Endpoint'),
      'https://edge.corp.local',
    );

    await user.click(
      within(dialog).getByRole('button', { name: /create integration/i }),
    );

    await waitFor(() => expect(createMutateAsync).toHaveBeenCalledTimes(1));

    const payload = createMutateAsync.mock.calls[0][0];
    expect(payload).toMatchObject({
      name: 'Edge vSphere',
      endpoint: 'https://edge.corp.local',
      kind: 'hypervisor',
      vendor: 'vmware_vsphere',
      enabled: true,
    });
    // No credentials entered => credentials key omitted entirely.
    expect(payload.credentials).toBeUndefined();

    // Successful submit closes the dialog.
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
  });

  it('does not call the create mutation when required fields are empty', async () => {
    const user = userEvent.setup();
    renderWithQuery(<DRIntegrationsPage />);

    await user.click(screen.getByRole('button', { name: /add integration/i }));
    const dialog = await screen.findByRole('dialog');

    const submit = within(dialog).getByRole('button', {
      name: /create integration/i,
    });
    // canSubmit is false with empty name/endpoint, so the button is disabled.
    expect(submit).toBeDisabled();
    await user.click(submit);
    expect(createMutateAsync).not.toHaveBeenCalled();
  });

  it('calls the test mutation with the integration id when "Test" is clicked', async () => {
    const user = userEvent.setup();
    renderWithQuery(<DRIntegrationsPage />);

    const firstRow = screen.getByText('Primary vSphere cluster').closest('tr');
    expect(firstRow).not.toBeNull();
    const testButton = within(firstRow as HTMLElement).getByRole('button', {
      name: /test/i,
    });

    await user.click(testButton);

    await waitFor(() => expect(testMutateAsync).toHaveBeenCalledTimes(1));
    expect(testMutateAsync).toHaveBeenCalledWith('int-1');
  });

  it('renders a connection-health roll-up from the real DRIntegration statuses', () => {
    // 1 active, 1 untested, 1 errored, 1 configured(+disabled) across 4 rows.
    integrationsState.data = [
      makeIntegration({ id: 'a', status: 'active', enabled: true }),
      makeIntegration({ id: 'b', status: 'untested', enabled: true }),
      makeIntegration({
        id: 'c',
        status: 'error',
        enabled: true,
        last_test_error: 'TLS handshake failed',
      }),
      makeIntegration({ id: 'd', status: 'configured', enabled: false }),
    ];
    renderWithQuery(<DRIntegrationsPage />);

    // The roll-up renders each count as a <dt> label paired with a sibling <dd>
    // value; assert the value next to each label comes from the real statuses.
    const valueFor = (label: string): string | undefined => {
      const term = screen.getByText(label, { selector: 'dt' });
      const group = term.closest('div');
      return group?.querySelector('dd')?.textContent ?? undefined;
    };

    // Roll-up card title (the table also has a "Connection health" column header,
    // so scope to the heading element rendered by CardTitle).
    expect(screen.getByText('Connection health', { selector: 'h3' })).toBeInTheDocument();
    expect(valueFor('Total')).toBe('4');
    expect(valueFor('Active')).toBe('1');
    expect(valueFor('Errored')).toBe('1');
    expect(valueFor('Untested')).toBe('1');
    expect(valueFor('Configured')).toBe('1');
    expect(valueFor('Disabled')).toBe('1');
  });

  it('surfaces a per-row last_test_error through a role="alert" region', () => {
    integrationsState.data = [
      makeIntegration({
        id: 'err-1',
        name: 'Broken vault',
        status: 'error',
        enabled: true,
        last_tested_at: '2026-06-10T12:00:00Z',
        last_test_error: 'connection refused by endpoint',
      }),
    ];
    renderWithQuery(<DRIntegrationsPage />);

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('connection refused by endpoint');
  });

  it('fans "Test all connections" out to testDRIntegration for every row (dr:write-gated)', async () => {
    const user = userEvent.setup();
    renderWithQuery(<DRIntegrationsPage />);

    const testAll = screen.getByRole('button', { name: /test all connections/i });
    await user.click(testAll);

    // Two integrations from beforeEach => two real test calls, by id.
    await waitFor(() => expect(testMutateAsync).toHaveBeenCalledTimes(2));
    const ids = testMutateAsync.mock.calls.map((call) => call[0]);
    expect(ids).toEqual(expect.arrayContaining(['int-1', 'int-2']));
  });

  it('hides the "Test all connections" control when dr:write is denied', () => {
    canWrite = false;
    renderWithQuery(<DRIntegrationsPage />);

    expect(
      screen.queryByRole('button', { name: /test all connections/i }),
    ).not.toBeInTheDocument();
  });

  it('renders the integrations surface in professional MSA under the ar locale', () => {
    renderWithQuery(<DRIntegrationsPage />, { locale: 'ar' });

    // Page header resolves to Arabic; the English title is gone.
    expect(
      screen.getByRole('heading', { name: 'تكاملات التعافي من الكوارث' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Recovery Integrations' }),
    ).not.toBeInTheDocument();

    // The "Add integration" CTA is translated.
    expect(screen.getByRole('button', { name: 'إضافة تكامل' })).toBeInTheDocument();

    // Localised kind labels render; vendor brand names are proper nouns (kept).
    expect(screen.getByText('مُشرف الأجهزة الافتراضية')).toBeInTheDocument();
    expect(screen.getByText('مصفوفة التخزين')).toBeInTheDocument();
    expect(screen.getByText('VMware vSphere')).toBeInTheDocument();
    expect(screen.getByText('NetApp ONTAP')).toBeInTheDocument();

    // Per-row action labels are translated (one per row => 2 each).
    expect(screen.getAllByRole('button', { name: 'اختبار' })).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: 'تعديل' })).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: 'حذف' })).toHaveLength(2);
  });

  it('opens the create dialog with Arabic copy under the ar locale', async () => {
    const user = userEvent.setup();
    renderWithQuery(<DRIntegrationsPage />, { locale: 'ar' });

    await user.click(screen.getByRole('button', { name: 'إضافة تكامل' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('تكامل استرداد جديد')).toBeInTheDocument();
    // Field labels + the submit CTA are MSA.
    expect(within(dialog).getByLabelText('الاسم')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('نقطة النهاية')).toBeInTheDocument();
    expect(
      within(dialog).getByRole('button', { name: 'إنشاء التكامل' }),
    ).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // Feature-disabled handling: DR_INTEGRATIONS_ENC_KEY unset => router not
  // mounted => list query 404s. The page must render the informational
  // "enable this capability" state, NOT a generic error.
  // -------------------------------------------------------------------------
  describe('feature-disabled handling (DR_INTEGRATIONS_ENC_KEY unset)', () => {
    function disableFeature() {
      // Real ApiError shape (matches buildApiError for an unmounted chi route).
      integrationsState.data = [];
      integrationsState.isLoading = false;
      integrationsState.isError = true;
      integrationsState.error = {
        status: 404,
        code: 'HTTP_404',
        message: 'Request failed with status 404',
      };
    }

    it('renders the enable hint (not an error) when the list query 404s', () => {
      disableFeature();
      renderWithQuery(<DRIntegrationsPage />);

      // Informational title + the operator remediation hint naming the env var.
      expect(
        screen.getByText('External recovery integrations are not enabled'),
      ).toBeInTheDocument();
      expect(
        screen.getByText(/set DR_INTEGRATIONS_ENC_KEY/),
      ).toBeInTheDocument();

      // It is an informational status region, NOT the destructive error surface.
      expect(screen.getByRole('status')).toBeInTheDocument();
      expect(
        screen.queryByText('Unable to load integrations'),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'Try again' }),
      ).not.toBeInTheDocument();
    });

    it('suppresses the "Add integration" CTA while the feature is disabled', () => {
      disableFeature();
      canWrite = true;
      renderWithQuery(<DRIntegrationsPage />);

      expect(
        screen.queryByRole('button', { name: /add integration/i }),
      ).not.toBeInTheDocument();
    });

    it('still renders the generic error state for a real fetch failure (5xx)', () => {
      integrationsState.data = [];
      integrationsState.isError = true;
      integrationsState.error = {
        status: 503,
        code: 'HTTP_503',
        message: 'Service unavailable',
      };
      renderWithQuery(<DRIntegrationsPage />);

      // A genuine outage => the destructive error surface, not the enable hint.
      expect(
        screen.getByText('Unable to load integrations'),
      ).toBeInTheDocument();
      expect(
        screen.queryByText('External recovery integrations are not enabled'),
      ).not.toBeInTheDocument();
    });

    it('renders the enable hint in professional MSA under the ar locale', () => {
      disableFeature();
      renderWithQuery(<DRIntegrationsPage />, { locale: 'ar' });

      expect(
        screen.getByText('تكاملات التعافي الخارجية غير مُفعَّلة'),
      ).toBeInTheDocument();
      // The literal env-var identifier is preserved verbatim across locales.
      expect(
        screen.getByText(/DR_INTEGRATIONS_ENC_KEY/),
      ).toBeInTheDocument();
      // English disabled copy is gone under the Arabic locale.
      expect(
        screen.queryByText('External recovery integrations are not enabled'),
      ).not.toBeInTheDocument();
    });
  });
});
