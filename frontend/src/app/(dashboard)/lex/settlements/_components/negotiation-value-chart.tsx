/**
 * Negotiation value-evolution chart + round timeline (FEATURE 10).
 *
 * Renders how the proposed settlement value moved across negotiation rounds: a
 * single line/area of `proposed_value` plotted over `round_number` (ascending),
 * with the final agreed value (`settlementValue`) drawn as a dashed reference
 * line and surfaced — alongside the delta from the first proposal to the final
 * agreed value — in a small stat strip. Below the chart sits a compact timeline
 * of every round (who proposed, the value, the outcome, and the relative time).
 *
 * Graceful degradation: the value chart needs at least two rounds that carry a
 * numeric `proposed_value` (one point cannot show evolution); with fewer it
 * shows a friendly note instead of an axis-less chart. The round timeline still
 * renders whenever there is at least one round.
 *
 * Self-contained bilingual labels (English + professional MSA) per the canonical
 * lex bilingual contract. Money is formatted via `formatSettlementValue`.
 * Legal glossary: تسوية (settlement) / مفاوضة (negotiation) / جولة (round) /
 * طرف مقابل (counterparty) / اعتماد (approval).
 *
 * Signature:
 *   <NegotiationValueChart
 *     rounds={settlement.rounds ?? []}
 *     currency={settlement.currency}
 *     settlementValue={settlement.value}
 *   />
 *
 * Mounts on the detail page ([id]/page.tsx) inside — or directly beneath — the
 * "Negotiation rounds" SectionCard (`labels.roundsTitle`), so the value story
 * sits next to the round list it summarizes.
 */

'use client';

import { Button } from '@/components/ui/button';

import { useMemo } from 'react';
import { Handshake, LineChart as LineChartIcon, TrendingDown, TrendingUp } from 'lucide-react';

import { LineChart } from '@/components/shared/charts/line-chart';
import { Timeline } from '@/components/shared/timeline';
import { Badge } from '@/components/ui/badge';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { CHART_COLORS } from '@/lib/design-tokens';
import { formatDateTime } from '@/lib/format';
import { formatSettlementValue, type SettlementNegotiationRound } from '@/lib/lex/settlements';
import type { AppLocale } from '@/lib/i18n';
import { type LexBilingual, resolveLexBilingual } from '../../_lib/lex-i18n';

/* ------------------------------------------------------------------------- *
 * Bilingual labels — self-contained per the lex contract.
 * ------------------------------------------------------------------------- */

interface NegotiationValueChartLabels {
  title: string;
  description: string;
  chartTitle: string;
  proposedSeries: string;
  agreedSeries: string;
  roundAxis: (n: number) => string;
  timelineTitle: string;
  stats: {
    firstProposal: string;
    finalAgreed: string;
    latestProposal: string;
    delta: string;
    notAgreed: string;
  };
  delta: {
    increase: (amount: string) => string;
    decrease: (amount: string) => string;
    unchanged: string;
  };
  emptyTitle: string;
  emptyDescription: string;
  singleTitle: string;
  singleDescription: string;
  unvaluedRound: string;
  proposedByFallback: string;
}

