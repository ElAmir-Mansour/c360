import { describe, expect, it, vi } from 'vitest';
import type { LexContract, LexObligation } from '@/types/suites';
import {
  EMPTY_OBLIGATION_COUNTS,
  OBLIGATIONS_DUE_SOON_DAYS,
  buildObligationCountsIndex,
  computeAutoRenewCountdowns,
  computeOptOutDeadline,
  isDueSoonObligation,
  isOpenObligation,
  isOverdueObligation,
  rollupObligations,
} from './use-obligations-rollup';

// The module imports the api client + react-query at top level; neither is
// exercised by the pure helpers under test, so stub them out.
vi.mock('@/lib/enterprise', () => ({ enterpriseApi: { lex: {} } }));
vi.mock('@tanstack/react-query', () => ({ useQuery: vi.fn() }));

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function obligation(overrides: Partial<LexObligation> = {}): LexObligation {
  return {
    id: 'ob-1',
    tenant_id: 't-1',
    title: 'Deliver quarterly report',
    description: '',
    type: 'contractual',
    status: 'open',
    priority: 'medium',
    contract_id: 'c-1',
    contract_title: 'MSA',
    matter_id: null,
    matter_title: null,
    clause_id: null,
    owner_user_id: 'u-1',
    owner_name: 'Ada',
    due_date: '2026-07-20',
    completed_at: null,
    reminder_enabled: true,
    reminder_lead_days: [7],
    escalation_enabled: false,
    escalation_lead_days: [],
    escalation_target: null,
    last_reminder_at: null,
    tags: [],
    metadata: {},
    created_by: 'u-1',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    deleted_at: null,
    days_until_due: 5,
    ...overrides,
  };
}

function contract(overrides: Partial<LexContract> = {}): LexContract {
  return {
    id: 'c-1',
    tenant_id: 't-1',
    title: 'MSA',
    contract_number: null,
    type: 'service_agreement',
    description: '',
    party_a_name: 'Al Othaim',
    party_a_entity: null,
    party_b_name: 'Vendor',
    party_b_entity: null,
    party_b_contact: null,
    total_value: 100_000,
    currency: 'SAR',
    payment_terms: null,
    effective_date: null,
    expiry_date: null,
    renewal_date: null,
    auto_renew: false,
    renewal_notice_days: 30,
    signed_date: null,
    status: 'active',
    previous_status: null,
    status_changed_at: null,
    status_changed_by: null,
    owner_user_id: 'u-1',
    owner_name: 'Ada',
    legal_reviewer_id: null,
    legal_reviewer_name: null,
    risk_score: null,
    risk_level: 'low',
    analysis_status: 'completed',
    last_analyzed_at: null,
    document_file_id: null,
    document_text: '',
    current_version: 1,
    parent_contract_id: null,
    workflow_instance_id: null,
    department: null,
    tags: [],
    metadata: {},
    created_by: 'u-1',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    deleted_at: null,
    ...overrides,
  };
}

describe('isOpenObligation', () => {
  it('treats open / in_progress / blocked as open', () => {
    for (const status of ['open', 'in_progress', 'blocked']) {
      expect(isOpenObligation(obligation({ status }))).toBe(true);
    }
  });

  it('treats terminal statuses as closed', () => {
    for (const status of ['completed', 'waived', 'cancelled']) {
      expect(isOpenObligation(obligation({ status }))).toBe(false);
    }
  });
});

describe('isOverdueObligation', () => {
  it('requires a negative days_until_due', () => {
    expect(isOverdueObligation(obligation({ days_until_due: -1 }))).toBe(true);
    expect(isOverdueObligation(obligation({ days_until_due: 0 }))).toBe(false);
  });

  it('never marks terminal obligations overdue', () => {
    expect(
      isOverdueObligation(obligation({ status: 'completed', days_until_due: -10 })),
    ).toBe(false);
  });
});

describe('isDueSoonObligation', () => {
  it('accepts 0..horizon inclusive and rejects beyond it', () => {
    expect(isDueSoonObligation(obligation({ days_until_due: 0 }))).toBe(true);
    expect(
      isDueSoonObligation(obligation({ days_until_due: OBLIGATIONS_DUE_SOON_DAYS })),
    ).toBe(true);
    expect(
      isDueSoonObligation(obligation({ days_until_due: OBLIGATIONS_DUE_SOON_DAYS + 1 })),
    ).toBe(false);
  });

  it('excludes overdue obligations', () => {
    expect(isDueSoonObligation(obligation({ days_until_due: -1 }))).toBe(false);
  });
});

describe('buildObligationCountsIndex', () => {
  it('aggregates open / overdue / due-soon per contract and skips terminal + unlinked rows', () => {
    const payload = [
      obligation({ id: 'a', contract_id: 'c-1', days_until_due: -2 }),
      obligation({ id: 'b', contract_id: 'c-1', days_until_due: 3 }),
      obligation({ id: 'c', contract_id: 'c-1', days_until_due: 30 }),
      obligation({ id: 'd', contract_id: 'c-2', status: 'completed', days_until_due: -5 }),
      obligation({ id: 'e', contract_id: null, days_until_due: 1 }),
    ];

    const index = buildObligationCountsIndex(payload);

    expect(index.get('c-1')).toEqual({ open: 3, overdue: 1, dueSoon: 1 });
    expect(index.get('c-2')).toBeUndefined();
    expect(index.size).toBe(1);
  });

  it('memoizes per payload reference', () => {
    const payload = [obligation()];
    expect(buildObligationCountsIndex(payload)).toBe(buildObligationCountsIndex(payload));
  });
});

