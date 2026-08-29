import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import { IntakeKpis } from './_intake-kpis';

describe('IntakeKpis', () => {
  it('renders three compact operational cards without explanatory copy', () => {
    const { container } = renderWithQuery(
      <IntakeKpis
        stats={{ pending: 3, processed: 2, errored: 1 }}
        loadedCount={6}
        loading={false}
      />,
    );

    const grid = container.firstElementChild;
    expect(grid).toHaveClass('grid-cols-2', 'gap-3', 'lg:grid-cols-3');
    expect(grid?.children).toHaveLength(3);
    expect(container.querySelectorAll('.kpi-card-themed')).toHaveLength(0);
    expect(screen.queryByText('Messages waiting for triage.')).not.toBeInTheDocument();
    expect(screen.getByText('Loaded messages')).toBeInTheDocument();
  });

  it('keeps Arabic labels and Arabic-Indic values', () => {
    renderWithQuery(
      <IntakeKpis
        stats={{ pending: 3, processed: 2, errored: 1 }}
        loadedCount={6}
        loading={false}
      />,
      { locale: 'ar' },
    );

    expect(screen.getByText('معلّقة')).toBeInTheDocument();
    expect(screen.getByText('٣')).toBeInTheDocument();
  });
});