const labelsBundle: LexBilingual<NegotiationValueChartLabels> = {
  en: {
    title: 'Value Evolution',
    description: 'How the proposed value moved across negotiation rounds toward the agreed amount.',
    chartTitle: 'Proposed value by round',
    proposedSeries: 'Proposed value',
    agreedSeries: 'Agreed value',
    roundAxis: (n) => `R${n}`,
    timelineTitle: 'Round timeline',
    stats: {
      firstProposal: 'First proposal',
      finalAgreed: 'Agreed value',
      latestProposal: 'Latest proposal',
      delta: 'Movement to agreed',
      notAgreed: 'Not yet agreed',
    },
    delta: {
      increase: (amount) => `▲ ${amount} higher`,
      decrease: (amount) => `▼ ${amount} lower`,
      unchanged: 'No change',
    },
    emptyTitle: 'No valued rounds yet',
    emptyDescription: 'Record negotiation rounds with a proposed value to chart how the offer evolves.',
    singleTitle: 'One valued round so far',
    singleDescription: 'The value chart appears once a second round carries a proposed value to compare.',
    unvaluedRound: 'No value',
    proposedByFallback: 'Counterparty',
  },
  ar: {
    title: 'تطوّر القيمة',
    description: 'كيف تحرّكت القيمة المقترحة عبر جولات التفاوض وصولًا إلى المبلغ المتفق عليه.',
    chartTitle: 'القيمة المقترحة حسب الجولة',
    proposedSeries: 'القيمة المقترحة',
    agreedSeries: 'القيمة المتفق عليها',
    roundAxis: (n) => `ج${n}`,
    timelineTitle: 'مسار الجولات',
    stats: {
      firstProposal: 'العرض الأول',
      finalAgreed: 'القيمة المتفق عليها',
      latestProposal: 'أحدث عرض',
      delta: 'التحرّك نحو المتفق عليه',
      notAgreed: 'لم يُتفق بعد',
    },
    delta: {
      increase: (amount) => `▲ أعلى بمقدار ${amount}`,
      decrease: (amount) => `▼ أقل بمقدار ${amount}`,
      unchanged: 'دون تغيير',
    },
    emptyTitle: 'لا توجد جولات بقيمة بعد',
    emptyDescription: 'سجّل جولات تفاوض بقيمة مقترحة لعرض كيفية تطوّر العرض.',
    singleTitle: 'جولة واحدة بقيمة حتى الآن',
    singleDescription: 'يظهر مخطط القيمة عند وجود جولة ثانية تحمل قيمة مقترحة للمقارنة.',
    unvaluedRound: 'بلا قيمة',
    proposedByFallback: 'الطرف المقابل',
  },
};

function useNegotiationValueChartLabels(): NegotiationValueChartLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo<NegotiationValueChartLabels>(() => resolveLexBilingual(labelsBundle, locale as AppLocale), [locale]);
}

/* ------------------------------------------------------------------------- *
 * Derivation.
 * ------------------------------------------------------------------------- */

const PROPOSED_COLOR = CHART_COLORS[0];
const AGREED_COLOR = CHART_COLORS[1];

interface ValuePoint extends Record<string, unknown> {
  roundId: string;
  round: number;
  proposed: number;
  agreed?: number;
}

interface DerivedValueChart {
  /** Rounds sorted ascending by round_number (all of them, for the timeline). */
  sortedRounds: SettlementNegotiationRound[];
  /** Chart points for rounds that carry a numeric proposed value. */
  points: ValuePoint[];
  firstProposed: number | null;
  latestProposed: number | null;
  /** Delta from first proposal to the agreed value when agreed; else to latest. */
  deltaFromFirst: number | null;
  /** Currency to format with: explicit settlement currency, else first round's. */
  currency: string | null;
  hasAgreed: boolean;
}

function deriveValueChart(
  rounds: SettlementNegotiationRound[],
  settlementValue: number | null | undefined,
  currency: string | null | undefined,
): DerivedValueChart {
  const sortedRounds = [...rounds].sort((a, b) => a.round_number - b.round_number);

  const hasAgreed = settlementValue !== null && settlementValue !== undefined;
  const valued = sortedRounds.filter((r) => r.proposed_value !== null && r.proposed_value !== undefined);

  const points: ValuePoint[] = valued.map((r) => ({
    roundId: r.id,
    round: r.round_number,
    proposed: r.proposed_value as number,
    ...(hasAgreed ? { agreed: settlementValue as number } : {}),
  }));

  const firstProposed = valued.length > 0 ? (valued[0].proposed_value as number) : null;
  const latestProposed = valued.length > 0 ? (valued[valued.length - 1].proposed_value as number) : null;

  // Compare the first proposal against the agreed value (preferred) or, when not
  // yet agreed, against the latest proposal — the spec's "delta from first to final".
  const target = hasAgreed ? (settlementValue as number) : latestProposed;
  const deltaFromFirst = firstProposed !== null && target !== null ? target - firstProposed : null;

  const resolvedCurrency = currency ?? sortedRounds.find((r) => r.currency)?.currency ?? null;

  return {
    sortedRounds,
    points,
    firstProposed,
    latestProposed,
    deltaFromFirst,
    currency: resolvedCurrency,
    hasAgreed,
  };
}

