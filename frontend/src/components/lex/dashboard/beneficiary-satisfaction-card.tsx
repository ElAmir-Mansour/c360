'use client';

/**
 * Beneficiary Satisfaction Rate — a shared control-panel card surfacing the
 * aggregated requester-feedback score for the legal service desk.
 *
 * The score is the live `AVG(rating)` (0–5 scale) returned by the director
 * analytics endpoint (`GET /reports/detailed-analytics` →
 * `summary.satisfaction_score`). This is the SAME number rendered on the
 * Reports → Analytics deck, so the workspace panels and the analytics page never
 * disagree. The card is self-contained (fetches + gates + fail-soft its own
 * query) so it drops into any dashboard column with a single `<… />`.
 *
 * Behaviour:
 *   - Ungated (`lex:report:read` absent) ⇒ renders nothing, so a lightly
 *     permissioned persona sees a clean panel (mirrors the role-dashboard
 *     self-hide rule).
 *   - Gated but no ratings yet (unavailable / sample 0) ⇒ a calm empty state,
 *     never a fabricated number.
 *   - Otherwise ⇒ the score out of 5, a threshold-toned meter, and an honest
 *     "based on N ratings" caption.
 *
 * Token-only + bilingual + RTL, matching the control-panel visual vocabulary
 * (`rounded-2xl border bg-card shadow-sm`).
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Star } from 'lucide-react';

import { useAuth } from '@/hooks/use-auth';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { useLexFormat } from '@/lib/lex/ksa';
import { Skeleton } from '@/components/ui/skeleton';
import { lexReportsApi, type LexReportQuery } from '@/lib/lex/reports';
import {
  resolveLexBilingual,
  type LexBilingual,
} from '@/app/(dashboard)/lex/_lib/lex-i18n';
import { cn } from '@/lib/utils';

const MAX_SCORE = 5;

interface BeneficiarySatisfactionLabels {
  title: string;
  /** Fixed denominator suffix rendered after the score (e.g. "/ 5"). */
  denominator: string;
  /** Full "score / 5" phrasing — used for the accessible meter label. */
  outOf: (score: string) => string;
  basedOn: (count: string) => string;
  empty: string;
  emptyHint: string;
}

const labels: LexBilingual<BeneficiarySatisfactionLabels> = {
  en: {
    title: 'Beneficiary Satisfaction Rate',
    denominator: '/ 5',
    outOf: (score) => `${score} / 5`,
    basedOn: (count) => `Based on ${count} beneficiary ratings`,
    empty: 'No ratings yet',
    emptyHint: 'Satisfaction is measured once beneficiaries rate closed requests.',
  },
  ar: {
    title: 'معدل رضا المستفيدين',
    denominator: '/ ٥',
    outOf: (score) => `${score} / ٥`,
    basedOn: (count) => `استنادًا إلى ${count} تقييمًا من المستفيدين`,
    empty: 'لا توجد تقييمات بعد',
    emptyHint: 'يُحتسب الرضا بمجرد تقييم المستفيدين للطلبات المُنجزة.',
  },
};

/** Meter tone by score band (never colour alone — the score value carries it). */
function bandClass(ratio: number): { bar: string; text: string } {
  if (ratio >= 0.8) {
    return { bar: 'bg-status-success', text: 'text-status-success' };
  }
  if (ratio >= 0.6) {
    return { bar: 'bg-status-warning', text: 'text-status-warning' };
  }
  return { bar: 'bg-status-error', text: 'text-status-error' };
}

export interface BeneficiarySatisfactionCardProps {
  /** Optional report filters (e.g. narrow to a department). */
  filters?: LexReportQuery;
  className?: string;
}

export function BeneficiarySatisfactionCard({
  filters,
  className,
}: BeneficiarySatisfactionCardProps) {
  const { hasPermission } = useAuth();
  const { locale, direction } = useLocaleOrDefault();
  const f = useLexFormat();
  const t = useMemo(() => resolveLexBilingual(labels, locale), [locale]);

  const canRead = hasPermission('lex:report:read');

  const query = useQuery({
    queryKey: ['lex-beneficiary-satisfaction', filters ?? null],
    queryFn: () => lexReportsApi.getDetailedAnalytics(filters ?? {}),
    enabled: canRead,
    staleTime: 60_000,
    retry: false,
  });

  // Self-hide entirely when the persona cannot read analytics.
  if (!canRead) {
    return null;
  }

  const metric = query.data?.summary.satisfaction_score;
  const isLoading = query.isLoading;
  const hasScore = Boolean(metric?.available) && (metric?.sample_size ?? 0) > 0;
  const rawScore = metric?.value ?? 0;
  const score = Math.min(MAX_SCORE, Math.max(0, rawScore));
  const ratio = score / MAX_SCORE;
  const band = bandClass(ratio);

  return (
    <section
      className={cn(
        'rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6',
        className,
      )}
      dir={direction}
      lang={locale}
      aria-label={t.title}
    >
      <div className="flex items-center gap-2">
        <Star className="h-4 w-4 text-brand-gold-600 dark:text-brand-gold-400" aria-hidden />
        <h2 className="text-h4 font-semibold text-foreground">{t.title}</h2>
      </div>

      {isLoading ? (
        <div className="mt-5 space-y-3">
          <Skeleton className="h-9 w-24" />
          <Skeleton className="h-2 w-full rounded-full" />
          <Skeleton className="h-4 w-40" />
        </div>
      ) : !hasScore ? (
        <div className="mt-4">
          <p className="text-body-sm font-medium text-foreground">{t.empty}</p>
          <p className="mt-1 text-body-sm text-muted-foreground">{t.emptyHint}</p>
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          <p className="flex items-baseline gap-1.5">
            <span
              className={cn(
                'text-4xl font-bold leading-none tabular-nums',
                band.text,
              )}
            >
              {f.formatNumber(Number(score.toFixed(1)))}
            </span>
            <span className="text-body-sm font-medium text-muted-foreground">
              {t.denominator}
            </span>
          </p>
          <div
            className="h-2 w-full overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-valuenow={Number(score.toFixed(1))}
            aria-valuemin={0}
            aria-valuemax={MAX_SCORE}
            aria-label={t.outOf(f.formatNumber(Number(score.toFixed(1))))}
          >
            <div
              className={cn('h-full rounded-full transition-[width] duration-500', band.bar)}
              style={{ width: `${Math.round(ratio * 100)}%` }}
            />
          </div>
          <p className="text-body-sm text-muted-foreground">
            {t.basedOn(f.formatNumber(metric?.sample_size ?? 0))}
          </p>
        </div>
      )}
    </section>
  );
}
