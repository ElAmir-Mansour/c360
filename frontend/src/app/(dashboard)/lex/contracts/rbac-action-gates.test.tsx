/**
 * RBAC action-gate visibility — Contracts list (Wave-2, §9/§18.4/§21).
 *
 * Proves the domain-specific action gates introduced on the contracts list:
 *   - a CONTRACTS MANAGER (holds contract add/edit) SEES the create CTA,
 *   - a LEGAL OFFICER / AUDITOR (contract:view only, NO add/edit) does NOT.
 *
 * The page guard now reads lex:contract:view (granted to all three personas
 * here) and the create CTA reads hasAnyPermission(['lex:contract:add',
 * 'lex:contract:edit']) — NOT the coarse lex:write it used before.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import LexContractsPage from '@/app/(dashboard)/lex/contracts/page';
import { contractsListLabels } from '@/app/(dashboard)/lex/contracts/_lib/contracts-labels';
import type { LexContract } from '@/types/suites';

const { fetchSuitePaginatedMock, permsRef } = vi.hoisted(() => ({
  fetchSuitePaginatedMock: vi.fn(),
  // Mutable permission set, swapped per persona before each render.
  permsRef: { current: new Set<string>() },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/lex/contracts',
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

const contract: LexContract = {
  id: 'contract-1',
  tenant_id: 'tenant-1',
  title: 'Master Services Agreement',
  contract_number: 'LEX-2026-001',
  type: 'service_agreement',
  description: 'Primary commercial agreement.',
  party_a_name: 'Clario360 Ltd.',
  party_b_name: 'Acme Holdings',
  total_value: 125000,
  currency: 'SAR',
  auto_renew: false,
  renewal_notice_days: 30,
  status: 'active',
  owner_user_id: 'u-1',
  owner_name: 'Sara Owner',
  risk_level: 'medium',
  analysis_status: 'complete',
  document_text: '',
  current_version: 1,
  tags: [],
  metadata: {},
  created_by: 'u-1',
  created_at: '2026-06-01T09:00:00Z',
  updated_at: '2026-06-02T09:00:00Z',
} as unknown as LexContract;

function setPersona(...permissions: string[]) {
  permsRef.current = new Set(permissions);
}

beforeEach(() => {
  fetchSuitePaginatedMock.mockReset();
  fetchSuitePaginatedMock.mockResolvedValue({
    data: [contract],
    meta: { page: 1, per_page: 25, total: 1, total_pages: 1 },
  });
});

describe('Contracts list — RBAC action gates', () => {
  it('shows the create CTA for a contracts manager (holds contract:add/edit)', async () => {
    setPersona('lex:contract:view', 'lex:contract:add', 'lex:contract:edit', 'lex:contract:distribute');
    renderWithQuery(<LexContractsPage />);

    // Page guard (contract:view) lets the list render.
    expect(await screen.findByText(contractsListLabels.en.pageTitle)).toBeInTheDocument();
    // Manager sees the create action.
    expect(screen.getByText(contractsListLabels.en.createContract)).toBeInTheDocument();
  });

  it('hides the create CTA for a legal officer with only contract:view', async () => {
    setPersona('lex:contract:view');
    renderWithQuery(<LexContractsPage />);

    // The list still renders (view granted) ...
    expect(await screen.findByText(contractsListLabels.en.pageTitle)).toBeInTheDocument();
    // ... but the officer (no add/edit) gets no create control.
    expect(screen.queryByText(contractsListLabels.en.createContract)).not.toBeInTheDocument();
  });

  it('hides the create CTA for an auditor (contract:view + audit:read, no mutation verbs)', async () => {
    setPersona('lex:contract:view', 'lex:audit:read', 'lex:report:read');
    renderWithQuery(<LexContractsPage />);

    expect(await screen.findByText(contractsListLabels.en.pageTitle)).toBeInTheDocument();
    expect(screen.queryByText(contractsListLabels.en.createContract)).not.toBeInTheDocument();
  });
});
