'use client';

import { useState } from 'react';
import { CalendarClock } from 'lucide-react';
import { SimpleTable, type Column } from '@/components/shared/simple-table';
import { StatusBadge } from '@/components/shared/status-badge';
import { ErrorState } from '@/components/common/error-state';
import { EmptyState } from '@/components/common/empty-state';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useT } from '@/components/providers/locale-provider';
import { useExpiringLicenses } from '@/hooks/use-platform';
import type { ExpiringLicense } from '@/types/platform';
import { licenseStateConfig } from '../_lib/license-state';

// Widen for the lightweight SimpleTable's Record<string, unknown> row constraint.
type ExpiringRow = ExpiringLicense & Record<string, unknown>;

function daysRemaining(row: ExpiringLicense): number {
  if (typeof row.days_remaining === 'number') return row.days_remaining;
  if (!row.expires_at) return 0;
  return Math.ceil((Date.parse(row.expires_at) - Date.now()) / 86_400_000);
}

export function ExpiriesTab() {
  const t = useT();
  const [within, setWithin] = useState('30');
  const { data, isLoading, isError, error, refetch } = useExpiringLicenses(Number(within));

  const stateConfig = licenseStateConfig(t);

  const WINDOWS = [
    { value: '7', label: t('platformConsole.licensing.window7') },
    { value: '14', label: t('platformConsole.licensing.window14') },
    { value: '30', label: t('platformConsole.licensing.window30') },
    { value: '60', label: t('platformConsole.licensing.window60') },
    { value: '90', label: t('platformConsole.licensing.window90') },
  ] as const;

  const rows = data ?? [];

  const columns: Column<ExpiringLicense>[] = [
    {
      key: 'tenant',
      header: t('platformConsole.licensing.colTenant'),
      render: (r) => (
        <span className="font-medium text-foreground">
          {r.tenant_name || r.tenant_id}
        </span>
      ),
    },
    {
      key: 'plan_key',
      header: t('platformConsole.licensing.colPlan'),
      render: (r) => <span className="text-sm">{r.plan_key || '—'}</span>,
    },
    {
      key: 'state',
      header: t('platformConsole.licensing.colState'),
      // Server-computed state — render only (§E.4).
      render: (r) => <StatusBadge status={r.state} config={stateConfig} />,
    },
    {
      key: 'expires_at',
      header: t('platformConsole.licensing.colExpires'),
      render: (r) =>
        r.expires_at ? (
          <span className="text-sm text-muted-foreground">
            {new Date(r.expires_at).toLocaleDateString()}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      key: 'days_remaining',
      header: t('platformConsole.licensing.colDaysLeft'),
      align: 'right',
      render: (r) => {
        const d = daysRemaining(r);
        const overdue = d < 0;
        return (
          <span
            className={
              overdue
                ? 'tabular-nums font-medium text-destructive'
                : d <= 7
                  ? 'tabular-nums font-medium text-warning-600 dark:text-warning-300'
                  : 'tabular-nums'
            }
          >
            {overdue
              ? t('platformConsole.licensing.daysOverdue').replace('{days}', String(Math.abs(d)))
              : d}
          </span>
        );
      },
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {t('platformConsole.licensing.expiriesHint')}
        </p>
        <Select value={within} onValueChange={setWithin}>
          <SelectTrigger className="w-44" aria-label={t('platformConsole.licensing.expiryWindowAria')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {WINDOWS.map((w) => (
              <SelectItem key={w.value} value={w.value}>
                {w.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div aria-live="polite">
        {isError ? (
          <ErrorState
            error={error}
            onRetry={() => void refetch()}
            message={t('platformConsole.licensing.expiriesError')}
          />
        ) : !isLoading && rows.length === 0 ? (
          <EmptyState
            icon={CalendarClock}
            title={t('platformConsole.licensing.expiriesEmptyTitle')}
            description={t('platformConsole.licensing.expiriesEmptyDesc').replace('{days}', within)}
          />
        ) : (
          <SimpleTable<ExpiringRow>
            columns={columns as Column<ExpiringRow>[]}
            data={rows as ExpiringRow[]}
            loading={isLoading}
            getRowKey={(r) => r.tenant_id}
            ariaLabel={t('platformConsole.licensing.expiries')}
            emptyMessage={t('platformConsole.licensing.expiriesEmptyTitle')}
          />
        )}
      </div>
    </div>
  );
}
