import { describe, it, expect } from 'vitest';
import {
  RECOVER_ANALYTICS_ENDPOINT,
  RECOVER_ANALYTICS_QUERY_KEY,
} from './analytics';
import type { RecoverAnalytics } from '@/types/recover-analytics';

describe('recover analytics client contract', () => {
  it('binds the REAL analytics endpoint (no placeholder)', () => {
    // Matches RECOVER_ANALYTICS_CONTRACT.md and the backend route registration.
    expect(RECOVER_ANALYTICS_ENDPOINT).toBe('/api/recover/analytics');
  });

  it('exposes a stable react-query key', () => {
    expect(RECOVER_ANALYTICS_QUERY_KEY).toEqual(['recover', 'analytics']);
  });

  it('the analytics shape carries per-application RTO-vs-RTA and the portfolio rollups', () => {
    // A compile-time + structural conformance check against the published shape.
    const sample: RecoverAnalytics = {
      portfolio_readiness: 72,
      progress: {
        total_applications: 2,
        recovered: 1,
        at_risk: 1,
        untested: 0,
        in_progress: 0,
        completion_ratio: 0.5,
      },
      applications: [
        {
          application_id: 'a1',
          app_key: 'core-banking',
          name: 'Core Banking',
          recovery_tier: 'mission_critical',
          rto_target_seconds: 600,
          latest_rta_seconds: 900,
          rta_breach: true,
          breach_seconds: 300,
          execution_count: 1,
          success_count: 1,
          readiness: 50,
          events: [
            {
              event_id: 'e1',
              source: 'runbook_run',
              mode: 'rehearsal',
              status: 'completed',
              succeeded: true,
              rta_actual_seconds: 900,
              started_at: '2026-06-29T00:00:00Z',
            },
          ],
        },
      ],
      bottlenecks: [
        {
          kind: 'rto_breach',
          application_id: 'a1',
          app_key: 'core-banking',
          label: 'Core Banking missed its RTO target',
          detail: 'latest recovery took 900s vs a 600s target (300s over)',
          severity: 0.8,
        },
      ],
      readiness_trend: [
        { score: 72, application_count: 2, breaching_count: 1, captured_at: '2026-06-29T00:00:00Z' },
      ],
      generated_at: '2026-06-29T00:00:00Z',
    };

    const app = sample.applications[0];
    expect(app.rta_breach).toBe(true);
    expect(app.latest_rta_seconds! - app.rto_target_seconds).toBe(app.breach_seconds);
    expect(sample.bottlenecks[0].kind).toBe('rto_breach');
    expect(sample.readiness_trend[0].score).toBe(sample.portfolio_readiness);
  });
});
