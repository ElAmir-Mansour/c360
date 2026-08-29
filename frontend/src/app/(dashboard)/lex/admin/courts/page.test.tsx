/**
 * Competent-court admin screen (feedback items 5 and 6).
 *
 * The three states that matter, because the reference list ships with zero rows
 * and the customer's court names never arrived:
 *   1. EMPTY     — say so, and offer the fix to whoever can apply it.
 *   2. POPULATED — the courts the tenant entered, exactly those and no others.
 *   3. LEGACY    — free-text competent_court values from before the list existed
 *                  are shown for manual reconciliation, never auto-mapped.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import type { LegalCourt } from '@/lib/lex/cases';
import type { LegacyCourtValue } from './_lib/courts-api';
import CourtsAdminPage from './page';

const { listMock, legacyMock, removeMock, hasPermissionMock } = vi.hoisted(() => ({
  listMock: vi.fn(),
  legacyMock: vi.fn(),
  removeMock: vi.fn(),
  hasPermissionMock: vi.fn<(permission: string) => boolean>(() => true),
}));

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    hasPermission: hasPermissionMock,
    isHydrated: true,
    isAuthenticated: true,
    user: { id: 'admin-1', email: 'admin@example.com', roles: [] },
  }),
}));

vi.mock('@/components/lex/access/lex-access-guard', () => ({
  LexAccessGuard: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('./_lib/courts-api', async () => {
  const actual = await vi.importActual<typeof import('./_lib/courts-api')>('./_lib/courts-api');
  return {
    ...actual,
    lexCourtsApi: {
      ...actual.lexCourtsApi,
      list: listMock,
      legacyValues: legacyMock,
      remove: removeMock,
    },
  };
});

function court(overrides: Partial<LegalCourt> = {}): LegalCourt {
  return {
    id: 'court-1',
    tenant_id: 'tenant-1',
    code: 'COURT_01',
    name: { en: 'Tenant-entered court', ar: 'محكمة أدخلها المستأجر' },
    active: true,
    is_system: false,
    sort: 10,
    created_at: '2026-08-01T00:00:00Z',
    updated_at: '2026-08-01T00:00:00Z',
    ...overrides,
  };
}

function paginated(data: LegalCourt[]) {
  return {
    data,
    meta: { page: 1, per_page: 25, total: data.length, total_pages: 1 },
  };
}

beforeEach(() => {
  hasPermissionMock.mockReset();
  hasPermissionMock.mockImplementation(() => true);
  listMock.mockReset();
  listMock.mockResolvedValue(paginated([]));
  legacyMock.mockReset();
  legacyMock.mockResolvedValue([] as LegacyCourtValue[]);
  removeMock.mockReset();
});

describe('LexCourtsAdminPage — empty catalogue', () => {
  it('states that no courts are configured and offers the admin an add action', async () => {
    renderWithQuery(<CourtsAdminPage />);

    // The empty state is rendered once for the desktop table and once for the
    // mobile card list, hence the *All* queries throughout this file.
    expect((await screen.findAllByText('No courts configured')).length).toBeGreaterThan(0);
    expect(
      screen.getAllByText(/Add your courts here and they become selectable straight away/).length,
    ).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: 'Add court' }).length).toBeGreaterThan(0);
  });

  it('never invents a court name in the empty state', async () => {
    renderWithQuery(<CourtsAdminPage />);

    await screen.findAllByText('No courts configured');
    // Guard against a well-meaning future "starter list" of guessed courts.
    expect(screen.queryAllByText(/Riyadh/i)).toHaveLength(0);
    expect(screen.queryAllByText(/Commercial Court/i)).toHaveLength(0);
    expect(screen.queryAllByText(/محكمة الرياض/)).toHaveLength(0);
  });

  it('tells a read-only viewer why the list is empty and hides every mutation', async () => {
    hasPermissionMock.mockImplementation((permission) => permission !== 'lex:catalog:manage');
    renderWithQuery(<CourtsAdminPage />);

    expect(
      (await screen.findAllByText(/Ask an administrator with catalogue permissions to add your courts/))
        .length,
    ).toBeGreaterThan(0);
    expect(screen.queryAllByRole('button', { name: 'Add court' })).toHaveLength(0);
  });
});

describe('LexCourtsAdminPage — populated catalogue', () => {
  it('lists exactly the courts the tenant entered', async () => {
    listMock.mockResolvedValue(
      paginated([
        court(),
        court({ id: 'court-2', code: 'COURT_02', name: { en: 'Second court', ar: 'محكمة ثانية' }, active: false }),
      ]),
    );
    renderWithQuery(<CourtsAdminPage />);

    // DataTable renders a desktop table and a mobile card list, so each value
    // legitimately appears more than once.
    expect((await screen.findAllByText('Tenant-entered court')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Second court').length).toBeGreaterThan(0);
    expect(screen.getAllByText('COURT_01').length).toBeGreaterThan(0);
    expect(screen.queryAllByText('No courts configured')).toHaveLength(0);
  });

  it('resolves the Arabic name under an Arabic locale', async () => {
    listMock.mockResolvedValue(paginated([court()]));
    renderWithQuery(<CourtsAdminPage />, { locale: 'ar' });

    expect((await screen.findAllByText('محكمة أدخلها المستأجر')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('المحاكم المختصة').length).toBeGreaterThan(0);
  });
});

describe('LexCourtsAdminPage — legacy free-text values', () => {
  it('shows historical competent_court strings with their case counts', async () => {
    legacyMock.mockResolvedValue([
      { value: 'Legacy court spelling', cases: 3 },
      { value: 'محكمة مكتوبة يدويًا', cases: 1 },
    ] as LegacyCourtValue[]);
    renderWithQuery(<CourtsAdminPage />);

    const rows = await screen.findAllByTestId('legacy-court-value');
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText('Legacy court spelling')).toBeInTheDocument();
    expect(within(rows[0]).getByText('3 cases')).toBeInTheDocument();
    expect(within(rows[1]).getByText('محكمة مكتوبة يدويًا')).toBeInTheDocument();
  });

  it('says plainly that adding a legacy value does not re-point the cases', async () => {
    legacyMock.mockResolvedValue([{ value: 'Legacy court spelling', cases: 3 }] as LegacyCourtValue[]);
    renderWithQuery(<CourtsAdminPage />);

    expect(await screen.findByText('These are historical values, not courts')).toBeInTheDocument();
    expect(
      screen.getByText(/It does not re-point the existing cases/),
    ).toBeInTheDocument();
  });

  it('offers no reconciliation affordance to a read-only viewer', async () => {
    hasPermissionMock.mockImplementation((permission) => permission !== 'lex:catalog:manage');
    legacyMock.mockResolvedValue([{ value: 'Legacy court spelling', cases: 3 }] as LegacyCourtValue[]);
    renderWithQuery(<CourtsAdminPage />);

    const rows = await screen.findAllByTestId('legacy-court-value');
    expect(within(rows[0]).queryByRole('button', { name: 'Add as a court' })).not.toBeInTheDocument();
  });

  it('reports a legacy-value load failure instead of implying there are none', async () => {
    legacyMock.mockRejectedValue(new Error('boom'));
    renderWithQuery(<CourtsAdminPage />);

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'The legacy court values could not be loaded.',
      ),
    );
  });
});
