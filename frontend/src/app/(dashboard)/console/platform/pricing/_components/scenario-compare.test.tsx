import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent, within } from '@testing-library/react';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import { ScenarioCompare } from './scenario-compare';
import { buildScenario, type CaptureScenarioInput } from '../_lib/use-pricing-scenarios';
import type { PricingInputState } from './pricing-inputs';
import type { PricingTierRow } from '../_lib/types';

// Build tier rows; Professional carries an internal margin block so we can prove
// a captured scenario NEVER surfaces it on the compare grid.
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

function inputs(partial: Partial<PricingInputState> = {}): PricingInputState {
  return {
    model: 'per_user',
    deployment: 1,
    termMonths: 12,
    users: 50,
    cores: 8,
    vms: 4,
    hotStorageGb: 100,
    coldStorageGb: 500,
    salesDiscountPct: 0,
    ...partial,
  };
}

function capture(name: string, partial: Partial<CaptureScenarioInput> = {}): CaptureScenarioInput {
  return {
    name,
    inputs: inputs(partial.inputs),
    selectedTier: partial.selectedTier ?? 'professional',
    model: partial.model ?? 'per_user',
    currency: 'SAR',
    pricingVersion: 3,
    tiers: TIERS,
    ...partial,
  };
}

const SCN_A = buildScenario(capture('SaaS 12mo per-user'));
const SCN_B = buildScenario(
  capture('On-Prem 24mo', { inputs: inputs({ deployment: 2, termMonths: 24, users: 120 }) }),
);

describe('ScenarioCompare', () => {
  it('renders a column per scenario with its selected-tier masked headline numbers', () => {
    renderWithQuery(<ScenarioCompare scenarios={[SCN_A, SCN_B]} />, { locale: 'en' });

    const grid = screen.getByTestId('scenario-compare');
    expect(within(grid).getByTestId(`scenario-col-${SCN_A.id}`)).toHaveTextContent(
      'SaaS 12mo per-user',
    );
    expect(within(grid).getByTestId(`scenario-col-${SCN_B.id}`)).toHaveTextContent('On-Prem 24mo');

    // Driver rows differ between the two scenarios (deployment + term + volume).
    expect(screen.getByTestId(`scenario-cell-deployment-${SCN_A.id}`)).toHaveTextContent('SaaS');
    expect(screen.getByTestId(`scenario-cell-deployment-${SCN_B.id}`)).toHaveTextContent('On-Prem');
    expect(screen.getByTestId(`scenario-cell-term-${SCN_A.id}`)).toHaveTextContent('12');
    expect(screen.getByTestId(`scenario-cell-term-${SCN_B.id}`)).toHaveTextContent('24');

    // The masked headline figures render (contract value is the highlighted row).
    expect(screen.getByTestId(`scenario-cell-contractValue-${SCN_A.id}`)).toHaveTextContent(/SAR|ر\.?س|SR/);
    expect(screen.getByTestId(`scenario-cell-totalMonthly-${SCN_A.id}`)).toBeInTheDocument();
  });

  it('NEVER surfaces margin / internal figures on the compare grid (even from an admin capture)', () => {
    renderWithQuery(<ScenarioCompare scenarios={[SCN_A, SCN_B]} />, { locale: 'en' });
    const grid = screen.getByTestId('scenario-compare');

    expect(within(grid).queryByText(/gross profit/i)).not.toBeInTheDocument();
    expect(within(grid).queryByText(/realized margin/i)).not.toBeInTheDocument();
    expect(within(grid).queryByText(/internal cost/i)).not.toBeInTheDocument();
    expect(within(grid).queryByText(/guardrail/i)).not.toBeInTheDocument();
    expect(within(grid).queryByText(/below floor/i)).not.toBeInTheDocument();

    // And no margin figure text leaked (the internal cost of Professional was 1500).
    const html = grid.innerHTML;
    expect(/internal/i.test(html)).toBe(false);
  });

  it('fires onLoad with the scenario when its Load action is pressed', () => {
    const onLoad = vi.fn();
    renderWithQuery(
      <ScenarioCompare scenarios={[SCN_A, SCN_B]} onLoad={onLoad} />,
      { locale: 'en' },
    );
    fireEvent.click(screen.getByTestId(`scenario-compare-load-${SCN_A.id}`));
    expect(onLoad).toHaveBeenCalledWith(SCN_A);
  });

  it('renders the RTL/Arabic surface', () => {
    renderWithQuery(<ScenarioCompare scenarios={[SCN_A, SCN_B]} />, { locale: 'ar' });
    expect(screen.getByTestId('scenario-compare')).toBeInTheDocument();
    // The Arabic compare title surfaces.
    expect(screen.getByText('مقارنة السيناريوهات')).toBeInTheDocument();
  });
});
