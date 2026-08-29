'use client';

/**
 * SyncRunsTable — the `.table-premium` ledger of recorded sync runs for one
 * integration endpoint (GET /integrations/{id}/sync-runs).
 *
 * Self-contained presentation: owns its own loading / empty / degraded rendering
 * (the parent passes already-fetched rows + flags). Columns: when, mode, status,
 * processed / created / updated / skipped / failed counts, duration, warnings,
 * and an expandable detail/error/cursor line. RTL-safe — logical properties only,
 * numbers in `tabular-nums`. Every string flows through the bilingual label
 * modules.
 */
import { Fragment, useState } from 'react';
import { History, ChevronDown, AlertCircle, ScanSearch } from 'lucide-react';
import { format } from 'date-fns';
import { ar as arLocale, enUS } from 'date-fns/locale';
import { EmptyState } from '@/components/common/empty-state';
import { ErrorState } from '@/components/common/error-state';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { StatusBadge } from '@/components/shared/status-badge';
import { Badge } from '@/components/ui/badge';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { cn } from '@/lib/utils';
import type { AppLocale } from '@/lib/i18n';
import type { SyncRun } from '@/lib/lex/integrations';
import type { IntegrationConsoleLabels } from '../../../_labels';
import type { IntegrationLogsLabels } from './logs-labels';
import { interpolate } from './logs-labels';
import {
  normalizeSyncMode,
  normalizeSyncStatus,
  runDuration,
  syncModeConfig,
  syncStatusConfig,
} from './sync-run-status';

export interface SyncRunsTableProps {
  runs: SyncRun[];
  loading: boolean;
  degraded?: boolean;
  onRetry?: () => void;
  /** Shared console labels (ledger columns, statuses, modes, empty text). */
  shared: IntegrationConsoleLabels;
  /** Page-local labels (duration / warnings / watermark / extra columns). */
  local: IntegrationLogsLabels;
}

function formatWhen(at: string, locale: AppLocale): string {
  const parsed = new Date(at);
  if (Number.isNaN(parsed.getTime())) return at || '—';
  return format(parsed, 'PP p', { locale: locale === 'ar' ? arLocale : enUS });
}

/**
 * True when a ledger row records a DRY-RUN preview rather than a committed sync.
 * The wire `mode` is a free string ("preview") on preview runs; some builds
 * instead flag it via `metadata.dry_run` / `metadata.preview`. Detect both so the
 * row can be visually distinguished and never mistaken for a real run.
 */
function isPreviewRun(run: SyncRun): boolean {
  if (run.mode === ('preview' as SyncRun['mode'])) return true;
  const meta = run.metadata ?? {};
  return meta.dry_run === true || meta.preview === true;
}

function NumCell({ value }: { value: number }) {
  return (
    <td className="tabular-nums text-end">{Number.isFinite(value) ? value.toLocaleString() : '—'}</td>
  );
}

