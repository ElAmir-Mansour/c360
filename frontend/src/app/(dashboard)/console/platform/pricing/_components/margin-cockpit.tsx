'use client';

// MARGIN COCKPIT (Wave B #9) — the ADMIN-ONLY internal surface. It is rendered
// by the page ONLY when hasPermission('pricing:admin'), and it reads the
// `internal` margin block legitimately: this component IS the internal surface,
// so the margin-masking rule is satisfied by NOT rendering it for non-admins
// (never by hiding fields inside it).
//
// Three parts:
//   • A MARGIN GAUGE per tier — a radial arc of realized_margin against the
//     ~10% floor. Green when OK, red when below the floor.
//   • A prominent BELOW-FLOOR BANNER (destructive) whenever ANY tier's guardrail
//     is BELOW FLOOR, with an inline "Request override" CTA the page can wire to
//     the Save-Quote / override flow.
//   • A WHAT-IF discount slider: on change it re-requests /compute with that
//     sales_discount + include_internal (debounced) and shows the resulting
//     realized margin + verdict per tier live.
//
// Nothing here ever renders on a client-facing surface, so it may show internal
// cost / gross profit / margin freely.

import { useMemo, useState } from 'react';
import { AlertTriangle, Gauge, ShieldAlert } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { useLocale, useT } from '@/components/providers/locale-provider';
import { useDebounce } from '@/hooks/use-debounce';
import { cn } from '@/lib/utils';
import { usePricingCompute } from '../_lib/use-pricing-compute';
import {
  MARGIN_FLOOR,
  TIER_LABEL_KEY,
  belowFloorTiers,
} from '../_lib/pricing-derive';
import { TIER_ORDER, type ComputeRequest, type PricingTier, type PricingTierRow } from '../_lib/types';

interface MarginCockpitProps {
  /** The current tier rows (must carry the `internal` block — admin response). */
  tiers: PricingTierRow[];
  currency: string;
  /**
   * The current compute request body (WITHOUT the sales-discount override). The
   * what-if slider re-issues /compute from this base with its own discount.
   */
  computeBody: ComputeRequest;
  /** Dim while the primary recompute is in flight. */
  fetching?: boolean;
  /**
   * Fired when the rep asks to override a below-floor tier. The page wires this
   * to the Save-Quote / override flow (e.g. preselect the tier + open the
   * dialog). Optional — the CTA is inert if unwired.
   */
  onRequestOverride?: (tier?: PricingTier) => void;
}

const FLOOR_PCT_LABEL = `${Math.round(MARGIN_FLOOR * 100)}%`;