describe('computeOptOutDeadline', () => {
  const now = new Date('2026-07-01T00:00:00Z');

  it('returns expiry minus the notice window with whole-day countdown', () => {
    const entry = computeOptOutDeadline(
      contract({ auto_renew: true, expiry_date: '2026-08-01T00:00:00Z', renewal_notice_days: 30 }),
      now,
    );

    expect(entry).not.toBeNull();
    expect(entry!.deadline.getTime()).toBe(
      new Date('2026-08-01T00:00:00Z').getTime() - 30 * MS_PER_DAY,
    );
    expect(entry!.daysLeft).toBe(1);
  });

  it('goes negative once the window closed', () => {
    const entry = computeOptOutDeadline(
      contract({ auto_renew: true, expiry_date: '2026-07-10T00:00:00Z', renewal_notice_days: 30 }),
      now,
    );
    expect(entry!.daysLeft).toBeLessThan(0);
  });

  it('clamps a negative notice window to zero days', () => {
    const entry = computeOptOutDeadline(
      contract({ auto_renew: true, expiry_date: '2026-08-01T00:00:00Z', renewal_notice_days: -5 }),
      now,
    );
    expect(entry!.deadline.getTime()).toBe(new Date('2026-08-01T00:00:00Z').getTime());
  });

  it('returns null for non-auto-renew, missing, or unparseable expiry', () => {
    expect(computeOptOutDeadline(contract({ auto_renew: false, expiry_date: '2026-08-01' }), now)).toBeNull();
    expect(computeOptOutDeadline(contract({ auto_renew: true, expiry_date: null }), now)).toBeNull();
    expect(computeOptOutDeadline(contract({ auto_renew: true, expiry_date: 'not-a-date' }), now)).toBeNull();
  });
});

describe('computeAutoRenewCountdowns', () => {
  it('sorts soonest deadline first and drops non-auto-renew rows', () => {
    const now = new Date('2026-07-01T00:00:00Z');
    const later = contract({
      id: 'c-later',
      auto_renew: true,
      expiry_date: '2026-12-01',
      renewal_notice_days: 30,
    });
    const sooner = contract({
      id: 'c-sooner',
      auto_renew: true,
      expiry_date: '2026-08-01',
      renewal_notice_days: 30,
    });
    const manual = contract({ id: 'c-manual', auto_renew: false, expiry_date: '2026-07-05' });

    const entries = computeAutoRenewCountdowns([later, manual, sooner], now);

    expect(entries.map((entry) => entry.contract.id)).toEqual(['c-sooner', 'c-later']);
  });
});

describe('rollupObligations', () => {
  const now = new Date('2026-07-01T00:00:00Z');

  it('joins the payload onto the visible rows, ordering upcoming by triage', () => {
    const visible = [contract({ id: 'c-1' }), contract({ id: 'c-2', total_value: 50_000 })];
    const payload = [
      obligation({ id: 'due', contract_id: 'c-2', days_until_due: 2 }),
      obligation({ id: 'late', contract_id: 'c-1', days_until_due: -4 }),
      obligation({ id: 'far', contract_id: 'c-1', days_until_due: 40 }),
      obligation({ id: 'other', contract_id: 'c-hidden', days_until_due: 1 }),
      obligation({ id: 'done', contract_id: 'c-1', status: 'completed', days_until_due: -9 }),
    ];

    const rollup = rollupObligations(payload, visible, now);

    expect(rollup.openTotal).toBe(3);
    expect(rollup.overdue).toBe(1);
    expect(rollup.dueSoon).toBe(1);
    expect(rollup.upcoming.map((entry) => entry.obligation.id)).toEqual(['late', 'due', 'far']);
    // Counts index spans the whole payload (hidden contracts included).
    expect(rollup.counts.get('c-hidden')).toEqual({ open: 1, overdue: 0, dueSoon: 1 });
  });

  it('sums SAR exposure over distinct contracts and excludes foreign currency', () => {
    const visible = [
      contract({ id: 'c-1', total_value: 100_000, currency: 'SAR' }),
      contract({ id: 'c-2', total_value: 999, currency: 'USD' }),
      contract({ id: 'c-3', total_value: null }),
    ];
    const payload = [
      obligation({ id: 'a', contract_id: 'c-1', days_until_due: 1 }),
      obligation({ id: 'b', contract_id: 'c-1', days_until_due: 2 }),
      obligation({ id: 'c', contract_id: 'c-2', days_until_due: 3 }),
      obligation({ id: 'd', contract_id: 'c-3', days_until_due: 4 }),
    ];

    const { exposure } = rollupObligations(payload, visible, now);

    // c-1 counted once despite two obligations; USD kept out of the SAR total.
    expect(exposure.sarTotal).toBe(100_000);
    expect(exposure.contractCount).toBe(1);
    expect(exposure.nonSarCount).toBe(1);
  });

  it('returns an empty rollup when nothing is visible', () => {
    const rollup = rollupObligations([obligation()], [], now);

    expect(rollup.openTotal).toBe(0);
    expect(rollup.upcoming).toEqual([]);
    expect(rollup.autoRenew).toEqual([]);
    expect(rollup.exposure).toEqual({ sarTotal: 0, contractCount: 0, nonSarCount: 0 });
  });
});

describe('EMPTY_OBLIGATION_COUNTS', () => {
  it('is a frozen zero record', () => {
    expect(EMPTY_OBLIGATION_COUNTS).toEqual({ open: 0, overdue: 0, dueSoon: 0 });
    expect(Object.isFrozen(EMPTY_OBLIGATION_COUNTS)).toBe(true);
  });
});
