import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import { RPOIndicator } from './rpo-indicator';
import { recoveryDashboardLabelsEn, sampleStreams } from './dashboard.gallery';

const labels = recoveryDashboardLabelsEn.rpo;

describe('RPOIndicator', () => {
  it('flags an RPO breach from the real stream contract (breaches_rpo)', () => {
    const breaching = sampleStreams[2]; // Dammam Vault: 312s vs 120s objective, breaches_rpo: true
    renderWithQuery(
      <RPOIndicator
        rpoSeconds={breaching.rpo_seconds}
        objectiveSeconds={breaching.rpo_objective_seconds}
        lagSeconds={breaching.lag_seconds}
        breachesRpo={breaching.breaches_rpo}
        labels={labels}
      />,
    );

    expect(screen.getByText('Breached')).toBeInTheDocument();
    // 312s -> "5m 12s", objective 120s -> "2m"
    expect(screen.getByText('5m 12s')).toBeInTheDocument();
    const meter = screen.getByRole('meter', { name: labels.title });
    expect(meter).toHaveAttribute('aria-valuetext', '5m 12s / 2m');
  });

  it('shows within-objective for a healthy stream', () => {
    const healthy = sampleStreams[0]; // Riyadh Primary: 18s vs 60s objective
    renderWithQuery(
      <RPOIndicator
        rpoSeconds={healthy.rpo_seconds}
        objectiveSeconds={healthy.rpo_objective_seconds}
        lagSeconds={healthy.lag_seconds}
        breachesRpo={healthy.breaches_rpo}
        labels={labels}
      />,
    );

    expect(screen.getByText('Within objective')).toBeInTheDocument();
    expect(screen.getByText('18s')).toBeInTheDocument();
  });

  it('hides the lag row in compact mode', () => {
    renderWithQuery(
      <RPOIndicator rpoSeconds={18} objectiveSeconds={60} lagSeconds={12} compact labels={labels} />,
    );
    expect(screen.queryByText(labels.lag)).not.toBeInTheDocument();
  });
});
