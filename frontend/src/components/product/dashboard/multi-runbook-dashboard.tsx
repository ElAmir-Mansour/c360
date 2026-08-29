'use client';

import * as React from 'react';
import { ChevronRight, LayoutGrid, ListTree, ServerCog } from 'lucide-react';
import { cn } from '@/lib/utils';
import { MetricTile } from '@/components/shared/metric-tile';
import { StatusChip } from '@/components/shared/status-chip';
import { EmptyState } from '@/components/common/empty-state';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { DRFailoverRun } from '@/lib/clario-dr';
import { RunbookProgressBar, type RunbookGate } from './runbook-progress-bar';
import {
  evaluateRto,
  formatDuration,
  isRunActive,
  isTerminalFailure,
  toneForRunStatus,
  toPercent,
} from './recovery-utils';

/**
 * MultiRunbookDashboard
 * =====================
 * Manage multiple concurrent recovery events from one screen. Renders a list of
 * active/recent failover runs with status, gate progress, and RTO-vs-RTA, plus a
 * drill-down: selecting a run fires `onSelectRun(run)`.
 *
 * Typed to the real `DRFailoverRun[]` list shape (`fetchDRFailoverRuns`). Each
 * row exposes `group_id`, `mode`, `status`, `rto_objective_seconds`,
 * `rto_actual_seconds`, and timestamps — no invented fields.
 *
 * Responsive per WCAG 1.4.10: a semantic data table on >=640px, and a stacked
 * card list on small screens (the same rows, no horizontal scroll). Token-driven,
 * light/dark, RTL-ready, bilingual via `labels`.
 */

export interface MultiRunbookDashboardLabels {
  title: string;
  subtitle: string;
  /** Summary tiles. */
  activeRuns: string;
  breachedRuns: string;
  totalRuns: string;
  /** Table column headers. */
  colRun: string;
  colGroup: string;
  colMode: string;
  colStatus: string;
  colProgress: string;
  colRto: string;
  colAction: string;
  /** Per-row. */
  rtoObjectivePrefix: string;
  selectRunLabel: string;
  empty: string;
  emptyDescription: string;
  gates: { validate: string; approve: string; execute: string; attest: string };
  gateStateLabels: {
    done: string;
    current: string;
    awaitingApproval: string;
    failed: string;
    pending: string;
  };
  /** Status pill text keyed by upper-case status; falls back to raw status. */
  runStatusLabels?: Record<string, string>;
  /** Mode pill text keyed by lower-case mode; falls back to raw mode. */
  modeLabels?: Record<string, string>;
  naLabel?: string;
}

export interface MultiRunbookDashboardProps {
  /** Failover-run list from `fetchDRFailoverRuns`. */
  runs: DRFailoverRun[];
  /** Drill-down: invoked with the selected run. */
  onSelectRun?: (run: DRFailoverRun) => void;
  /** Currently selected run id (drives row highlight + aria-current). */
  selectedRunId?: string | null;
  /** When true, sort active (in-flight) runs to the top. Default true. */
  activeFirst?: boolean;
  labels: MultiRunbookDashboardLabels;
  className?: string;
}

const FAILOVER_GATES = (labels: MultiRunbookDashboardLabels): RunbookGate[] => [
  { key: 'validate', label: labels.gates.validate },
  { key: 'approve', label: labels.gates.approve },
  { key: 'execute', label: labels.gates.execute },
  { key: 'attest', label: labels.gates.attest },
];

function sortRuns(runs: DRFailoverRun[], activeFirst: boolean): DRFailoverRun[] {
  return [...runs].sort((a, b) => {
    if (activeFirst) {
      const aActive = isRunActive(a.status);
      const bActive = isRunActive(b.status);
      if (aActive !== bActive) return aActive ? -1 : 1;
    }
    return new Date(b.initiated_at).getTime() - new Date(a.initiated_at).getTime();
  });
}

