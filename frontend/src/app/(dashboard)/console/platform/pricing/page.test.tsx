import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, within } from '@testing-library/react';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import type { ComputeResponse } from './_lib/types';

// ---------------------------------------------------------------------------
// Auth gating — mutable hasPermission so tests can flip pricing:admin.
// ---------------------------------------------------------------------------
const { hasPermissionMock } = vi.hoisted(() => ({
  hasPermissionMock: vi.fn<(perm: string) => boolean>(() => true),
}));
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ hasPermission: hasPermissionMock, user: { id: 'u1' } }),
}));

// PermissionRedirect reads the auth store directly; stub it to render children
// (the page's own pricing:read gate is exercised via the nav config elsewhere).
vi.mock('@/components/common/permission-redirect', () => ({
  PermissionRedirect: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// ---------------------------------------------------------------------------
// The compute hook — return a canned 2-tier-ish response. We capture the args
// it was called with so we can assert include_internal gating.
// ---------------------------------------------------------------------------
const { computeMock } = vi.hoisted(() => ({
  computeMock: vi.fn(),
}));

const BASE_RESPONSE: ComputeResponse = {
  pricing_version: 1,
  currency: 'SAR',
  model: 'per_user',
  tiers: [
    {
      tier: 'standard',
      line_items: {
        base_charge: 1000,
        ai_allocation: 200,
        data_storage: 300,
        vm_infrastructure: 0,
        deployment_setup_premium: 0,
      },
      sub_total: 1500,
      volume_discount: 0,
      term_discount: 150,
      sales_discount: 0,
      net_sub_total: 1350,
      vat: 202.5,
      total_monthly: 1552.5,
      contract_value: 18630,
      internal: {
        internal_cost: 900,
        gross_profit: 450,
        realized_margin: 0.33,
        guardrail: 'OK',
      },
    },
    {
      tier: 'growth',
      line_items: {
        base_charge: 2000,
        ai_allocation: 400,
        data_storage: 600,
        vm_infrastructure: 0,
        deployment_setup_premium: 0,
      },
      sub_total: 3000,
      volume_discount: 100,
      term_discount: 290,
      sales_discount: 0,
      net_sub_total: 2610,
      vat: 391.5,
      total_monthly: 3001.5,
      contract_value: 36018,
      internal: {
        internal_cost: 2800,
        gross_profit: -190,
        realized_margin: -0.07,
        guardrail: 'BELOW FLOOR',
      },
    },
  ],
};

vi.mock('./_lib/use-pricing-compute', () => ({
  usePricingCompute: (args: { includeInternal?: boolean }) => {
    computeMock(args);
    return {
      data: BASE_RESPONSE,
      isLoading: false,
      isError: false,
      error: null,
      isFetching: false,
      refetch: vi.fn(),
    };
  },
}));

import PricingPage from './page';

describe('PricingPage', () => {
  beforeEach(() => {
    hasPermissionMock.mockReset();
    computeMock.mockReset();
  });

  it('renders the tier cards + deal-summary strip with the headline totals', () => {
    hasPermissionMock.mockReturnValue(true); // full access
    renderWithQuery(<PricingPage />, { locale: 'en' });

    // The card grid + one card per returned tier.
    expect(screen.getByTestId('tier-cards')).toBeInTheDocument();
    expect(screen.getByTestId('tier-card-standard')).toBeInTheDocument();
    expect(screen.getByTestId('tier-card-growth')).toBeInTheDocument();

    // Tier names surface on the cards.
    expect(screen.getAllByText('Standard').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Growth').length).toBeGreaterThan(0);

    // The deal-summary strip leads with the contract-value headline.
    const summary = screen.getByTestId('deal-summary');
    expect(within(summary).getByText('Total contract value')).toBeInTheDocument();
    expect(within(summary).getByText('Effective per-unit rate')).toBeInTheDocument();
    expect(within(summary).getByText('Annualized')).toBeInTheDocument();

    // Each card carries a "Quote this tier" CTA.
    expect(screen.getAllByText('Quote this tier').length).toBeGreaterThan(0);
  });

  it('reveals the EXISTING detailed line-item table only via "Compare all details"', () => {
    hasPermissionMock.mockReturnValue(true);
    renderWithQuery(<PricingPage />, { locale: 'en' });

    // Collapsed by default: the detailed table is not mounted.
    expect(screen.queryByTestId('pricing-detail-table')).not.toBeInTheDocument();

    // Expand it.
    fireEvent.click(screen.getByTestId('compare-details-toggle'));

    const table = screen.getByTestId('pricing-detail-table');
    expect(table).toBeInTheDocument();
    // The reused table exposes the full breakdown rows + totals.
    expect(within(table).getByText('Base charge')).toBeInTheDocument();
    expect(within(table).getByText('Total monthly')).toBeInTheDocument();
    expect(within(table).getByText('Total contract value')).toBeInTheDocument();
  });

  it('HIDES the margin cockpit and never requests include_internal without pricing:admin', () => {
    // Write user: has read+write but NOT admin.
    hasPermissionMock.mockImplementation((p) => p === 'pricing:read' || p === 'pricing:write');
    renderWithQuery(<PricingPage />, { locale: 'en' });

    // Neither the (superseded) comparison margin panel nor the cockpit render.
    expect(screen.queryByTestId('pricing-margin-panel')).not.toBeInTheDocument();
    expect(screen.queryByTestId('margin-cockpit')).not.toBeInTheDocument();
    expect(screen.queryByText('Margin cockpit')).not.toBeInTheDocument();
    expect(screen.queryByText('Internal margin')).not.toBeInTheDocument();

    // The CLIENT cost-breakdown chart IS available to a non-admin — and carries
    // no margin (it's built from masked ClientTier fields only).
    expect(screen.getByTestId('cost-breakdown-card')).toBeInTheDocument();

    // The hook must have been asked NOT to include internal on any call.
    expect(computeMock).toHaveBeenCalled();
    for (const call of computeMock.mock.calls) {
      expect(call[0].includeInternal).toBe(false);
    }
  });

  it('SHOWS the margin cockpit (gauges + what-if) and requests include_internal for pricing:admin', () => {
    hasPermissionMock.mockImplementation((p) => p === 'pricing:admin');
    renderWithQuery(<PricingPage />, { locale: 'en' });

    // The admin-only cockpit surface with its gauges + what-if.
    const cockpit = screen.getByTestId('margin-cockpit');
    expect(cockpit).toBeInTheDocument();
    expect(within(cockpit).getByTestId('cockpit-gauges')).toBeInTheDocument();
    expect(within(cockpit).getByTestId('cockpit-what-if')).toBeInTheDocument();
    // The canned growth row is below floor → the destructive banner renders.
    expect(within(cockpit).getByTestId('cockpit-below-floor-banner')).toBeInTheDocument();

    // The hook must have been asked to include internal at least once.
    expect(
      computeMock.mock.calls.some((call) => call[0].includeInternal === true),
    ).toBe(true);
  });

  it('keeps the CLIENT cost-breakdown chart free of any margin/internal figure', () => {
    // Full access (admin) so the internal block is present on the canned rows —
    // the client chart must STILL never surface it.
    hasPermissionMock.mockReturnValue(true);
    renderWithQuery(<PricingPage />, { locale: 'en' });

    const card = screen.getByTestId('cost-breakdown-card');
    // No internal-margin FIGURES/labels leak into the client breakdown card.
    // (The card's own descriptive copy legitimately says "no margin"; we assert
    // that the internal-only vocabulary that would accompany leaked data is
    // absent.)
    expect(within(card).queryByText(/gross profit/i)).not.toBeInTheDocument();
    expect(within(card).queryByText(/realized margin/i)).not.toBeInTheDocument();
    expect(within(card).queryByText(/internal cost/i)).not.toBeInTheDocument();
    expect(within(card).queryByText(/guardrail/i)).not.toBeInTheDocument();
    expect(within(card).queryByText(/below floor/i)).not.toBeInTheDocument();
  });
});
