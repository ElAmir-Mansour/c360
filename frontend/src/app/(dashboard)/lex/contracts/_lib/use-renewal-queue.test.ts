/**
 * Unit tests for the renewal-decision-queue pure helpers (`use-renewal-queue`):
 * notice-period-aware countdown classification, the cohort/warnings join, the
 * renewed-term computation, the FSM decision gate, the drafting notice-letter
 * request builder, and the draft→plain-text flattener.
 */
import { describe, expect, it } from 'vitest';

import type {
  LexContractRenewalWarning,
  LexDraftingContractDraft,
  LexExpiringContractSummary,
} from '@/types/suites';

import {
  DECISION_TARGET_STATUS,
  DEFAULT_NOTICE_DAYS,
  type RenewalQueueRow,
  buildNoticeLetterRequest,
  countdownTone,
  isDecisionAllowed,
  mergeQueueRows,
  noticeDraftToPlainText,
  renewalExpiryFrom,
} from './use-renewal-queue';

function expiring(
  overrides: Partial<LexExpiringContractSummary> = {},
): LexExpiringContractSummary {
  return {
    id: 'c-1',
    title: 'Cloud Hosting MSA',
    type: 'service_agreement',
    status: 'active',
    party_b_name: 'Najm Cloud LLC',
    expiry_date: '2026-08-01T00:00:00Z',
    days_until_expiry: 23,
    owner_name: 'Ada',
    ...overrides,
  };
}

function warning(
  overrides: Partial<LexContractRenewalWarning> = {},
): LexContractRenewalWarning {
  return {
    contract_id: 'c-1',
    title: 'Cloud Hosting MSA',
    status: 'active',
    counterparty: 'Najm Cloud LLC',
    owner: 'Ada',
    expiry_date: '2026-08-01T00:00:00Z',
    renewal_date: null,
    auto_renew: true,
    renewal_notice_days: 60,
    configured_lead_days: 90,
    trigger_date: null,
    days_until_trigger: 0,
    days_until_expiry: 23,
    severity: 'urgent',
    reason: 'inside notice window',
    ...overrides,
  };
}

function row(overrides: Partial<RenewalQueueRow> = {}): RenewalQueueRow {
  return {
    id: 'c-1',
    title: 'Cloud Hosting MSA',
    type: 'service_agreement',
    status: 'active',
    counterparty: 'Najm Cloud LLC',
    ownerName: 'Ada',
    expiryDate: '2026-08-01T00:00:00Z',
    daysUntilExpiry: 23,
    noticeDays: 60,
    noticeKnown: true,
    autoRenew: true,
    severity: 'urgent',
    ...overrides,
  };
}

describe('countdownTone', () => {
  it('is overdue at or past expiry', () => {
    expect(countdownTone(0, 30)).toBe('overdue');
    expect(countdownTone(-5, 30)).toBe('overdue');
  });

  it('is notice inside the renewal notice window (inclusive)', () => {
    expect(countdownTone(10, 30)).toBe('notice');
    expect(countdownTone(30, 30)).toBe('notice');
  });

  it('is upcoming beyond the notice window', () => {
    expect(countdownTone(31, 30)).toBe('upcoming');
  });

  it('clamps a negative notice window to zero (never "notice")', () => {
    expect(countdownTone(5, -10)).toBe('upcoming');
  });
});

describe('mergeQueueRows', () => {
  it('enriches cohort rows from the warnings digest by contract id', () => {
    const rows = mergeQueueRows([expiring()], [warning()]);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: 'c-1',
      counterparty: 'Najm Cloud LLC',
      noticeDays: 60,
      noticeKnown: true,
      autoRenew: true,
      severity: 'urgent',
    });
  });

  it('falls back to the default notice window when no warning matches', () => {
    const rows = mergeQueueRows([expiring({ id: 'c-2' })], [warning()]);

    expect(rows[0].noticeDays).toBe(DEFAULT_NOTICE_DAYS);
    expect(rows[0].noticeKnown).toBe(false);
    expect(rows[0].autoRenew).toBe(false);
    expect(rows[0].severity).toBeUndefined();
  });

  it('preserves cohort order and clamps negative notice windows', () => {
    const rows = mergeQueueRows(
      [expiring({ id: 'c-2', title: 'Second' }), expiring({ id: 'c-1' })],
      [warning({ renewal_notice_days: -7 })],
    );

    expect(rows.map((item) => item.id)).toEqual(['c-2', 'c-1']);
    expect(rows[1].noticeDays).toBe(0);
  });
});