export function MultiRunbookDashboard({
  runs,
  onSelectRun,
  selectedRunId = null,
  activeFirst = true,
  labels,
  className,
}: MultiRunbookDashboardProps) {
  const naLabel = labels.naLabel ?? 'n/a';
  const gates = React.useMemo(() => FAILOVER_GATES(labels), [labels]);
  const ordered = React.useMemo(() => sortRuns(runs, activeFirst), [runs, activeFirst]);

  const activeCount = ordered.filter((run) => isRunActive(run.status)).length;
  const breachedCount = ordered.filter(
    (run) =>
      isTerminalFailure(run.status) ||
      evaluateRto(run.rto_objective_seconds, run.rto_actual_seconds).breached,
  ).length;

  const runStatusText = (status: string): string =>
    labels.runStatusLabels?.[status.toUpperCase()] ?? status;
  const modeText = (mode: string): string => labels.modeLabels?.[mode.toLowerCase()] ?? mode;

  function rtoCell(run: DRFailoverRun) {
    const evaluation = evaluateRto(run.rto_objective_seconds, run.rto_actual_seconds);
    return (
      <div className="flex flex-col">
        <span
          className={cn(
            'font-medium tabular-nums',
            evaluation.breached ? 'text-state-error' : 'text-content-primary',
          )}
        >
          {formatDuration(evaluation.actualSeconds, naLabel)}
        </span>
        <span className="text-caption text-content-muted">
          {labels.rtoObjectivePrefix} {formatDuration(evaluation.objectiveSeconds, naLabel)}
        </span>
      </div>
    );
  }

  function handleSelect(run: DRFailoverRun) {
    onSelectRun?.(run);
  }

  if (ordered.length === 0) {
    return (
      <section
        className={cn(
          'rounded-card border border-outline-subtle bg-surface-card p-card-padding shadow-elevation-1',
          className,
        )}
        aria-label={labels.title}
      >
        <EmptyState icon={ServerCog} title={labels.empty} description={labels.emptyDescription} size="compact" />
      </section>
    );
  }

  return (
    <section
      className={cn(
        'rounded-card border border-outline-subtle bg-surface-card shadow-elevation-1',
        className,
      )}
      aria-label={labels.title}
      dir="auto"
    >
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-outline-subtle p-card-padding">
        <div>
          <h2 className="flex items-center gap-2 text-body-lg font-bold text-content-primary">
            <ListTree className="size-4 text-content-muted" aria-hidden />
            {labels.title}
          </h2>
          <p className="mt-1 text-body-sm text-content-muted">{labels.subtitle}</p>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <MetricTile icon={ServerCog} label={labels.activeRuns} value={activeCount} tone="info" />
          <MetricTile label={labels.breachedRuns} value={breachedCount} tone="danger" />
          <MetricTile icon={LayoutGrid} label={labels.totalRuns} value={ordered.length} />
        </div>
      </header>

      {/* Desktop / tablet: semantic data table */}
      <div className="hidden overflow-x-auto sm:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{labels.colRun}</TableHead>
              <TableHead>{labels.colGroup}</TableHead>
              <TableHead>{labels.colMode}</TableHead>
              <TableHead>{labels.colStatus}</TableHead>
              <TableHead className="w-[220px]">{labels.colProgress}</TableHead>
              <TableHead>{labels.colRto}</TableHead>
              <TableHead className="w-12">
                <span className="sr-only">{labels.colAction}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {ordered.map((run) => {
              const selected = run.id === selectedRunId;
              return (
                <TableRow
                  key={run.id}
                  data-state={selected ? 'selected' : undefined}
                  aria-current={selected ? 'true' : undefined}
                  tabIndex={onSelectRun ? 0 : undefined}
                  onClick={onSelectRun ? () => handleSelect(run) : undefined}
                  onKeyDown={
                    onSelectRun
                      ? (event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            handleSelect(run);
                          }
                        }
                      : undefined
                  }
                  className={cn(
                    onSelectRun &&
                      'cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  )}
                >
                  <TableCell className="font-mono text-caption text-content-muted">
                    {run.id}
                  </TableCell>
                  <TableCell className="text-content-primary">{run.group_id}</TableCell>
                  <TableCell>
                    <StatusChip tone="neutral" label={modeText(run.mode)} size="sm" />
                  </TableCell>
                  <TableCell>
                    <StatusChip
                      tone={toneForRunStatus(run.status)}
                      label={runStatusText(run.status)}
                      size="sm"
                    />
                  </TableCell>
                  <TableCell>
                    <RunbookProgressBar
                      gates={gates}
                      status={run.status}
                      ariaLabel={`${labels.colProgress} ${run.id}`}
                      stateLabels={labels.gateStateLabels}
                    />
                  </TableCell>
                  <TableCell>{rtoCell(run)}</TableCell>
                  <TableCell>
                    {onSelectRun && (
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          handleSelect(run);
                        }}
                        aria-label={`${labels.selectRunLabel}: ${run.id}`}
                        className="inline-flex items-center justify-center rounded-button p-1 text-content-muted transition-colors hover:bg-bg-inset hover:text-content-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rtl:rotate-180"
                      >
                        <ChevronRight className="size-4" aria-hidden />
                      </button>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {/* Mobile (<640px): stacked cards — same data, no horizontal scroll */}
      <ul className="flex flex-col gap-3 p-card-padding sm:hidden">
        {ordered.map((run) => {
          const selected = run.id === selectedRunId;
          const interactive = Boolean(onSelectRun);
          return (
            <li key={run.id}>
              <button
                type="button"
                disabled={!interactive}
                onClick={interactive ? () => handleSelect(run) : undefined}
                aria-current={selected ? 'true' : undefined}
                aria-label={interactive ? `${labels.selectRunLabel}: ${run.id}` : undefined}
                className={cn(
                  'w-full rounded-card border p-3 text-start transition-colors',
                  selected
                    ? 'border-brand-primary-600/40 bg-brand-primary-600/5'
                    : 'border-outline-subtle bg-surface-card',
                  interactive &&
                    'hover:border-brand-primary-600/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-body-sm font-semibold text-content-primary">
                      {run.group_id}
                    </p>
                    <p className="truncate font-mono text-caption text-content-muted">{run.id}</p>
                  </div>
                  <StatusChip
                    tone={toneForRunStatus(run.status)}
                    label={runStatusText(run.status)}
                    size="sm"
                  />
                </div>

                <div className="mt-3">
                  <RunbookProgressBar
                    gates={gates}
                    status={run.status}
                    ariaLabel={`${labels.colProgress} ${run.id}`}
                    stateLabels={labels.gateStateLabels}
                  />
                </div>

                <dl className="mt-3 grid grid-cols-2 gap-2 text-body-sm">
                  <div>
                    <dt className="text-overline uppercase tracking-wide text-content-muted">
                      {labels.colMode}
                    </dt>
                    <dd className="text-content-primary">{modeText(run.mode)}</dd>
                  </div>
                  <div>
                    <dt className="text-overline uppercase tracking-wide text-content-muted">
                      {labels.colRto}
                    </dt>
                    <dd>{rtoCell(run)}</dd>
                  </div>
                </dl>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export { toPercent };
