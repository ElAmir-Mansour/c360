'use client';

import { ShieldAlert } from 'lucide-react';
import Link from 'next/link';
import { StatusBadge } from '@/components/shared/status-badge';
import { EmptyState } from '@/components/common/empty-state';
import { ErrorState, detectVariant } from '@/components/common/error-state';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { usePlatformAuditLogs } from '@/hooks/use-platform';
import { useT, useLocale } from '@/components/providers/locale-provider';
import type { AuditAdminLog } from '@/types/platform';
import { severityConfig } from './overview-status';

export function CriticalAuditPanel() {
  const t = useT();
  const { locale } = useLocale();
  const sevConfig = severityConfig(t);
  // G14 — last N high/critical events across tenants.
  const { data, isLoading, error, refetch } = usePlatformAuditLogs({
    severity: 'high,critical',
    per_page: 6,
    sort: 'created_at',
    order: 'desc',
  });

  const rows: AuditAdminLog[] = data?.data ?? [];

  return (
    <section className="rounded-2xl border bg-card p-5">
      <header className="mb-4 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <ShieldAlert className="h-4 w-4 text-muted-foreground" aria-hidden />
          {t('platformConsole.overview.recentCriticalAudit')}
        </h2>
        <Link
          href="/platform/audit"
          className="text-xs font-medium text-primary hover:underline"
        >
          {t('platformConsole.overview.viewAll')}
        </Link>
      </header>

      {isLoading ? (
        <LoadingSkeleton variant="list" count={4} />
      ) : error ? (
        <ErrorState
          variant={detectVariant(error)}
          error={error}
          onRetry={() => refetch()}
        />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={ShieldAlert}
          title={t('platformConsole.overview.noCritical')}
          description={t('platformConsole.overview.noCriticalDesc')}
          size="compact"
        />
      ) : (
        <ul className="divide-y divide-border/60">
          {rows.map((log) => (
            <li key={log.id} className="py-2.5">
              <Link
                href={`/platform/audit?tenant_id=${log.tenant_id}`}
                className="group block"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium text-foreground group-hover:text-primary group-hover:underline">
                    {log.action}
                  </span>
                  {log.severity ? (
                    <StatusBadge
                      status={log.severity}
                      config={sevConfig}
                      size="sm"
                    />
                  ) : null}
                </div>
                <div className="mt-0.5 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span className="truncate">
                    {log.tenant_name}
                    {log.actor_email ? ` · ${log.actor_email}` : ''}
                  </span>
                  <span className="shrink-0 tabular-nums">
                    {new Date(log.created_at).toLocaleString(locale)}
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
