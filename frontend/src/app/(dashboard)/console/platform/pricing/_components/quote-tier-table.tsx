'use client';

// The quote's 4-tier breakdown table (masked, client-facing) plus the SEPARATE
// internal MARGIN panel below it.
//
// The margin panel is rendered ONLY when `showMargin` is true (the page gates it
// on pricing:admin) AND the rows actually carry an `internal` block — the backend
// structurally masks, so a non-admin never receives it and the panel is never
// shown. This is the same discipline as the calculator's TierComparison, reused
// for a persisted quote.

import { TrendingUp } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useLocale, useT } from '@/components/providers/locale-provider';
import { TIER_ORDER, type PricingModel, type PricingTierRow } from '../_lib/types';
import { TIER_LABEL_KEY, makeMoney } from '../_lib/quote-format';

interface QuoteTierTableProps {
  tiers: PricingTierRow[];
  model: PricingModel;
  currency: string;
  /** The quote's selected tier — highlighted as the active column. */
  selectedTier: string;
  /** True only for pricing:admin — the sole gate for the margin panel. */
  showMargin: boolean;
}

export function QuoteTierTable({
  tiers,
  model,
  currency,
  selectedTier,
  showMargin,
}: QuoteTierTableProps) {
  const t = useT();
  const { locale } = useLocale();

  const byTier = new Map(tiers.map((row) => [row.tier, row]));
  const ordered = TIER_ORDER.map((tier) => byTier.get(tier)).filter(
    (r): r is PricingTierRow => Boolean(r),
  );

  const money = makeMoney(locale, currency);
  const pct = (fraction: number) =>
    new Intl.NumberFormat(locale, {
      style: 'percent',
      maximumFractionDigits: 1,
    }).format(fraction);

  const usageRowKey: keyof PricingTierRow['line_items'] =
    model === 'per_core' ? 'vm_infrastructure' : 'data_storage';
  const usageRowLabel =
    model === 'per_core'
      ? t('platformConsole.pricing.rowVmInfrastructure')
      : t('platformConsole.pricing.rowDataStorage');

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

  const discountCell = (n: number) => (n > 0 ? `− ${money(n)}` : money(0));
  const activeCol = (tier: string) =>
    tier === selectedTier ? 'bg-primary/[0.06]' : '';
  const hasInternal = ordered.some((r) => r.internal);

  return (
    <div className="space-y-6">
      <Card>
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
                    <th key={r.tier} scope="col" className={`text-end ${activeCol(r.tier)}`}>
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
                          activeCol(r.tier) +
                          ' ' +
                          (row.strong ? 'font-semibold text-foreground ' : '') +
                          (row.discount ? 'text-success-700 dark:text-success-300' : '')
                        }
                      >
                        {row.discount ? discountCell(row.get(r)) : money(row.get(r))}
                      </td>
                    ))}
                  </tr>
                ))}

                <tr className="border-t-2 border-primary/30">
                  <th scope="row" className="text-start font-semibold text-foreground">
                    {t('platformConsole.pricing.rowTotalMonthly')}
                  </th>
                  {ordered.map((r) => (
                    <td
                      key={r.tier}
                      className={`text-end text-base font-bold tabular-nums text-primary ${activeCol(r.tier)}`}
                    >
                      {money(r.total_monthly)}
                    </td>
                  ))}
                </tr>

                <tr>
                  <th scope="row" className="text-start font-semibold text-foreground">
                    {t('platformConsole.pricing.rowContractValue')}
                  </th>
                  {ordered.map((r) => (
                    <td
                      key={r.tier}
                      className={`text-end font-semibold tabular-nums text-foreground ${activeCol(r.tier)}`}
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

      {/* INTERNAL MARGIN — pricing:admin only, rendered only when present. */}
      {showMargin && hasInternal ? (
        <Card data-testid="quote-margin-panel">
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
