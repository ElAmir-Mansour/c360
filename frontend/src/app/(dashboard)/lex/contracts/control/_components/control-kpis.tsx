'use client';

/**
 * The four headline metrics at the top of the Contracts & Consultations Control
 * & Monitoring Panel: active contracts, contracts under review, consultations,
 * and contracts expiring within 30 days.
 *
 * Deliberately identical in layout to the Case & Investigation panel's
 * `ControlKpis` so the two service-workspace dashboards read as one system — a
 * quiet caption, a large tabular value, and an honest present-state note (a
 * portfolio share or an in-flight count), never a fabricated period delta.
 */

import { cn } from '@/lib/utils';
import { useLexFormat } from '@/lib/lex/ksa';
import { Skeleton } from '@/components/ui/skeleton';
import Link from 'next/link';
import type { ContractsControlKpis } from '../_lib/use-contracts-control';
import { useContractsControlLabels } from '../_lib/labels';

type HintTone = 'neutral' | 'positive' | 'warning';

interface KpiSpec {
  id: string;
  label: string;
  value: number;
  hint: string;
  hintTone: HintTone;
  href: string;
}

const HINT_TONE_CLASS: Record<HintTone, string> = {
  neutral: 'text-muted-foreground',
  positive: 'text-success-600 dark:text-success-400',
  warning: 'text-warning-600 dark:text-warning-400',
};

export function ControlKpis({ kpis, loading }: { kpis: ContractsControlKpis; loading?: boolean }) {
  const t = useContractsControlLabels();
  const f = useLexFormat();

  const specs: KpiSpec[] = [
    {
      id: 'active',
      label: t.kpis.activeContracts,
      value: kpis.activeContracts,
      hint: t.kpis.shareOfPortfolio(f.formatNumber(kpis.activeShare)),
      hintTone: 'positive',
      href: '/lex/contracts?status=active',
    },
    {
      id: 'review',
      label: t.kpis.underReview,
      value: kpis.underReview,
      hint: t.kpis.inReview(f.formatNumber(kpis.underReview)),
      hintTone: kpis.underReview > 0 ? 'warning' : 'neutral',
      href: '/lex/contracts?status=internal_review%2Clegal_review',
    },
    {
      id: 'consultations',
      label: t.kpis.consultations,
      value: kpis.consultations,
      hint: t.kpis.open(f.formatNumber(kpis.consultations)),
      hintTone: 'neutral',
      href: '/lex/consultations',
    },
    {
      id: 'expiring',
      label: t.kpis.expiring,
      value: kpis.expiringSoon,
      hint: t.kpis.withinDays(f.formatNumber(kpis.expiringSoon)),
      hintTone: kpis.expiringSoon > 0 ? 'warning' : 'neutral',
      href: '/lex/contracts?status=active&expiring_in_days=30&sort=expiry_date&order=asc',
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {specs.map((spec) => (
        <Link
          key={spec.id}
          href={spec.href}
          className="rounded-2xl border border-border bg-card p-5 shadow-sm outline-none transition-colors hover:border-primary/40 hover:bg-primary/5 focus-visible:ring-2 focus-visible:ring-ring"
        >
          <p className="text-body-sm font-medium text-muted-foreground">{spec.label}</p>
          <div className="mt-3 flex items-end justify-between gap-3">
            {loading ? (
              <Skeleton className="h-9 w-16" />
            ) : (
              <span className="text-4xl font-bold leading-none tabular-nums text-foreground">
                {f.formatNumber(spec.value)}
              </span>
            )}
            {!loading && (
              <span className={cn('pb-0.5 text-body-sm font-semibold', HINT_TONE_CLASS[spec.hintTone])}>
                {spec.hint}
              </span>
            )}
          </div>
        </Link>
      ))}
    </div>
  );
}
