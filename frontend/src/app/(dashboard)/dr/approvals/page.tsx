'use client';

import { useCallback, useMemo } from 'react';
import { Inbox } from 'lucide-react';
import { EmptyState } from '@/components/common/empty-state';
import { ErrorState } from '@/components/common/error-state';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { PageHeader } from '@/components/common/page-header';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useAuth } from '@/hooks/use-auth';
import { useDRFailbackRuns, useDRFailoverRuns } from '../_hooks/use-dr-queries';
import { useDRRealtime } from '../_hooks/use-dr-realtime';
import { useFailoverActions } from '../_hooks/use-dr-actions';
import { itemsNeedingApproval, type ApprovalItem } from '../_lib/collaboration';
import { DRWriteGate } from '../_components/console/dr-write-gate';
import { ApprovalItemCard } from './_components/approval-item-card';
import { useApprovalsInboxLabels } from './_components/approvals-labels';

const WRITE_PERMISSION = 'dr:write';

/**
 * `/dr/approvals` — the cross-route "needs your approval" inbox.
 *
 * A deep-linkable queue of every recovery decision currently paused at an
 * approval gate, folded from the LIVE failover + failback run lists by the shared
 * `itemsNeedingApproval` selector (failover gate detected via the FSM helper
 * `isAwaitingApproval`; failback cutback via the canonical
 * `awaiting_cutback_approval` state — both inside the selector, never re-encoded
 * here). Oldest-waiting first.
 *
 * Each item offers ONE-CLICK approval wired to the real recovery action for its
 * kind — failover → `useFailoverActions().approveFailover`, failback cutback →
 * `approveCutback` — and an inline link into the full context (the war room for a
 * failover run, the recovery workbench for a failback). All write CTAs are
 * `dr:write`-gated.
 *
 * Liveness: `useDRRealtime` registers the failover/failback run-list query keys
 * against the DR WS lifecycle topics so the queue invalidates the instant a run
 * reaches — or leaves — its approval gate; the shared hooks keep a polling
 * fallback for deployments without the WS topic. The page exports
 * `useApprovalCount` (in `_components/use-approval-count.ts`) so the layout/nav
 * can badge this entry later without this build touching layout/nav.
 *
 * Scope: there is no BCM approval/run FSM, so `useDRBCMPacks` contributes no
 * items (documented in the selector) and is not fetched here. Every field is a
 * real `@/types/clario-dr` shape; no endpoints or fields are invented.
 */
export default function DRApprovalsInboxPage() {
  const L = useApprovalsInboxLabels();
  const { hasPermission } = useAuth();
  const canWrite = hasPermission(WRITE_PERMISSION);

  const failoverQuery = useDRFailoverRuns();
  const failbackQuery = useDRFailbackRuns();

  // Keep the queue live: invalidate the failover/failback run-list caches on
  // incoming DR gate/lifecycle events (and poll-fallback via the shared hooks).
  useDRRealtime();

  // The approve actions take an explicit run id, so the rich failover context
  // (objectives, sites, recovery point) is not needed here — pass the safe nulls.
  const failover = useFailoverActions({
    activeGroupId: null,
    activeRecoveryPointId: null,
    failbackSites: { fromSite: null, toSite: null },
  });

  const items = useMemo(
    () => itemsNeedingApproval(failoverQuery.data ?? [], failbackQuery.data ?? []),
    [failoverQuery.data, failbackQuery.data],
  );

  const onApprove = useCallback(
    (item: ApprovalItem, reason?: string) => {
      if (!canWrite) return;
      const payload = reason?.trim() ? { reason: reason.trim() } : undefined;
      if (item.kind === 'failback_cutback') {
        failover.approveCutback(item.id, payload);
        return;
      }
      failover.approveFailover(item.id, payload);
    },
    [canWrite, failover],
  );

  // A single run can only be approving via one of the two mutations at a time;
  // both are surfaced so a busy row shows its spinner regardless of kind.
  const approving = failover.approveFailoverPending || failover.approveCutbackPending;

  const firstLoad =
    (failoverQuery.isLoading && failoverQuery.data === undefined) ||
    (failbackQuery.isLoading && failbackQuery.data === undefined);
  const loadError = failoverQuery.error ?? failbackQuery.error;

  const countLabel = items.length === 1 ? L.pendingCountLabelOne : L.pendingCountLabelMany;

  return (
    <TooltipProvider delayDuration={150}>
      <div className="space-y-6">
        <PageHeader title={L.title} description={L.description} />

        <section aria-labelledby="approvals-queue-heading" className="space-y-3">
          <Card>
            <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
              <div className="min-w-0">
                <CardTitle id="approvals-queue-heading" className="text-base">
                  {L.queueHeading}
                </CardTitle>
                <CardDescription>{L.queueDescription}</CardDescription>
              </div>
              {items.length > 0 ? (
                <Badge
                  variant="outline"
                  className="shrink-0"
                  data-testid="approvals-count"
                  aria-label={`${items.length} ${countLabel}`}
                >
                  <span aria-hidden>{items.length}</span>
                </Badge>
              ) : null}
            </CardHeader>
            <CardContent>
              <DRWriteGate canWrite={canWrite} description={L.readOnlyNotice}>
                {firstLoad ? (
                  <LoadingSkeleton variant="card" count={3} />
                ) : loadError && items.length === 0 ? (
                  <ErrorState
                    message={L.loadError}
                    onRetry={() => {
                      void failoverQuery.refetch();
                      void failbackQuery.refetch();
                    }}
                  />
                ) : items.length === 0 ? (
                  <EmptyState
                    icon={Inbox}
                    title={L.emptyTitle}
                    description={L.emptyDescription}
                  />
                ) : (
                  <ul className="space-y-3" data-testid="approvals-list">
                    {items.map((item) => (
                      <li key={`${item.kind}:${item.id}`}>
                        <ApprovalItemCard
                          item={item}
                          canWrite={canWrite}
                          pending={approving}
                          onApprove={onApprove}
                          sinceLabel={formatSince(item.since, L.waitingSinceUnknown)}
                        />
                      </li>
                    ))}
                  </ul>
                )}
              </DRWriteGate>
            </CardContent>
          </Card>
        </section>
      </div>
    </TooltipProvider>
  );
}

/**
 * Locale-aware, compact "since" timestamp; safe on null / unparseable input.
 * Mirrors the ledger explorer's `formatLedgerTimestamp` so the console reads
 * consistently. Pure (uses no wall clock) so the rendered row is deterministic;
 * the resolved "unknown" fallback copy is passed in by the locale-aware caller.
 */
function formatSince(value: string | null | undefined, unknownLabel: string): string {
  if (!value) return unknownLabel;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return unknownLabel;
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}
