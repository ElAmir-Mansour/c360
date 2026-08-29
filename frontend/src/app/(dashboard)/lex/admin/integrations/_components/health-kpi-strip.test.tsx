import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import { HealthKpiStrip } from './health-kpi-strip';
import { labels as integrationsListLabels } from '../_lib/integrations-i18n';
import type { GradeCounts } from '../_lib/health-presentation';

const t = integrationsListLabels.en;

const counts: GradeCounts = {
  total: 7,
  healthy: 3,
  degraded: 2,
  down: 1,
  unconfigured: 1,
  disabled: 0,
};

describe('HealthKpiStrip', () => {
  it('renders a tile per health grade with its tallied value', () => {
    renderWithQuery(<HealthKpiStrip counts={counts} labels={t} />);

    expect(within(screen.getByTestId('health-kpi-total')).getByText(t.kpiTotal)).toBeInTheDocument();
    expect(within(screen.getByTestId('health-kpi-healthy')).getByText(t.kpiHealthy)).toBeInTheDocument();
    expect(within(screen.getByTestId('health-kpi-degraded')).getByText(t.kpiDegraded)).toBeInTheDocument();
    expect(within(screen.getByTestId('health-kpi-down')).getByText(t.kpiDown)).toBeInTheDocument();
    expect(within(screen.getByTestId('health-kpi-unconfigured')).getByText(t.kpiUnconfigured)).toBeInTheDocument();

    expect(within(screen.getByTestId('health-kpi-total')).getByText('7')).toBeInTheDocument();
    expect(within(screen.getByTestId('health-kpi-healthy')).getByText('3')).toBeInTheDocument();
  });

  it('uses the compact operational grid without verbose descriptions', () => {
    renderWithQuery(<HealthKpiStrip counts={counts} labels={t} />);

    const grid = screen.getByTestId('health-kpi-strip');
    expect(grid).toHaveClass(
      'grid-cols-1',
      'gap-3',
      'sm:grid-cols-2',
      'lg:grid-cols-3',
      '2xl:grid-cols-5',
    );
    expect(grid.querySelectorAll('.min-h-40')).toHaveLength(5);
    expect(grid.querySelector('.kpi-card-themed')).toBeNull();
    expect(within(grid).queryByText(t.kpiTotalHint)).not.toBeInTheDocument();
    expect(within(grid).queryByText(t.kpiHealthyHint)).not.toBeInTheDocument();
  });

  it('renders the zero-count legend without crashing', () => {
    const zero: GradeCounts = {
      total: 0,
      healthy: 0,
      degraded: 0,
      down: 0,
      unconfigured: 0,
      disabled: 0,
    };
    renderWithQuery(<HealthKpiStrip counts={zero} labels={t} />);
    // Legend stays visible even at zero so operators see the grade vocabulary.
    expect(within(screen.getByTestId('health-kpi-total')).getByText(t.kpiTotal)).toBeInTheDocument();
  });

  it('renders Arabic labels under the ar locale', () => {
    renderWithQuery(<HealthKpiStrip counts={counts} labels={integrationsListLabels.ar} />);
    expect(
      within(screen.getByTestId('health-kpi-total')).getByText(integrationsListLabels.ar.kpiTotal),
    ).toBeInTheDocument();
  });
});
