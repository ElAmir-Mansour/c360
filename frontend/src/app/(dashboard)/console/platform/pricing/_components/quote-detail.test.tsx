import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import type { Quote } from '../_lib/quote-types';

// ---------------------------------------------------------------------------
// Auth gating — mutable hasPermission so tests can flip pricing:admin / write.
// ---------------------------------------------------------------------------
const { hasPermissionMock } = vi.hoisted(() => ({
  hasPermissionMock: vi.fn<(perm: string) => boolean>(() => true),
}));
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ hasPermission: hasPermissionMock, user: { id: 'u1' } }),
}));

// next/navigation Link is fine in jsdom; no router needed for the detail view.

// ---------------------------------------------------------------------------
// The quotes hook family — return a canned below-floor quote WITH an internal
// margin block (as pricing:admin would receive). The margin panel must still be
// hidden when the auth gate says non-admin, proving the page-level gate.
// ---------------------------------------------------------------------------
const BELOW_FLOOR_QUOTE: Quote = {
  id: 'q-1',
  quote_number: 'Q-2026-000123',
  model: 'per_user',
  pricing_version: 3,
  status: 'draft',
  below_floor: true,
  floor_override: false,
  selected_tier: 'growth',
  account_name: 'Al Othaim Investment Company',
  currency: 'SAR',
  valid_until: '2026-08-01T00:00:00Z',
  created_at: '2026-07-01T00:00:00Z',
  tiers: [
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
        internal_cost: 3200,
        gross_profit: -590,
        realized_margin: -0.2,
        guardrail: 'BELOW FLOOR',
      },
    },
  ],
};

vi.mock('../_lib/use-pricing-quotes', () => ({
  usePricingQuote: () => ({
    data: BELOW_FLOOR_QUOTE,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
  useTransitionPricingQuote: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useOverrideFloor: () => ({ mutateAsync: vi.fn(), isPending: false }),
  exportPricingQuote: vi.fn(),
}));

import { QuoteDetail } from './quote-detail';

describe('QuoteDetail', () => {
  beforeEach(() => {
    hasPermissionMock.mockReset();
  });

  it('a below-floor quote surfaces the override-required guard and disables Send/Accept', () => {
    hasPermissionMock.mockReturnValue(true); // full access incl. pricing:admin
    renderWithQuery(<QuoteDetail id="q-1" />, { locale: 'en' });

    // The override-required banner is present.
    expect(screen.getByTestId('override-required-banner')).toBeInTheDocument();

    // Send + Accept are disabled until the floor is overridden.
    expect(screen.getByTestId('quote-send')).toBeDisabled();
    expect(screen.getByTestId('quote-accept')).toBeDisabled();

    // The pricing:admin Override-Floor action is offered (must be used first).
    expect(screen.getByTestId('override-floor-action')).toBeInTheDocument();
    // Reject is NOT floor-gated.
    expect(screen.getByTestId('quote-reject')).not.toBeDisabled();
  });

  it('HIDES the internal margin panel + the Override-Floor action without pricing:admin', () => {
    // pricing:read + pricing:write only — no admin.
    hasPermissionMock.mockImplementation(
      (p) => p === 'pricing:read' || p === 'pricing:write',
    );
    renderWithQuery(<QuoteDetail id="q-1" />, { locale: 'en' });

    // Margin block never rendered for a non-admin, even though the canned quote
    // carries an `internal` block.
    expect(screen.queryByTestId('quote-margin-panel')).not.toBeInTheDocument();
    expect(screen.queryByText('Internal margin')).not.toBeInTheDocument();

    // Override-Floor is a pricing:admin-only action — absent here.
    expect(screen.queryByTestId('override-floor-action')).not.toBeInTheDocument();

    // The below-floor guard still shows, and Send/Accept stay disabled (a
    // pricing:write user cannot self-unblock — they must escalate to admin).
    expect(screen.getByTestId('override-required-banner')).toBeInTheDocument();
    expect(screen.getByTestId('quote-send')).toBeDisabled();
  });

  it('SHOWS the internal margin panel for pricing:admin', () => {
    hasPermissionMock.mockImplementation((p) => p === 'pricing:admin');
    renderWithQuery(<QuoteDetail id="q-1" />, { locale: 'en' });

    expect(screen.getByTestId('quote-margin-panel')).toBeInTheDocument();
    expect(screen.getByText('Internal margin')).toBeInTheDocument();
    // "Below floor" appears both as the header flag and the guardrail badge.
    expect(screen.getAllByText('Below floor').length).toBeGreaterThan(0);
  });
});
