import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import {
  usePricingScenarios,
  buildScenario,
  toSavedTier,
  MAX_SCENARIOS,
  type CaptureScenarioInput,
} from './use-pricing-scenarios';
import type { PricingInputState } from '../_components/pricing-inputs';
import type { PricingTierRow } from './types';

// A full 4-tier compute result. Professional carries an `internal` margin block
// (as a pricing:admin compute would). A scenario captured off this MUST NOT
// persist any margin — that is the core invariant of this feature.
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
  tier('professional', 3000, true), // <-- carries internal margin
  tier('customized', 5000),
];

const INPUTS: PricingInputState = {
  model: 'per_user',
  deployment: 1,
  termMonths: 12,
  users: 50,
  cores: 8,
  vms: 4,
  hotStorageGb: 100,
  coldStorageGb: 500,
  salesDiscountPct: 0,
};

const CAPTURE: CaptureScenarioInput = {
  name: 'SaaS 12mo per-user',
  inputs: INPUTS,
  selectedTier: 'professional',
  model: 'per_user',
  currency: 'SAR',
  pricingVersion: 3,
  tiers: TIERS,
};

/** Deep-scan any value for internal-only margin keys/values. */
function containsMargin(value: unknown): boolean {
  const json = JSON.stringify(value) ?? '';
  return (
    /internal_cost|gross_profit|realized_margin|guardrail/i.test(json) ||
    /"internal"\s*:/.test(json)
  );
}

describe('scenario snapshot masking (buildScenario / toSavedTier)', () => {
  it('toSavedTier drops the internal block entirely', () => {
    const admin = tier('professional', 3000, true);
    expect(admin.internal).toBeDefined(); // source has margin

    const saved = toSavedTier(admin);
    // The masked row carries NO internal field and no margin keys.
    expect('internal' in saved).toBe(false);
    expect(containsMargin(saved)).toBe(false);
    // Client figures survive.
    expect(saved.total_monthly).toBe(admin.total_monthly);
    expect(saved.contract_value).toBe(admin.contract_value);
  });

  it('buildScenario captures a margin-free snapshot even from an admin compute', () => {
    const scenario = buildScenario(CAPTURE);
    // Not a single margin figure anywhere in the persisted scenario.
    expect(containsMargin(scenario)).toBe(false);
    for (const row of scenario.tiers) {
      expect('internal' in row).toBe(false);
    }
    // The selected tier + inputs are captured for restore.
    expect(scenario.selectedTier).toBe('professional');
    expect(scenario.inputs.termMonths).toBe(12);
    expect(scenario.name).toBe('SaaS 12mo per-user');
  });
});

describe('usePricingScenarios (localStorage CRUD)', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('saves a scenario and persists a MARGIN-FREE payload to localStorage', () => {
    const { result } = renderHook(() => usePricingScenarios('user-1'));

    act(() => {
      result.current.save(CAPTURE);
    });

    expect(result.current.scenarios).toHaveLength(1);
    expect(result.current.scenarios[0].name).toBe('SaaS 12mo per-user');

    // The RAW persisted string must contain no margin vocabulary at all.
    const raw = window.localStorage.getItem('clario360.pricing.scenarios.user-1') ?? '';
    expect(raw.length).toBeGreaterThan(0);
    expect(/internal_cost|gross_profit|realized_margin|guardrail/i.test(raw)).toBe(false);
    expect(/"internal"\s*:/.test(raw)).toBe(false);
  });

  it('survives a refresh — a fresh hook re-hydrates from localStorage', () => {
    const first = renderHook(() => usePricingScenarios('user-1'));
    act(() => {
      first.result.current.save(CAPTURE);
    });

    // A brand-new hook instance (simulating a page refresh) reads it back.
    const second = renderHook(() => usePricingScenarios('user-1'));
    expect(second.result.current.scenarios).toHaveLength(1);
    expect(second.result.current.scenarios[0].name).toBe('SaaS 12mo per-user');
    expect(containsMargin(second.result.current.scenarios[0])).toBe(false);
  });

  it('scopes scenarios per-user', () => {
    const u1 = renderHook(() => usePricingScenarios('user-1'));
    act(() => {
      u1.result.current.save(CAPTURE);
    });
    const u2 = renderHook(() => usePricingScenarios('user-2'));
    // A different user sees an empty list.
    expect(u2.result.current.scenarios).toHaveLength(0);
  });

  it('renames and deletes a scenario', () => {
    const { result } = renderHook(() => usePricingScenarios('user-1'));
    let id = '';
    act(() => {
      id = result.current.save(CAPTURE).id;
    });

    act(() => {
      result.current.rename(id, 'On-Prem 24mo');
    });
    expect(result.current.scenarios[0].name).toBe('On-Prem 24mo');

    act(() => {
      result.current.remove(id);
    });
    expect(result.current.scenarios).toHaveLength(0);
  });

  it('caps the number of stored scenarios', () => {
    const { result } = renderHook(() => usePricingScenarios('user-1'));
    // Each save is its own commit (React re-renders between events), so the cap
    // is applied against the growing list — mirror that with per-save act()s.
    for (let i = 0; i < MAX_SCENARIOS + 5; i++) {
      act(() => {
        result.current.save({ ...CAPTURE, name: `S${i}` });
      });
    }
    expect(result.current.scenarios.length).toBe(MAX_SCENARIOS);
  });
});