export function MarginCockpit({
  tiers,
  currency,
  computeBody,
  fetching = false,
  onRequestOverride,
}: MarginCockpitProps) {
  const t = useT();
  const { locale, direction } = useLocale();
  const rtl = direction === 'rtl';

  const byTier = new Map(tiers.map((r) => [r.tier, r]));
  const ordered = useMemo(
    () => TIER_ORDER.map((x) => byTier.get(x)).filter((r): r is PricingTierRow => Boolean(r)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tiers],
  );

  const money = (n: number) =>
    new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: currency || 'SAR',
      maximumFractionDigits: 0,
    }).format(n);
  const pct = (frac: number) =>
    new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 }).format(frac);

  const below = belowFloorTiers(ordered);
  const anyBelow = below.length > 0;

  // ---- WHAT-IF: re-request /compute with an overridden sales discount. -----
  const [whatIfPct, setWhatIfPct] = useState(0); // 0-100 in the UI
  const debouncedWhatIf = useDebounce(whatIfPct, 300);

  const whatIfBody = useMemo<ComputeRequest>(() => {
    const b: ComputeRequest = { ...computeBody };
    if (debouncedWhatIf > 0) b.sales_discount = debouncedWhatIf / 100;
    else delete b.sales_discount;
    return b;
  }, [computeBody, debouncedWhatIf]);

  // Only fire when the rep has actually moved the slider off 0; otherwise the
  // live figures already reflect the base compute.
  const whatIfEnabled = debouncedWhatIf > 0;
  const { data: whatIfData, isFetching: whatIfFetching } = usePricingCompute({
    body: whatIfBody,
    includeInternal: true, // admin surface — legitimate
    enabled: whatIfEnabled,
  });

  // The rows we narrate in the what-if list: the live re-computed rows when the
  // slider is engaged, else the base rows (so the list is never empty).
  const whatIfRows = whatIfEnabled && whatIfData ? whatIfData.tiers : ordered;

  return (
    <Card
      data-testid="margin-cockpit"
      className={cn(fetching ? 'opacity-70 transition-opacity' : 'transition-opacity')}
    >
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Gauge className="h-4 w-4 text-primary" aria-hidden />
          {t('platformConsole.pricing.cockpit.title')}
          <Badge variant="warning" className="ms-1">
            {t('platformConsole.pricing.internalOnly')}
          </Badge>
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          {t('platformConsole.pricing.cockpit.description')}
        </p>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* BELOW-FLOOR banner. */}
        {anyBelow ? (
          <div
            data-testid="cockpit-below-floor-banner"
            role="alert"
            className="flex flex-wrap items-center gap-3 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
          >
            <ShieldAlert className="h-5 w-5 shrink-0" aria-hidden />
            <span className="min-w-0 flex-1 text-start font-medium">
              {below.length === 1
                ? t('platformConsole.pricing.cockpit.belowFloorSingle').replace(
                    '{tier}',
                    t(TIER_LABEL_KEY[below[0]]),
                  )
                : t('platformConsole.pricing.cockpit.belowFloorBanner').replace(
                    '{count}',
                    String(below.length),
                  )}
            </span>
            <Button
              size="sm"
              variant="destructive"
              onClick={() => onRequestOverride?.(below[0])}
              data-testid="cockpit-request-override"
            >
              {t('platformConsole.pricing.cockpit.requestOverride')}
            </Button>
          </div>
        ) : null}

        {/* MARGIN GAUGES — one radial per tier. */}
        <div
          data-testid="cockpit-gauges"
          className="grid grid-cols-2 gap-4 sm:grid-cols-4"
        >
          {ordered.map((r) =>
            r.internal ? (
              <MarginGauge
                key={r.tier}
                tierLabel={t(TIER_LABEL_KEY[r.tier])}
                ariaLabel={t('platformConsole.pricing.cockpit.gaugeAria').replace(
                  '{tier}',
                  t(TIER_LABEL_KEY[r.tier]),
                )}
                margin={r.internal.realized_margin}
                ok={r.internal.guardrail === 'OK'}
                marginLabel={pct(r.internal.realized_margin)}
                verdictLabel={
                  r.internal.guardrail === 'OK'
                    ? t('platformConsole.pricing.cockpit.verdictOk')
                    : t('platformConsole.pricing.cockpit.verdictBelowFloor')
                }
                floorLabel={t('platformConsole.pricing.cockpit.floorLabel').replace(
                  '{pct}',
                  FLOOR_PCT_LABEL,
                )}
                rtl={rtl}
              />
            ) : null,
          )}
        </div>

        {/* WHAT-IF discount simulation. */}
        <div data-testid="cockpit-what-if" className="space-y-3 rounded-lg border border-border bg-muted/30 p-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <AlertTriangle className="h-4 w-4 text-warning-600 dark:text-warning-400" aria-hidden />
              <Label htmlFor="cockpit-what-if-slider" className="text-sm font-medium">
                {t('platformConsole.pricing.cockpit.whatIfTitle')}
              </Label>
            </div>
            <span className="text-sm font-semibold tabular-nums text-foreground">
              {t('platformConsole.pricing.cockpit.whatIfDiscount').replace(
                '{d}',
                String(whatIfPct),
              )}
            </span>
          </div>
          <Slider
            id="cockpit-what-if-slider"
            value={[whatIfPct]}
            min={0}
            max={50}
            step={1}
            onValueChange={([v]) => setWhatIfPct(v)}
            aria-label={t('platformConsole.pricing.cockpit.whatIfTitle')}
            aria-valuetext={`${whatIfPct}%`}
          />
          <p className="text-xs text-muted-foreground">
            {t('platformConsole.pricing.cockpit.whatIfHint')}
          </p>

          <ul className="space-y-1.5" aria-busy={whatIfEnabled && whatIfFetching}>
            {whatIfEnabled && whatIfFetching ? (
              <li className="text-xs text-muted-foreground" role="status" aria-live="polite">
                {t('platformConsole.pricing.cockpit.whatIfLoading')}
              </li>
            ) : (
              whatIfRows.map((r) =>
                r.internal ? (
                  <li
                    key={r.tier}
                    data-testid={`what-if-${r.tier}`}
                    className="flex items-center justify-between gap-2 text-xs"
                  >
                    <span className="text-start text-foreground">
                      {t('platformConsole.pricing.cockpit.whatIfLine')
                        .replace('{d}', String(whatIfEnabled ? debouncedWhatIf : 0))
                        .replace('{tier}', t(TIER_LABEL_KEY[r.tier]))
                        .replace('{m}', pct(r.internal.realized_margin))
                        .replace(
                          '{verdict}',
                          r.internal.guardrail === 'OK'
                            ? t('platformConsole.pricing.cockpit.verdictOk')
                            : t('platformConsole.pricing.cockpit.verdictBelowFloor'),
                        )}
                    </span>
                    <Badge variant={r.internal.guardrail === 'OK' ? 'success' : 'destructive'}>
                      {r.internal.guardrail === 'OK'
                        ? t('platformConsole.pricing.cockpit.verdictOk')
                        : t('platformConsole.pricing.cockpit.verdictBelowFloor')}
                    </Badge>
                  </li>
                ) : null,
              )
            )}
          </ul>
        </div>

        {/* Detail rows — internal cost / gross profit under each gauge label. */}
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs sm:grid-cols-4">
          {ordered.map((r) =>
            r.internal ? (
              <div key={r.tier} className="space-y-0.5">
                <dt className="font-medium text-foreground">{t(TIER_LABEL_KEY[r.tier])}</dt>
                <dd className="text-muted-foreground">
                  {t('platformConsole.pricing.rowGrossProfit')}:{' '}
                  <span className="tabular-nums text-foreground">{money(r.internal.gross_profit)}</span>
                </dd>
              </div>
            ) : null,
          )}
        </dl>
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------------- *
 * MarginGauge — a compact half-radial arc of realized margin vs. the floor.
 * SVG-based (no recharts needed for a single-value gauge); green OK / red
 * below-floor. The floor is drawn as a tick on the arc.
 * ------------------------------------------------------------------------- */

