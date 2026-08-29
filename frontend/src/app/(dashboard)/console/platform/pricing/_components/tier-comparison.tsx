'use client';

// The live 4-tier COMPARISON surface. It now leads with responsive TIER CARDS
// (Standard / Growth / Professional / Customized), one elevated as
// "Recommended / Most Popular", each with a headline SAR/mo price, a compact
// line-item summary, a derived features list, savings storytelling, and a
// "Quote this tier" CTA that wires into the existing Save-Quote flow. A "Compare
// all details" toggle reveals the EXISTING detailed line-item table (reused
// verbatim) for buyers who want the full breakdown.
//
// The INTERNAL MARGIN panel (per-tier internal cost, gross profit, realized
// margin %, OK / BELOW-FLOOR badge) is UNCHANGED and still a SEPARATE surface,
// rendered ONLY when `showMargin` is true AND the rows actually carry an
// `internal` block (the server structurally masks — a non-admin never receives
// it). A non-admin must never see margin: the page gates `showMargin` on
// pricing:admin, and none of the new card/summary/savings code reads the
// `internal` block at all.

import { useState } from 'react';
import { TrendingUp, ChevronDown, ChevronUp, Sparkles, Check, Zap } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useLocale, useT } from '@/components/providers/locale-provider';
import { cn } from '@/lib/utils';
import { TIER_ORDER, type PricingModel, type PricingTier, type PricingTierRow } from '../_lib/types';
import {
  RECOMMENDED_TIER,
  TIER_LABEL_KEY,
  TIER_POSITIONING_KEY,
  TIER_AI_ALLOWANCE_KEY,
  deploymentEligible,
  totalSavings,
  savingsFraction,
  volumeDriver,
  nextVolumeNudge,
} from '../_lib/pricing-derive';

interface TierComparisonProps {
  tiers: PricingTierRow[];
  model: PricingModel;
  currency: string;
  /** True only for pricing:admin — the page's sole gate for the margin panel. */
  showMargin: boolean;
  /** Dim the surfaces while a debounced recompute is in flight. */
  fetching?: boolean;
  /** Contract term (months) — drives the term-commitment savings callout. */
  termMonths: number;
  /** Active users driver (per_user model) — drives the volume nudge. */
  users: number;
  /** Active cores driver (per_core model) — drives the volume nudge. */
  cores: number;
  /** Which tile is elevated as recommended. Defaults to Professional. */
  recommendedTier?: PricingTier;
  /** Fires when a card's "Quote this tier" CTA is pressed (opens Save-Quote). */
  onQuoteTier?: (tier: PricingTier) => void;
}

