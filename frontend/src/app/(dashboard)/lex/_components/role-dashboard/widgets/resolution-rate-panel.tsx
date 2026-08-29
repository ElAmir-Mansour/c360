'use client';

import type { CSSProperties } from 'react';
import Link from 'next/link';

import { useLexFormat } from '@/lib/lex/ksa';

import { useLegalDirectorDashboardLabels } from '../../../_lib/role-dashboards/legal-director-i18n';
import { DashboardPrimitiveState } from './dashboard-primitive-state';
import { PanelActionLink } from './panel-action-link';
import { PanelShell } from './panel-shell';
import styles from './resolution-rate-panel.module.css';

export interface ResolutionRateChartProps {
  bars: { label: string; ratePct: number; href: string }[];
}

export interface ResolutionRatePanelErrorProps {
  onRetry: () => void;
}

type ResolutionRateStyle = CSSProperties & {
  '--resolution-rate-visual': string;
};

function visualRate(ratePct: number): number {
  if (!Number.isFinite(ratePct)) return 0;
  return Math.min(Math.max(ratePct, 0), 100);
}

/**
 * Independent per-category rates. Each fill is measured against its own
 * 0–100% track; values are never normalized against the other bars or stacked.
 */
export function ResolutionRateChart({ bars }: ResolutionRateChartProps) {
  const labels = useLegalDirectorDashboardLabels();
  const format = useLexFormat();
  const title = labels.panels.resolutionRate;

  return (
    <div>
      <div
        role="group"
        aria-label={labels.accessibility.chart(title)}
        className={styles.chart}
      >
        {bars.map((bar, index) => {
          const displayRate = format.formatPercent(bar.ratePct, {
            fromPercent: true,
            maximumFractionDigits: 0,
          });
          const style: ResolutionRateStyle = {
            '--resolution-rate-visual': `${visualRate(bar.ratePct)}%`,
          };

          return (
            <Link
              key={`${bar.label}:${index}`}
              href={bar.href}
              className={styles.barGroup}
              data-rate-pct={bar.ratePct}
              aria-label={labels.accessibility.kpiLink(`${bar.label}: ${displayRate}`)}
            >
              <span className={styles.track} aria-hidden="true">
                <span
                  data-resolution-rate-fill=""
                  className={styles.fill}
                  style={style}
                />
              </span>
              <span className={styles.value}>{displayRate}</span>
              <span className={styles.label} dir="auto">
                {bar.label}
              </span>
            </Link>
          );
        })}
      </div>

      <div
        className="sr-only"
        role="table"
        aria-label={labels.accessibility.chartTable(title)}
        aria-colcount={2}
        aria-rowcount={bars.length + 1}
      >
        <div role="rowgroup">
          <div role="row">
            <span role="columnheader">{labels.accessibility.columns.category}</span>
            <span role="columnheader">{labels.accessibility.columns.rate}</span>
          </div>
        </div>
        <div role="rowgroup">
          {bars.map((bar, index) => (
            <div role="row" key={`${bar.label}:${index}`}>
              <span role="rowheader">{bar.label}</span>
              <span role="cell">
                {format.formatPercent(bar.ratePct, {
                  fromPercent: true,
                  maximumFractionDigits: 0,
                })}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Ready/empty Resolution Rate panel. Numeric zero remains ready chart data. */
export function ResolutionRatePanel({ bars }: ResolutionRateChartProps) {
  const labels = useLegalDirectorDashboardLabels();

  return (
    <PanelShell
      title={labels.panels.resolutionRate}
      action={
        <PanelActionLink href="/lex/reports/analytics" label={labels.actions.viewAll} />
      }
    >
      {bars.length === 0 ? (
        <DashboardPrimitiveState
          state="empty"
          title={labels.states.resolutionRate.empty}
        />
      ) : (
        <ResolutionRateChart bars={bars} />
      )}
    </PanelShell>
  );
}

/** Loading companion kept separate so the frozen chart props stay exact. */
export function ResolutionRatePanelLoading() {
  const labels = useLegalDirectorDashboardLabels();

  return (
    <PanelShell title={labels.panels.resolutionRate}>
      <DashboardPrimitiveState
        state="loading"
        label={labels.states.resolutionRate.loading}
      />
    </PanelShell>
  );
}

/** Retryable error companion kept separate from ready chart data. */
export function ResolutionRatePanelError({
  onRetry,
}: ResolutionRatePanelErrorProps) {
  const labels = useLegalDirectorDashboardLabels();

  return (
    <PanelShell title={labels.panels.resolutionRate}>
      <DashboardPrimitiveState
        state="error"
        title={labels.states.resolutionRate.error}
        retryLabel={labels.actions.retry}
        onRetry={onRetry}
      />
    </PanelShell>
  );
}
