import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import type { DRTopologyFailoverSelection } from '@/types/clario-dr';
import { FailoverTargetPanel } from './failover-target-panel';

/**
 * Failover-target ranking panel tests.
 *
 * Proves the panel renders the server-computed selected target + ranked
 * candidates from a REAL {@link DRTopologyFailoverSelection} (eligible /
 * ineligible chips, reason, health), the empty state when no candidates exist,
 * and an Arabic / RTL render. `next/navigation` is globally mocked by the setup.
 */

const selection: DRTopologyFailoverSelection = {
  group_id: 'g1',
  selected: {
    node_id: 'node-recovery',
    site_id: 'site-recovery-2',
    site_name: 'Recovery DC',
    role: 'target',
    edge_id: 'edge-1',
    stream_id: 'stream-1',
    mode: 'async',
    priority: 10,
    health: 'healthy',
    eligible: true,
    lag_seconds: 4,
    applied_seq: 4210,
    reason: 'Within objective and lowest priority among eligible targets.',
  },
  ranking: [
    {
      node_id: 'node-recovery',
      site_id: 'site-recovery-2',
      site_name: 'Recovery DC',
      role: 'target',
      edge_id: 'edge-1',
      stream_id: 'stream-1',
      mode: 'async',
      priority: 10,
      health: 'healthy',
      eligible: true,
      lag_seconds: 4,
      applied_seq: 4210,
      reason: 'Within objective and lowest priority among eligible targets.',
    },
    {
      node_id: 'node-relay',
      site_id: 'site-relay-3',
      site_name: 'Relay DC',
      role: 'relay',
      edge_id: 'edge-2',
      stream_id: 'stream-2',
      mode: 'sync',
      priority: 20,
      health: 'degraded',
      eligible: false,
      lag_seconds: 120,
      applied_seq: 980,
      reason: 'Apply lag exceeds the recovery-point objective.',
    },
  ],
  evaluated_at: '2026-06-14T10:00:05Z',
};

describe('FailoverTargetPanel', () => {
  it('renders the selected target and ranked candidates', () => {
    renderWithQuery(<FailoverTargetPanel selection={selection} />);

    expect(screen.getByText('Selected target')).toBeInTheDocument();
    expect(screen.getAllByText('Recovery DC').length).toBeGreaterThan(0);
    expect(screen.getByText('Relay DC')).toBeInTheDocument();
    expect(screen.getByText('Eligible')).toBeInTheDocument();
    expect(screen.getByText('Ineligible')).toBeInTheDocument();
    expect(
      screen.getByText('Apply lag exceeds the recovery-point objective.'),
    ).toBeInTheDocument();
  });

  it('shows the no-target empty state when there is no ranking', () => {
    renderWithQuery(
      <FailoverTargetPanel
        selection={{ group_id: 'g1', selected: null, ranking: [], evaluated_at: '2026-06-14T10:00:05Z' }}
      />,
    );

    expect(screen.getAllByText('No eligible failover target').length).toBeGreaterThan(0);
  });

  it('renders the full MSA Arabic surface for locale "ar" (RTL)', () => {
    renderWithQuery(<FailoverTargetPanel selection={selection} />, { locale: 'ar' });

    expect(screen.getByText('هدف تجاوز الفشل')).toBeInTheDocument();
    expect(screen.getByText('الهدف المختار')).toBeInTheDocument();
  });
});