interface MarginGaugeProps {
  tierLabel: string;
  ariaLabel: string;
  /** Realized margin fraction (may be negative). */
  margin: number;
  ok: boolean;
  marginLabel: string;
  /** OK / below-floor verdict, spoken as part of the gauge's accessible name. */
  verdictLabel: string;
  floorLabel: string;
  rtl: boolean;
}

// The gauge maps margin ∈ [GAUGE_MIN, GAUGE_MAX] onto a half arc.
const GAUGE_MIN = -0.2;
const GAUGE_MAX = 0.6;

function frac01(margin: number): number {
  const f = (margin - GAUGE_MIN) / (GAUGE_MAX - GAUGE_MIN);
  return Math.min(1, Math.max(0, f));
}

function MarginGauge({
  tierLabel,
  ariaLabel,
  margin,
  ok,
  marginLabel,
  verdictLabel,
  floorLabel,
  rtl,
}: MarginGaugeProps) {
  const size = 120;
  const stroke = 10;
  const radius = (size - stroke) / 2;
  const circumference = Math.PI * radius; // half circle
  const pctFill = frac01(margin);
  const floorFill = frac01(MARGIN_FLOOR);
  const color = ok ? 'hsl(var(--ds-success-500))' : 'hsl(var(--ds-destructive, var(--destructive)))';
  const dashOffset = circumference * (1 - pctFill);

  // Floor tick angle along the half arc (π at start → 0 at end). In RTL the arc
  // is mirrored so higher margin still sweeps toward the "leading" edge.
  const angle = Math.PI * (rtl ? floorFill : 1 - floorFill);
  const cx = size / 2;
  const cy = size / 2;
  const tickInner = radius - stroke;
  const tickOuter = radius + stroke / 2;
  const fx1 = cx + tickInner * Math.cos(angle);
  const fy1 = cy - tickInner * Math.sin(angle);
  const fx2 = cx + tickOuter * Math.cos(angle);
  const fy2 = cy - tickOuter * Math.sin(angle);

  return (
    <div
      data-testid={`margin-gauge-${tierLabel}`}
      className="flex flex-col items-center gap-1"
    >
      <svg
        width={size}
        height={size / 2 + 16}
        viewBox={`0 0 ${size} ${size / 2 + 16}`}
        role="img"
        aria-label={`${ariaLabel}: ${marginLabel} — ${verdictLabel} (${floorLabel})`}
        style={rtl ? { transform: 'scaleX(-1)' } : undefined}
      >
        {/* Background arc. */}
        <path
          d={`M ${stroke / 2} ${cy} A ${radius} ${radius} 0 0 1 ${size - stroke / 2} ${cy}`}
          fill="none"
          stroke="hsl(var(--muted))"
          strokeWidth={stroke}
          strokeLinecap="round"
        />
        {/* Value arc. */}
        <path
          d={`M ${stroke / 2} ${cy} A ${radius} ${radius} 0 0 1 ${size - stroke / 2} ${cy}`}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          style={{
            transition:
              'stroke-dashoffset var(--ds-duration-slow, 400ms) var(--ds-ease-decelerate, ease-out), stroke var(--ds-duration-slow, 400ms) ease-out',
          }}
        />
        {/* Floor tick. */}
        <line x1={fx1} y1={fy1} x2={fx2} y2={fy2} stroke="hsl(var(--foreground))" strokeWidth={2} />
      </svg>
      <span
        className={cn('text-sm font-bold tabular-nums', ok ? 'text-success-700 dark:text-success-300' : 'text-destructive')}
      >
        {marginLabel}
      </span>
      <span className="text-overline font-medium text-foreground">{tierLabel}</span>
      <span className="text-overline text-muted-foreground">{floorLabel}</span>
    </div>
  );
}
