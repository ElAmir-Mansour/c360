'use client';

import { TriangleAlert } from 'lucide-react';
import Link from 'next/link';

import { useLegalDirectorDashboardLabels } from '@/app/(dashboard)/lex/_lib/role-dashboards/legal-director-i18n';
import { useLexFormat } from '@/lib/lex/ksa';

import { DashboardPrimitiveState } from './dashboard-primitive-state';
import { PanelShell } from './panel-shell';
import { PanelActionLink } from './panel-action-link';
import { ProgressBar } from './progress-bar';
import styles from './escalation-panel.module.css';

export interface EscalationPanelProps {
  levels: { level: 'critical' | 'high' | 'medium'; count: number; href: string }[];
  totalLabel: string;
}

export type EscalationPanelStateProps =
  | { state: 'loading' }
  | { state: 'empty' }
  | { state: 'error'; onRetry: () => void };

function EscalationDataTable({
  levels,
  title,
}: {
  levels: EscalationPanelProps['levels'];
  title: string;
}) {
  const labels = useLegalDirectorDashboardLabels();
  const formatter = useLexFormat();

  return (
    <div
      className="sr-only"
      role="table"
      aria-label={labels.accessibility.chartTable(title)}
      aria-colcount={2}
      aria-rowcount={levels.length + 1}
    >
      <div role="rowgroup">
        <div role="row">
          <span role="columnheader">{labels.accessibility.columns.category}</span>
          <span role="columnheader">{labels.accessibility.columns.count}</span>
        </div>
      </div>
      <div role="rowgroup">
        {levels.map(({ level, count }, index) => (
          <div role="row" key={`${level}-${index}`}>
            <span role="cell">{labels.severity[level]}</span>
            <span role="cell">{formatter.formatNumber(count)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function EscalationPanel({ levels, totalLabel }: EscalationPanelProps) {
  const labels = useLegalDirectorDashboardLabels();
  const formatter = useLexFormat();
  const title = labels.panels.escalations;

  if (levels.length === 0) {
    return (
      <PanelShell title={title} icon={TriangleAlert}>
        <DashboardPrimitiveState state="empty" title={labels.states.escalations.empty} />
      </PanelShell>
    );
  }

  const maxCount = Math.max(...levels.map(({ count }) => count));

  return (
    <PanelShell
      title={title}
      icon={TriangleAlert}
      action={<PanelActionLink href="/lex/inbox" label={labels.actions.viewAll} />}
    >
      <div className={styles.content} dir={formatter.direction}>
        <ul className={styles.list}>
          {levels.map(({ level, count }, index) => {
            const levelLabel = labels.severity[level];
            const formattedCount = formatter.formatNumber(count);

            return (
              <li key={`${level}-${index}`}>
                <Link
                  href={levels[index].href}
                  className={styles.row}
                  aria-label={labels.accessibility.kpiLink(`${levelLabel}: ${formattedCount}`)}
                >
                  <span className={styles.label}>{levelLabel}</span>
                  <div className={styles.progress}>
                    <ProgressBar
                      label={`${levelLabel}: ${formattedCount}`}
                      value={count}
                      max={maxCount}
                      tone={level}
                      size="escalation"
                    />
                  </div>
                  <span className={styles.count}>{formattedCount}</span>
                </Link>
              </li>
            );
          })}
        </ul>
        <p className={styles.total}>{totalLabel}</p>
        <EscalationDataTable levels={levels} title={title} />
      </div>
    </PanelShell>
  );
}

export function EscalationPanelState(props: EscalationPanelStateProps) {
  const labels = useLegalDirectorDashboardLabels();
  const title = labels.panels.escalations;

  return (
    <PanelShell title={title} icon={TriangleAlert}>
      {props.state === 'loading' ? (
        <DashboardPrimitiveState state="loading" label={labels.states.escalations.loading} />
      ) : props.state === 'empty' ? (
        <DashboardPrimitiveState state="empty" title={labels.states.escalations.empty} />
      ) : (
        <DashboardPrimitiveState
          state="error"
          title={labels.states.escalations.error}
          retryLabel={labels.actions.retry}
          onRetry={props.onRetry}
        />
      )}
    </PanelShell>
  );
}
