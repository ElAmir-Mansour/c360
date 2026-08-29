'use client';

// DEAL SUMMARY STRIP — the prominent headline panel a rep leads with, for the
// currently-highlighted (recommended/selected) tier. Four figures: total monthly,
// TOTAL CONTRACT VALUE (the hero), effective per-unit rate, and the annualized
// figure. Updates live with inputs.
//
// It reads ONLY masked ClientTier fields (total_monthly, contract_value) via the
// dealSummary() derivation — no internal margin is referenced here, so there is
// nothing to gate. The headline totals count up smoothly on change; a subtle
// "recalculating…" affordance + opacity dip is shown while a debounced recompute
// is in flight.

import { Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { useLocale, useT } from '@/components/providers/locale-provider';
import { useCountUp } from '../_lib/use-count-up';
import { dealSummary, TIER_LABEL_KEY } from '../_lib/pricing-derive';
import type { PricingModel, PricingTierRow } from '../_lib/types';

interface DealSummaryProps {
  row: PricingTierRow;
  model: PricingModel;
  users: number;
  cores: number;
  currency: string;
  /** Dim + show a recalculating affordance while a recompute is in flight. */
  fetching?: boolean;
}

export function DealSummary({
  row,
  model,
  users,
  cores,
  currency,
  fetching = false,
}: DealSummaryProps) {
  const t = useT();
  const { locale } = useLocale();

  const summary = dealSummary(row, model, users, cores);

  // Smoothly ease the two hero figures on change.
  const monthly = useCountUp(summary.totalMonthly);
  const contract = useCountUp(summary.contractValue);

  const money = (n: number) =>
    new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: currency || 'SAR',
      maximumFractionDigits: 0,
    }).format(n);

  const perUnitLabel =
    model === 'per_core'
      ? t('platformConsole.pricing.summary.perCore')
      : t('platformConsole.pricing.summary.perUser');

  return (
    <Card
      data-testid="deal-summary"
      className={
        'border-primary/25 bg-primary/5 ' +
        (fetching ? 'opacity-70 transition-opacity' : 'transition-opacity')
      }
    >
      <CardContent className="space-y-4 p-6">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-muted-foreground">
            {t('platformConsole.pricing.summary.leadWith')}
          </span>
          <Badge variant="default">{t(TIER_LABEL_KEY[row.tier])}</Badge>
          {fetching ? (
            <span
              className="ms-auto inline-flex items-center gap-1.5 text-xs text-muted-foreground"
              role="status"
              aria-live="polite"
            >
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              {t('platformConsole.pricing.recalculating')}
            </span>
          ) : null}
        </div>

        <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
          {/* Total contract value — the hero. */}
          <div className="space-y-1 sm:order-1">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground text-start">
              {t('platformConsole.pricing.summary.contractValue')}
            </p>
            <p className="text-2xl font-bold tabular-nums text-primary text-start sm:text-3xl">
              {money(contract)}
            </p>
          </div>

          {/* Total monthly. */}
          <div className="space-y-1 sm:order-2">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground text-start">
              {t('platformConsole.pricing.summary.totalMonthly')}
            </p>
            <p className="text-xl font-semibold tabular-nums text-foreground text-start">
              {money(monthly)}
              <span className="ms-1 text-sm font-normal text-muted-foreground">
                {t('platformConsole.pricing.summary.perMonth')}
              </span>
            </p>
          </div>

          {/* Effective per-unit rate. */}
          <div className="space-y-1 sm:order-3">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground text-start">
              {t('platformConsole.pricing.summary.perUnit')}
            </p>
            <p className="text-xl font-semibold tabular-nums text-foreground text-start">
              {summary.perUnit != null ? (
                <>
                  {money(summary.perUnit)}
                  <span className="ms-1 text-sm font-normal text-muted-foreground">
                    {perUnitLabel}
                  </span>
                </>
              ) : (
                <span className="text-base font-normal text-muted-foreground">
                  {t('platformConsole.pricing.summary.perUnitNa')}
                </span>
              )}
            </p>
          </div>

          {/* Annualized. */}
          <div className="space-y-1 sm:order-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground text-start">
              {t('platformConsole.pricing.summary.annualized')}
            </p>
            <p className="text-xl font-semibold tabular-nums text-foreground text-start">
              {money(summary.annualized)}
              <span className="ms-1 text-sm font-normal text-muted-foreground">
                {t('platformConsole.pricing.summary.perYear')}
              </span>
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
