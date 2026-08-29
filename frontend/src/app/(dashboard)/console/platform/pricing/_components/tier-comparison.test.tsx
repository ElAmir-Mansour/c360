import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent, within } from '@testing-library/react';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import { TierComparison } from './tier-comparison';
import type { PricingTierRow } from '../_lib/types';

// A controlled full 4-tier dataset (client-facing masked rows). Only Professional
// carries an `internal` block here so we can prove the margin panel is gated on
// BOTH showMargin AND the presence of internal — never on a client field.
function tier(
  name: PricingTierRow['tier'],
  total: number,
  withInternal = false,
): PricingTierRow {
  const row: PricingTierRow = {
    tier: name,
    line_items: {
      base_charge: total * 0.6,
      ai_allocation: total * 0.2,
      data_storage: total * 0.2,
      vm_infrastructure: 0,
      deployment_setup_premium: 0,
    },
    sub_total: total * 1.25,
    volume_discount: total * 0.1,
    term_discount: total * 0.1,
    sales_discount: total * 0.05,
    net_sub_total: total,
    vat: total * 0.15,
    total_monthly: total * 1.15,
    contract_value: total * 1.15 * 12,
  };
  if (withInternal) {
    row.internal = {
      internal_cost: total * 0.5,
      gross_profit: total * 0.5,
      realized_margin: 0.5,
      guardrail: 'OK',
    };
  }
  return row;
}

const TIERS: PricingTierRow[] = [
  tier('standard', 1000),
  tier('growth', 2000),
  tier('professional', 3000, true),
  tier('customized', 5000),
];

const baseProps = {
  tiers: TIERS,
  model: 'per_user' as const,
  currency: 'SAR',
  termMonths: 12,
  users: 90, // just below the 100-user breakpoint → volume nudge should show
  cores: 0,
};

describe('TierComparison — tier cards', () => {
  it('renders a card per tier and elevates the recommended (Professional) tier', () => {
    renderWithQuery(
      <TierComparison {...baseProps} showMargin={false} />,
      { locale: 'en' },
    );

    for (const name of ['standard', 'growth', 'professional', 'customized']) {
      expect(screen.getByTestId(`tier-card-${name}`)).toBeInTheDocument();
    }

    // The recommended badge is on the Professional card (default recommendedTier).
    const badge = screen.getByTestId('tier-recommended-badge');
    expect(badge).toHaveTextContent('Most Popular');
    expect(screen.getByTestId('tier-card-professional')).toContainElement(badge);
  });

  it('shows the term-commitment savings callout and the volume nudge', () => {
    renderWithQuery(
      <TierComparison {...baseProps} showMargin={false} />,
      { locale: 'en' },
    );

    // Savings storytelling on a tier card (term >= 12 + positive discounts).
    expect(screen.getByTestId('tier-savings-professional')).toHaveTextContent(
      /Save .* with a 12-month commitment/,
    );

    // Volume nudge: 90 users → add 10 more to unlock the 100-user (10%) discount.
    expect(screen.getByTestId('volume-nudge')).toHaveTextContent(
      /Add 10 more to unlock a 10% volume discount/,
    );
  });

  it('fires onQuoteTier with the tier when a card CTA is pressed', () => {
    const onQuoteTier = vi.fn();
    renderWithQuery(
      <TierComparison {...baseProps} showMargin={false} onQuoteTier={onQuoteTier} />,
      { locale: 'en' },
    );

    fireEvent.click(screen.getByTestId('tier-quote-cta-growth'));
    expect(onQuoteTier).toHaveBeenCalledWith('growth');
  });

  it('toggles the reused detailed line-item table', () => {
    renderWithQuery(
      <TierComparison {...baseProps} showMargin={false} />,
      { locale: 'en' },
    );

    expect(screen.queryByTestId('pricing-detail-table')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('compare-details-toggle'));
    const table = screen.getByTestId('pricing-detail-table');
    expect(within(table).getByText('Base charge')).toBeInTheDocument();
    expect(within(table).getByText('Total monthly')).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // MARGIN GATING at the component level — showMargin is the sole gate, and it
  // only renders when the rows actually carry an `internal` block.
  // -------------------------------------------------------------------------
  it('HIDES the internal margin panel when showMargin is false (non-admin)', () => {
    renderWithQuery(
      <TierComparison {...baseProps} showMargin={false} />,
      { locale: 'en' },
    );
    expect(screen.queryByTestId('pricing-margin-panel')).not.toBeInTheDocument();
    expect(screen.queryByText('Internal margin')).not.toBeInTheDocument();
  });

  it('SHOWS the internal margin panel when showMargin is true (admin) and internal is present', () => {
    renderWithQuery(
      <TierComparison {...baseProps} showMargin={true} />,
      { locale: 'en' },
    );
    expect(screen.getByTestId('pricing-margin-panel')).toBeInTheDocument();
    expect(screen.getByText('Internal margin')).toBeInTheDocument();
  });
});
