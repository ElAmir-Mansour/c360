import { fireEvent, render, screen } from '@testing-library/react';
import { Activity } from 'lucide-react';
import { describe, expect, it, vi } from 'vitest';

import { LexKpiStrip } from './kpi-strip';

describe('LexKpiStrip operational appearance', () => {
  it('defaults to a dense balanced grid with flat medium tiles and no descriptions', () => {
    const { container } = render(
      <LexKpiStrip
        columns={6}
        items={Array.from({ length: 6 }, (_, index) => ({
          id: String(index),
          label: `Metric ${index + 1}`,
          value: index + 1,
          icon: Activity,
          theme: 'teal',
          description: `Long explanation ${index + 1}`,
          href: `/metrics/${index + 1}`,
        }))}
      />,
    );

    expect(container.firstChild).toHaveClass('gap-3', 'sm:grid-cols-2', 'lg:grid-cols-3', '2xl:grid-cols-6');
    expect(container.querySelectorAll('.min-h-40')).toHaveLength(6);
    expect(container.querySelectorAll('.kpi-card-themed')).toHaveLength(0);
    expect(screen.queryByText('Long explanation 1')).not.toBeInTheDocument();
  });

  it('forwards item interaction state to the accessible card wrapper', () => {
    const onAction = vi.fn();
    render(
      <LexKpiStrip
        items={[
          {
            label: 'Overdue',
            value: 4,
            onAction,
            pressed: true,
          },
        ]}
      />,
    );

    const button = screen.getByRole('button', { name: /Overdue/ });
    expect(button).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(button);
    expect(onAction).toHaveBeenCalledOnce();
  });

  it('explains what each statistic represents and accepts a contextual hint', () => {
    render(
      <LexKpiStrip
        items={[
          {
            label: 'Open cases',
            value: 12,
            href: '/lex/cases?status=open',
          },
          {
            label: 'SLA compliance',
            value: '94%',
            hint: 'Requests completed within their configured SLA during this period',
            href: '/lex/service-desk?view=sla',
          },
        ]}
      />,
    );

    expect(screen.getByText('Open cases').closest('[title]')).toHaveAttribute(
      'title',
      'Open cases — open the records contributing to this statistic',
    );
    expect(screen.getByText('SLA compliance').closest('[title]')).toHaveAttribute(
      'title',
      'Requests completed within their configured SLA during this period',
    );
  });

  it('derives a five-column maximum for five operational items', () => {
    const { container } = render(
      <LexKpiStrip
        items={Array.from({ length: 5 }, (_, index) => ({
          id: String(index),
          label: `Metric ${index + 1}`,
          value: index + 1,
          href: `/metrics/${index + 1}`,
        }))}
      />,
    );

    expect(container.firstChild).toHaveClass('gap-3', 'sm:grid-cols-2', 'lg:grid-cols-3', '2xl:grid-cols-5');
    expect(container.firstChild).not.toHaveClass('2xl:grid-cols-6');
  });

  it('retains the legacy elevated layout when explicitly requested', () => {
    const { container } = render(
      <LexKpiStrip
        appearance="default"
        items={[
          {
            label: 'Legacy metric',
            value: 8,
            description: 'Supporting context',
            href: '/metrics/legacy',
          },
        ]}
      />,
    );

    expect(container.firstChild).toHaveClass('gap-4');
    expect(container.querySelector('.kpi-card-themed')).toBeInTheDocument();
    expect(screen.getByText('Supporting context')).toBeInTheDocument();
  });
});
