'use client';

import { ListChecks } from 'lucide-react';
import Link from 'next/link';

import { useLegalDirectorDashboardLabels } from '@/app/(dashboard)/lex/_lib/role-dashboards/legal-director-i18n';
import { managerTasksCopy } from '@/app/(dashboard)/lex/tasks/_lib/labels';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { useLexFormat } from '@/lib/lex/ksa';
import type { ManagerTaskStatus } from '@/lib/lex/manager-tasks';

import { DashboardPrimitiveState } from './dashboard-primitive-state';
import { PanelShell } from './panel-shell';
import { PanelActionLink } from './panel-action-link';
import styles from './manager-tasks-panel.module.css';

/**
 * One row of the Task Management module. Deliberately a flat presentation shape:
 * the caller resolves the assignee's display name (which needs a cross-database
 * platform_core lookup) so this widget never has to know that identities live in
 * a different database from tasks.
 */
export interface ManagerTaskRow {
  id: string;
  title: string;
  assigneeName: string;
  status: ManagerTaskStatus;
  updatedAt: string;
}

export interface ManagerTasksPanelProps {
  rows: ManagerTaskRow[];
  /**
   * Counts across the caller's WHOLE visible board, not just `rows`. The panel
   * shows a truncated list, so deriving the summary from `rows` would silently
   * under-report — the same trap `CoverageReport.RowsTruncated` guards against
   * on the workforce report.
   */
  summary: { awaitingReview: number; inProgress: number; total: number };
  /**
   * True when the caller sees the whole tenant's board (director/admin) rather
   * than only tasks they created or received. Drives the scope caption so a
   * section manager never reads their slice as the department total.
   */
  hasOversight: boolean;
}

export type ManagerTasksPanelStateProps =
  | { state: 'loading' }
  | { state: 'empty' }
  | { state: 'error'; onRetry: () => void };

/** Statuses that read as "needs someone to act", used for row emphasis only. */
const ACTIONABLE: ReadonlySet<ManagerTaskStatus> = new Set([
  'submitted',
  'correction_required',
]);

function ManagerTasksDataTable({
  rows,
  title,
  statusLabel,
}: {
  rows: ManagerTaskRow[];
  title: string;
  statusLabel: (status: ManagerTaskStatus) => string;
}) {
  const labels = useLegalDirectorDashboardLabels();

  return (
    <div
      className="sr-only"
      role="table"
      aria-label={labels.accessibility.chartTable(title)}
      aria-colcount={3}
      aria-rowcount={rows.length + 1}
    >
      <div role="rowgroup">
        <div role="row">
          <span role="columnheader">{labels.managerTasks.columns.task}</span>
          <span role="columnheader">{labels.managerTasks.columns.assignee}</span>
          <span role="columnheader">{labels.managerTasks.columns.status}</span>
        </div>
      </div>
      <div role="rowgroup">
        {rows.map((row) => (
          <div role="row" key={row.id}>
            <span role="cell">{row.title}</span>
            <span role="cell">{row.assigneeName}</span>
            <span role="cell">{statusLabel(row.status)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ManagerTasksPanel({ rows, summary, hasOversight }: ManagerTasksPanelProps) {
  const labels = useLegalDirectorDashboardLabels();
  const formatter = useLexFormat();
  const { locale } = useLocaleOrDefault();
  const copy = managerTasksCopy(locale);
  const title = labels.panels.managerTasks;
  const statusLabel = (status: ManagerTaskStatus) => copy.status[status];

  if (rows.length === 0) {
    return (
      <PanelShell title={title} icon={ListChecks}>
        <DashboardPrimitiveState state="empty" title={labels.states.managerTasks.empty} />
      </PanelShell>
    );
  }

  return (
    <PanelShell
      title={title}
      icon={ListChecks}
      description={
        hasOversight ? labels.managerTasks.scopeTenant : labels.managerTasks.scopeOwn
      }
      action={<PanelActionLink href="/lex/tasks" label={labels.actions.viewAll} />}
    >
      <div className={styles.content} dir={formatter.direction}>
        <p className={styles.summary}>
          {labels.managerTasks.summary(
            formatter.formatNumber(summary.awaitingReview),
            formatter.formatNumber(summary.inProgress),
            formatter.formatNumber(summary.total),
          )}
        </p>
        <ul className={styles.list}>
          {rows.map((row) => (
            <li key={row.id}>
              <Link
                href="/lex/tasks"
                className={styles.row}
                data-actionable={ACTIONABLE.has(row.status) ? '' : undefined}
                aria-label={labels.accessibility.kpiLink(
                  `${row.title} — ${row.assigneeName}: ${statusLabel(row.status)}`,
                )}
              >
                <span className={styles.main}>
                  <span className={styles.title} dir="auto">
                    {row.title}
                  </span>
                  <span className={styles.assignee} dir="auto">
                    {copy.list.assignedTo}: {row.assigneeName}
                  </span>
                </span>
                <span className={styles.status} data-status={row.status}>
                  {statusLabel(row.status)}
                </span>
                <span className={styles.updated}>{formatter.formatRelative(row.updatedAt)}</span>
              </Link>
            </li>
          ))}
        </ul>
        <ManagerTasksDataTable rows={rows} title={title} statusLabel={statusLabel} />
      </div>
    </PanelShell>
  );
}

export function ManagerTasksPanelState(props: ManagerTasksPanelStateProps) {
  const labels = useLegalDirectorDashboardLabels();
  const title = labels.panels.managerTasks;

  return (
    <PanelShell title={title} icon={ListChecks}>
      {props.state === 'loading' ? (
        <DashboardPrimitiveState state="loading" label={labels.states.managerTasks.loading} />
      ) : props.state === 'empty' ? (
        <DashboardPrimitiveState state="empty" title={labels.states.managerTasks.empty} />
      ) : (
        <DashboardPrimitiveState
          state="error"
          title={labels.states.managerTasks.error}
          retryLabel={labels.actions.retry}
          onRetry={props.onRetry}
        />
      )}
    </PanelShell>
  );
}
