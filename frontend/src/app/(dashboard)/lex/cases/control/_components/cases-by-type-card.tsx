'use client';

/**
 * "Cases by Type" — the right-hand breakdown. A ranked set of horizontal meters
 * over the control-panel read model's `cases.by_type` aggregate. Percentages are
 * shares of the total case portfolio; type tokens are localized via
 * `resolveCaseTypeLabel`.
 */

import { useLocale } from '@/components/providers/locale-provider';
import { useLexFormat } from '@/lib/lex/ksa';
import { Skeleton } from '@/components/ui/skeleton';
import Link from 'next/link';
import { resolveCaseTypeLabel } from '../../[id]/_components/case-enums-i18n';
import type { CaseTypeSlice } from '../_lib/use-control-panel';
import { useControlPanelLabels } from '../_lib/labels';

/** Bar + matching percent-text colors, ranked by share (deep teal → gold → grey). */
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

export function CasesByTypeCard({
  slices,
  loading,
  kind = 'cases',
}: {
  slices: CaseTypeSlice[];
  loading?: boolean;
  kind?: 'cases' | 'investigations';
}) {
  const t = useControlPanelLabels();
  const { locale, direction } = useLocale();
  const f = useLexFormat();
  const copy = kind === 'investigations' ? t.investigationsByType : t.byType;

  return (
    <section
      className="rounded-[20px] border border-border bg-card p-5 shadow-sm sm:p-6"
      dir={direction}
      lang={locale}
      aria-label={copy.title}
    >
      <h2 className="text-h4 font-semibold text-foreground">{copy.title}</h2>

      <div className="mt-5 space-y-5">
        {loading ? (
          Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-2 w-full rounded-full" />
            </div>
          ))
        ) : slices.length === 0 ? (
          <p className="text-body-sm text-muted-foreground">{copy.empty}</p>
        ) : (
          slices.map((slice, index) => {
            const palette = BAR_PALETTE[index % BAR_PALETTE.length];
            const href =
              kind === 'investigations'
                ? `/lex/investigations?case_type=${encodeURIComponent(slice.key)}`
                : `/lex/cases?case_type=${encodeURIComponent(slice.key)}`;
            return (
              <Link
                key={slice.key}
                href={href}
                className="block space-y-2 rounded-xl p-1 outline-none transition-colors hover:bg-primary/5 focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={`${resolveCaseTypeLabel(slice.key, locale)} — ${copy.ofTotal(f.formatNumber(slice.count))}`}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="text-body-sm font-semibold text-foreground">
                    {resolveCaseTypeLabel(slice.key, locale)}
                  </span>
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
                  aria-label={`${resolveCaseTypeLabel(slice.key, locale)} — ${copy.ofTotal(f.formatNumber(slice.count))}`}
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
