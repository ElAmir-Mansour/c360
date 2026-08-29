/**
 * <ContractsCycleTimeCard> — the draft→active cycle-time headline for the
 * contracts ANALYTICS view.
 *
 * A stat tile (deliberately NOT a chart: three summary statistics carry the
 * message better than a plot) over the upgraded analytics payload's
 * `cycle_time` block: average, median (p50) and p90 days from draft to
 * active, annotated with the sample size and the timeline source so a
 * headline built on two contracts is never over-read.
 *
 * All numbers go through `useLexFormat` (Arabic-Indic digits in `ar`); layout
 * uses logical properties only, so RTL mirrors for free. Read-only.
 */

'use client';

import { Button } from '@/components/ui/button';

import { memo, useMemo } from 'react';
import { Timer } from 'lucide-react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { useLexFormat } from '@/lib/lex/ksa';
import type { LexContractCycleTimeStats } from '@/lib/lex/reports';
import { type LexBilingual, resolveLexBilingual } from '../../_lib/lex-i18n';

/* ---------------------------- Bilingual labels ---------------------------- */

interface CycleTimeLabels {
  title: string;
  description: string;
  average: string;
  median: string;
  p90: string;
  /** Unit suffix under each stat. */
  days: string;
  /** Sample-size chip. Receives a PRE-FORMATTED count string. */
  sample: (count: string) => string;
  /** Timeline sources keyed by the raw backend token. */
  source: Record<string, string>;
  emptyTitle: string;
  emptyDescription: string;
}

const cycleTimeLabels: LexBilingual<CycleTimeLabels> = {
  en: {
    title: 'Cycle time (draft → active)',
    description: 'How long contracts take from first draft to activation.',
    average: 'Average',
    median: 'Median (p50)',
    p90: 'p90',
    days: 'days',
    sample: (count) => `n = ${count}`,
    source: {
      duration_facts: 'From recorded duration facts',
      status_timeline: 'From the status timeline',
    },
    emptyTitle: 'No completed cycles yet',
    emptyDescription: 'No contract in scope has moved from draft to active.',
  },
  ar: {
    title: 'زمن الدورة (مسودة ← نشط)',
    description: 'المدة التي يستغرقها العقد من المسودة الأولى حتى التفعيل.',
    average: 'المتوسط',
    median: 'الوسيط (p50)',
    p90: 'p90',
    days: 'يومًا',
    sample: (count) => `ن = ${count}`,
    source: {
      duration_facts: 'من وقائع المدة المسجّلة',
      status_timeline: 'من الخط الزمني للحالات',
    },
    emptyTitle: 'لا توجد دورات مكتملة بعد',
    emptyDescription: 'لم ينتقل أي عقد ضمن النطاق من المسودة إلى النشاط.',
  },
};

export interface ContractsCycleTimeCardProps {
  /** `cycle_time` block; null/absent when the backend could not compute it. */
  stats: LexContractCycleTimeStats | null | undefined;
  loading?: boolean;
  className?: string;
  onAction?: () => void;
}

function ContractsCycleTimeCardImpl({ stats, loading = false, className, onAction }: ContractsCycleTimeCardProps) {
  const { locale } = useLocaleOrDefault();
  const f = useLexFormat();
  const labels = useMemo(() => resolveLexBilingual(cycleTimeLabels, locale), [locale]);

  const days = (value: number) => f.formatNumber(value, { maximumFractionDigits: 1 });

  const measures =
    stats && stats.sample_size > 0
      ? [
          { key: 'avg', label: labels.average, value: days(stats.avg_days) },
          { key: 'p50', label: labels.median, value: days(stats.p50_days) },
          { key: 'p90', label: labels.p90, value: days(stats.p90_days) },
        ]
      : [];

  const card = (
    <Card className={className}>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Timer className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          {labels.title}
        </CardTitle>
        <CardDescription>{labels.description}</CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="grid grid-cols-3 gap-3 animate-pulse motion-reduce:animate-none" aria-hidden>
            {[0, 1, 2].map((i) => (
              <div key={i} className="space-y-2">
                <div className="h-7 rounded-md bg-muted" />
                <div className="h-3 w-2/3 rounded-pill bg-muted" />
              </div>
            ))}
          </div>
        ) : measures.length === 0 ? (
          <div className="py-2">
            <p className="text-sm font-medium text-foreground">{labels.emptyTitle}</p>
            <p className="text-sm text-muted-foreground">{labels.emptyDescription}</p>
          </div>
        ) : (
          <div className="space-y-3">
            <dl className="grid grid-cols-3 gap-3">
              {measures.map((measure) => (
                <div key={measure.key}>
                  <dd className="text-2xl font-semibold tabular-nums text-foreground">
                    {measure.value}
                  </dd>
                  <dt className="text-xs text-muted-foreground">
                    {measure.label} · {labels.days}
                  </dt>
                </div>
              ))}
            </dl>
            <p className="text-xs text-muted-foreground">
              <span className="tabular-nums">{labels.sample(f.formatNumber(stats!.sample_size))}</span>
              <span className="ms-2">{labels.source[stats!.source] ?? stats!.source}</span>
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );

  if (!onAction) return card;

  return (
    <Button
      type="button"
      variant="ghost"
      onClick={onAction}
      className="h-auto w-full items-stretch justify-start rounded-xl p-0 text-start font-normal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {card}
    </Button>
  );
}

/** PERF: pure projection of its props — memo keeps steady-state renders free. */
export const ContractsCycleTimeCard = memo(ContractsCycleTimeCardImpl);
