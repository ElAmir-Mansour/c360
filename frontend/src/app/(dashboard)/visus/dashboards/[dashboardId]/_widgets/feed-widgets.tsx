'use client';

import type { ReactNode } from 'react';
import type { WidgetBodyProps } from './widget-body-props';
import type { VisusAlertFeedWidgetData, VisusStatusGridWidgetData } from '@/types/suites';
import { RelativeTime } from '@/components/shared/relative-time';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { severityVar, statusVar, type StatusTone } from '@/lib/design-tokens';
import { pickEnumLabel, useVisusEnumLabels, useVisusWidgetChromeLabels } from '../../../_lib/visus-i18n';

/* ---- shared body states -------------------------------------------------- */

/** Muted, centered note used for empty payloads. */
function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center py-6 text-center">
      <p className="text-xs text-muted-foreground">{children}</p>
    </div>
  );
}

/** Error note with a Retry affordance that re-runs the widget fetch. */
function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  const t = useVisusWidgetChromeLabels();
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 py-6 text-center">
      <p className="text-xs text-muted-foreground">{message}</p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        {t.retry}
      </Button>
    </div>
  );
}

/* ---- alert feed ---------------------------------------------------------- */

/** A few placeholder alert rows (dot + two text lines) while data loads. */
function AlertFeedSkeleton() {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 py-1" aria-hidden>
      {Array.from({ length: 4 }).map((_, idx) => (
        <div key={idx} className="flex gap-2.5">
          <Skeleton.Block className="mt-1 h-2 w-2 shrink-0 rounded-full" />
          <div className="flex-1 space-y-1.5">
            <Skeleton.Block className="h-3.5 w-3/4" />
            <Skeleton.Block className="h-3 w-1/2" />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Scrollable feed of executive alerts. Each row leads with a severity-colored
 * dot (severity is also spelled out in text so it never reads by color alone),
 * the title, a clamped description, the originating suite, an occurrence badge
 * when an alert has recurred, and a live-updating "last seen" timestamp.
 */
export function AlertFeedWidget({ data, isLoading, isError, onRetry }: WidgetBodyProps<VisusAlertFeedWidgetData>) {
  const t = useVisusWidgetChromeLabels();
  const enums = useVisusEnumLabels();
  if (isLoading) return <AlertFeedSkeleton />;
  if (isError) return <ErrorState message={t.unableToLoadAlerts} onRetry={onRetry} />;

  const alerts = data?.alerts ?? [];
  if (alerts.length === 0) return <EmptyState>{t.noActiveAlerts}</EmptyState>;

  return (
    <ul className="-mx-1 min-h-0 flex-1 divide-y overflow-y-auto px-1">
      {alerts.map((alert) => (
        <li key={alert.id} className="flex gap-2.5 py-2.5">
          <span
            aria-hidden
            className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
            style={{ backgroundColor: severityVar(alert.severity) }}
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <p className="truncate text-sm font-medium leading-tight" title={alert.title}>
                {alert.title}
              </p>
              {alert.occurrence_count > 1 ? (
                <span
                  className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-overline font-semibold tabular-nums text-muted-foreground"
                  aria-label={t.occurrencesAria(alert.occurrence_count)}
                >
                  ×{alert.occurrence_count}
                </span>
              ) : null}
            </div>
            {alert.description ? (
              <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{alert.description}</p>
            ) : null}
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-overline text-muted-foreground">
              <span className="inline-flex items-center rounded border border-border/60 bg-muted/50 px-1.5 py-0.5 font-medium capitalize">
                {alert.source_suite}
              </span>
              <span className="font-medium capitalize" style={{ color: severityVar(alert.severity) }}>
                {t.severityTag(pickEnumLabel(enums.severity, alert.severity))}
              </span>
              <span aria-hidden>·</span>
              <RelativeTime date={alert.last_seen_at} className="text-overline" />
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

/* ---- status grid --------------------------------------------------------- */

/** Human label + tone for a free-form status string (color is never the only cue). */
function resolveStatusTone(status: string): StatusTone {
  switch (status.trim().toLowerCase()) {
    case 'normal':
    case 'success':
    case 'ok':
    case 'healthy':
    case 'up':
      return 'success';
    case 'warning':
    case 'warn':
    case 'degraded':
      return 'warning';
    case 'critical':
    case 'error':
    case 'down':
    case 'failed':
      return 'error';
    default:
      return 'neutral';
  }
}

/** A responsive grid of placeholder tiles while status data loads. */
function StatusGridSkeleton() {
  return (
    <div
      className="grid min-h-0 flex-1 auto-rows-min grid-cols-[repeat(auto-fill,minmax(8rem,1fr))] gap-2 py-1"
      aria-hidden
    >
      {Array.from({ length: 6 }).map((_, idx) => (
        <Skeleton.Block key={idx} className="h-16 rounded-lg" />
      ))}
    </div>
  );
}

/**
 * Responsive grid of compact status tiles. Each tile shows its label, the
 * numeric/text value (with optional unit, tabular figures), and a tone dot plus
 * its status word so state is legible without relying on color.
 */
export function StatusGridWidget({ data, isLoading, isError, onRetry }: WidgetBodyProps<VisusStatusGridWidgetData>) {
  const t = useVisusWidgetChromeLabels();
  if (isLoading) return <StatusGridSkeleton />;
  if (isError) return <ErrorState message={t.unableToLoadStatus} onRetry={onRetry} />;

  const items = data?.items ?? [];
  if (items.length === 0) return <EmptyState>{t.noStatusMetrics}</EmptyState>;

  return (
    <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1 py-0.5">
      <div className="grid auto-rows-min grid-cols-[repeat(auto-fill,minmax(8rem,1fr))] gap-2">
        {items.map((item, index) => {
          const tone = resolveStatusTone(item.status);
          return (
            <div key={`${item.label}-${index}`} className="rounded-lg border bg-card/40 p-2.5">
              <div className="flex items-center justify-between gap-1.5">
                <span className="truncate text-xs text-muted-foreground" title={item.label}>
                  {item.label}
                </span>
                <span
                  className="inline-flex shrink-0 items-center gap-1 text-overline font-medium capitalize text-muted-foreground"
                  aria-label={t.statusAria(item.status)}
                >
                  <span
                    aria-hidden
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: statusVar(tone) }}
                  />
                  {item.status}
                </span>
              </div>
              <div className="mt-1.5 text-lg font-semibold leading-none tabular-nums">
                {item.value}
                {item.unit ? (
                  <span className="ms-1 text-xs font-normal text-muted-foreground">{item.unit}</span>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
