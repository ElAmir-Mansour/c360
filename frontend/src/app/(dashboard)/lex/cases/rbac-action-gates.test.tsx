/**
 * RBAC action-gate visibility — Cases list (Wave-2, §9/§18.4/§21).
 *
 * Proves the domain-specific action gate on the litigation-cases list:
 *   - a CASES MANAGER (holds lex:case:add) SEES the "New Case" CTA,
 *   - a LEGAL OFFICER / AUDITOR (case:view only, NO add verb) does NOT.
 *
 * The page guard reads lex:case:view (granted to all three personas) and the
 * create CTA reads hasPermission('lex:case:add') — not the coarse lex:write it
 * used before. The heavy list workspace + create dialog are stubbed so the test
 * isolates the page's own gating.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import LexCasesPage from '@/app/(dashboard)/lex/cases/page';
import { resolveCaseLabels } from '@/app/(dashboard)/lex/cases/_components/labels';

const enLabels = resolveCaseLabels('en');

const { fetchSuitePaginatedMock, permsRef } = vi.hoisted(() => ({
  fetchSuitePaginatedMock: vi.fn(),
  permsRef: { current: new Set<string>() },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/lex/cases',
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
}));

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    hasPermission: (permission: string) => permsRef.current.has(permission),
    hasAnyPermission: (permissions: string[]) =>
      permissions.some((p) => permsRef.current.has(p)),
    isHydrated: true,
    isAuthenticated: true,
    user: { id: 'u-1' },
  }),
}));

vi.mock('@/lib/suite-api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/suite-api')>('@/lib/suite-api');
  return { ...actual, fetchSuitePaginated: fetchSuitePaginatedMock };
});

// Stub the heavy list workspace + create dialog: this test only asserts the
// page-level "New Case" CTA gating, not the table internals.
vi.mock('@/app/(dashboard)/lex/cases/_components/list-workspace/case-list-workspace', () => ({
  CaseListWorkspace: () => <div data-testid="case-list-workspace" />,
}));
vi.mock('@/app/(dashboard)/lex/cases/_components/case-form-dialog', () => ({
  CaseFormDialog: () => null,
}));

function setPersona(...permissions: string[]) {
  permsRef.current = new Set(permissions);
}

beforeEach(() => {
  fetchSuitePaginatedMock.mockReset();
  fetchSuitePaginatedMock.mockResolvedValue({
    data: [],
    meta: { page: 1, per_page: 25, total: 0, total_pages: 1 },
  });
});

describe('Cases list — RBAC action gates', () => {
  it('shows the New Case CTA for a cases manager (holds case:add)', async () => {
    setPersona('lex:case:view', 'lex:case:add', 'lex:case:edit', 'lex:case:assign', 'lex:case:close');
    renderWithQuery(<LexCasesPage />);

    expect(await screen.findByText(enLabels.list.title)).toBeInTheDocument();
    expect(screen.getByText(enLabels.list.newCase)).toBeInTheDocument();
  });

  it('hides the New Case CTA for a legal officer with only case:view', async () => {
    setPersona('lex:case:view', 'lex:case:edit');
    renderWithQuery(<LexCasesPage />);

    // List renders (view granted) ...
    expect(await screen.findByText(enLabels.list.title)).toBeInTheDocument();
    // ... but no add verb ⇒ no "New Case" control. (The classifications link,
    // which is ungated, still renders — so newCase must be absent specifically.)
    expect(screen.queryByText(enLabels.list.newCase)).not.toBeInTheDocument();
  });

  it('hides the New Case CTA for an auditor (case:view + audit:read, no add)', async () => {
    setPersona('lex:case:view', 'lex:audit:read', 'lex:report:read');
    renderWithQuery(<LexCasesPage />);

    expect(await screen.findByText(enLabels.list.title)).toBeInTheDocument();
    expect(screen.queryByText(enLabels.list.newCase)).not.toBeInTheDocument();
  });
});
