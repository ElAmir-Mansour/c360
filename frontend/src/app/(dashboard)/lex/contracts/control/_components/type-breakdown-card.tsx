'use client';

/**
 * Generic "… by Type" breakdown — a ranked set of horizontal meters over a
 * domain's type buckets, keyed by localized type label. Reused twice on the
 * Contracts & Consultations panel (contracts + consultations), so the section
 * shows the type mix that is RELEVANT to this workspace (the mirror of the Case
 * & Investigation panel's "Cases by Type"). Percentages are shares of that
 * domain's total.
 */

import { useLocale } from '@/components/providers/locale-provider';
import { useLexFormat } from '@/lib/lex/ksa';
import { Skeleton } from '@/components/ui/skeleton';
import Link from 'next/link';
import type { TypeSlice } from '../_lib/use-contracts-control';

/** Ranked bar + matching percent-text colors (deep teal → gold → grey). */
const BAR_PALETTE = [
  {
    bar: 'bg-brand-primary-700',
    text: 'text-brand-primary-700 dark:text-brand-primary-400',
  },
  {
    bar: 'bg-brand-teal-500',
    text: 'text-brand-teal-700 dark:text-brand-teal-400',
  },
  {
    bar: 'bg-brand-gold-600',
    text: 'text-brand-gold-600 dark:text-brand-gold-400',
  },
  {
    bar: 'bg-brand-teal-800',
    text: 'text-brand-teal-800 dark:text-brand-teal-300',
  },
  { bar: 'bg-muted-foreground/60', text: 'text-muted-foreground' },
];

export function TypeBreakdownCard({
  title,
  slices,
  resolveLabel,
  emptyLabel,
  ofTotal,
  hrefFor,
  loading,
}: {
  title: string;
  slices: TypeSlice[];
  /** Localize a raw type token in the active locale. */
  resolveLabel: (key: string) => string;
  emptyLabel: string;
  /** Accessible "N records" phrasing for the meter. */
  ofTotal: (count: string) => string;
  /** Exact register filter represented by each aggregate bucket. */
  hrefFor: (key: string) => string;
  loading?: boolean;
}) {
  const { locale, direction } = useLocale();
  const f = useLexFormat();

  return (
    <section
      className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6"
      dir={direction}
      lang={locale}
      aria-label={title}
    >
      <h2 className="text-h4 font-semibold text-foreground">{title}</h2>

      <div className="mt-5 space-y-5">
        {loading ? (
          Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-2 w-full rounded-full" />
            </div>
          ))
        ) : slices.length === 0 ? (
          <p className="text-body-sm text-muted-foreground">{emptyLabel}</p>
        ) : (
          slices.map((slice, index) => {
            const palette = BAR_PALETTE[index % BAR_PALETTE.length];
            const label = resolveLabel(slice.key);
            return (
              <Link
                key={slice.key}
                href={hrefFor(slice.key)}
                className="block space-y-2 rounded-xl p-1 outline-none transition-colors hover:bg-primary/5 focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={`${label} — ${ofTotal(f.formatNumber(slice.count))}`}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="text-body-sm font-semibold text-foreground">{label}</span>
                  <span className={`text-body-sm font-bold tabular-nums ${palette.text}`}>
                    {f.formatNumber(slice.pct)}%
                  </span>
                </div>
                <div
                  className="h-2 w-full overflow-hidden rounded-full bg-muted"
                  role="progressbar"
                  aria-valuenow={slice.pct}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={`${label} — ${ofTotal(f.formatNumber(slice.count))}`}
                >
                  <div
                    className={`h-full rounded-full ${palette.bar} transition-[width] duration-500`}
                    style={{ width: `${slice.pct}%` }}
                  />
                </div>
              </Link>
            );
          })
        )}
      </div>
    </section>
  );
}
