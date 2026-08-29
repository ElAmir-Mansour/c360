'use client';

/**
 * DlqConsole (#11) — dead-letter queue table for one endpoint OR the whole tenant.
 *
 * When `endpointId` is set it reads GET /integrations/{id}/dlq and exposes a
 * "Replay all failed" batch action (POST …/dlq/replay-failed); when omitted it
 * reads the tenant-wide GET /integrations/dlq and adds an Integration column (no
 * batch action — batch is per-endpoint). Each row shows source, summary, error,
 * attempts, status, relative failure time, and an expandable redacted payload,
 * with a per-row Replay (POST /integrations/dlq/{dlqId}/replay).
 *
 * Replay actions are optimistic (the row is marked busy), toast on result, and
 * invalidate the relevant react-query keys. All mutating affordances are gated on
 * `canManage` (`lex:integration:manage`); read-only users see the table only.
 * Reads use an explicit degraded flag so failures are not confused with an empty
 * queue. RTL via `dir`.
 */
import { Fragment, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ChevronDown,
  ChevronRight,
  Inbox,
  Loader2,
  RefreshCw,
  RotateCcw,
} from 'lucide-react';
import { EmptyState } from '@/components/common/empty-state';
import { ErrorState } from '@/components/common/error-state';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { StatusBadge } from '@/components/shared/status-badge';
import { RelativeTime } from '@/components/shared/relative-time';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { Button } from '@/components/ui/button';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { showSuccess, showBackendError } from '@/lib/toast';
import { cn } from '@/lib/utils';
import {
  getDlqResult,
  getDlqAllResult,
  replayDlq,
  replayFailed,
  type DeadLetter,
} from '@/lib/lex/integrations';
import {
  useReliabilityLabels,
  fillReliabilityToken,
  buildDlqStatusConfig,
  sourceIcon,
  sourceLabel,
} from '../_lib/reliability-labels';

interface DlqConsoleProps {
  /** When set: per-endpoint DLQ + batch replay. When omitted: tenant-wide view. */
  endpointId?: string;
  /** Gated on `lex:integration:manage`; read-only users get the table only. */
  canManage?: boolean;
  /**
   * Optional map endpoint id → display name, used only in the tenant-wide view
   * to label the Integration column. Falls back to the raw id.
   */
  endpointNames?: Record<string, string>;
}

const DLQ_KEY = 'lex-integration-dlq';
const DLQ_ALL_KEY = 'lex-integration-dlq-all';

