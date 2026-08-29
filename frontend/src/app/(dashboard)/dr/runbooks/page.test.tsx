import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';

/**
 * `/dr/runbooks` list + create surface tests.
 *
 * Proves the operator can create a runbook (the dialog builds a zod-valid
 * `DRCreateRunbookRequest` and the page wires it to `createRunbook`), that the
 * create trigger is gated behind `dr:write` (disabled, no action), and an Arabic
 * render. There is no list endpoint, so the surface is URL-`?runbook=`-driven —
 * the selection hook is mocked to assert the new id is selected after create.
 */

const replaceMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: replaceMock,
    back: vi.fn(),
    prefetch: vi.fn(),
    refresh: vi.fn(),
  }),
  usePathname: () => '/dr/runbooks',
  useSearchParams: () => new URLSearchParams(''),
}));

let canWrite = true;
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    hasPermission: (perm: string) => (perm === 'dr:write' ? canWrite : true),
    user: { id: 'u1' },
  }),
}));

// No runbook is open by default (no ?runbook= in the mocked search params).
const setRunbookMock = vi.fn();
vi.mock('./_components/use-runbook-selection', () => ({
  useRunbookSelection: () => ({ runbookId: null, setRunbook: setRunbookMock }),
}));

// The single-runbook query (driven off the selected id) — empty until selected.
// Posture drives the cold-start empty state + the runbook catalog; mock it with
// one protection group so the operational surface (selector + create) renders
// rather than the zero-group setup empty state.
vi.mock('../_hooks/use-dr-queries', () => ({
  useDRRunbook: () => ({ data: null, isLoading: false, error: null, refetch: vi.fn() }),
  useDRPosture: () => ({
    data: {
      groups: [
        {
          group_id: 'group-rb-1',
          name: 'Critical ERP',
          health: 'healthy',
          member_count: 3,
          stream_count: 2,
          replication_percent: 98,
          rpo_objective_seconds: 300,
          rto_objective_seconds: 900,
          latest_recovery_point: { id: 'rp-1', is_validated: true },
          last_run: { run_id: 'run-1' },
        },
      ],
    },
    isPending: false,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

// The studio action hook: capture the create payload + surface a new id.
const createRunbookMock = vi.fn();
let latestRunbookId: string | null = null;
vi.mock('../_hooks/use-dr-actions', () => ({
  useRunbookStudioActions: () => ({
    createRunbook: createRunbookMock,
    createRunbookPending: false,
    createRunbookError: null,
    latestRunbook: null,
    latestRunbookId,
    updateRunbook: vi.fn(),
    updateRunbookPending: false,
    updateRunbookError: null,
    addTask: vi.fn(),
    addTaskPending: false,
    addTaskError: null,
    latestTask: null,
    startRun: vi.fn(),
    startRunPending: false,
    startRunError: null,
    latestRunId: null,
    actOnTask: vi.fn(),
    actOnTaskPending: false,
    actOnTaskError: null,
    latestRunState: null,
  }),
}));

import DRRunbooksPage from './page';

beforeEach(() => {
  canWrite = true;
  latestRunbookId = null;
  vi.clearAllMocks();
});

afterEach(() => cleanup());

describe('DRRunbooksPage', () => {
  it('creates a runbook with a zod-valid DRCreateRunbookRequest payload', async () => {
    const user = userEvent.setup();
    renderWithQuery(<DRRunbooksPage />);

    await user.click(screen.getByRole('button', { name: /Create runbook/ }));

    await user.type(
      screen.getByPlaceholderText('Tier-1 regional failover'),
      'Tier-1 regional failover',
    );
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(createRunbookMock).toHaveBeenCalledTimes(1));
    expect(createRunbookMock).toHaveBeenCalledWith({ name: 'Tier-1 regional failover' });
  });

  it('selects the freshly created runbook via the URL param once the id is surfaced', () => {
    latestRunbookId = 'rb-new-1';
    renderWithQuery(<DRRunbooksPage />);
    expect(setRunbookMock).toHaveBeenCalledWith('rb-new-1');
  });

  it('gates the create trigger behind dr:write — disabled, no action fires', async () => {
    canWrite = false;
    const user = userEvent.setup();
    renderWithQuery(<DRRunbooksPage />);

    const create = screen.getByRole('button', { name: /Create runbook/ });
    expect(create).toBeDisabled();
    await user.click(create);
    expect(createRunbookMock).not.toHaveBeenCalled();
  });

  it('renders a browsable protection-group catalog with operator context', () => {
    renderWithQuery(<DRRunbooksPage />);

    expect(screen.getByText('Runbook catalog')).toBeInTheDocument();
    expect(screen.getByText('Critical ERP')).toBeInTheDocument();
    expect(screen.getByText('Validated recovery point available')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Open last run/i })).toHaveAttribute(
      'href',
      '/dr/runs/run-1',
    );
  });

  it('renders the full MSA Arabic surface for locale "ar" (RTL)', () => {
    renderWithQuery(<DRRunbooksPage />, { locale: 'ar' });
    expect(screen.getByText('كتيّبات الاسترداد')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /إنشاء كتيّب/ })).toBeInTheDocument();
    // English headline must not leak in Arabic mode.
    expect(screen.queryByText('Recovery runbooks')).not.toBeInTheDocument();
  });
});
