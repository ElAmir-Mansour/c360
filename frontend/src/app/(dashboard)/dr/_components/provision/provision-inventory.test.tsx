import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import type { DRProtectedSite } from '@/types/clario-dr';
import { ProvisionInventory } from './provision-inventory';

/**
 * Provisioning inventory tests.
 *
 * Proves the first-run onboarding empty-state shows when the tenant has no sites
 * AND no groups, that the create flows are gated (no enabled create trigger and
 * the read-only notice shown) when the operator lacks `dr:write`, that a
 * populated inventory renders the site list, and an Arabic/RTL render asserting
 * MSA copy. The query hooks and the provisioning action hook are mocked so the
 * component is exercised in isolation against real data shapes.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    prefetch: vi.fn(),
    refresh: vi.fn(),
  }),
  usePathname: () => '/dr/protect',
  useSearchParams: () => new URLSearchParams(''),
}));

// Mutable query results so each test sets the inventory it needs.
const queryState = vi.hoisted(() => ({
  sites: [] as DRProtectedSite[],
  groups: [] as { id: string; name: string }[],
  streams: [] as unknown[],
  sitesLoading: false,
  groupsLoading: false,
}));

vi.mock('@/app/(dashboard)/dr/_hooks/use-dr-queries', () => ({
  useDRSites: () => ({ data: queryState.sites, isLoading: queryState.sitesLoading, error: null, refetch: vi.fn() }),
  useDRGroups: () => ({ data: queryState.groups, isLoading: queryState.groupsLoading, error: null, refetch: vi.fn() }),
  useDRStreams: () => ({ data: queryState.streams, isLoading: false, error: null, refetch: vi.fn() }),
  useDRGroupMembers: () => ({ data: [], isLoading: false, error: null, refetch: vi.fn() }),
  useDRGroupNetworkMappings: () => ({ data: [], isLoading: false, error: null, refetch: vi.fn() }),
}));

vi.mock('@/app/(dashboard)/dr/_hooks/use-dr-actions', () => ({
  useProvisioningActions: () => ({
    createSite: vi.fn(),
    createSitePending: false,
    createSiteError: null,
    latestSite: null,
    createGroup: vi.fn(),
    createGroupPending: false,
    createGroupError: null,
    latestGroup: null,
    addMember: vi.fn(),
    addMemberPending: false,
    addMemberError: null,
    latestMember: null,
    createStream: vi.fn(),
    createStreamPending: false,
    createStreamError: null,
    latestStream: null,
    createNetworkMapping: vi.fn(),
    createNetworkMappingPending: false,
    createNetworkMappingError: null,
    latestNetworkMapping: null,
  }),
}));

function makeSite(id: string, name: string): DRProtectedSite {
  return {
    id,
    tenant_id: 't1',
    name,
    kind: 'database',
    primary_endpoint: 'pg://primary.internal:5432',
    rto_objective_seconds: 900,
    rpo_objective_seconds: 300,
    created_at: '2026-06-14T09:00:00Z',
    updated_at: '2026-06-14T09:00:00Z',
  };
}

beforeEach(() => {
  queryState.sites = [];
  queryState.groups = [];
  queryState.streams = [];
  queryState.sitesLoading = false;
  queryState.groupsLoading = false;
});

describe('ProvisionInventory', () => {
  it('shows the first-run onboarding panel when there are no sites and no groups', () => {
    renderWithQuery(<ProvisionInventory canWrite />);

    expect(screen.getByTestId('dr-provision-onboarding')).toBeInTheDocument();
    expect(screen.getByText('Get started with ClarioDR')).toBeInTheDocument();
  });

  it('hides the onboarding panel once the tenant has at least one site', () => {
    queryState.sites = [makeSite('s1', 'Prod DB')];
    renderWithQuery(<ProvisionInventory canWrite />);

    expect(screen.queryByTestId('dr-provision-onboarding')).not.toBeInTheDocument();
    expect(screen.getByText('Prod DB')).toBeInTheDocument();
  });

  it('gates the create flows when the operator lacks dr:write', () => {
    queryState.sites = [makeSite('s1', 'Prod DB')];
    renderWithQuery(<ProvisionInventory canWrite={false} />);

    // The write gate renders its read-only notice and no create trigger is enabled.
    expect(screen.getByText('Read-only access')).toBeInTheDocument();
    const addSiteButtons = screen.getAllByRole('button', { name: /Add protected site/i });
    addSiteButtons.forEach((button) => expect(button).toBeDisabled());
  });

  it('renders the Arabic inventory surface for locale "ar" (RTL)', () => {
    queryState.sites = [makeSite('s1', 'قاعدة البيانات')];
    renderWithQuery(<ProvisionInventory canWrite />, { locale: 'ar' });

    // Arabic trigger copy from the bilingual bundle.
    expect(screen.getAllByRole('button', { name: 'إضافة موقع محمي' }).length).toBeGreaterThan(0);
    expect(screen.getByText('قاعدة البيانات')).toBeInTheDocument();
  });
});
