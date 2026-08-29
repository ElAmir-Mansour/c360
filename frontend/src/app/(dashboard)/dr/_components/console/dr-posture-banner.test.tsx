import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import type {
  DRPosture,
  DRRansomwareSignal,
  DRReplicationSummary,
} from '@/types/clario-dr';

// next/navigation is consumed transitively by anything under (dashboard)/dr.
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    prefetch: vi.fn(),
    refresh: vi.fn(),
  }),
  usePathname: () => '/dr',
  useSearchParams: () => new URLSearchParams(''),
}));

// Controllable query-hook return values, swapped per test.
const postureRef: { current: { data: DRPosture | undefined; isLoading: boolean } } = {
  current: { data: undefined, isLoading: false },
};
const replicationRef: {
  current: { data: DRReplicationSummary | undefined; isLoading: boolean };
} = { current: { data: undefined, isLoading: false } };
const ransomwareRef: {
  current: { data: DRRansomwareSignal[] | undefined; isLoading: boolean };
} = { current: { data: undefined, isLoading: false } };

vi.mock('@/app/(dashboard)/dr/_hooks/use-dr-queries', () => ({
  useDRPosture: () => postureRef.current,
  useDRReplicationSummary: () => replicationRef.current,
  useDRRansomwareSignals: () => ransomwareRef.current,
}));

import { DRPostureBanner } from './dr-posture-banner';

const POSTURE: DRPosture = {
  generated_at: '2026-06-15T08:00:00Z',
  overall_health: 'healthy',
  site_count: 3,
  group_count: 4,
  stream_count: 6,
  recovery_point_count: 18,
  streams_by_status: { streaming: 6 },
  worst_live_rpo: {
    stream_id: 'stream-1',
    site_id: 'site-1',
    site_name: 'Riyadh DR',
    site_kind: 'recovery',
    status: 'streaming',
    health: 'healthy',
    applied_seq: 42,
    has_data: true,
    breaches_rpo: false,
    rpo_seconds: 45,
    rpo_objective_seconds: 300,
    measured_at: '2026-06-15T08:00:00Z',
  },
  rpo_breaches: [],
  attention: [],
  groups: [],
  recent_runs: [
    {
      run_id: 'run-1',
      group_id: 'g1',
      mode: 'drill',
      status: 'completed',
      rto_objective_seconds: 900,
      rto_actual_seconds: 600,
      met_rto: true,
      initiated_at: '2026-06-10T08:00:00Z',
      completed_at: '2026-06-10T08:30:00Z',
    },
  ],
};

const REPLICATION: DRReplicationSummary = {
  generated_at: '2026-06-15T08:00:00Z',
  overall_health: 'healthy',
  total_streams: 6,
  streams_by_status: { streaming: 6 },
  worst_live_rpo: null,
  rpo_breaches: [],
  streams: [],
};

beforeEach(() => {
  postureRef.current = { data: undefined, isLoading: false };
  replicationRef.current = { data: undefined, isLoading: false };
  ransomwareRef.current = { data: undefined, isLoading: false };
});

describe('DRPostureBanner', () => {
  it('renders the five KPI tiles from a real DRPosture payload', () => {
    postureRef.current = { data: POSTURE, isLoading: false };
    replicationRef.current = { data: REPLICATION, isLoading: false };
    ransomwareRef.current = { data: [], isLoading: false };

    renderWithQuery(<DRPostureBanner />);

    // The five labelled KPI tiles are all present.
    expect(screen.getByText('Overall health')).toBeInTheDocument();
    expect(screen.getByText('Worst live RPO')).toBeInTheDocument();
    expect(screen.getByText('Protected groups')).toBeInTheDocument();
    expect(screen.getByText('Last drill verdict')).toBeInTheDocument();
    expect(screen.getByText('Ransomware signals')).toBeInTheDocument();

    // Values derived from the payload.
    expect(screen.getAllByText('Healthy').length).toBeGreaterThan(0); // overall health tile
    expect(screen.getByText('4')).toBeInTheDocument(); // protected groups = group_count
    expect(screen.getByText('Passed')).toBeInTheDocument(); // completed drill, met_rto=true
    expect(screen.getByText('45s')).toBeInTheDocument(); // worst live RPO formatted
    // Footer detail line is rendered from real counts.
    expect(screen.getByText('3 protected sites')).toBeInTheDocument();
    expect(screen.getByText('18 recovery points')).toBeInTheDocument();
  });

  it('surfaces the highest-severity ransomware signal', () => {
    postureRef.current = { data: POSTURE, isLoading: false };
    replicationRef.current = { data: REPLICATION, isLoading: false };
    ransomwareRef.current = {
      data: [
        {
          id: 'sig-low',
          tenant_id: 't1',
          stream_id: 'stream-1',
          kind: 'entropy_spike',
          severity: 'low',
          observed: 10,
          baseline: 2,
          ratio: 5,
          threshold: 3,
          sample_seq: 11,
          detail: 'low entropy anomaly',
          observed_at: '2026-06-15T07:00:00Z',
          created_at: '2026-06-15T07:00:00Z',
        },
        {
          id: 'sig-crit',
          tenant_id: 't1',
          stream_id: 'stream-1',
          kind: 'mass_encrypt',
          severity: 'critical',
          observed: 99,
          baseline: 2,
          ratio: 49,
          threshold: 3,
          sample_seq: 12,
          detail: 'mass encryption detected',
          observed_at: '2026-06-15T07:30:00Z',
          created_at: '2026-06-15T07:30:00Z',
        },
      ],
      isLoading: false,
    };

    renderWithQuery(<DRPostureBanner />);

    // Two signals total -> tile value of "2".
    expect(screen.getByText('2')).toBeInTheDocument();
    // The worst (critical) signal drives the footer detail line.
    expect(screen.getByText(/Critical · mass_encrypt/)).toBeInTheDocument();
  });

  it('shows an empty/no-data state when all queries are undefined', () => {
    // All refs left undefined (default from beforeEach).
    const { container } = renderWithQuery(<DRPostureBanner />);

    // No posture data -> 'n/a' shown in both the readiness score box and the
    // worst-RPO tile (rpoTile(null)).
    expect(screen.getAllByText('n/a').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('No posture data')).toBeInTheDocument();
    // Falls back to the 'Empty' health label and zeroed counts.
    expect(screen.getByText('Empty')).toBeInTheDocument();
    expect(screen.getByText('No drills yet')).toBeInTheDocument();
    expect(screen.getByText('0 protected sites')).toBeInTheDocument();
    // The card root is still rendered (no crash on undefined data).
    expect(container.querySelector('[aria-label="Disaster-recovery posture"]')).toBeTruthy();
  });

  it('marks the banner busy while every query is loading with no data', () => {
    postureRef.current = { data: undefined, isLoading: true };
    replicationRef.current = { data: undefined, isLoading: true };
    ransomwareRef.current = { data: undefined, isLoading: true };

    const { container } = renderWithQuery(<DRPostureBanner />);

    expect(
      container.querySelector('[aria-label="Disaster-recovery posture"][aria-busy="true"]'),
    ).toBeTruthy();
  });
});
