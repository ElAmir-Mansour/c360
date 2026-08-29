'use client';

// SCENARIO COMPARE (Wave C #6) — a side-by-side comparison of 2-4 captured
// what-if scenarios as COLUMNS. Each column shows the scenario's key drivers
// (deployment, term, volume) and, for its SELECTED tier, the masked headline
// numbers (total monthly, contract value, effective rate, savings). Differences
// jump out row-by-row.
//
// CLIENT-SAFE BY CONSTRUCTION: every figure comes from a SavedTier (a structural
// subset of ClientTier — no `internal` block exists on a scenario at all), so
// there is NOTHING to gate and NO way to leak margin here, even for an admin.
// This is a client-safe comparison surface by design.

import { GitCompareArrows, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useLocale, useT } from '@/components/providers/locale-provider';
import type { MessageKey } from '@/lib/i18n/messages';
import { cn } from '@/lib/utils';
import { TIER_LABEL_KEY, makeMoney } from '../_lib/quote-format';
import { volumeDriver } from '../_lib/pricing-derive';
import {
  DEPLOYMENT_LABEL_KEY,
  type PricingScenario,
  type SavedTier,
} from '../_lib/use-pricing-scenarios';

interface ScenarioCompareProps {
  /** 2-4 scenarios to line up as columns. */
  scenarios: PricingScenario[];
  /** Restore a scenario's inputs into the live calculator. */
  onLoad?: (scenario: PricingScenario) => void;
  /** Drop a scenario out of the comparison (does not delete it). */
  onRemove?: (id: string) => void;
}

/** The selected tier row on a scenario (defensive against ordering / absence). */
function selectedRow(s: PricingScenario): SavedTier | undefined {
  return s.tiers.find((r) => r.tier === s.selectedTier) ?? s.tiers[0];
}

/** Total masked savings for a scenario's selected tier (volume+term+sales). */
function savingsOf(row: SavedTier | undefined): number {
  if (!row) return 0;
  return (
    Math.max(0, row.volume_discount) +
    Math.max(0, row.term_discount) +
    Math.max(0, row.sales_discount)
  );
}

