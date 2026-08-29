import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import LexRoleMatrixPage from './page';
import { ROLE_ROSTER } from './_lib/legal-role-matrix';
import {
  CANONICAL_PERMS_BY_CODE,
  MATRIX_DOMAINS,
  type RolePermDrift,
} from './_lib/legal-role-permissions';
import type { RoleCode } from './_lib/legal-role-matrix';

const { hasPermissionMock, replaceMock, runtimeMock } = vi.hoisted(() => ({
  hasPermissionMock: vi.fn<(permission: string) => boolean>(() => true),
  replaceMock: vi.fn(),
  runtimeMock: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: replaceMock,
    back: vi.fn(),
    prefetch: vi.fn(),
    refresh: vi.fn(),
  }),
  usePathname: () => '/lex/admin/role-matrix',
  useSearchParams: () => new URLSearchParams(''),
  useParams: () => ({}),
}));

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    hasPermission: hasPermissionMock,
    isHydrated: true,
    isAuthenticated: true,
    user: { id: 'u-1', email: 'legal@example.com', full_name: 'Legal Owner' },
  }),
}));

vi.mock('@/components/lex/access/use-lex-access', () => ({
  useLexAccess: () => ({
    me: null,
    isLoading: false,
    isResolved: true,
    error: null,
    refresh: vi.fn(),
    switchPersona: vi.fn(),
  }),
}));

// The grid derives its cells from the seeded role permission sets (design v2
// §6). The runtime hook is mocked so the test drives the EXACT same canonical
// source the server enforces, in a "synced" state by default.
vi.mock('./_lib/use-runtime-role-perms', () => ({
  useRuntimeRolePerms: () => runtimeMock(),
}));

const ALL_CODES: RoleCode[] = [
  'REQ', 'DM', 'BUC', 'CEO', 'LD', 'CSM', 'KSM', 'CSV', 'KSV', 'LO', 'LA', 'SSM', 'AUD', 'ADM',
];

function syncedRuntime() {
  const permsByCode = Object.fromEntries(
    ALL_CODES.map((code) => [code, CANONICAL_PERMS_BY_CODE[code]]),
  ) as Record<RoleCode, readonly string[]>;
  return { permsByCode, drift: [] as RolePermDrift[], seeded: true, isLoading: false };
}

describe('LexRoleMatrixPage', () => {
  beforeEach(() => {
    hasPermissionMock.mockReset();
    hasPermissionMock.mockReturnValue(true);
    replaceMock.mockReset();
    runtimeMock.mockReset();
    runtimeMock.mockReturnValue(syncedRuntime());
  });

  it('renders the English matrix with all 14 role columns', () => {
    renderWithQuery(<LexRoleMatrixPage />, { locale: 'en' });
    expect(screen.getByRole('heading', { name: 'Legal Role Matrix', level: 1 })).toBeInTheDocument();
    for (const role of ROLE_ROSTER) {
      expect(screen.getAllByText(role.code).length).toBeGreaterThan(0);
    }
  });

  it('renders one row per lex capability domain, keyed by its permission prefix', () => {
    renderWithQuery(<LexRoleMatrixPage />, { locale: 'en' });
    // The grid's "Key" column shows the lex:<domain> prefix for each row.
    for (const domain of MATRIX_DOMAINS) {
      expect(screen.getByText(domain.prefix)).toBeInTheDocument();
    }
  });

  it('renders the permission legend with all six verbs', () => {
    renderWithQuery(<LexRoleMatrixPage />, { locale: 'en' });
    expect(screen.getByText('Permission legend')).toBeInTheDocument();
    for (const name of ['Manage', 'Approve', 'Close', 'Edit', 'Add', 'View']) {
      expect(screen.getAllByText(name, { exact: false }).length).toBeGreaterThan(0);
    }
  });

  it('notes the grid renders from the server-enforced permission sets', () => {
    renderWithQuery(<LexRoleMatrixPage />, { locale: 'en' });
    expect(
      screen.getByText(/same seeded role permission sets the server enforces/i),
    ).toBeInTheDocument();
  });

  it('exposes an accessible "no access" label for a derived empty cell', () => {
    renderWithQuery(<LexRoleMatrixPage />, { locale: 'en' });
    // REQ holds no investigation key → its Investigations cell is "no access".
    expect(
      screen.getByLabelText('Requester / Employee — Investigations: no access'),
    ).toBeInTheDocument();
  });

  it('surfaces a drift banner when the live tenant diverges from the model', () => {
    runtimeMock.mockReturnValue({
      ...syncedRuntime(),
      drift: [{ code: 'LO', slug: 'legal-officer', extra: ['lex:case:approve'], missing: [] }],
    });
    renderWithQuery(<LexRoleMatrixPage />, { locale: 'en' });
    expect(screen.getByText(/drift from the live tenant/i)).toBeInTheDocument();
    expect(screen.getByText(/legal-officer has extra keys: lex:case:approve/i)).toBeInTheDocument();
  });

  it('renders the Arabic surface with RTL direction', () => {
    renderWithQuery(<LexRoleMatrixPage />, { locale: 'ar' });
    expect(
      screen.getByRole('heading', { name: 'مصفوفة الأدوار القانونية', level: 1 }),
    ).toBeInTheDocument();
    const rtl = document.querySelector('[dir="rtl"]');
    expect(rtl).not.toBeNull();
  });

  it('renders access denied when the user lacks role matrix permissions', () => {
    hasPermissionMock.mockImplementation((p: string) => p === 'lex:read');
    renderWithQuery(<LexRoleMatrixPage />, { locale: 'en' });
    expect(screen.getByTestId('lex-access-denied')).toBeInTheDocument();
    expect(screen.getByTestId('required-permission')).toHaveTextContent('lex:role:view');
    expect(screen.getByTestId('required-permission')).toHaveTextContent('lex:role:manage');
    expect(replaceMock).not.toHaveBeenCalledWith('/dashboard');
    expect(screen.queryByRole('heading', { name: 'Legal Role Matrix', level: 1 })).toBeNull();
  });
});
