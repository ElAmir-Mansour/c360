import { describe, expect, it } from 'vitest';

import { parseWorkforceReport } from './workforce-contract';

function metric(value: number | null, available = value !== null, reason?: string) {
  return { value, available, ...(reason ? { reason } : {}) };
}

function wireReport() {
  return {
    scope: {
      mode: 'unscoped', entity_ids: [], user_ids: ['user-1'], member_count: 1,
      reason: 'roster_not_configured', warning: 'roster_stale', stale_days: 12,
    },
    period: {
      from: '2026-07-02', to: '2026-07-31', timezone: 'UTC', calendar_source: 'fallback_utc',
      working_days: metric(null, false, 'calendar_unavailable'),
    },
    team: [{
      user_id: 'user-1', display_name: 'Layla', title: { en: 'Counsel', ar: 'مستشارة' },
      identity_status: 'unverified', user_status: 'inactive', linked_count: 2,
      by_domain: [{ domain: 'contracts', rel: 'owner', attribution_path: 'direct', open: 1, resolved: 2 }],
      metrics: {
        active_workload: metric(1), load_index_pct: metric(100),
        utilisation_pct: metric(null, false, 'no_capacity_source'),
        completion_rate_pct: { ...metric(50), numerator: 1, denominator: 2 },
        on_time_pct: metric(null, false, 'aggregation_not_implemented'),
        median_cycle_days: { ...metric(3), sample: 2 },
        approval_latency_hrs: metric(null, false, 'workflow_attribution_undefined'),
        obligation_discharge_pct: metric(100), overdue_count: metric(0),
        idle_assignment_pct: metric(null, false, 'workflow_attribution_undefined'),
      },
    }],
    rollup: {
      distribution_gini: metric(0), key_person_concentration_pct: metric(100),
      backlog_burn_pct: metric(null, false, 'aggregation_contract_undefined'),
      unrouted_requests: metric(0),
      aging: {
        d0_30: metric(1),
        d31_60: metric(0),
        d61_90: metric(null, false, 'partial_data'),
        d90_plus: metric(0),
      },
    },
    coverage: {
      domains_requested: 7, domains_returned: 5, items_total: 59, items_attributed: 36,
      items_unattributed: 23, attribution_pct: 61, rows_returned: 1, rows_truncated: 4,
      exclusions: [{ domain: 'contracts', reason: 'forbidden' }],
    },
    degraded: true,
    errors: [
      { domain: 'contracts', kind: 'forbidden' },
      { domain: 'cases', kind: 'query_error', detail: 'timeout' },
    ],
  };
}

describe('workforce contract mapping', () => {
  it('maps the authoritative snake-case envelope to the camel-case UI boundary', () => {
    const report = parseWorkforceReport(wireReport());

    expect(report.scope).toMatchObject({
      mode: 'unscoped', memberCount: 1, reason: 'roster_not_configured', staleDays: 12,
    });
    expect(report.period.calendarSource).toBe('fallback_utc');
    expect(report.team[0]).toMatchObject({
      userId: 'user-1', displayName: 'Layla', identityStatus: 'unverified', linkedCount: 2,
    });
    expect(report.team[0].metrics.completionRatePct).toMatchObject({
      value: 50, available: true, numerator: 1, denominator: 2,
    });
    expect(report.team[0].byDomain[0].attributionPath).toBe('direct');
    expect(report.rollup.aging).toEqual({
      d0_30: { value: 1, available: true, reason: undefined, numerator: undefined, denominator: undefined, sample: undefined },
      d31_60: { value: 0, available: true, reason: undefined, numerator: undefined, denominator: undefined, sample: undefined },
      d61_90: { value: null, available: false, reason: 'partial_data', numerator: undefined, denominator: undefined, sample: undefined },
      d90_plus: { value: 0, available: true, reason: undefined, numerator: undefined, denominator: undefined, sample: undefined },
    });
    expect(report.coverage).toMatchObject({ attributionPct: 61, rowsTruncated: 4 });
    expect(report.errors.map((error) => error.kind)).toEqual(['forbidden', 'query_error']);
  });

  it('rejects an available metric whose value is null', () => {
    const payload = wireReport();
    payload.period.working_days = { value: null, available: true };

    expect(() => parseWorkforceReport(payload)).toThrow(
      'workforce.period.working_days.value cannot be null when available is true',
    );
  });

  it('rejects an unavailable metric without a reason', () => {
    const payload = wireReport();
    payload.period.working_days = { value: null, available: false };

    expect(() => parseWorkforceReport(payload)).toThrow(
      'workforce.period.working_days.reason is required when available is false',
    );
  });

  it('rejects unknown enum values at the API boundary', () => {
    const payload = wireReport();
    payload.period.calendar_source = 'browser_local';

    expect(() => parseWorkforceReport(payload)).toThrow(
      'workforce.period.calendar_source must be one of: tenant, fallback_utc',
    );
  });

  it('accepts support work attributed through the assignee relation', () => {
    const payload = wireReport();
    payload.team[0].by_domain = [{
      domain: 'support',
      rel: 'assignee',
      attribution_path: 'direct',
      open: 2,
      resolved: 1,
    }];

    expect(parseWorkforceReport(payload).team[0].byDomain[0]).toMatchObject({
      domain: 'support',
      rel: 'assignee',
      open: 2,
      resolved: 1,
    });
  });
});
