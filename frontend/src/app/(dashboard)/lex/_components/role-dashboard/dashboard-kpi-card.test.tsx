import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import { DashboardKpiCard } from './dashboard-kpi-card';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/lex',
  useSearchParams: () => new URLSearchParams(),
}));

const datum = (value: number | null) => ({
  value,
  isLoading: false,
  isAvailable: value !== null,
  isError: false,
});

describe('DashboardKpiCard caption tone', () => {
  it('a goodHighPct KPI at 0% reads as a failure (error), never "all clear"', () => {
    renderWithQuery(
      <DashboardKpiCard label="SLA Compliance" datum={datum(0)} format="percent" href="/lex" tone="goodHighPct" />,
    );
    const caption = screen.getByText('Action required');
    // Color must match the (error) meaning — not the zero-value green override.
    expect(caption.className).toContain('text-status-error');
    expect(caption.className).not.toContain('text-status-success');
  });

  it('a badWhenPositive KPI at 0 reads as "all clear" (success)', () => {
    renderWithQuery(
      <DashboardKpiCard label="Pending Approvals" datum={datum(0)} format="count" href="/lex/inbox" tone="badWhenPositive" />,
    );
    const caption = screen.getByText('All clear');
    expect(caption.className).toContain('text-status-success');
  });

  it('a goodHighPct KPI at 95% is on target (success)', () => {
    renderWithQuery(
      <DashboardKpiCard label="SLA Compliance" datum={datum(95)} format="percent" href="/lex" tone="goodHighPct" />,
    );
    const caption = screen.getByText('On target');
    expect(caption.className).toContain('text-status-success');
  });
});
