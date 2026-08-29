'use client';

import { Boxes } from 'lucide-react';
import Link from 'next/link';
import { StatusBadge } from '@/components/shared/status-badge';
import { EmptyState } from '@/components/common/empty-state';
import { ErrorState, detectVariant } from '@/components/common/error-state';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { useProvisioningQueue } from '@/hooks/use-platform';
import { useT } from '@/components/providers/locale-provider';
import { cn } from '@/lib/utils';
import type { ProvisioningItem } from '@/types/platform';
import { provisioningStatusConfig } from './overview-status';

export function ProvisioningTicker() {
  const t = useT();
  const provConfig = provisioningStatusConfig(t);
  // Poll 10s while something is in flight (G24, §H cadence).
  const { data, isLoading, error, refetch } = useProvisioningQueue(
    'in_flight',
    true,
  );

  // Tolerate both the bare-array contract and a `{ data: [...] }` envelope.
  const items: ProvisioningItem[] = Array.isArray(data)
    ? data
    : ((data as { data?: ProvisioningItem[] } | undefined)?.data ?? []);

  return (
    <section className="rounded-2xl border bg-card p-5">
      <header className="mb-4 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Boxes className="h-4 w-4 text-muted-foreground" aria-hidden />
          {t('platformConsole.overview.provisioning')}
        </h2>
        <Link
          href="/platform/provisioning"
          className="text-xs font-medium text-primary hover:underline"
        >
          {t('platformConsole.overview.viewAll')}
        </Link>
      </header>

      {isLoading ? (
        <LoadingSkeleton variant="list" count={3} />
      ) : error ? (
        <ErrorState
          variant={detectVariant(error)}
          error={error}
          onRetry={() => refetch()}
        />
      ) : items.length === 0 ? (
        <EmptyState
          icon={Boxes}
          title={t('platformConsole.overview.noProvisioning')}
          description={t('platformConsole.overview.noProvisioningDesc')}
          size="compact"
        />
      ) : (
        <ul className="space-y-3">
          {items.map((item) => {
            const pct = Math.max(0, Math.min(100, Math.round(item.progress_pct)));
            const failed = item.status === 'failed';
            return (
              <li key={item.tenant_id}>
                <Link
                  href={`/platform/provisioning`}
                  className="group block rounded-lg border border-transparent p-2 transition-colors hover:border-border/60 hover:bg-muted/40"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium text-foreground group-hover:text-primary">
                      {item.tenant_name}
                    </span>
                    <StatusBadge
                      status={item.status}
                      config={provConfig}
                      size="sm"
                    />
                  </div>
                  <div className="mt-1.5 flex items-center gap-2">
                    <div
                      className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"
                      role="progressbar"
                      aria-label={`${item.tenant_name} — ${t('platformConsole.overview.provisioning')}`}
                      aria-valuenow={pct}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuetext={`${pct}%`}
                    >
                      <div
                        className={cn(
                          'h-full rounded-full transition-all',
                          failed ? 'bg-error-500' : 'bg-primary',
                        )}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                      {pct}%
                    </span>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