/* ------------------------------------------------------------------------- *
 * Component.
 * ------------------------------------------------------------------------- */

export interface NegotiationValueChartProps {
  rounds: SettlementNegotiationRound[];
  /** Settlement currency; falls back to the first round's currency for money copy. */
  currency?: string | null;
  /** The final agreed settlement value, drawn as a dashed reference + delta target. */
  settlementValue?: number | null;
  /** Opens or focuses the exact negotiation round represented by a point/stat. */
  onRoundSelect: (roundId: string) => void;
  className?: string;
}

export function NegotiationValueChart({
  rounds,
  currency,
  settlementValue,
  onRoundSelect,
  className,
}: NegotiationValueChartProps) {
  const labels = useNegotiationValueChartLabels();
  const { direction } = useLocaleOrDefault();

  const derived = useMemo(
    () => deriveValueChart(rounds, settlementValue, currency),
    [rounds, settlementValue, currency],
  );

  const money = (value: number | null | undefined): string => formatSettlementValue(value, derived.currency);

  const yKeys = useMemo(
    () => [
      { key: 'proposed', label: labels.proposedSeries, color: PROPOSED_COLOR },
      ...(derived.hasAgreed
        ? [
            {
              key: 'agreed',
              label: labels.agreedSeries,
              color: AGREED_COLOR,
              dashed: true,
            },
          ]
        : []),
    ],
    [labels.proposedSeries, labels.agreedSeries, derived.hasAgreed],
  );

  const timelineItems = useMemo(
    () =>
      derived.sortedRounds.map((round) => {
        const valued = round.proposed_value !== null && round.proposed_value !== undefined;
        const valuePart = valued
          ? formatSettlementValue(round.proposed_value, round.currency ?? derived.currency)
          : labels.unvaluedRound;
        const descriptionParts = [valuePart];
        if (round.outcome) {
          descriptionParts.push(round.outcome);
        }
        return {
          id: round.id,
          icon: Handshake,
          variant: 'default' as const,
          title: `${labels.roundAxis(round.round_number)} · ${round.proposed_by || labels.proposedByFallback}`,
          description: descriptionParts.join(' · '),
          timestamp: formatDateTime(round.created_at),
        };
      }),
    [derived.sortedRounds, derived.currency, labels],
  );

  // Nothing recorded at all — let the host's empty state cover it; render nothing.
  if (derived.sortedRounds.length === 0) {
    return null;
  }

  const canChart = derived.points.length >= 2;
  const deltaPositive = (derived.deltaFromFirst ?? 0) > 0;
  const deltaNegative = (derived.deltaFromFirst ?? 0) < 0;

  return (
    <div className={className} dir={direction}>
      <div className="mb-3 flex items-center gap-2">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          <LineChartIcon className="h-3.5 w-3.5" aria-hidden />
        </span>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold leading-tight">{labels.title}</h3>
          <p className="text-xs text-muted-foreground">{labels.description}</p>
        </div>
      </div>

      {/* Stat strip: first proposal, agreed value, and the movement between them. */}
      {derived.firstProposed !== null ? (
        <div className="mb-4 grid gap-3 sm:grid-cols-3">
          <Button
            type="button"
            variant="ghost"
            onClick={() => onRoundSelect(derived.points[0].roundId)}
            className="h-auto flex-col items-stretch rounded-xl border border-[color:var(--panel-border)] bg-card/50 p-3 text-start font-normal outline-none transition-colors hover:border-primary/30 hover:bg-primary/5 focus-visible:ring-2 focus-visible:ring-ring"
          >
            <p className="text-xs text-muted-foreground">{labels.stats.firstProposal}</p>
            <p className="mt-1 text-sm font-semibold">{money(derived.firstProposed)}</p>
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onRoundSelect(derived.points[derived.points.length - 1].roundId)}
            className="h-auto flex-col items-stretch rounded-xl border border-[color:var(--panel-border)] bg-card/50 p-3 text-start font-normal outline-none transition-colors hover:border-primary/30 hover:bg-primary/5 focus-visible:ring-2 focus-visible:ring-ring"
          >
            <p className="text-xs text-muted-foreground">
              {derived.hasAgreed ? labels.stats.finalAgreed : labels.stats.latestProposal}
            </p>
            <p className="mt-1 text-sm font-semibold">
              {derived.hasAgreed
                ? money(settlementValue)
                : derived.latestProposed !== null
                  ? money(derived.latestProposed)
                  : labels.stats.notAgreed}
            </p>
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onRoundSelect(derived.points[derived.points.length - 1].roundId)}
            className="h-auto flex-col items-stretch rounded-xl border border-[color:var(--panel-border)] bg-card/50 p-3 text-start font-normal outline-none transition-colors hover:border-primary/30 hover:bg-primary/5 focus-visible:ring-2 focus-visible:ring-ring"
          >
            <p className="text-xs text-muted-foreground">{labels.stats.delta}</p>
            <p
              className={`mt-1 flex items-center gap-1.5 text-sm font-semibold ${
                deltaPositive ? 'text-success-600' : deltaNegative ? 'text-destructive' : 'text-foreground'
              }`}
            >
              {deltaPositive ? (
                <TrendingUp className="h-3.5 w-3.5" aria-hidden />
              ) : deltaNegative ? (
                <TrendingDown className="h-3.5 w-3.5" aria-hidden />
              ) : null}
              {derived.deltaFromFirst === null || derived.deltaFromFirst === 0
                ? labels.delta.unchanged
                : derived.deltaFromFirst > 0
                  ? labels.delta.increase(money(Math.abs(derived.deltaFromFirst)))
                  : labels.delta.decrease(money(Math.abs(derived.deltaFromFirst)))}
            </p>
          </Button>
        </div>
      ) : null}

      {/* Value evolution chart (needs >= 2 valued rounds) or a friendly note. */}
      {canChart ? (
        <div className="rounded-xl border border-[color:var(--panel-border)] bg-card/50 p-4">
          <LineChart
            data={derived.points}
            xKey="round"
            yKeys={yKeys}
            title={labels.chartTitle}
            height={240}
            xFormatter={(value) => labels.roundAxis(Number(value))}
            yFormatter={(value) => money(value)}
            tooltipFormatter={(value) => money(value)}
            onItemSelect={(datum) => onRoundSelect(String(datum.roundId ?? ''))}
          />
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-[color:var(--panel-border)] bg-card/30 px-4 py-8 text-center">
          <LineChartIcon className="h-7 w-7 text-muted-foreground/40" aria-hidden />
          <p className="text-sm font-medium">{derived.points.length === 1 ? labels.singleTitle : labels.emptyTitle}</p>
          <p className="text-sm text-muted-foreground">
            {derived.points.length === 1 ? labels.singleDescription : labels.emptyDescription}
          </p>
        </div>
      )}

      {/* Compact round timeline. */}
      <div className="mt-4">
        <div className="mb-2 flex items-center gap-2">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {labels.timelineTitle}
          </h4>
          <Badge variant="outline" className="text-[11px]">
            {derived.sortedRounds.length}
          </Badge>
        </div>
        <Timeline items={timelineItems} />
      </div>
    </div>
  );
}

export default NegotiationValueChart;
