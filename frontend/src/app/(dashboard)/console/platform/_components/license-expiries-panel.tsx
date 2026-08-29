'use client';

import { KeyRound } from 'lucide-react';
import Link from 'next/link';
import { StatusBadge } from '@/components/shared/status-badge';
import { EmptyState } from '@/components/common/empty-state';
import { ErrorState, detectVariant } from '@/components/common/error-state';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { useExpiringLicenses } from '@/hooks/use-platform';
import { useT } from '@/components/providers/locale-provider';
import type { MessageKey } from '@/lib/i18n/messages';
import { cn } from '@/lib/utils';
import type { ExpiringLicense } from '@/types/platform';
import { licenseStateConfig } from './overview-status';

type Translate = (key: MessageKey) => string;

/** Human label for the days-remaining figure (negative = already expired). */
function daysLabel(
  days: number,
  t: Translate,
): { text: string; tone: string } {
  if (days < 0) {
    return {
      text: t('platformConsole.overview.expiredAgo').replace(
        '{days}',
        String(Math.abs(days)),
      ),
      tone: 'text-error-600 dark:text-error-300',
    };
  }
  if (days === 0) {
    return {
      text: t('platformConsole.overview.expiresToday'),
      tone: 'text-error-600 dark:text-error-300',
    };
  }
  const text = t('platformConsole.overview.daysLeft').replace(
    '{days}',
    String(days),
  );
  if (days <= 7) {
    return { text, tone: 'text-warning-600 dark:text-warning-300' };
  }
  return { text, tone: 'text-muted-foreground' };
}

export function LicenseExpiriesPanel() {
  const t = useT();
  const licCfg = licenseStateConfig(t);
  const { data, isLoading, error, refetch } = useExpiringLicenses(30);
  // Tolerate both the bare-array contract and a `{ data: [...] }` envelope so the
  // console never crashes on an API shape change (defensive — see also the
  // audit/provisioning panels).
  const licenses: ExpiringLicense[] = Array.isArray(data)
    ? data
    : ((data as { data?: ExpiringLicense[] } | undefined)?.data ?? []);

  return (
    <section className="rounded-2xl border bg-card p-5">
      <header className="mb-4 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <KeyRound className="h-4 w-4 text-muted-foreground" aria-hidden />
          {t('platformConsole.overview.licenseExpiries')}
        </h2>
        <Link
          href="/platform/licensing"
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
      ) : licenses.length === 0 ? (
        <EmptyState
          icon={KeyRound}
          title={t('platformConsole.overview.noExpiring')}
          description={t('platformConsole.overview.noExpiringDesc')}
          size="compact"
        />
      ) : (
        <ul className="divide-y divide-border/60">
          {licenses.map((lic: ExpiringLicense) => {
            const d = daysLabel(lic.days_remaining, t);
            return (
              <li
                key={`${lic.tenant_id}-${lic.plan_key}`}
                className="flex items-center justify-between gap-3 py-2.5"
              >
                <div className="min-w-0">
                  <Link
                    href={`/platform/tenants/${lic.tenant_id}`}
                    className="block truncate text-sm font-medium text-foreground hover:text-primary hover:underline"
                  >
                    {lic.tenant_name}
                  </Link>
                  <p className="truncate text-xs text-muted-foreground">
                    {lic.plan_key}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <StatusBadge
                    status={lic.state}
                    config={licCfg}
                    size="sm"
                  />
                  <span className={cn('text-xs tabular-nums', d.tone)}>
                    {d.text}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
