import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { HealthSparkline } from './health-sparkline';
import type { HealthCheckRecord } from '@/lib/lex/integrations';
import { integrationsLabels } from '../_lib/integrations-i18n';

const t = integrationsLabels('en');

function record(over: Partial<HealthCheckRecord> = {}): HealthCheckRecord {
  return {
    grade: 'healthy',
    reachable: true,
    detail: 'ok',
    checked_at: '2026-06-20T10:00:00Z',
    ...over,
  };
}

describe('HealthSparkline', () => {
  it('renders a no-history hint when the series is empty', () => {
    render(<HealthSparkline history={[]} labels={t} />);
    expect(screen.getByText(t.uptimeNoHistory)).toBeInTheDocument();
  });

  it('renders a single point gracefully with an accessible uptime label', () => {
    render(<HealthSparkline history={[record()]} labels={t} />);
    // role=img with an aria-label describing uptime (a11y smoke).
    const strip = screen.getByRole('img');
    expect(strip).toHaveAttribute('aria-label');
    expect(strip.getAttribute('aria-label')).toContain('100');
  });

  it('flags a degrade when the latest probe is worse than the prior one', () => {
    render(
      <HealthSparkline
        history={[
          record({ checked_at: '2026-06-20T10:00:00Z', grade: 'healthy' }),
          record({ checked_at: '2026-06-20T11:00:00Z', grade: 'down', reachable: false }),
        ]}
        labels={t}
      />,
    );
    expect(screen.getByText(t.degrading)).toBeInTheDocument();
  });

  it('renders a shimmer placeholder while loading', () => {
    render(<HealthSparkline history={[]} labels={t} loading />);
    expect(screen.getByTestId('health-sparkline-loading')).toBeInTheDocument();
  });

  it('renders unavailable copy when the history read is degraded', () => {
    render(<HealthSparkline history={[]} labels={t} degraded />);
    expect(screen.getByText(t.healthUnavailableTitle)).toBeInTheDocument();
    expect(screen.queryByText(t.uptimeNoHistory)).not.toBeInTheDocument();
  });
});
