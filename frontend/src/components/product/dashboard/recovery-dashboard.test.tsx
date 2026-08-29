import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import { RecoveryDashboard } from './recovery-dashboard';
import {
  recoveryDashboardLabelsEn,
  sampleActiveRun,
  sampleAnalytics,
  sampleGroupSummary,
  sampleRecoveryPoint,
  sampleStreams,
} from './dashboard.gallery';

const here = dirname(fileURLToPath(import.meta.url));

describe('RecoveryDashboard', () => {
  it('renders header KPIs and the live recovery status from the real group summary', () => {
    renderWithQuery(
      <RecoveryDashboard
        summary={sampleGroupSummary}
        activeRun={sampleActiveRun}
        streams={sampleStreams}
        recoveryPoint={sampleRecoveryPoint}
        analyticsData={sampleAnalytics}
        elapsedSeconds={295}
        labels={recoveryDashboardLabelsEn}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Najd Sovereign Core' })).toBeInTheDocument();
    // Replication percent KPI off DRGroupSummary.replication_percent.
    expect(screen.getByText('91%')).toBeInTheDocument();
    // The in-flight run's gate progress (AWAITING_APPROVAL).
    expect(
      screen.getByRole('meter', { name: recoveryDashboardLabelsEn.runProgressTitle }),
    ).toHaveAttribute('aria-valuenow', '25');
  });

  it('surfaces the breaching focus stream in the RPO indicator', () => {
    renderWithQuery(
      <RecoveryDashboard
        summary={sampleGroupSummary}
        activeRun={sampleActiveRun}
        streams={sampleStreams}
        recoveryPoint={sampleRecoveryPoint}
        labels={recoveryDashboardLabelsEn}
      />,
    );

    // The worst stream (Dammam Vault, breaches_rpo) drives the RPO widget.
    const rpoMeter = screen.getByRole('meter', { name: recoveryDashboardLabelsEn.rpo.title });
    expect(rpoMeter).toHaveAttribute('aria-valuetext', '5m 12s / 2m');
  });

  it('shows the recovery-point validation ratio and legal-hold pill', () => {
    renderWithQuery(
      <RecoveryDashboard
        summary={sampleGroupSummary}
        activeRun={sampleActiveRun}
        recoveryPoint={sampleRecoveryPoint}
        labels={recoveryDashboardLabelsEn}
      />,
    );

    expect(screen.getByText('97%')).toBeInTheDocument();
    expect(screen.getByText('Legal hold')).toBeInTheDocument();
    expect(screen.getByText('Validated')).toBeInTheDocument();
  });

  it('renders the analytics chart via a dynamic import (no static recharts in the base render)', () => {
    renderWithQuery(
      <RecoveryDashboard
        summary={sampleGroupSummary}
        activeRun={sampleActiveRun}
        analyticsData={sampleAnalytics}
        labels={recoveryDashboardLabelsEn}
      />,
    );

    // The dynamic wrapper renders its lightweight loading placeholder synchronously;
    // recharts is only fetched lazily when the impl chunk resolves.
    const analyticsCard = screen.getByText(recoveryDashboardLabelsEn.analyticsTitle).closest('div');
    expect(analyticsCard).toBeTruthy();
    expect(screen.getByTestId('recovery-analytics-chart-loading')).toBeInTheDocument();
  });

  it('keeps recharts out of the chart WRAPPER module (lazy-loaded only via next/dynamic)', () => {
    // The wrapper file must not statically import recharts — it goes through
    // next/dynamic, so recharts lives only in the *-impl chunk.
    const wrapperSource = readFileSync(join(here, 'recovery-analytics-chart.tsx'), 'utf8');
    expect(wrapperSource).toContain("import dynamic from 'next/dynamic'");
    expect(wrapperSource).not.toMatch(/from ['"]recharts['"]/);
    expect(wrapperSource).toContain("import('./recovery-analytics-chart-impl')");
  });

  it('falls back to an empty state when no run is in flight', () => {
    renderWithQuery(
      <RecoveryDashboard summary={sampleGroupSummary} recentRuns={[]} labels={recoveryDashboardLabelsEn} />,
    );
    expect(screen.getByText('No recovery run in flight')).toBeInTheDocument();
  });

  it('renders all KPI tiles in the strip', () => {
    const { container } = renderWithQuery(
      <RecoveryDashboard
        summary={sampleGroupSummary}
        activeRun={sampleActiveRun}
        labels={recoveryDashboardLabelsEn}
      />,
    );
    // The dashboard renders within a single root region.
    expect(within(container).getByText('Members')).toBeInTheDocument();
    expect(within(container).getByText('Streams')).toBeInTheDocument();
  });
});