export function TierComparison({
  tiers,
  model,
  currency,
  showMargin,
  fetching = false,
  termMonths,
  users,
  cores,
  recommendedTier = RECOMMENDED_TIER,
  onQuoteTier,
}: TierComparisonProps) {
  const t = useT();
  const { locale } = useLocale();
  const [showDetails, setShowDetails] = useState(false);

  // Order the incoming rows canonically (defensive — the API already returns
  // them in this order) and index by tier for lookup.
  const byTier = new Map(tiers.map((row) => [row.tier, row]));
  const ordered = TIER_ORDER.map((tier) => byTier.get(tier)).filter(
    (r): r is PricingTierRow => Boolean(r),
  );

  const money = (n: number) =>
    new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: currency || 'SAR',
      maximumFractionDigits: 2,
    }).format(n);

  const moneyRound = (n: number) =>
    new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: currency || 'SAR',
      maximumFractionDigits: 0,
    }).format(n);

  const pct = (fraction: number) =>
    new Intl.NumberFormat(locale, {
      style: 'percent',
      maximumFractionDigits: 1,
    }).format(fraction);

  const num = (n: number) => new Intl.NumberFormat(locale).format(n);

  // The storage line is model-conditional: per_user shows data storage,
  // per_core shows VM infrastructure.
  const usageRowKey: keyof PricingTierRow['line_items'] =
    model === 'per_core' ? 'vm_infrastructure' : 'data_storage';
  const usageRowLabel =
    model === 'per_core'
      ? t('platformConsole.pricing.rowVmInfrastructure')
      : t('platformConsole.pricing.rowDataStorage');

  // Client-facing detail rows (value readers over a tier row) — reused as-is by
  // the "Compare all details" table.
  const rows: {
    label: string;
    get: (r: PricingTierRow) => number;
    strong?: boolean;
    discount?: boolean;
  }[] = [
    { label: t('platformConsole.pricing.rowBaseCharge'), get: (r) => r.line_items.base_charge },
    { label: t('platformConsole.pricing.rowAiAllocation'), get: (r) => r.line_items.ai_allocation },
    { label: usageRowLabel, get: (r) => r.line_items[usageRowKey] },
    { label: t('platformConsole.pricing.rowSetupPremium'), get: (r) => r.line_items.deployment_setup_premium },
    { label: t('platformConsole.pricing.rowSubTotal'), get: (r) => r.sub_total, strong: true },
    { label: t('platformConsole.pricing.rowVolumeDiscount'), get: (r) => r.volume_discount, discount: true },
    { label: t('platformConsole.pricing.rowTermDiscount'), get: (r) => r.term_discount, discount: true },
    { label: t('platformConsole.pricing.rowSalesDiscount'), get: (r) => r.sales_discount, discount: true },
    { label: t('platformConsole.pricing.rowNetSubTotal'), get: (r) => r.net_sub_total, strong: true },
    { label: t('platformConsole.pricing.rowVat'), get: (r) => r.vat },
  ];

  // A discount is stored as a positive number; display it as a subtraction.
  const discountCell = (n: number) => (n > 0 ? `− ${money(n)}` : money(0));

  const hasInternal = ordered.some((r) => r.internal);

  // Volume nudge — the same for every card (driven by the active model driver).
  const driver = volumeDriver(model, users, cores);
  const nudge = nextVolumeNudge(driver);

  return (
    <div className="space-y-6">
      {/* TIER CARDS */}
      <div
        data-testid="tier-cards"
        aria-label={t('platformConsole.pricing.comparisonAria')}
        className={cn(
          'grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4',
          fetching ? 'opacity-70 transition-opacity' : 'transition-opacity',
        )}
      >
        {ordered.map((r) => {
          const isRecommended = r.tier === recommendedTier;
          const savings = totalSavings(r);
          const savingsPct = savingsFraction(r);
          const showTermCallout = termMonths >= 12 && savings > 0;

          return (
            <Card
              key={r.tier}
              data-testid={`tier-card-${r.tier}`}
              className={cn(
                'relative flex flex-col',
                isRecommended &&
                  'border-primary/50 shadow-elevation-3 ring-1 ring-primary/30',
              )}
            >
              {isRecommended ? (
                <div className="absolute -top-3 start-1/2 -translate-x-1/2 rtl:translate-x-1/2">
                  <Badge
                    variant="default"
                    className="gap-1 shadow-elevation-2"
                    data-testid="tier-recommended-badge"
                  >
                    <Sparkles className="h-3 w-3" aria-hidden />
                    {t('platformConsole.pricing.cards.recommended')}
                  </Badge>
                </div>
              ) : null}

              <CardHeader className="space-y-1 pb-3">
                <CardTitle className="text-base text-start">
                  {t(TIER_LABEL_KEY[r.tier])}
                </CardTitle>
                <p className="text-xs text-muted-foreground text-start">
                  {t(TIER_POSITIONING_KEY[r.tier])}
                </p>
              </CardHeader>

              <CardContent className="flex flex-1 flex-col gap-4">
                {/* Headline price */}
                <div className="text-start">
                  <span className="text-2xl font-bold tabular-nums text-foreground">
                    {moneyRound(r.total_monthly)}
                  </span>
                  <span className="ms-1 text-sm font-normal text-muted-foreground">
                    {t('platformConsole.pricing.summary.perMonth')}
                  </span>
                  <p className="mt-0.5 text-xs text-muted-foreground text-start">
                    {t('platformConsole.pricing.cards.contractValueLabel')}{' '}
                    <span className="font-medium tabular-nums text-foreground">
                      {moneyRound(r.contract_value)}
                    </span>
                  </p>
                </div>

                {/* Savings storytelling — term commitment callout. */}
                {showTermCallout ? (
                  <div
                    data-testid={`tier-savings-${r.tier}`}
                    className="flex items-start gap-2 rounded-lg border border-success-300/50 bg-success-50 px-2.5 py-2 text-xs text-success-700 dark:border-success-700/50 dark:bg-success-700/10 dark:text-success-300"
                  >
                    <Zap className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                    <span className="text-start">
                      {t('platformConsole.pricing.cards.saveWithTerm')
                        .replace('{pct}', pct(savingsPct))
                        .replace('{amount}', money(savings))
                        .replace('{term}', num(termMonths))}
                    </span>
                  </div>
                ) : null}

                {/* Compact line-item summary. */}
                <dl className="space-y-1.5 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <dt className="text-muted-foreground text-start">
                      {t('platformConsole.pricing.rowBaseCharge')}
                    </dt>
                    <dd className="tabular-nums text-foreground text-end">
                      {money(r.line_items.base_charge)}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <dt className="text-muted-foreground text-start">{usageRowLabel}</dt>
                    <dd className="tabular-nums text-foreground text-end">
                      {money(r.line_items[usageRowKey])}
                    </dd>
                  </div>
                  {savings > 0 ? (
                    <div className="flex items-center justify-between gap-2">
                      <dt className="text-muted-foreground text-start">
                        {t('platformConsole.pricing.cards.totalSavings')}
                      </dt>
                      <dd className="tabular-nums text-success-700 dark:text-success-300 text-end">
                        − {money(savings)}
                      </dd>
                    </div>
                  ) : null}
                </dl>

                {/* Features list — derived from the tier identity (no margin). */}
                <ul className="space-y-1.5 text-xs">
                  <li className="flex items-start gap-1.5">
                    <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
                    <span className="text-start text-foreground">
                      {t(TIER_AI_ALLOWANCE_KEY[r.tier])}
                    </span>
                  </li>
                  <li className="flex items-start gap-1.5">
                    <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
                    <span className="text-start text-foreground">
                      {deploymentEligible(r.tier)
                        ? t('platformConsole.pricing.cards.deployAll')
                        : t('platformConsole.pricing.cards.deploySaasOnly')}
                    </span>
                  </li>
                </ul>

                {/* Primary CTA — wires into the existing Save-Quote flow. */}
                <div className="mt-auto pt-1">
                  <Button
                    className="w-full"
                    variant={isRecommended ? 'default' : 'outline'}
                    onClick={() => onQuoteTier?.(r.tier)}
                    data-testid={`tier-quote-cta-${r.tier}`}
                  >
                    {t('platformConsole.pricing.cards.quoteThisTier')}
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Volume nudge — one tasteful highlight below the cards. */}
      {nudge ? (
        <div
          data-testid="volume-nudge"
          className="flex items-center gap-2 rounded-lg border border-primary/25 bg-primary/5 px-3.5 py-2.5 text-sm text-foreground"
        >
          <TrendingUp className="h-4 w-4 shrink-0 text-primary" aria-hidden />
          <span className="text-start">
            {t('platformConsole.pricing.cards.volumeNudge')
              .replace('{n}', num(nudge.needed))
              .replace('{pct}', pct(nudge.pct))}
          </span>
        </div>
      ) : null}

      {/* Compare all details — reveals the EXISTING detailed line-item table. */}
      <div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowDetails((v) => !v)}
          aria-expanded={showDetails}
          aria-controls="pricing-detail-table"
          data-testid="compare-details-toggle"
        >
          {showDetails ? (
            <ChevronUp className="me-1.5 h-4 w-4" aria-hidden />
          ) : (
            <ChevronDown className="me-1.5 h-4 w-4" aria-hidden />
          )}
          {showDetails
            ? t('platformConsole.pricing.cards.hideDetails')
            : t('platformConsole.pricing.cards.compareDetails')}
        </Button>

        {showDetails ? (
          <Card
            id="pricing-detail-table"
            data-testid="pricing-detail-table"
            className={cn(
              'mt-3',
              fetching ? 'opacity-70 transition-opacity' : 'transition-opacity',
            )}
          >
            <CardHeader>
              <CardTitle className="text-base">
                {t('platformConsole.pricing.comparisonTitle')}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table
                  className="table-premium w-full text-sm"
                  aria-label={t('platformConsole.pricing.comparisonAria')}
                >
                  <thead>
                    <tr>
                      <th scope="col" className="text-start">
                        {t('platformConsole.pricing.colLineItem')}
                      </th>
                      {ordered.map((r) => (
                        <th key={r.tier} scope="col" className="text-end">
                          {t(TIER_LABEL_KEY[r.tier])}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.label}>
                        <th scope="row" className="text-start font-normal text-muted-foreground">
                          {row.label}
                        </th>
                        {ordered.map((r) => (
                          <td
                            key={r.tier}
                            className={
                              'text-end tabular-nums ' +
                              (row.strong ? 'font-semibold text-foreground ' : '') +
                              (row.discount ? 'text-success-700 dark:text-success-300' : '')
                            }
                          >
                            {row.discount ? discountCell(row.get(r)) : money(row.get(r))}
                          </td>
                        ))}
                      </tr>
                    ))}

                    {/* TOTAL MONTHLY */}
                    <tr className="border-t-2 border-primary/30">
                      <th scope="row" className="text-start font-semibold text-foreground">
                        {t('platformConsole.pricing.rowTotalMonthly')}
                      </th>
                      {ordered.map((r) => (
                        <td
                          key={r.tier}
                          className="text-end text-base font-bold tabular-nums text-primary"
                        >
                          {money(r.total_monthly)}
                        </td>
                      ))}
                    </tr>

                    {/* TOTAL CONTRACT VALUE */}
                    <tr>
                      <th scope="row" className="text-start font-semibold text-foreground">
                        {t('platformConsole.pricing.rowContractValue')}
                      </th>
                      {ordered.map((r) => (
                        <td
                          key={r.tier}
                          className="text-end font-semibold tabular-nums text-foreground"
                        >
                          {money(r.contract_value)}
                        </td>
                      ))}
                    </tr>
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        ) : null}
      </div>

      {/* INTERNAL MARGIN — pricing:admin only. Rendered only when the server
          actually returned the internal block (structural mask). UNCHANGED. */}
      {showMargin && hasInternal ? (
        <Card data-testid="pricing-margin-panel">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <TrendingUp className="h-4 w-4 text-primary" aria-hidden />
              {t('platformConsole.pricing.marginTitle')}
              <Badge variant="warning" className="ms-1">
                {t('platformConsole.pricing.internalOnly')}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table
                className="table-premium w-full text-sm"
                aria-label={t('platformConsole.pricing.marginAria')}
              >
                <thead>
                  <tr>
                    <th scope="col" className="text-start">
                      {t('platformConsole.pricing.colMetric')}
                    </th>
                    {ordered.map((r) => (
                      <th key={r.tier} scope="col" className="text-end">
                        {t(TIER_LABEL_KEY[r.tier])}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <th scope="row" className="text-start font-normal text-muted-foreground">
                      {t('platformConsole.pricing.rowInternalCost')}
                    </th>
                    {ordered.map((r) => (
                      <td key={r.tier} className="text-end tabular-nums">
                        {r.internal ? money(r.internal.internal_cost) : '—'}
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <th scope="row" className="text-start font-normal text-muted-foreground">
                      {t('platformConsole.pricing.rowGrossProfit')}
                    </th>
                    {ordered.map((r) => (
                      <td key={r.tier} className="text-end font-semibold tabular-nums text-foreground">
                        {r.internal ? money(r.internal.gross_profit) : '—'}
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <th scope="row" className="text-start font-normal text-muted-foreground">
                      {t('platformConsole.pricing.rowRealizedMargin')}
                    </th>
                    {ordered.map((r) => (
                      <td key={r.tier} className="text-end tabular-nums">
                        {r.internal ? pct(r.internal.realized_margin) : '—'}
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <th scope="row" className="text-start font-normal text-muted-foreground">
                      {t('platformConsole.pricing.rowGuardrail')}
                    </th>
                    {ordered.map((r) => (
                      <td key={r.tier} className="text-end">
                        {r.internal ? (
                          <Badge
                            variant={r.internal.guardrail === 'OK' ? 'success' : 'destructive'}
                          >
                            {r.internal.guardrail === 'OK'
                              ? t('platformConsole.pricing.guardrailOk')
                              : t('platformConsole.pricing.guardrailBelowFloor')}
                          </Badge>
                        ) : (
                          '—'
                        )}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
