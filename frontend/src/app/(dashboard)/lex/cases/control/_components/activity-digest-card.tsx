'use client';

/**
 * "Weekly Activity Digest" — the tinted panel under the type breakdown. Its copy
 * is composed from real counts in the control-panel read model: cases resolved
 * in its trailing seven-day window and cases currently on hold.
 */

import { useLocale } from '@/components/providers/locale-provider';
import { useLexFormat } from '@/lib/lex/ksa';
import { Skeleton } from '@/components/ui/skeleton';
import type { WeeklyDigest } from '../_lib/use-control-panel';
import { useControlPanelLabels } from '../_lib/labels';

export function ActivityDigestCard({
  digest,
  loading,
}: {
  digest: WeeklyDigest;
  loading?: boolean;
}) {
  const t = useControlPanelLabels();
  const { locale, direction } = useLocale();
  const f = useLexFormat();

  const lines: string[] = [];
  if (digest.total > 0) {
    lines.push(t.digest.resolved(f.formatNumber(digest.resolvedThisWeek)));
    lines.push(
      digest.onHold > 0
        ? t.digest.onHold(f.formatNumber(digest.onHold))
        : t.digest.allClear,
    );
  }

  return (
    <section
      className="rounded-2xl border border-border bg-muted/40 p-5 shadow-sm sm:p-6 dark:bg-muted/20"
      dir={direction}
      lang={locale}
      aria-label={t.digest.title}
    >
      <h2 className="text-h4 font-semibold text-foreground">{t.digest.title}</h2>

      <div className="mt-3 space-y-2">
        {loading ? (
          <>
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-11/12" />
            <Skeleton className="h-4 w-3/4" />
          </>
        ) : lines.length === 0 ? (
          <p className="text-body-sm leading-relaxed text-muted-foreground">
            {t.digest.empty}
          </p>
        ) : (
          <p className="text-body-sm leading-relaxed text-muted-foreground">
            {lines.join(' ')}
          </p>
        )}
      </div>
    </section>
  );
}