export function ScenarioCompare({ scenarios, onLoad, onRemove }: ScenarioCompareProps) {
  const t = useT();
  const { locale } = useLocale();

  if (scenarios.length < 2) return null;

  // Each scenario carries its own currency; they are all SAR in practice. Use the
  // first for the shared money formatter.
  const money = makeMoney(locale, scenarios[0]?.currency || 'SAR');
  const num = (n: number) => new Intl.NumberFormat(locale).format(n);

  const monthsUnit = t('platformConsole.pricing.inputs.monthsUnit');
  const perUnitLabel = (model: PricingScenario['model']) =>
    model === 'per_core'
      ? t('platformConsole.pricing.summary.perCore')
      : t('platformConsole.pricing.summary.perUser');

  // The comparison ROWS — each a label + a per-scenario cell renderer. Ordered
  // drivers first, then the selected-tier masked headline numbers.
  const rows: {
    key: string;
    label: string;
    render: (s: PricingScenario, row: SavedTier | undefined) => React.ReactNode;
    strong?: boolean;
    highlight?: boolean;
  }[] = [
    {
      key: 'deployment',
      label: t('platformConsole.pricing.deploymentLabel'),
      render: (s) => t(DEPLOYMENT_LABEL_KEY[s.inputs.deployment] as MessageKey),
    },
    {
      key: 'term',
      label: t('platformConsole.pricing.termMonths'),
      render: (s) => `${num(s.inputs.termMonths)} ${monthsUnit}`,
    },
    {
      key: 'model',
      label: t('platformConsole.pricing.modelLabel'),
      render: (s) =>
        s.model === 'per_core'
          ? t('platformConsole.pricing.modelPerCore')
          : t('platformConsole.pricing.modelPerUser'),
    },
    {
      key: 'volume',
      label: t('platformConsole.pricing.scenarios.volumeDriver'),
      render: (s) =>
        s.model === 'per_core'
          ? `${num(s.inputs.cores)} · ${num(s.inputs.vms)} ${t('platformConsole.pricing.vms')}`
          : `${num(s.inputs.users)} ${t('platformConsole.pricing.users')}`,
    },
    {
      key: 'tier',
      label: t('platformConsole.pricing.quotes.selectedTier'),
      render: (s) => (
        <Badge variant="outline">{t(TIER_LABEL_KEY[s.selectedTier])}</Badge>
      ),
    },
    {
      key: 'totalMonthly',
      label: t('platformConsole.pricing.summary.totalMonthly'),
      strong: true,
      render: (_s, row) => (row ? money(row.total_monthly) : '—'),
    },
    {
      key: 'contractValue',
      label: t('platformConsole.pricing.summary.contractValue'),
      strong: true,
      highlight: true,
      render: (_s, row) => (row ? money(row.contract_value) : '—'),
    },
    {
      key: 'perUnit',
      label: t('platformConsole.pricing.summary.perUnit'),
      render: (s, row) => {
        const driver = volumeDriver(s.model, s.inputs.users, s.inputs.cores);
        if (!row || driver <= 0)
          return t('platformConsole.pricing.summary.perUnitNa');
        return `${money(row.total_monthly / driver)} ${perUnitLabel(s.model)}`;
      },
    },
    {
      key: 'savings',
      label: t('platformConsole.pricing.cards.totalSavings'),
      render: (_s, row) => {
        const sv = savingsOf(row);
        return sv > 0 ? (
          <span className="text-success-700 dark:text-success-300">− {money(sv)}</span>
        ) : (
          money(0)
        );
      },
    },
  ];

  return (
    <Card data-testid="scenario-compare">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <GitCompareArrows className="h-4 w-4 text-primary" aria-hidden />
          {t('platformConsole.pricing.scenarios.compareTitle')}
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          {t('platformConsole.pricing.scenarios.compareDescription')}
        </p>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table
            className="table-premium w-full text-sm"
            aria-label={t('platformConsole.pricing.scenarios.compareAria')}
          >
            <thead>
              <tr>
                <th scope="col" className="text-start">
                  {t('platformConsole.pricing.scenarios.metricColumn')}
                </th>
                {scenarios.map((s) => (
                  <th
                    key={s.id}
                    scope="col"
                    className="min-w-[10rem] text-start align-top"
                    data-testid={`scenario-col-${s.id}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-semibold text-foreground">{s.name}</span>
                      {onRemove ? (
                        <button
                          type="button"
                          onClick={() => onRemove(s.id)}
                          className="shrink-0 rounded text-muted-foreground transition-colors hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          aria-label={`${t('platformConsole.pricing.scenarios.removeFromCompare')} — ${s.name}`}
                          data-testid={`scenario-compare-remove-${s.id}`}
                        >
                          <X className="h-3.5 w-3.5" aria-hidden />
                        </button>
                      ) : null}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className={cn(r.highlight && 'border-t-2 border-primary/30')}>
                  <th scope="row" className="text-start font-normal text-muted-foreground">
                    {r.label}
                  </th>
                  {scenarios.map((s) => {
                    const row = selectedRow(s);
                    return (
                      <td
                        key={s.id}
                        className={cn(
                          'text-start tabular-nums',
                          r.strong && 'font-semibold text-foreground',
                          r.highlight && 'text-base font-bold text-primary',
                        )}
                        data-testid={`scenario-cell-${r.key}-${s.id}`}
                      >
                        {r.render(s, row)}
                      </td>
                    );
                  })}
                </tr>
              ))}

              {/* Load-into-calculator actions. */}
              {onLoad ? (
                <tr>
                  <th scope="row" className="text-start font-normal text-muted-foreground">
                    {t('platformConsole.pricing.scenarios.actions')}
                  </th>
                  {scenarios.map((s) => (
                    <td key={s.id} className="text-start">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => onLoad(s)}
                        data-testid={`scenario-compare-load-${s.id}`}
                      >
                        {t('platformConsole.pricing.scenarios.load')}
                      </Button>
                    </td>
                  ))}
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
