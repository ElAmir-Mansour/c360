'use client';

import { ArrowDown, ArrowUp, Minus, RotateCw, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { statusVar, type StatusTone } from '@/lib/design-tokens';
import { formatNumber } from '@/lib/format-number';
import { cn } from '@/lib/utils';
import type {
  VisusKPIStatus,
  VisusKpiCardWidgetData,
  VisusTrendIndicatorWidgetData,
  VisusSparklineWidgetData,
} from '@/types/suites';
import type { WidgetBodyProps } from './widget-body-props';
import { useVisusWidgetChromeLabels } from '../../../_lib/visus-i18n';

/* ------------------------------------------------------------------ helpers */

/** KPI health → semantic status tone (drives the accent color). */
const STATUS_TONE: Record<VisusKPIStatus, StatusTone> = {
  normal: 'success',
  warning: 'warning',
  critical: 'error',
  unknown: 'neutral',
};

type Direction = 'up' | 'down' | 'flat';

/** A movement direction → tone. `up` reads positive, `down` negative. */
function directionTone(direction: Direction): StatusTone {
  return direction === 'up' ? 'success' : direction === 'down' ? 'error' : 'neutral';
}

/** Sign of a value → tone (colors a delta pill green/red/muted). */
function signTone(n: number): StatusTone {
  return n > 0 ? 'success' : n < 0 ? 'error' : 'neutral';
}

/** Tailwind pill classes (translucent bg + text) for the three tones used here. */
function pillClass(tone: StatusTone): string {
  switch (tone) {
    case 'success':
      return 'bg-status-success/10 text-status-success';
    case 'error':
      return 'bg-status-error/10 text-status-error';
    case 'warning':
      return 'bg-status-warning/10 text-status-warning';
    default:
      return 'bg-muted text-muted-foreground';
  }
}

function arrowForDirection(direction: Direction): LucideIcon {
  return direction === 'up' ? ArrowUp : direction === 'down' ? ArrowDown : Minus;
}

function arrowForSign(n: number): LucideIcon {
  return n > 0 ? ArrowUp : n < 0 ? ArrowDown : Minus;
}

const PERCENT_FMT = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 1,
  signDisplay: 'exceptZero',
});

/** e.g. 12.34 → "+12.3%", -4 → "-4%", 0 → "0%". */
function formatSignedPercent(n: number): string {
  if (!Number.isFinite(n)) return '—';
  return `${PERCENT_FMT.format(n)}%`;
}

/* ---------------------------------------------------------------- primitives */

/** Compact inline SVG sparkline — no axes, no legend, stretches to its box. */
function Sparkline({
  values,
  color,
  filled = true,
  ariaLabel,
  className,
}: {
  values: number[];
  color: string;
  filled?: boolean;
  ariaLabel: string;
  className?: string;
}) {
  const width = 100;
  const height = 32;
  const pad = 3;
  // Duplicate a lone point so we still draw a (flat) line rather than nothing.
  const vals = values.length === 1 ? [values[0], values[0]] : values;
  if (vals.length < 2) return null;

  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const range = max - min;
  const step = width / (vals.length - 1);
  const points = vals.map((v, i) => {
    const x = i * step;
    const y = range === 0 ? height / 2 : height - pad - ((v - min) / range) * (height - pad * 2);
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });
  const line = `M${points.join(' L')}`;
  const area = `${line} L${width},${height} L0,${height} Z`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={ariaLabel}
      className={cn('h-full w-full overflow-visible', className)}
    >
      {filled ? <path d={area} fill={color} fillOpacity={0.12} stroke="none" /> : null}
      <path
        d={line}
        fill="none"
        stroke={color}
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/* -------------------------------------------------------------- shared states */

function WidgetLoading() {
  return (
    <div className="flex min-h-0 flex-1 flex-col justify-center gap-2 py-1">
      <Skeleton className="h-7 w-24" />
      <Skeleton className="h-4 w-16" />
    </div>
  );
}

function WidgetError({ onRetry }: { onRetry: () => void }) {
  const t = useVisusWidgetChromeLabels();
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 py-2 text-center">
      <p className="text-xs text-muted-foreground">{t.couldntLoadData}</p>
      <Button
        variant="outline"
        size="sm"
        className="h-7 min-h-0 px-2 text-xs"
        onClick={onRetry}
      >
        <RotateCw className="me-1 h-3 w-3" aria-hidden />
        {t.retry}
      </Button>
    </div>
  );
}

function WidgetEmpty({ message }: { message: string }) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center py-2">
      <p className="text-xs text-muted-foreground">{message}</p>
    </div>
  );
}

/* ------------------------------------------------------------------- widgets */