describe('renewalExpiryFrom', () => {
  const now = new Date('2026-07-09T00:00:00Z');

  it('extends a future expiry by the term', () => {
    expect(renewalExpiryFrom('2026-12-01T00:00:00Z', 12, now)).toMatch(/^2027-12-01/);
  });

  it('forward-dates from now when the contract already lapsed', () => {
    expect(renewalExpiryFrom('2020-01-01T00:00:00Z', 6, now)).toMatch(/^2027-01-09/);
  });

  it('forward-dates from now for an unparseable expiry', () => {
    expect(renewalExpiryFrom('not-a-date', 12, now)).toMatch(/^2027-07-09/);
  });

  it('never yields a term shorter than one month and rounds fractions', () => {
    expect(renewalExpiryFrom('2026-12-01T00:00:00Z', 0, now)).toMatch(/^2027-01-01/);
    expect(renewalExpiryFrom('2026-12-01T00:00:00Z', 11.6, now)).toMatch(/^2027-12-01/);
  });
});

describe('isDecisionAllowed', () => {
  it('renews only active or expired contracts (mirrors backend RenewContract)', () => {
    expect(isDecisionAllowed(row({ status: 'active' }), 'renew')).toBe(true);
    expect(isDecisionAllowed(row({ status: 'expired' }), 'renew')).toBe(true);
    expect(isDecisionAllowed(row({ status: 'draft' }), 'renew')).toBe(false);
    expect(isDecisionAllowed(row({ status: 'suspended' }), 'renew')).toBe(false);
  });

  it('terminates per the lifecycle FSM (active/suspended only)', () => {
    expect(isDecisionAllowed(row({ status: 'active' }), 'terminate')).toBe(true);
    expect(isDecisionAllowed(row({ status: 'suspended' }), 'terminate')).toBe(true);
    expect(isDecisionAllowed(row({ status: 'expired' }), 'terminate')).toBe(false);
    expect(isDecisionAllowed(row({ status: 'terminated' }), 'terminate')).toBe(false);
  });

  it('renegotiates (→ suspended) only from active', () => {
    expect(isDecisionAllowed(row({ status: 'active' }), 'renegotiate')).toBe(true);
    expect(isDecisionAllowed(row({ status: 'suspended' }), 'renegotiate')).toBe(false);
    expect(isDecisionAllowed(row({ status: 'expired' }), 'renegotiate')).toBe(false);
  });

  it('targets the documented FSM statuses', () => {
    expect(DECISION_TARGET_STATUS.terminate).toBe('terminated');
    expect(DECISION_TARGET_STATUS.renegotiate).toBe('suspended');
  });
});

describe('buildNoticeLetterRequest', () => {
  it('builds a renewal notice in the active locale', () => {
    const request = buildNoticeLetterRequest(row(), 'renew', 'ar');

    expect(request.contract_type).toBe('service_agreement');
    expect(request.language).toBe('ar');
    expect(request.template_hint).toBe('renewal notice letter');
    expect(request.deal_terms).toMatchObject({
      notice_kind: 'renewal_notice',
      contract_id: 'c-1',
      contract_title: 'Cloud Hosting MSA',
      counterparty: 'Najm Cloud LLC',
      expiry_date: '2026-08-01T00:00:00Z',
      renewal_notice_days: 60,
      auto_renew: true,
    });
  });

  it('maps terminate and renegotiate to their notice kinds', () => {
    expect(buildNoticeLetterRequest(row(), 'terminate', 'en')).toMatchObject({
      language: 'en',
      template_hint: 'termination notice letter',
      deal_terms: expect.objectContaining({ notice_kind: 'termination_notice' }),
    });
    expect(
      buildNoticeLetterRequest(row(), 'renegotiate', 'en').deal_terms.notice_kind,
    ).toBe('renegotiation_notice');
  });
});

describe('noticeDraftToPlainText', () => {
  it('joins title, summary and sections; skips empty parts', () => {
    const draft: LexDraftingContractDraft = {
      title: 'Renewal Notice',
      summary: undefined,
      sections: [
        { heading: 'Subject', body: 'Renewal of the Cloud Hosting MSA.' },
        { heading: 'Term', body: '12 months.' },
      ],
    };

    expect(noticeDraftToPlainText(draft)).toBe(
      'Renewal Notice\n\nSubject\nRenewal of the Cloud Hosting MSA.\n\nTerm\n12 months.',
    );
  });
});
