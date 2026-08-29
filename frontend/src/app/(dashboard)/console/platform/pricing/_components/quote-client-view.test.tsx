import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import type { Quote } from '../_lib/quote-types';

// ---------------------------------------------------------------------------
// Auth — mutable hasPermission. The client view must be margin-free for EVERY
// role, so we flip pricing:admin on and still assert no margin surfaces.
// ---------------------------------------------------------------------------
const { hasPermissionMock } = vi.hoisted(() => ({
  hasPermissionMock: vi.fn<(perm: string) => boolean>(() => true),
}));
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ hasPermission: hasPermissionMock, user: { id: 'u1' } }),
}));

// ---------------------------------------------------------------------------
// A saved quote whose selected tier CARRIES an internal margin block — exactly
// what a pricing:admin GET /quotes/{id} could return. The client view must NEVER
// render any of it: it is a prospect-facing document.
// ---------------------------------------------------------------------------
const ADMIN_QUOTE_WITH_MARGIN: Quote = {
  id: 'q-9',
  quote_number: 'Q-2026-000999',
  model: 'per_user',
  pricing_version: 4,
  status: 'sent',
  below_floor: false,
  floor_override: false,
  selected_tier: 'professional',
  account_name: 'Al Othaim Investment Company',
  currency: 'SAR',
  valid_until: '2026-09-01T00:00:00Z',
  created_at: '2026-07-01T00:00:00Z',
  tiers: [
    {
      tier: 'professional',
      line_items: {
        base_charge: 6000,
        ai_allocation: 1200,
        data_storage: 800,
        vm_infrastructure: 0,
        deployment_setup_premium: 500,
      },
      sub_total: 8500,
      volume_discount: 500,
      term_discount: 700,
      sales_discount: 0,
      net_sub_total: 7300,
      vat: 1095,
      total_monthly: 8395,
      contract_value: 100740,
      // INTERNAL — must never leak onto the client view.
      internal: {
        internal_cost: 4200,
        gross_profit: 3100,
        realized_margin: 0.42,
        guardrail: 'OK',
      },
    },
  ],
};

const { exportMock } = vi.hoisted(() => ({ exportMock: vi.fn() }));

vi.mock('../_lib/use-pricing-quotes', () => ({
  usePricingQuote: () => ({
    data: ADMIN_QUOTE_WITH_MARGIN,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
  exportPricingQuote: exportMock,
}));

import { QuoteClientView } from './quote-client-view';

describe('QuoteClientView (shareable client quote)', () => {
  beforeEach(() => {
    hasPermissionMock.mockReset();
    hasPermissionMock.mockReturnValue(true); // full access incl. pricing:admin
  });

  it('renders a branded proposal with the logo, quote metadata, and totals', () => {
    renderWithQuery(<QuoteClientView id="q-9" />, { locale: 'en' });

    const proposal = screen.getByTestId('client-view-proposal');
    // Brand logo present. The direction-aware Logo renders a wordmark PAIR
    // (Latin + Arabic, one hidden by `dir` via CSS), so assert on the pair.
    const logoImgs = within(screen.getByTestId('client-view-logo')).getAllByRole('img', {
      name: 'Clario360',
    });
    expect(logoImgs.length).toBeGreaterThan(0);
    expect(logoImgs[0]).toBeInTheDocument();

    // Quote metadata.
    expect(within(proposal).getByText('Q-2026-000999')).toBeInTheDocument();
    expect(within(proposal).getByText('Al Othaim Investment Company')).toBeInTheDocument();

    // Hero tier + totals surfaces.
    expect(screen.getByTestId('client-view-hero')).toHaveTextContent('Professional');
    // The total contract value headline renders the masked contract_value.
    const cv = screen.getByTestId('client-view-contract-value');
    expect(within(cv).getByText(/100,?740/)).toBeInTheDocument();

    // Print + copy-link affordances.
    expect(screen.getByTestId('client-view-print')).toBeInTheDocument();
    expect(screen.getByTestId('client-view-copy-link')).toBeInTheDocument();
  });

  it('NEVER shows internal margin — even for a pricing:admin viewer', () => {
    hasPermissionMock.mockReturnValue(true); // admin
    renderWithQuery(<QuoteClientView id="q-9" />, { locale: 'en' });

    const view = screen.getByTestId('quote-client-view');

    // No internal-only vocabulary.
    expect(within(view).queryByText(/internal cost/i)).not.toBeInTheDocument();
    expect(within(view).queryByText(/gross profit/i)).not.toBeInTheDocument();
    expect(within(view).queryByText(/realized margin/i)).not.toBeInTheDocument();
    expect(within(view).queryByText(/guardrail/i)).not.toBeInTheDocument();
    expect(within(view).queryByText('Internal margin')).not.toBeInTheDocument();

    // No margin FIGURES leak: internal_cost 4200 / gross_profit 3100 must not
    // appear as text anywhere in the rendered document.
    const html = view.innerHTML;
    expect(/4,?200/.test(html)).toBe(false);
    expect(/3,?100/.test(html)).toBe(false);
    // "42%" (the realized margin) must not appear either.
    expect(/42\s*%/.test(view.textContent ?? '')).toBe(false);
  });

  it('renders the RTL/Arabic proposal', () => {
    renderWithQuery(<QuoteClientView id="q-9" />, { locale: 'ar' });
    expect(screen.getByTestId('client-view-proposal')).toBeInTheDocument();
    // The Arabic "prepared for" label + account still render.
    expect(screen.getByText('أُعدّ لـ')).toBeInTheDocument();
    expect(screen.getByText('Al Othaim Investment Company')).toBeInTheDocument();
  });
});
