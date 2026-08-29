'use client';

import { cn } from '@/lib/utils';
import { formatPercentage } from '@/lib/format';
import { TONE_THEME_CLASS, type StatTone } from '@/components/shared/stat-card';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import type { AIValidationResult } from '@/types/ai-governance';
import { validationMetricLabel } from '../../../_lib/enum-labels';
import { ComparisonIndicator } from './comparison-indicator';

interface MetricsCardsProps {
  result: AIValidationResult;
}

export function MetricsCards({ result }: MetricsCardsProps) {
  const { locale } = useLocaleOrDefault();
  // Quality metrics keep RAG semantics: precision/recall/F1 are pass/health
  // (emerald); the false-positive rate is a failure rate (rose). Tone is a
  // decorative accent only — the large value text stays neutral.
  const cards: Array<{
    title: string;
    value: number;
    delta: number | null | undefined;
    inverse: boolean;
    tone: StatTone;
  }> = [
    {
      title: validationMetricLabel('precision', locale),
      value: result.precision,
      delta: result.deltas?.precision,
      inverse: false,
      tone: 'emerald',
    },
    {
      title: validationMetricLabel('recall', locale),
      value: result.recall,
      delta: result.deltas?.recall,
      inverse: false,
      tone: 'emerald',
    },
    {
      title: validationMetricLabel('f1Score', locale),
      value: result.f1_score,
      delta: result.deltas?.f1_score,
      inverse: false,
      tone: 'emerald',
    },
    {
      title: validationMetricLabel('falsePositiveRate', locale),
      value: result.false_positive_rate,
      delta: result.deltas?.false_positive_rate,
      inverse: true,
      tone: 'rose',
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
      {cards.map((card) => (
        <div key={card.title} className={cn('kpi-card-themed', TONE_THEME_CLASS[card.tone])}>
          <p className="text-base font-semibold text-[color:var(--kpi-accent)]">
            {card.title}
          </p>
          <div className="mt-3 text-4xl font-semibold tracking-[-0.06em] text-foreground">
            {formatPercentage(card.value, 1)}
          </div>
          <div className="mt-3">
            <ComparisonIndicator delta={card.delta} inverse={card.inverse} />
          </div>
        </div>
      ))}
    </div>
  );
}