export function SyncRunsTable({
  runs,
  loading,
  degraded = false,
  onRetry,
  shared,
  local,
}: SyncRunsTableProps) {
  const { locale } = useLocaleOrDefault();
  const [expanded, setExpanded] = useState<string | null>(null);
  const statusConfig = syncStatusConfig(shared);
  const modeConfig = syncModeConfig(shared);

  if (loading) {
    return <LoadingSkeleton variant="table" count={6} label={shared.ledgerTitle} />;
  }

  if (degraded) {
    return (
      <ErrorState
        variant="generic"
        title={shared.loadErrorTitle}
        message={shared.loadErrorBody}
        onRetry={onRetry}
      />
    );
  }

  if (runs.length === 0) {
    return (
      <EmptyState
        icon={History}
        size="compact"
        title={shared.ledgerTitle}
        description={shared.ledgerEmpty}
      />
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="table-premium w-full">
        <thead>
          <tr>
            <th>{shared.ledgerColWhen}</th>
            <th>{shared.ledgerColMode}</th>
            <th>{shared.ledgerColStatus}</th>
            <th className="text-end">{shared.ledgerColProcessed}</th>
            <th className="text-end">{shared.ledgerColCreated}</th>
            <th className="text-end">{shared.ledgerColUpdated}</th>
            <th className="text-end">{shared.ledgerColSkipped}</th>
            <th className="text-end">{shared.ledgerColFailed}</th>
            <th>{local.ledgerColDuration}</th>
            <th>{local.ledgerColWarnings}</th>
            <th aria-label={shared.ledgerColDetail} />
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => {
            const status = normalizeSyncStatus(run.status);
            const mode = normalizeSyncMode(run.mode);
            const preview = isPreviewRun(run);
            const isOpen = expanded === run.id;
            const hasDetail = Boolean(run.detail || run.error || run.watermark);
            const warnLabel =
              run.failed > 0
                ? interpolate(local.ledgerWarnFailed, { n: run.failed })
                : local.ledgerWarnNone;
            return (
              <Fragment key={run.id}>
                <tr
                  className={cn(
                    hasDetail && 'cursor-pointer',
                    preview && 'bg-warning-50/40 dark:bg-warning-800/10',
                  )}
                  onClick={hasDetail ? () => setExpanded(isOpen ? null : run.id) : undefined}
                >
                  <td className="whitespace-nowrap font-medium">{formatWhen(run.started_at, locale)}</td>
                  <td>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <StatusBadge status={mode} config={modeConfig} variant="outline" size="sm" />
                      {preview ? (
                        <Badge
                          variant="warning"
                          className="gap-1 normal-case tracking-normal"
                          title={local.previewBadgeHint}
                        >
                          <ScanSearch className="h-3 w-3" aria-hidden />
                          {local.previewBadge}
                        </Badge>
                      ) : null}
                    </div>
                  </td>
                  <td>
                    <StatusBadge status={status} config={statusConfig} size="sm" />
                  </td>
                  <NumCell value={run.processed} />
                  <NumCell value={run.created} />
                  <NumCell value={run.updated} />
                  <NumCell value={run.skipped} />
                  <td
                    className={cn(
                      'tabular-nums text-end',
                      run.failed > 0 && 'font-semibold text-error-500 dark:text-error-300',
                    )}
                  >
                    {run.failed.toLocaleString()}
                  </td>
                  <td className="whitespace-nowrap text-muted-foreground">
                    {runDuration(run.started_at, run.finished_at, local.unknownDuration)}
                  </td>
                  <td>
                    <span
                      className={cn(
                        'text-xs',
                        run.failed > 0
                          ? 'text-warning-700 dark:text-warning-300'
                          : 'text-muted-foreground',
                      )}
                    >
                      {warnLabel}
                    </span>
                  </td>
                  <td className="text-end">
                    {hasDetail ? (
                      <ChevronDown
                        className={cn(
                          'inline h-4 w-4 text-muted-foreground transition-transform',
                          isOpen && 'rotate-180',
                        )}
                        aria-hidden
                      />
                    ) : null}
                  </td>
                </tr>
                {isOpen && hasDetail ? (
                  <tr className="bg-muted/30">
                    <td colSpan={11}>
                      <div className="space-y-2 py-1 text-sm">
                        {run.detail ? (
                          <p className="text-muted-foreground">{run.detail}</p>
                        ) : null}
                        {run.error ? (
                          <p className="flex items-start gap-2 text-error-600 dark:text-error-300">
                            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                            <span>
                              <span className="font-semibold">{local.ledgerRowError}:</span>{' '}
                              {run.error}
                            </span>
                          </p>
                        ) : null}
                        {run.watermark ? (
                          <p className="text-xs text-muted-foreground">
                            <span className="font-semibold">{local.ledgerWatermark}:</span>{' '}
                            <span className="font-mono">{run.watermark}</span>
                          </p>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default SyncRunsTable;
