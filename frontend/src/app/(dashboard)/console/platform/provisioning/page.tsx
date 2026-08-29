'use client';

// Provisioning Oversight — Platform Admin Console screen 9 (§E.5(9), G24).
//
// Live table of in-flight tenants (status = pending|provisioning|failed) with
// status / progress_pct / current_step; expand a row to see the 12-step
// ProvisioningStep rail (per-step status / duration / error) fetched from the
// existing per-tenant provision-status endpoint. Polls every 10s while anything
// is still in flight (pending|provisioning), and stops once the queue is quiet
// (failed-only) to avoid needless load (§H poll-cadence contract).
//
// Source list endpoint is G24 (GET /api/v1/admin/provisioning?status=in_flight,
// proposed). Until the backend gap ships, the query errors and this screen shows
// its ErrorState — no mocks (foundation contract).

import { useMemo } from 'react';
import { Boxes, RefreshCw, Loader, CircleX, Layers } from 'lucide-react';
import { PageHeader } from '@/components/common/page-header';
import { EmptyState } from '@/components/common/empty-state';
import { ErrorState } from '@/components/common/error-state';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { MetricTile } from '@/components/shared/metric-tile';
import { Button } from '@/components/ui/button';
import { useProvisioningQueue } from '@/hooks/use-platform';
import { useT } from '@/components/providers/locale-provider';
import { formatRelativeTime } from '@/lib/format';
import type { ProvisioningItem } from '@/types/platform';
import { ProvisioningTable } from './_components/provisioning-table';

const IN_FLIGHT = new Set(['pending', 'provisioning']);

export default function ProvisioningOversightPage() {
  const t = useT();

  // First render polls at the 10s cadence; once data lands we keep polling only
  // while at least one tenant is genuinely in flight. The `status=in_flight`
  // filter still returns recently-failed tenants (so operators can retry), but
  // those don't justify a live ticker.
  const initial = useProvisioningQueue('in_flight', false);
  const anyInFlight = useMemo(
    () => (initial.data ?? []).some((i) => IN_FLIGHT.has(i.status)),
    [initial.data],
  );
  // Re-bind the query with the resolved cadence. Same query key, so this shares
  // the cache entry with `initial` — no duplicate fetch.
  const query = useProvisioningQueue('in_flight', anyInFlight || initial.isLoading);

  const items: ProvisioningItem[] = useMemo(() => query.data ?? [], [query.data]);
  const counts = useMemo(() => summarize(items), [items]);

  const lastUpdated = query.dataUpdatedAt
    ? formatRelativeTime(new Date(query.dataUpdatedAt))
    : null;

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        eyebrow={t('platformConsole.eyebrow')}
        title={t('platformConsole.provisioning.title')}
        description={t('platformConsole.provisioning.subtitle')}
        tags={
          lastUpdated
            ? [
                {
                  label: `${t('platformConsole.lastUpdated')}: ${lastUpdated}`,
                  tone: 'neutral',
                },
                ...(anyInFlight
                  ? [
                      {
                        label: t('platformConsole.provisioning.liveBadge'),
                        tone: 'info' as const,
                      },
                    ]
                  : []),
              ]
            : undefined
        }
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => query.refetch()}
            disabled={query.isFetching}
            aria-label={t('platformConsole.refresh')}
          >
            <RefreshCw
              className={query.isFetching ? 'me-1.5 h-4 w-4 animate-spin' : 'me-1.5 h-4 w-4'}
              aria-hidden
            />
            {t('platformConsole.refresh')}
          </Button>
        }
      />

      {/* Polite status region for assistive tech: announces the live ticker /
          fetch state without stealing focus. */}
      <p className="sr-only" aria-live="polite">
        {query.isFetching
          ? t('platformConsole.provisioning.refreshing')
          : anyInFlight
            ? t('platformConsole.provisioning.liveAnnounce')
            : t('platformConsole.provisioning.idleAnnounce')}
      </p>

      {!query.isLoading && !query.isError && items.length > 0 ? (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <MetricTile
            label={t('platformConsole.provisioning.kpiInFlight')}
            value={counts.inFlight}
            icon={Loader}
            tone="info"
          />
          <MetricTile
            label={t('platformConsole.provisioning.kpiProvisioning')}
            value={counts.provisioning}
            icon={Boxes}
            tone="primary"
          />
          <MetricTile
            label={t('platformConsole.provisioning.kpiPending')}
            value={counts.pending}
            icon={Layers}
            tone="muted"
          />
          <MetricTile
            label={t('platformConsole.provisioning.kpiFailed')}
            value={counts.failed}
            icon={CircleX}
            tone={counts.failed > 0 ? 'danger' : 'muted'}
          />
        </div>
      ) : null}

      {query.isLoading ? (
        <LoadingSkeleton variant="table" count={6} />
      ) : query.isError ? (
        <ErrorState
          error={query.error}
          message={t('platformConsole.provisioning.loadError')}
          onRetry={() => query.refetch()}
        />
      ) : items.length === 0 ? (
        <EmptyState
          icon={Boxes}
          title={t('platformConsole.provisioning.emptyTitle')}
          description={t('platformConsole.provisioning.emptyDesc')}
        />
      ) : (
        <ProvisioningTable items={items} onRetried={() => query.refetch()} />
      )}
    </div>
  );
}

function summarize(items: ProvisioningItem[]) {
  let provisioning = 0;
  let pending = 0;
  let failed = 0;
  for (const i of items) {
    if (i.status === 'provisioning') provisioning += 1;
    else if (i.status === 'pending') pending += 1;
    else if (i.status === 'failed') failed += 1;
  }
  return { provisioning, pending, failed, inFlight: provisioning + pending };
}