export function KpiCardWidget({
  data,
  isLoading,
  isError,
  onRetry,
}: WidgetBodyProps<VisusKpiCardWidgetData>) {
  const t = useVisusWidgetChromeLabels();
  if (isLoading) return <WidgetLoading />;
  if (isError) return <WidgetError onRetry={onRetry} />;

  const isEmpty =
    !data ||
    (data.value === 0 &&
      data.trend.length === 0 &&
      data.delta == null &&
      data.delta_percent == null);
  if (isEmpty) return <WidgetEmpty message={t.noMeasurement} />;

  const tone = STATUS_TONE[data.status] ?? 'neutral';
  const accent = statusVar(tone);
  const unit = data.unit ?? undefined;
  const deltaPct = data.delta_percent;
  const DeltaArrow = deltaPct != null ? arrowForSign(deltaPct) : Minus;
  const trendValues = data.trend.map((t) => t.value);

  return (
    <div className="flex min-h-0 flex-1 flex-col justify-between gap-2">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-baseline gap-1">
          <span
            className="truncate text-2xl font-semibold leading-none tabular-nums"
            style={{ color: accent }}
          >
            {formatNumber(data.value)}
          </span>
          {unit ? <span className="shrink-0 text-xs text-muted-foreground">{unit}</span> : null}
        </div>
        {deltaPct != null ? (
          <span
            className={cn(
              'inline-flex shrink-0 items-center gap-0.5 rounded-full px-1.5 py-0.5 text-xs font-medium tabular-nums',
              pillClass(signTone(deltaPct)),
            )}
            aria-label={t.changeAria(formatSignedPercent(deltaPct))}
          >
            <DeltaArrow className="h-3 w-3" aria-hidden />
            {formatSignedPercent(deltaPct)}
          </span>
        ) : null}
      </div>

      {trendValues.length >= 2 ? (
        <div className="h-8 w-full shrink-0">
          <Sparkline values={trendValues} color={accent} ariaLabel={t.kpiTrendAria} />
        </div>
      ) : null}

      {data.target != null ? (
        <p className="shrink-0 truncate text-overline text-muted-foreground">
          {t.targetPrefix} {formatNumber(data.target)}
          {unit ? ` ${unit}` : ''}
        </p>
      ) : null}
    </div>
  );
}

export function TrendIndicatorWidget({
  data,
  isLoading,
  isError,
  onRetry,
}: WidgetBodyProps<VisusTrendIndicatorWidgetData>) {
  const t = useVisusWidgetChromeLabels();
  if (isLoading) return <WidgetLoading />;
  if (isError) return <WidgetError onRetry={onRetry} />;

  const isEmpty =
    !data || (data.value === 0 && data.change_percent === 0 && data.periods.length === 0);
  if (isEmpty) return <WidgetEmpty message={t.noTrend} />;

  const tone = directionTone(data.direction);
  const accent = statusVar(tone);
  const DirectionArrow = arrowForDirection(data.direction);
  const trendingAria =
    data.direction === 'up' ? t.trendingUpAria : data.direction === 'down' ? t.trendingDownAria : t.trendingFlatAria;

  return (
    <div className="flex min-h-0 flex-1 flex-col justify-center gap-1">
      <div className="flex items-center gap-2">
        <span className="text-3xl font-semibold leading-none tabular-nums">
          {formatNumber(data.value)}
        </span>
        <DirectionArrow
          className="h-6 w-6 shrink-0"
          style={{ color: accent }}
          aria-label={trendingAria}
        />
      </div>
      <div className="flex items-center gap-1.5 text-sm">
        <span className="font-medium tabular-nums" style={{ color: accent }}>
          {formatSignedPercent(data.change_percent)}
        </span>
        <span className="text-xs text-muted-foreground">{t.vsPrevious}</span>
      </div>
    </div>
  );
}

export function SparklineWidget({
  data,
  isLoading,
  isError,
  onRetry,
}: WidgetBodyProps<VisusSparklineWidgetData>) {
  const t = useVisusWidgetChromeLabels();
  if (isLoading) return <WidgetLoading />;
  if (isError) return <WidgetError onRetry={onRetry} />;

  const isEmpty = !data || data.values.length === 0;
  if (isEmpty) return <WidgetEmpty message={t.noSamples} />;

  const tone = directionTone(data.trend_direction);
  const accent = statusVar(tone);
  const DirectionArrow = arrowForDirection(data.trend_direction);
  const trendingAria =
    data.trend_direction === 'up'
      ? t.trendingUpAria
      : data.trend_direction === 'down'
        ? t.trendingDownAria
        : t.trendingFlatAria;

  return (
    <div className="flex min-h-0 flex-1 flex-col justify-between gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <span
          className="text-2xl font-semibold leading-none tabular-nums"
          style={{ color: accent }}
        >
          {formatNumber(data.current)}
        </span>
        <DirectionArrow
          className="h-4 w-4 shrink-0 self-center"
          style={{ color: accent }}
          aria-label={trendingAria}
        />
      </div>

      <div className="min-h-[28px] w-full flex-1">
        <Sparkline values={data.values} color={accent} ariaLabel={t.valueSparklineAria} />
      </div>

      <div className="flex shrink-0 justify-between text-overline text-muted-foreground tabular-nums">
        <span>{formatNumber(data.min, { abbr: true })}</span>
        <span>{formatNumber(data.max, { abbr: true })}</span>
      </div>
    </div>
  );
}
