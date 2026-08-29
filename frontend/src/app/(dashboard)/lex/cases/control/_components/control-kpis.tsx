'use client';

/**
 * The four headline metrics at the top of the Control & Monitoring Panel:
 * defendant / plaintiff case counts, ongoing investigations and active lawsuits.
 *
 * Each tile mirrors the reference layout exactly — a quiet caption, a large
 * tabular value, and a small context note in the trailing corner. The context
 * note carries an honest present-state metric (a portfolio share or an in-flight
 * count), never a fabricated period-over-period delta.
 */

import { cn } from '@/lib/utils';
import { useLexFormat } from '@/lib/lex/ksa';
import { Skeleton } from '@/components/ui/skeleton';
import Link from 'next/link';
import type { ControlKpis } from '../_lib/use-control-panel';
import { useControlPanelLabels } from '../_lib/labels';

type HintTone = 'neutral' | 'positive' | 'warning';

interface KpiSpec {
  id: string;
  label: string;
  value: number | null;
  hint: string;
  hintTone: HintTone;
  href: string;
}

const HINT_TONE_CLASS: Record<HintTone, string> = {
  neutral: 'text-muted-foreground',
  positive: 'text-success-600 dark:text-success-400',
  warning: 'text-warning-600 dark:text-warning-400',
};

export function ControlKpis({ kpis, loading }: { kpis: ControlKpis; loading?: boolean }) {
  const t = useControlPanelLabels();
  const f = useLexFormat();
  const today = new Date();
  const dueThrough = new Date(today);
  dueThrough.setDate(dueThrough.getDate() + 30);
  const expectedResolutionHref = `/lex/cases?expected_resolution_from=${today.toISOString().slice(0, 10)}&expected_resolution_to=${dueThrough.toISOString().slice(0, 10)}&sort=expected_resolution_date&order=asc`;

  const specs: KpiSpec[] = [
    {
      id: 'active',
      label: t.kpis.activeCases,
      value: kpis.activeCases,
      hint: t.kpis.shareOfPortfolio(f.formatNumber(kpis.activeShare)),
      hintTone: 'positive',
      href: '/lex/cases?status=intake%2Cphase1%2Cphase2%2Copen%2Cunder_procedure',
    },
    {
      id: 'review',
      label: t.kpis.underReview,
      value: kpis.underReview,
      hint: t.kpis.underReviewHint(f.formatNumber(kpis.underReview)),
      hintTone: kpis.underReview > 0 ? 'warning' : 'neutral',
      href: '/lex/cases?status=phase1%2Cphase2',
    },
    {
      id: 'investigations',
      label: t.kpis.investigations,
      value: kpis.ongoingInvestigations,
      hint: t.kpis.inProgress(f.formatNumber(kpis.ongoingInvestigations)),
      hintTone: kpis.ongoingInvestigations > 0 ? 'warning' : 'neutral',
      href: '/lex/investigations?status=registered%2Cin_progress%2Cresults_recorded%2Cpending_approval%2Crejected',
    },
    {
      id: 'due-soon',
      label: t.kpis.dueSoon,
      value: kpis.dueIn30Days,
      hint: kpis.dueIn30Days === null ? t.kpis.unavailable : t.kpis.dueSoonHint(f.formatNumber(kpis.dueIn30Days)),
      hintTone: kpis.dueIn30Days && kpis.dueIn30Days > 0 ? 'warning' : 'neutral',
      href: expectedResolutionHref,
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {specs.map((spec) => (
        <Link
          key={spec.id}
          href={spec.href}
          className="min-h-[110px] rounded-[20px] border border-border bg-card p-5 shadow-sm outline-none transition-colors hover:border-primary/40 hover:bg-primary/5 focus-visible:ring-2 focus-visible:ring-ring"
        >
          <p className="text-body-sm font-medium text-muted-foreground">{spec.label}</p>
          <div className="mt-3 flex items-end justify-between gap-3">
            {loading ? (
              <Skeleton className="h-9 w-16" />
            ) : (
              <span className="text-4xl font-bold leading-none tabular-nums text-foreground">
                {spec.value === null ? '—' : f.formatNumber(spec.value)}
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
