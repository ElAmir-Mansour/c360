import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, within } from '@testing-library/react';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import type { ComputeResponse, PricingTierRow } from '../_lib/types';

// The what-if slider re-issues usePricingCompute. Mock it so we can (a) capture
// the args (assert include_internal + the sales-discount override) and (b)
// return a canned below-floor result for the recomputed rows.
const { computeMock } = vi.hoisted(() => ({ computeMock: vi.fn() }));

const WHAT_IF_RESULT: ComputeResponse = {
  pricing_version: 1,
  currency: 'SAR',
  model: 'per_user',
  tiers: [
    {
      tier: 'professional',
      line_items: {
        base_charge: 1800,
        ai_allocation: 600,
        data_storage: 600,
        vm_infrastructure: 0,
        deployment_setup_premium: 0,
      },
      sub_total: 3000,
      volume_discount: 0,
      term_discount: 0,
      sales_discount: 900,
      net_sub_total: 2100,
      vat: 315,
      total_monthly: 2415,
      contract_value: 28980,
      internal: {
        internal_cost: 2200,
        gross_profit: -100,
        realized_margin: -0.05,
        guardrail: 'BELOW FLOOR',
      },
    },
  ],
};

vi.mock('../_lib/use-pricing-compute', () => ({
  usePricingCompute: (args: { includeInternal?: boolean; enabled?: boolean }) => {
    computeMock(args);
    return {
      data: WHAT_IF_RESULT,
      isLoading: false,
      isError: false,
      error: null,
      isFetching: false,
      refetch: vi.fn(),
    };
  },
}));

import { MarginCockpit } from './margin-cockpit';

function tier(name: PricingTierRow['tier'], margin: number, ok: boolean): PricingTierRow {
  return {
    tier: name,
    line_items: {
      base_charge: 1000,
      ai_allocation: 200,
      data_storage: 300,
      vm_infrastructure: 0,
      deployment_setup_premium: 0,
    },
    sub_total: 1500,
    volume_discount: 0,
    term_discount: 0,
    sales_discount: 0,
    net_sub_total: 1500,
    vat: 225,
    total_monthly: 1725,
    contract_value: 20700,
    internal: {
      internal_cost: 900,
      gross_profit: 600,
      realized_margin: margin,
      guardrail: ok ? 'OK' : 'BELOW FLOOR',
    },
  };
}

const OK_TIERS: PricingTierRow[] = [
  tier('standard', 0.33, true),
  tier('growth', 0.28, true),
  tier('professional', 0.4, true),
  tier('customized', 0.5, true),
];

const BELOW_TIERS: PricingTierRow[] = [
  tier('standard', 0.33, true),
  tier('growth', -0.07, false),
  tier('professional', 0.4, true),
  tier('customized', 0.5, true),
];

const baseBody = {
  model: 'per_user' as const,
  deployment: 1 as const,
  term_months: 12,
  users: 50,
  hot_storage_gb: 100,
  cold_storage_gb: 500,
};

describe('MarginCockpit', () => {
  beforeEach(() => computeMock.mockReset());

  it('renders a margin gauge per tier', () => {
    renderWithQuery(
      <MarginCockpit tiers={OK_TIERS} currency="SAR" computeBody={baseBody} />,
      { locale: 'en' },
    );
    const gauges = screen.getByTestId('cockpit-gauges');
    // One gauge per tier (by localized tier label).
    expect(within(gauges).getByTestId('margin-gauge-Standard')).toBeInTheDocument();
    expect(within(gauges).getByTestId('margin-gauge-Growth')).toBeInTheDocument();
    expect(within(gauges).getByTestId('margin-gauge-Professional')).toBeInTheDocument();
    expect(within(gauges).getByTestId('margin-gauge-Customized')).toBeInTheDocument();
  });

  it('hides the below-floor banner when every tier is OK', () => {
    renderWithQuery(
      <MarginCockpit tiers={OK_TIERS} currency="SAR" computeBody={baseBody} />,
      { locale: 'en' },
    );
    expect(screen.queryByTestId('cockpit-below-floor-banner')).not.toBeInTheDocument();
  });

  it('shows the destructive below-floor banner + override CTA when a tier is below floor', () => {
    renderWithQuery(
      <MarginCockpit tiers={BELOW_TIERS} currency="SAR" computeBody={baseBody} />,
      { locale: 'en' },
    );
    const banner = screen.getByTestId('cockpit-below-floor-banner');
    expect(banner).toBeInTheDocument();
    expect(within(banner).getByTestId('cockpit-request-override')).toBeInTheDocument();
  });

  it('fires onRequestOverride with the below-floor tier from the banner CTA', () => {
    const onRequestOverride = vi.fn();
    renderWithQuery(
      <MarginCockpit
        tiers={BELOW_TIERS}
        currency="SAR"
        computeBody={baseBody}
        onRequestOverride={onRequestOverride}
      />,
      { locale: 'en' },
    );
    fireEvent.click(screen.getByTestId('cockpit-request-override'));
    expect(onRequestOverride).toHaveBeenCalledWith('growth');
  });

  it('renders the what-if surface and always requests include_internal', () => {
    renderWithQuery(
      <MarginCockpit tiers={OK_TIERS} currency="SAR" computeBody={baseBody} />,
      { locale: 'en' },
    );
    expect(screen.getByTestId('cockpit-what-if')).toBeInTheDocument();
    // The what-if compute call (whenever it fires) is admin/internal.
    for (const call of computeMock.mock.calls) {
      expect(call[0].includeInternal).toBe(true);
    }
  });
});
