'use client';

/**
 * BreakdownCard renders a single {key,count} aggregate (a `LexCountBucket[]`) as
 * a sorted, token-labelled distribution list inside a SectionCard. Used by every
 * analytics tab (cases / contracts / consultations) for the by-type /
 * by-department / by-status breakdowns. RTL-safe (logical spacing, text-start).
 */
import Link from 'next/link';
import { titleCase } from '@/lib/format';
import { SectionCard } from '@/components/suites/section-card';
import { Badge } from '@/components/ui/badge';
import { LexStatusChip, type LexStatusDomain } from '@/components/lex/status-chip';
import { rowAccentClass } from '@/components/lex/row-accents';
import { useLexFormat } from '@/lib/lex/ksa';
import { cn } from '@/lib/utils';
import type { LexCountBucket } from '@/lib/lex/reports';

interface BreakdownCardProps {
  title: string;
  buckets: LexCountBucket[];
  distributionLabel: string;
  emptyLabel: string;
  /** Optional localizer for the raw backend token; falls back to titleCase. */
  formatKey?: (key: string) => string;
  /** Optional detail-list URL builder for each bucket. */
  linkFor?: (key: string, bucket: LexCountBucket) => string;
  openLabel?: string;
  /**
   * When set, status buckets render the unified <LexStatusChip> (color + icon)
   * instead of a plain outline badge, and rows pick up a status-tinted accent.
   */
  statusDomain?: LexStatusDomain;
}

export function BreakdownCard({
  title,
  buckets,
  distributionLabel,
  emptyLabel,
  formatKey,
  linkFor,
  openLabel,
  statusDomain,
}: BreakdownCardProps) {
  const f = useLexFormat();
  const sorted = [...buckets].sort((left, right) => right.count - left.count);
  const max = sorted.reduce((peak, bucket) => Math.max(peak, bucket.count), 0);

  return (
    <SectionCard title={title} description={distributionLabel}>
      <div className="space-y-2.5">
        {sorted.length === 0 ? (
          <p className="text-sm text-muted-foreground">{emptyLabel}</p>
        ) : (
          sorted.map((bucket) => {
            const pct = max > 0 ? Math.round((bucket.count / max) * 100) : 0;
            const href = linkFor?.(bucket.key, bucket);
            const label = formatKey ? formatKey(bucket.key) : titleCase(bucket.key);
            // Status breakdowns read as color-coded, elevated rows; non-status
            // (type/department) stay neutral so the page isn't over-tinted.
            const accent = statusDomain ? rowAccentClass('status', bucket.key) : '';
            const content = (
              <>
                <div className="flex items-center justify-between gap-3">
                  {statusDomain ? (
                    <LexStatusChip value={bucket.key} domain={statusDomain} labels={undefined} size="sm" />
                  ) : (
                    <Badge variant="outline">{label}</Badge>
                  )}
                  <span className="text-sm font-medium tabular-nums">
                    {f.formatNumber(bucket.count)}
                  </span>
                </div>
                <div
                  className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
                  role="presentation"
                >
                  <div
                    className="h-full rounded-full bg-primary/70 transition-[width] duration-500"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </>
            );
            return (
              <div key={bucket.key} className={cn('space-y-1 rounded-lg px-2.5 py-2', accent)}>
                {href ? (
                  <Link
                    href={href}
                    aria-label={openLabel ? `${openLabel}: ${label}` : label}
                    className="block rounded-md p-1 -m-1 transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {content}
                  </Link>
                ) : (
                  content
                )}
              </div>
            );
          })
        )}
      </div>
    </SectionCard>
  );
}
