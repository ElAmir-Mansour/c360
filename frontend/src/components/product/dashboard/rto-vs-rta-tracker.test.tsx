import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import { RTOvsRTATracker } from './rto-vs-rta-tracker';
import { recoveryDashboardLabelsEn } from './dashboard.gallery';

const labels = recoveryDashboardLabelsEn.rto;

describe('RTOvsRTATracker', () => {
  it('shows the breach state when actual exceeds the objective', () => {
    renderWithQuery(
      <RTOvsRTATracker objectiveSeconds={900} actualSeconds={1_110} labels={labels} />,
    );

    // Status pill announces the breach as text (not colour-only).
    expect(screen.getByText('Breached')).toBeInTheDocument();
    // The overrun delta is computed from real RTO/RTA seconds: 1110 - 900 = 210s = 3m 30s.
    expect(screen.getByText('3m 30s over target')).toBeInTheDocument();
    // The meter exposes the breach via an accessible value text.
    const meter = screen.getByRole('meter', { name: labels.title });
    expect(meter).toHaveAttribute('aria-valuetext', '18m 30s / 15m');
  });

  it('shows on-target when a sealed actual is within the objective', () => {
    renderWithQuery(
      <RTOvsRTATracker objectiveSeconds={900} actualSeconds={620} labels={labels} />,
    );

    expect(screen.getByText('On target')).toBeInTheDocument();
    // remaining = 900 - 620 = 280s = 4m 40s
    expect(screen.getByText('4m 40s to spare')).toBeInTheDocument();
  });

  it('projects at-risk from live elapsed before an actual is sealed', () => {
    renderWithQuery(
      <RTOvsRTATracker objectiveSeconds={600} elapsedSeconds={640} labels={labels} />,
    );

    expect(screen.getByText('At risk')).toBeInTheDocument();
  });

  it('renders the not-started state when no measurement exists', () => {
    renderWithQuery(<RTOvsRTATracker objectiveSeconds={900} labels={labels} />);
    expect(screen.getAllByText('Not started').length).toBeGreaterThan(0);
  });
});
