'use client';

// COST-BREAKDOWN CHART (Wave B #2) — a client-facing visualization of how each
// tier's monthly cost is composed. Two views, switchable via a small tab:
//
//   • STACKED comparison — the four tiers on the axis, each bar stacked from
//     base charge / AI allocation / storage-or-VM / setup premium.
//   • Per-tier WATERFALL — sub-total → (−discounts) → net → (+VAT) → total.
//
// CLIENT-SAFE BY CONSTRUCTION: every value comes from the MASKED ClientTier
// fields via the pure `costBreakdownData` / `waterfallSteps` derivations, which
// never read the internal margin block. There is NO margin / internal / cost
// figure anywhere on this surface — it is safe for any pricing:read viewer.
//
// Built on recharts@2.15.4: ResponsiveContainer with an explicit height, a
// stacked BarChart, a legend, and SAR-formatted tooltips. RTL-aware — under the
// Arabic locale the category axis is reversed and the Y axis is mirrored to the
// right so the chart reads right-to-left.

import { useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { BarChart3, ChevronDown, ChevronUp, GitCompareArrows } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useLocale, useT } from '@/components/providers/locale-provider';
import { cn } from '@/lib/utils';
import { TIER_ORDER, type PricingModel, type PricingTier, type PricingTierRow } from '../_lib/types';
import {
  TIER_LABEL_KEY,
  costBreakdownData,
  waterfallSteps,
  type WaterfallStep,
} from '../_lib/pricing-derive';

interface CostBreakdownChartProps {
  tiers: PricingTierRow[];
  model: PricingModel;
  currency: string;
  /** Dim while a debounced recompute is in flight. */
  fetching?: boolean;
}

// Segment colours from the design-system brand/semantic tokens (HSL vars).
const COLOR_BASE = 'hsl(var(--ds-brand-primary))';
const COLOR_AI = 'hsl(var(--ds-info-500))';
const COLOR_USAGE = 'hsl(var(--ds-brand-teal))';
const COLOR_SETUP = 'hsl(var(--ds-warning-500))';
const COLOR_NET = 'hsl(var(--ds-brand-primary))';
const COLOR_DISCOUNT = 'hsl(var(--ds-success-500))';
const COLOR_VAT = 'hsl(var(--muted-foreground))';
const COLOR_TOTAL = 'hsl(var(--ds-brand-primary))';

const CHART_HEIGHT = 300;