export function DlqConsole({ endpointId, canManage = false, endpointNames }: DlqConsoleProps) {
  const t = useReliabilityLabels();
  const { locale, direction } = useLocaleOrDefault();
  const qc = useQueryClient();
  const statusConfig = buildDlqStatusConfig(t);
  const isGlobal = !endpointId;

  const queryKey = isGlobal ? [DLQ_ALL_KEY] : [DLQ_KEY, endpointId];

  const q = useQuery({
    queryKey,
    queryFn: () => (isGlobal ? getDlqAllResult() : getDlqResult(endpointId!)),
    staleTime: 15_000,
  });

  const entries = useMemo(() => q.data?.entries ?? [], [q.data]);
  const degraded = q.data?.degraded ?? false;
  const failedCount = useMemo(
    () => entries.filter((e) => e.status === 'failed').length,
    [entries],
  );

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [replayAllOpen, setReplayAllOpen] = useState(false);
  // Track which single rows are mid-replay so we can show per-row spinners.
  const [replayingId, setReplayingId] = useState<string | null>(null);

  function toggleExpanded(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function invalidate() {
    await qc.invalidateQueries({ queryKey });
    // Keep the other DLQ view in sync (a per-endpoint replay also affects global).
    if (isGlobal && endpointId) {
      await qc.invalidateQueries({ queryKey: [DLQ_KEY, endpointId] });
    } else {
      await qc.invalidateQueries({ queryKey: [DLQ_ALL_KEY] });
    }
  }

  const replayOne = useMutation({
    mutationFn: (dlqId: string) => replayDlq(dlqId),
    onMutate: (dlqId) => setReplayingId(dlqId),
    onSuccess: async () => {
      showSuccess(t.toastReplayed);
      await invalidate();
    },
    onError: (e) => showBackendError(e, t.reliabilityError),
    onSettled: () => setReplayingId(null),
  });

  const replayAll = useMutation({
    mutationFn: () => replayFailed(endpointId!),
    onSuccess: async (res) => {
      showSuccess(
        fillReliabilityToken(t.toastReplayedAll, {
          replayed: res.replayed,
          failed: res.failed,
        }),
      );
      await invalidate();
    },
    onError: (e) => showBackendError(e, t.reliabilityError),
  });

  const colSpan = isGlobal ? 8 : 7;

  return (
    <div className="space-y-3" dir={direction} lang={locale}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {failedCount > 0
            ? fillReliabilityToken(t.dlqFailedCount, { n: failedCount })
            : isGlobal
              ? t.dlqGlobalSubtitle
              : t.dlqSubtitle}
        </p>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void q.refetch()}
            disabled={q.isFetching}
          >
            <RefreshCw
              className={cn('me-1.5 h-4 w-4', q.isFetching && 'animate-spin')}
              aria-hidden
            />
            {t.refresh}
          </Button>
          {canManage && !isGlobal ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setReplayAllOpen(true)}
              disabled={replayAll.isPending || failedCount === 0}
            >
              {replayAll.isPending ? (
                <Loader2 className="me-1.5 h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <RotateCcw className="me-1.5 h-4 w-4" aria-hidden />
              )}
              {replayAll.isPending ? t.dlqReplayAllRunning : t.dlqReplayAll}
            </Button>
          ) : null}
        </div>
      </div>

      {q.isLoading ? (
        <LoadingSkeleton variant="table-row" count={4} />
      ) : q.isError || degraded ? (
        <ErrorState
          variant="generic"
          title={t.dlqTitle}
          message={t.reliabilityError}
          onRetry={() => void q.refetch()}
        />
      ) : entries.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title={t.dlqEmpty}
          description={t.dlqEmptyHint}
          size="compact"
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="table-premium w-full text-sm">
            <thead>
              <tr>
                <th className="w-8" aria-hidden />
                <th className="text-start">{t.dlqColSource}</th>
                {isGlobal ? <th className="text-start">{t.dlqColEndpoint}</th> : null}
                <th className="text-start">{t.dlqColSummary}</th>
                <th className="text-start">{t.dlqColError}</th>
                <th className="text-end">{t.dlqColAttempts}</th>
                <th className="text-start">{t.dlqColStatus}</th>
                <th className="text-start">{t.dlqColWhen}</th>
                {canManage ? <th className="text-end">{t.dlqColActions}</th> : null}
              </tr>
            </thead>
            <tbody>
              {entries.map((entry: DeadLetter) => {
                const SourceIcon = sourceIcon(entry.source);
                const isOpen = expanded.has(entry.id);
                const rowBusy = replayingId === entry.id && replayOne.isPending;
                const canReplay = canManage && entry.status === 'failed';
                return (
                  <Fragment key={entry.id}>
                    <tr>
                      <td className="align-middle">
                        <button
                          type="button"
                          onClick={() => toggleExpanded(entry.id)}
                          className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-muted"
                          aria-label={isOpen ? t.dlqHidePayload : t.dlqShowPayload}
                          aria-expanded={isOpen}
                        >
                          {isOpen ? (
                            <ChevronDown className="h-4 w-4" aria-hidden />
                          ) : (
                            <ChevronRight className="h-4 w-4 rtl:rotate-180" aria-hidden />
                          )}
                        </button>
                      </td>
                      <td>
                        <span className="inline-flex items-center gap-1.5">
                          <SourceIcon className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                          {sourceLabel(t, entry.source)}
                        </span>
                      </td>
                      {isGlobal ? (
                        <td className="max-w-[12rem] truncate" title={entry.endpoint_id}>
                          {endpointNames?.[entry.endpoint_id] ?? entry.endpoint_id}
                        </td>
                      ) : null}
                      <td className="max-w-[16rem] truncate" title={entry.summary}>
                        {entry.summary || '—'}
                      </td>
                      <td
                        className="max-w-[18rem] truncate text-destructive"
                        title={entry.error}
                      >
                        {entry.error || '—'}
                      </td>
                      <td className="text-end tabular-nums">{entry.attempts}</td>
                      <td>
                        <StatusBadge status={entry.status} config={statusConfig} size="sm" />
                      </td>
                      <td className="whitespace-nowrap">
                        <RelativeTime date={entry.created_at} />
                      </td>
                      {canManage ? (
                        <td className="text-end">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => replayOne.mutate(entry.id)}
                            disabled={!canReplay || rowBusy || replayOne.isPending}
                          >
                            {rowBusy ? (
                              <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />
                            ) : (
                              <RotateCcw className="me-1.5 h-3.5 w-3.5" aria-hidden />
                            )}
                            {rowBusy ? t.dlqReplaying : t.dlqReplay}
                          </Button>
                        </td>
                      ) : null}
                    </tr>
                    {isOpen ? (
                      <tr>
                        <td colSpan={colSpan} className="bg-muted/20">
                          <div className="space-y-2 px-2 py-2">
                            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-caption text-muted-foreground">
                              <span className="font-medium">{t.dlqPayloadTitle}</span>
                              {entry.last_attempt_at ? (
                                <span>
                                  {t.dlqLastAttempt}:{' '}
                                  <RelativeTime date={entry.last_attempt_at} />
                                </span>
                              ) : null}
                            </div>
                            <pre
                              className="max-h-64 overflow-auto rounded-lg border bg-background p-3 text-caption leading-relaxed text-foreground"
                              dir="ltr"
                            >
                              {entry.payload_redacted || '—'}
                            </pre>
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
      )}

      {canManage && !isGlobal ? (
        <ConfirmDialog
          open={replayAllOpen}
          onOpenChange={setReplayAllOpen}
          title={t.dlqReplayAllConfirmTitle}
          description={fillReliabilityToken(t.dlqReplayAllConfirmBody, { n: failedCount })}
          confirmLabel={t.dlqReplayAll}
          loading={replayAll.isPending}
          onConfirm={async () => {
            await replayAll.mutateAsync();
          }}
        />
      ) : null}
    </div>
  );
}
