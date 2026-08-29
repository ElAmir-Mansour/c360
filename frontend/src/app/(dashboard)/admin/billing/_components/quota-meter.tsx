'use client';

import { cn } from '@/lib/utils';
import { quotaPercent, quotaTone, type QuotaTone } from './billing-helpers';
import { useAdminT } from '../../_lib/admin-i18n';

const BAR_CLASS: Record<QuotaTone, string> = {
  primary: 'bg-primary',
  warning: 'bg-status-warning',
  danger: 'bg-status-error',
  muted: 'bg-muted-foreground/30',
};

interface QuotaMeterProps {
  label: string;
  used: number;
  limit?: number | null;
  formatValue?: (n: number) => string;
}

/** A single quota bar (e.g. seats, storage) with usage-driven severity color. */
export function QuotaMeter({ label, used, limit, formatValue = (n) => n.toLocaleString() }: QuotaMeterProps) {
  const { billingPage: labels } = useAdminT();
  const pct = quotaPercent(used, limit);
  const tone = quotaTone(pct);
  const quotaQualifier =
    tone === 'danger'
      ? labels.quotaApproachingLimit
      : tone === 'warning'
        ? labels.quotaUsageHigh
        : undefined;

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-foreground">{label}</span>
        <span className="text-xs text-muted-foreground">
          {formatValue(used)}
          {limit ? ` / ${formatValue(limit)}` : ''}
        </span>
      </div>
      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={cn('h-full rounded-full transition-all', BAR_CLASS[tone])}
          style={{ width: `${pct ?? (limit === null || limit === undefined ? 0 : 0)}%` }}
        />
      </div>
      <p className="mt-1.5 text-overline text-muted-foreground">
        {pct == null ? labels.quotaNoLimit : labels.quotaUsedState(pct, quotaQualifier)}
      </p>
    </div>
  );
}
