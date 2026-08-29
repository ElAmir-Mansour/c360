'use client';

/**
 * ReconciliationPanel — the gaps + conflicts drill-down for one integration
 * endpoint (feature 5).
 *
 * Calls `getReconciliationResult(id)` (GET /integrations/{id}/reconciliation)
 * on demand and renders the two finding classes — GAPS (present externally, missing in Lex)
 * and CONFLICTS (diverging values) — each in a `.table-premium`, grouped by issue
 * type, with the suggested remediation surfaced as a badge per row. The client
 * helper returns a degraded flag, so this component can distinguish a clean
 * empty report from an unavailable reconciliation read.
 *
 * Every string flows through the bilingual logs label module. RTL-safe (logical
 * properties; the table never relies on left/right). Read-only — the panel
 * presents remediation suggestions but does not mutate; acting on them lives in
 * the sync/preview flow.
 */
import { Fragment, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  GitCompareArrows,
  RefreshCw,
  AlertTriangle,
  FileWarning,
  CheckCircle2,
  Loader2,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/common/empty-state';
import { cn } from '@/lib/utils';
import {
  lexIntegrationsApi,
  type ReconItem,
  type ReconciliationReport,
  type ReconciliationReportResult,
} from '@/lib/lex/integrations';
import type { IntegrationLogsLabels } from './logs-labels';
import { interpolate } from './logs-labels';

export interface ReconciliationPanelProps {
  endpointId: string;
  /** Whether the operator may trigger the reconciliation probe (read is enough). */
  enabled: boolean;
  local: IntegrationLogsLabels;
}

/** Group a flat list of recon items by their `issue` code, preserving order. */
function groupByIssue(items: ReconItem[]): Array<[string, ReconItem[]]> {
  const map = new Map<string, ReconItem[]>();
  for (const item of items) {
    const key = item.issue || '—';
    const bucket = map.get(key);
    if (bucket) bucket.push(item);
    else map.set(key, [item]);
  }
  return Array.from(map.entries());
}

/** Render the connector-defined free-form summary as readable lines. */
function summaryLines(summary: Record<string, unknown>): string[] {
  return Object.entries(summary)
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`);
}

interface ReconTableProps {
  heading: string;
  count: number;
  countLabel: string;
  groups: Array<[string, ReconItem[]]>;
  tone: 'gap' | 'conflict';
  local: IntegrationLogsLabels;
}

function ReconTable({ heading, count, countLabel, groups, tone, local }: ReconTableProps) {
  if (count === 0) return null;
  const HeadingIcon = tone === 'gap' ? FileWarning : GitCompareArrows;
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <HeadingIcon
          className={cn(
            'h-4 w-4',
            tone === 'gap'
              ? 'text-warning-700 dark:text-warning-300'
              : 'text-error-500 dark:text-error-300',
          )}
          aria-hidden
        />
        <h3 className="text-sm font-semibold">{heading}</h3>
        <Badge variant={tone === 'gap' ? 'warning' : 'destructive'}>
          {interpolate(countLabel, { n: count })}
        </Badge>
      </div>
      <div className="overflow-x-auto">
        <table className="table-premium w-full">
          <thead>
            <tr>
              <th>{local.reconColExternalId}</th>
              <th>{local.reconColLexKind}</th>
              <th>{local.reconColDetail}</th>
              <th>{local.reconColSuggested}</th>
            </tr>
          </thead>
          <tbody>
            {groups.map(([issue, items]) => (
              <Fragment key={`${tone}-${issue}`}>
                <tr className="bg-muted/40">
                  <td colSpan={4} className="py-1.5">
                    <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {issue}
                    </span>{' '}
                    <span className="text-xs text-muted-foreground">
                      ({interpolate(local.reconGroupCount, { n: items.length })})
                    </span>
                  </td>
                </tr>
                {items.map((item, idx) => (
                  <tr key={`${tone}-${issue}-${item.external_id}-${idx}`}>
                    <td className="whitespace-nowrap font-mono text-xs">
                      {item.external_id || '—'}
                    </td>
                    <td className="whitespace-nowrap">{item.lex_kind || '—'}</td>
                    <td className="text-muted-foreground">{item.detail || '—'}</td>
                    <td>
                      {item.suggested ? (
                        <Badge variant="outline" className="font-mono normal-case tracking-normal">
                          {item.suggested}
                        </Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          {local.reconNoSuggestion}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function ReconciliationPanel({ endpointId, enabled, local }: ReconciliationPanelProps) {
  const query = useQuery<ReconciliationReportResult>({
    queryKey: ['lex-integration-reconciliation', endpointId],
    queryFn: () => lexIntegrationsApi.getReconciliationResult(endpointId),
    enabled: false, // on-demand: reconciliation can be expensive on the connector
    staleTime: 30_000,
  });

  const report = query.data?.report;
  const degraded = query.data?.degraded ?? false;
  const gapGroups = useMemo(() => groupByIssue(report?.gaps ?? []), [report?.gaps]);
  const conflictGroups = useMemo(
    () => groupByIssue(report?.conflicts ?? []),
    [report?.conflicts],
  );
  const summary = useMemo(() => summaryLines(report?.summary ?? {}), [report?.summary]);

  const gapCount = report?.gaps.length ?? 0;
  const conflictCount = report?.conflicts.length ?? 0;
  const clean = Boolean(report) && gapCount === 0 && conflictCount === 0;
  const hasRun = query.isFetched || query.isFetching;

  const runLabel = query.isFetching
    ? local.reconRunning
    : hasRun
      ? local.reconRefresh
      : local.reconRun;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">{local.reconSubtitle}</p>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={!enabled || query.isFetching}
          onClick={() => void query.refetch()}
          className="shrink-0"
        >
          {query.isFetching ? (
            <Loader2 className="me-1.5 h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <RefreshCw className="me-1.5 h-4 w-4" aria-hidden />
          )}
          {runLabel}
        </Button>
      </div>

      {query.isFetching && !report ? (
        <div className="flex flex-col items-center justify-center gap-3 py-10 text-center">
          <Loader2 className="h-7 w-7 animate-spin text-primary" aria-hidden />
          <p className="text-sm text-muted-foreground">{local.reconLoading}</p>
        </div>
      ) : query.isError || degraded ? (
        <EmptyState
          icon={AlertTriangle}
          size="compact"
          title={local.reconErrorTitle}
          description={local.reconErrorBody}
          action={{ label: local.reconRefresh, onClick: () => void query.refetch() }}
        />
      ) : !hasRun ? (
        <EmptyState
          icon={GitCompareArrows}
          size="compact"
          title={local.reconIdleTitle}
          description={local.reconIdleBody}
          action={enabled ? { label: local.reconRun, onClick: () => void query.refetch() } : undefined}
        />
      ) : clean ? (
        <EmptyState
          icon={CheckCircle2}
          size="compact"
          title={local.reconCleanTitle}
          description={local.reconCleanBody}
        />
      ) : (
        <div className="space-y-6">
          <ReconTable
            heading={local.reconGapsHeading}
            count={gapCount}
            countLabel={local.reconGapsCount}
            groups={gapGroups}
            tone="gap"
            local={local}
          />
          <ReconTable
            heading={local.reconConflictsHeading}
            count={conflictCount}
            countLabel={local.reconConflictsCount}
            groups={conflictGroups}
            tone="conflict"
            local={local}
          />
          {summary.length > 0 ? (
            <div className="rounded-md border border-border/70 bg-muted/30 p-3">
              <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {local.reconSummaryHeading}
              </h4>
              <ul className="space-y-0.5 text-xs text-muted-foreground">
                {summary.map((line) => (
                  <li key={line} className="font-mono">
                    {line}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

export default ReconciliationPanel;