export function CostBreakdownChart({
  tiers,
  model,
  currency,
  fetching = false,
}: CostBreakdownChartProps) {
  const t = useT();
  const { locale, direction } = useLocale();
  const rtl = direction === 'rtl';

  const [open, setOpen] = useState(false);
  const [view, setView] = useState<'stacked' | 'waterfall'>('stacked');

  // Canonical order + index (defensive — the API already orders them).
  const byTier = new Map(tiers.map((r) => [r.tier, r]));
  const ordered = useMemo(
    () => TIER_ORDER.map((x) => byTier.get(x)).filter((r): r is PricingTierRow => Boolean(r)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tiers],
  );

  // The tier the waterfall focuses on (defaults to the first available tier).
  const [wfTier, setWfTier] = useState<PricingTier>(ordered[0]?.tier ?? 'standard');

  const money = (n: number) =>
    new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: currency || 'SAR',
      maximumFractionDigits: 0,
    }).format(n);

  const usageLabel =
    model === 'per_core' ? t('platformConsole.pricing.breakdown.segVm') : t('platformConsole.pricing.breakdown.segStorage');

  // ---- Stacked dataset (client-safe). ------------------------------------
  const stacked = useMemo(() => {
    const rows = costBreakdownData(ordered, model).map((d) => ({
      ...d,
      // A localized display label for the category axis / tooltip title.
      tierLabel: t(TIER_LABEL_KEY[d.tier]),
    }));
    // Mirror category order in RTL so the tiers read right-to-left.
    return rtl ? [...rows].reverse() : rows;
  }, [ordered, model, rtl, t]);

  // ---- Waterfall dataset for the focused tier (client-safe). -------------
  const wfRow = byTier.get(wfTier) ?? ordered[0];
  const wfSteps: WaterfallStep[] = useMemo(
    () => (wfRow ? waterfallSteps(wfRow) : []),
    [wfRow],
  );
  const WF_LABEL: Record<WaterfallStep['key'], string> = {
    subTotal: t('platformConsole.pricing.breakdown.wfSubTotal'),
    discounts: t('platformConsole.pricing.breakdown.wfDiscounts'),
    net: t('platformConsole.pricing.breakdown.wfNet'),
    vat: t('platformConsole.pricing.breakdown.wfVat'),
    total: t('platformConsole.pricing.breakdown.wfTotal'),
  };
  const WF_COLOR: Record<WaterfallStep['key'], string> = {
    subTotal: COLOR_NET,
    discounts: COLOR_DISCOUNT,
    net: COLOR_NET,
    vat: COLOR_VAT,
    total: COLOR_TOTAL,
  };
  const wfData = useMemo(() => {
    const rows = wfSteps.map((s) => ({
      key: s.key,
      step: WF_LABEL[s.key],
      range: s.range,
      delta: s.delta,
      fill: WF_COLOR[s.key],
    }));
    return rtl ? [...rows].reverse() : rows;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wfSteps, rtl, locale]);

  // Shared SAR tooltip. `active`/`payload` come from recharts.
  const StackedTooltip = ({
    active,
    payload,
    label,
  }: {
    active?: boolean;
    payload?: Array<{ name: string; value: number; color: string; dataKey: string }>;
    label?: string;
  }) => {
    if (!active || !payload || payload.length === 0) return null;
    const total = payload.reduce((s, e) => s + (e.value || 0), 0);
    return (
      <div className="min-w-[160px] rounded-card border border-border bg-card p-3 text-body-sm shadow-elevation-3" dir={rtl ? 'rtl' : 'ltr'}>
        <p className="mb-2 font-medium text-foreground">{String(label)}</p>
        <div className="space-y-1">
          {payload.map((e) => (
            <div key={e.dataKey} className="flex items-center justify-between gap-4">
              <span className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 shrink-0 rounded-pill" style={{ backgroundColor: e.color }} aria-hidden />
                <span className="text-muted-foreground">{e.name}</span>
              </span>
              <span className="font-medium tabular-nums text-foreground">{money(e.value)}</span>
            </div>
          ))}
          <div className="mt-1 flex items-center justify-between gap-4 border-t border-border pt-1">
            <span className="text-muted-foreground">{t('platformConsole.pricing.rowSubTotal')}</span>
            <span className="font-semibold tabular-nums text-foreground">{money(total)}</span>
          </div>
        </div>
      </div>
    );
  };

  const WaterfallTooltip = ({
    active,
    payload,
  }: {
    active?: boolean;
    payload?: Array<{ payload: { step: string; delta: number } }>;
  }) => {
    if (!active || !payload || payload.length === 0) return null;
    const p = payload[0]?.payload;
    if (!p) return null;
    return (
      <div className="min-w-[140px] rounded-card border border-border bg-card p-3 text-body-sm shadow-elevation-3" dir={rtl ? 'rtl' : 'ltr'}>
        <p className="mb-1 font-medium text-foreground">{p.step}</p>
        <p className={cn('tabular-nums font-semibold', p.delta < 0 ? 'text-success-700 dark:text-success-300' : 'text-foreground')}>
          {p.delta < 0 ? `− ${money(Math.abs(p.delta))}` : money(p.delta)}
        </p>
      </div>
    );
  };

  const axisTick = { fontSize: 12, fill: 'hsl(var(--muted-foreground))' } as const;
  const sarAxisFmt = (v: number) =>
    new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(v);

  return (
    <Card
      data-testid="cost-breakdown-card"
      className={cn(fetching ? 'opacity-70 transition-opacity' : 'transition-opacity')}
    >
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <div className="min-w-0 space-y-0.5">
          <CardTitle className="flex items-center gap-2 text-base">
            <BarChart3 className="h-4 w-4 text-primary" aria-hidden />
            {t('platformConsole.pricing.breakdown.title')}
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            {t('platformConsole.pricing.breakdown.description')}
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls="cost-breakdown-body"
          data-testid="cost-breakdown-toggle"
        >
          {open ? (
            <ChevronUp className="me-1.5 h-4 w-4" aria-hidden />
          ) : (
            <ChevronDown className="me-1.5 h-4 w-4" aria-hidden />
          )}
          {open
            ? t('platformConsole.pricing.breakdown.toggleHide')
            : t('platformConsole.pricing.breakdown.toggleShow')}
        </Button>
      </CardHeader>

      {open ? (
        <CardContent id="cost-breakdown-body" className="space-y-4">
          <div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              {/* Segmented view switch (plain buttons — robust, a11y radios). */}
              <div
                role="radiogroup"
                aria-label={t('platformConsole.pricing.breakdown.title')}
                className="inline-flex rounded-xl border border-border/70 bg-card/80 p-1"
              >
                <Button
                  type="button"
                  size="sm"
                  role="radio"
                  aria-checked={view === 'stacked'}
                  variant={view === 'stacked' ? 'secondary' : 'ghost'}
                  onClick={() => setView('stacked')}
                  data-testid="breakdown-tab-stacked"
                >
                  <GitCompareArrows className="me-1.5 h-4 w-4" aria-hidden />
                  {t('platformConsole.pricing.breakdown.viewStacked')}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  role="radio"
                  aria-checked={view === 'waterfall'}
                  variant={view === 'waterfall' ? 'secondary' : 'ghost'}
                  onClick={() => setView('waterfall')}
                  data-testid="breakdown-tab-waterfall"
                >
                  {t('platformConsole.pricing.breakdown.viewWaterfall')}
                </Button>
              </div>

              {/* Waterfall focus-tier picker. */}
              {view === 'waterfall' ? (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    {t('platformConsole.pricing.breakdown.waterfallTierLabel')}
                  </span>
                  <Select value={wfTier} onValueChange={(v) => setWfTier(v as PricingTier)}>
                    <SelectTrigger className="h-8 w-40" data-testid="waterfall-tier-select">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ordered.map((r) => (
                        <SelectItem key={r.tier} value={r.tier}>
                          {t(TIER_LABEL_KEY[r.tier])}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : null}
            </div>

            {/* STACKED comparison. */}
            {view === 'stacked' ? (
              <figure
                data-testid="breakdown-stacked"
                aria-label={t('platformConsole.pricing.breakdown.stackedAria')}
                className="mt-4"
              >
                <figcaption className="sr-only">
                  {t('platformConsole.pricing.breakdown.stackedTitle')}
                </figcaption>
                {/* Visually-hidden data table so screen readers get the actual
                    figures the bar chart encodes (the SVG bars are aria-hidden).
                    We deliberately DON'T put role="img" on the figure — that would
                    prune this table from the a11y tree; instead the chart is hidden
                    and the real tabular data is exposed. */}
                <table className="sr-only">
                  <caption>{t('platformConsole.pricing.breakdown.stackedTitle')}</caption>
                  <thead>
                    <tr>
                      <th scope="col">{t('platformConsole.pricing.colLineItem')}</th>
                      <th scope="col">{t('platformConsole.pricing.breakdown.segBase')}</th>
                      <th scope="col">{t('platformConsole.pricing.breakdown.segAi')}</th>
                      <th scope="col">{usageLabel}</th>
                      <th scope="col">{t('platformConsole.pricing.breakdown.segSetup')}</th>
                      <th scope="col">{t('platformConsole.pricing.rowSubTotal')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stacked.map((d) => (
                      <tr key={d.tier}>
                        <th scope="row">{d.tierLabel}</th>
                        <td>{money(d.base)}</td>
                        <td>{money(d.ai)}</td>
                        <td>{money(d.usage)}</td>
                        <td>{money(d.setup)}</td>
                        <td>{money(d.base + d.ai + d.usage + d.setup)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <ResponsiveContainer width="100%" height={CHART_HEIGHT} aria-hidden>
                  <BarChart data={stacked} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                    <XAxis
                      dataKey="tierLabel"
                      reversed={rtl}
                      tick={axisTick}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      orientation={rtl ? 'right' : 'left'}
                      tickFormatter={sarAxisFmt}
                      tick={axisTick}
                      axisLine={false}
                      tickLine={false}
                      width={48}
                    />
                    <Tooltip content={<StackedTooltip />} cursor={{ fill: 'hsl(var(--muted))' }} />
                    <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="base" stackId="cost" name={t('platformConsole.pricing.breakdown.segBase')} fill={COLOR_BASE} />
                    <Bar dataKey="ai" stackId="cost" name={t('platformConsole.pricing.breakdown.segAi')} fill={COLOR_AI} />
                    <Bar dataKey="usage" stackId="cost" name={usageLabel} fill={COLOR_USAGE} />
                    <Bar dataKey="setup" stackId="cost" name={t('platformConsole.pricing.breakdown.segSetup')} fill={COLOR_SETUP} radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </figure>
            ) : (
              /* Per-tier WATERFALL. */
              <figure
                data-testid="breakdown-waterfall"
                aria-label={t('platformConsole.pricing.breakdown.waterfallAria')}
                className="mt-4"
              >
                <figcaption className="sr-only">
                  {t('platformConsole.pricing.breakdown.waterfallTitle')}
                </figcaption>
                {/* Visually-hidden data table mirroring the waterfall steps (the
                    SVG chart itself is aria-hidden). */}
                <table className="sr-only">
                  <caption>{t('platformConsole.pricing.breakdown.waterfallTitle')}</caption>
                  <thead>
                    <tr>
                      <th scope="col">{t('platformConsole.pricing.breakdown.waterfallTierLabel')}</th>
                      <th scope="col">{t(TIER_LABEL_KEY[wfTier])}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {wfSteps.map((s) => (
                      <tr key={s.key}>
                        <th scope="row">{WF_LABEL[s.key]}</th>
                        <td>
                          {s.delta < 0 ? `− ${money(Math.abs(s.delta))}` : money(s.delta)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <ResponsiveContainer width="100%" height={CHART_HEIGHT} aria-hidden>
                  <BarChart data={wfData} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                    <XAxis
                      dataKey="step"
                      reversed={rtl}
                      tick={axisTick}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      orientation={rtl ? 'right' : 'left'}
                      tickFormatter={sarAxisFmt}
                      tick={axisTick}
                      axisLine={false}
                      tickLine={false}
                      width={48}
                    />
                    <Tooltip content={<WaterfallTooltip />} cursor={{ fill: 'hsl(var(--muted))' }} />
                    {/* Floating bars: dataKey="range" is a [start,end] tuple. */}
                    <Bar dataKey="range" radius={[4, 4, 4, 4]}>
                      {wfData.map((d) => (
                        <Cell key={d.key} fill={d.fill} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </figure>
            )}
          </div>
        </CardContent>
      ) : null}
    </Card>
  );
}
