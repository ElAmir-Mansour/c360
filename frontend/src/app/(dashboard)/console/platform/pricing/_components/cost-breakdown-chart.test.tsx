import { describe, it, expect } from 'vitest';
import { screen, fireEvent, within } from '@testing-library/react';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import { CostBreakdownChart } from './cost-breakdown-chart';
import type { PricingTierRow } from '../_lib/types';

// recharts ResponsiveContainer measures its parent (0×0 in jsdom); stub it to a
// fixed box so the stacked bars / waterfall mount deterministically when the
// section is expanded.
import { vi } from 'vitest';
vi.mock('recharts', async () => {
  const actual = await vi.importActual<typeof import('recharts')>('recharts');
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
      <div style={{ width: 600, height: 300 }}>{children}</div>
    ),
  };
});

// A full 4-tier dataset. Professional carries an `internal` block: the chart
// must NEVER surface it (client-safe by construction).
function tier(name: PricingTierRow['tier'], total: number, withInternal = false): PricingTierRow {
  const row: PricingTierRow = {
    tier: name,
    line_items: {
      base_charge: total * 0.6,
      ai_allocation: total * 0.2,
      data_storage: total * 0.2,
      vm_infrastructure: 0,
      deployment_setup_premium: total * 0.05,
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

const baseProps = { tiers: TIERS, model: 'per_user' as const, currency: 'SAR' };

describe('CostBreakdownChart', () => {
  it('is collapsed by default and reveals the stacked chart on toggle', () => {
    renderWithQuery(<CostBreakdownChart {...baseProps} />, { locale: 'en' });

    // Collapsed: no chart figure yet.
    expect(screen.queryByTestId('breakdown-stacked')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('cost-breakdown-toggle'));

    // Expanded: the stacked comparison is the default view.
    expect(screen.getByTestId('breakdown-stacked')).toBeInTheDocument();
  });

  it('switches to the per-tier waterfall view', () => {
    renderWithQuery(<CostBreakdownChart {...baseProps} />, { locale: 'en' });
    fireEvent.click(screen.getByTestId('cost-breakdown-toggle'));

    fireEvent.click(screen.getByTestId('breakdown-tab-waterfall'));
    expect(screen.getByTestId('breakdown-waterfall')).toBeInTheDocument();
    expect(screen.getByTestId('waterfall-tier-select')).toBeInTheDocument();
  });

  it('NEVER surfaces margin / internal figures (client-safe)', () => {
    renderWithQuery(<CostBreakdownChart {...baseProps} />, { locale: 'en' });
    fireEvent.click(screen.getByTestId('cost-breakdown-toggle'));

    const card = screen.getByTestId('cost-breakdown-card');
    // Internal-only vocabulary must NEVER appear on this client surface.
    expect(within(card).queryByText(/gross profit/i)).not.toBeInTheDocument();
    expect(within(card).queryByText(/realized margin/i)).not.toBeInTheDocument();
    expect(within(card).queryByText(/internal cost/i)).not.toBeInTheDocument();
    expect(within(card).queryByText(/guardrail/i)).not.toBeInTheDocument();
    expect(within(card).queryByText(/below floor/i)).not.toBeInTheDocument();
  });

  it('renders the RTL/Arabic surface', () => {
    renderWithQuery(<CostBreakdownChart {...baseProps} />, { locale: 'ar' });
    fireEvent.click(screen.getByTestId('cost-breakdown-toggle'));
    // The chart figure mounts and the Arabic view labels surface.
    expect(screen.getByTestId('breakdown-stacked')).toBeInTheDocument();
    expect(screen.getByTestId('breakdown-tab-stacked')).toHaveTextContent('مقارنة مكدّسة');
  });
});
