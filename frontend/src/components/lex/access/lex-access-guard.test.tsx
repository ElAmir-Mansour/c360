import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';

const replaceMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    replace: replaceMock,
    push: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => '/lex/cases',
}));

// Auth state is per-test mutable.
let authState: {
  hasPermission: (p: string) => boolean;
  isHydrated: boolean;
  isAuthenticated: boolean;
  user: unknown;
};
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => authState,
}));

// Keep the guard offline: never hit /api/v1/lex/me.
const switchPersonaMock = vi.fn().mockResolvedValue({});
vi.mock('./use-lex-access', () => ({
  useLexAccess: () => ({
    me: {
      active_legal_role: {
        slug: 'legal-advisor',
        name_en: 'Legal Advisor / Consultant',
        name_ar: 'المستشار القانوني',
        tier: 'Legal',
        org_unit: 'Advisory',
        escalation_level: 0,
      },
      available_legal_roles: [],
      access_state: 'READY',
      effective_permissions: [],
      permission_version: 'v1',
      persona_landing: '/lex/consultations',
      capabilities: {},
      tenant_id: 't1',
      user_id: 'u1',
    },
    isLoading: false,
    isResolved: true,
    error: null,
    refresh: vi.fn(),
    switchPersona: switchPersonaMock,
  }),
}));

import { LexAccessGuard } from './lex-access-guard';

beforeEach(() => {
  replaceMock.mockClear();
});

describe('LexAccessGuard — §6 deep-link behavior', () => {
  it('renders children when authenticated and permitted', () => {
    authState = {
      hasPermission: () => true,
      isHydrated: true,
      isAuthenticated: true,
      user: { id: 'u1' },
    };
    renderWithQuery(
      <LexAccessGuard requirement="lex:case:view">
        <div data-testid="protected">CASES</div>
      </LexAccessGuard>,
    );
    expect(screen.getByTestId('protected')).toBeInTheDocument();
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it('allows a direct admin route when the registry grants a manage-only key', () => {
    authState = {
      hasPermission: (permission) => permission === 'lex:catalog:manage',
      isHydrated: true,
      isAuthenticated: true,
      user: { id: 'u1' },
    };
    renderWithQuery(
      <LexAccessGuard routeKey="/lex/admin/service-catalog">
        <div data-testid="protected">SERVICE CATALOG</div>
      </LexAccessGuard>,
    );
    expect(screen.getByTestId('protected')).toBeInTheDocument();
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it('allows the Lex landing for a granular system-admin permission without lex:read', () => {
    authState = {
      hasPermission: (permission) => permission === 'lex:audit:read',
      isHydrated: true,
      isAuthenticated: true,
      user: { id: 'u1' },
    };
    renderWithQuery(
      <LexAccessGuard routeKey="/lex">
        <div data-testid="protected">LEX ADMIN HOME</div>
      </LexAccessGuard>,
    );
    expect(screen.getByTestId('protected')).toBeInTheDocument();
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it('resolves wildcard registry entries for dynamic admin routes', () => {
    authState = {
      hasPermission: (permission) => permission === 'lex:catalog:manage',
      isHydrated: true,
      isAuthenticated: true,
      user: { id: 'u1' },
    };
    renderWithQuery(
      <LexAccessGuard routeKey="/lex/admin/service-catalog/LEX-OPINION">
        <div data-testid="protected">SERVICE DETAIL</div>
      </LexAccessGuard>,
    );
    expect(screen.getByTestId('protected')).toBeInTheDocument();
  });

  it('denies authenticated users for unknown registry route keys', () => {
    authState = {
      hasPermission: () => true,
      isHydrated: true,
      isAuthenticated: true,
      user: { id: 'u1' },
    };
    renderWithQuery(
      <LexAccessGuard routeKey="/lex/admin/not-registered">
        <div data-testid="protected">UNKNOWN</div>
      </LexAccessGuard>,
    );
    expect(screen.getByTestId('lex-access-denied')).toBeInTheDocument();
    expect(screen.queryByTestId('protected')).not.toBeInTheDocument();
    expect(screen.queryByTestId('required-permission')).not.toBeInTheDocument();
    expect(replaceMock).not.toHaveBeenCalledWith('/dashboard');
  });

  it('renders the access-denied view (NOT a /dashboard redirect) when authenticated but unpermitted', () => {
    authState = {
      hasPermission: () => false,
      isHydrated: true,
      isAuthenticated: true,
      user: { id: 'u1' },
    };
    renderWithQuery(
      <LexAccessGuard
        requirement="lex:case:view"
        resourceName="Litigation Cases"
      >
        <div data-testid="protected">CASES</div>
      </LexAccessGuard>,
    );
    // Access-denied view shown; protected content NOT rendered.
    expect(screen.getByTestId('lex-access-denied')).toBeInTheDocument();
    expect(screen.queryByTestId('protected')).not.toBeInTheDocument();
    expect(screen.getByTestId('required-permission')).toHaveTextContent(
      'lex:case:view',
    );
    // Must NOT silently redirect to the generic dashboard.
    expect(replaceMock).not.toHaveBeenCalledWith('/dashboard');
  });

  it('redirects to login with a redirect param when unauthenticated', () => {
    authState = {
      hasPermission: () => false,
      isHydrated: true,
      isAuthenticated: false,
      user: null,
    };
    renderWithQuery(
      <LexAccessGuard requirement="lex:case:view">
        <div data-testid="protected">CASES</div>
      </LexAccessGuard>,
    );
    expect(replaceMock).toHaveBeenCalledWith(
      expect.stringContaining('/login?redirect='),
    );
    expect(screen.queryByTestId('protected')).not.toBeInTheDocument();
  });

  it('shows a loading skeleton until auth resolves', () => {
    authState = {
      hasPermission: () => false,
      isHydrated: false,
      isAuthenticated: false,
      user: null,
    };
    renderWithQuery(
      <LexAccessGuard requirement="lex:case:view">
        <div data-testid="protected">CASES</div>
      </LexAccessGuard>,
    );
    expect(screen.queryByTestId('protected')).not.toBeInTheDocument();
    expect(replaceMock).not.toHaveBeenCalled();
  });
});
