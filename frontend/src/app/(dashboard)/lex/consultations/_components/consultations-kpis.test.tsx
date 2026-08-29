import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import { ConsultationsKpis } from './consultations-kpis';
import { resolveConsultationLabels } from './labels';

const labels = resolveConsultationLabels('en');

describe('ConsultationsKpis', () => {
  it('renders all six metrics in one compact responsive grid', () => {
    const { container } = renderWithQuery(
      <ConsultationsKpis
        stats={{
          total: 9,
          open: 9,
          responded: 0,
          approved: 0,
          breachingSoon: 0,
          breached: 0,
        }}
      />,
    );

    const grid = container.querySelector('.consultations-kpi-grid');
    expect(grid).toHaveClass('2xl:grid-cols-6');
    expect(grid?.children).toHaveLength(6);

    for (const label of [
      labels.stats.total,
      labels.stats.open,
      labels.stats.responded,
      labels.stats.approved,
      labels.stats.breachingSoon,
      labels.stats.breached,
    ]) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
  });

  it('keeps SLA metrics keyboard-operable filters', () => {
    const onSlaTileClick = vi.fn();
    renderWithQuery(
      <ConsultationsKpis
        stats={{
          total: 9,
          open: 6,
          responded: 2,
          approved: 1,
          breachingSoon: 1,
          breached: 0,
        }}
        activeSlaRisk="due_soon"
        onSlaTileClick={onSlaTileClick}
      />,
    );

    const filters = screen.getAllByRole('button');
    expect(filters).toHaveLength(2);
    expect(filters[0]).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(filters[0]);
    expect(onSlaTileClick).toHaveBeenCalledWith(null);
    fireEvent.click(filters[1]);
    expect(onSlaTileClick).toHaveBeenLastCalledWith('breached');
  });
});
