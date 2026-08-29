'use client';

/**
 * Per-event delay-window duration (timeline feature #2).
 *
 * Renders how long a delay window has lasted:
 *   - resolved → "{n} days" between `opened_at` and `resolved_at`
 *   - open     → "ongoing — {n} days" between `opened_at` and now (live)
 *
 * Sub-day windows fall back to "{n} hours" so a freshly opened delay does not
 * read "0 days". All copy is bilingual via the `timeline.duration` label group;
 * this component never hard-codes user-facing strings.
 */

import { useSyncExternalStore } from 'react';
import { cn } from '@/lib/utils';
import { useSettlementLabels } from './labels';

const MS_PER_HOUR = 1000 * 60 * 60;
const MS_PER_DAY = MS_PER_HOUR * 24;

export interface DelayWindow {
  /** Whole days elapsed (>= 1 when `unit === 'days'`). */
  value: number;
  /** Granularity chosen for `value`. */
  unit: 'days' | 'hours';
  /** Total elapsed milliseconds (raw, unrounded). */
  ms: number;
}

/**
 * Compute the elapsed window between two timestamps. For open events pass `now`
 * as the second argument (the component supplies a live ticking value).
 *
 * Rounding: >= 24h rounds to the nearest whole day with a floor of 1 day; under
 * 24h rounds to the nearest whole hour with a floor of 1 hour (so "just now"
 * still reads as a measurable window rather than zero).
 */
export function computeDelayWindow(from: string | Date, to: string | Date): DelayWindow | null {
  const start = typeof from === 'string' ? new Date(from) : from;
  const end = typeof to === 'string' ? new Date(to) : to;
  if (
    !(start instanceof Date) ||
    !(end instanceof Date) ||
    isNaN(start.getTime()) ||
    isNaN(end.getTime())
  ) {
    return null;
  }
  const ms = Math.max(0, end.getTime() - start.getTime());
  if (ms >= MS_PER_DAY) {
    return { value: Math.max(1, Math.round(ms / MS_PER_DAY)), unit: 'days', ms };
  }
  return { value: Math.max(1, Math.round(ms / MS_PER_HOUR)), unit: 'hours', ms };
}

// --- live "now" ticker (1-minute cadence, shared across instances) ----------

const listeners = new Set<() => void>();
let nowTs = typeof window === 'undefined' ? 0 : Date.now();
let intervalId: ReturnType<typeof setInterval> | null = null;

function ensureTicker() {
  if (typeof window === 'undefined' || intervalId !== null) return;
  intervalId = setInterval(() => {
    if (document.hidden) return;
    nowTs = Date.now();
    listeners.forEach((cb) => cb());
  }, 60_000);
}

function subscribe(cb: () => void) {
  ensureTicker();
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
    if (listeners.size === 0 && intervalId !== null) {
      clearInterval(intervalId);
      intervalId = null;
    }
  };
}

function useNowTick() {
  return useSyncExternalStore(
    subscribe,
    () => nowTs,
    () => 0,
  );
}

export interface DelayDurationProps {
  openedAt: string;
  /** When provided the event is resolved; otherwise the window is "ongoing". */
  resolvedAt?: string | null;
  className?: string;
}

/**
 * Inline duration string for a single delay event. Open windows tick live;
 * resolved windows are static. Returns `null` when timestamps are unusable so
 * callers can simply drop the element.
 */
export function DelayDuration({ openedAt, resolvedAt, className }: DelayDurationProps) {
  const labels = useSettlementLabels().timeline.duration;
  const tick = useNowTick();
  const isResolved = Boolean(resolvedAt);
  const end = isResolved ? (resolvedAt as string) : tick === 0 ? openedAt : new Date(tick);

  const window = computeDelayWindow(openedAt, end);
  if (!window) return null;

  const amount = window.unit === 'days' ? labels.days(window.value) : labels.hours(window.value);
  const text = isResolved ? amount : labels.ongoing(amount);

  return (
    <span className={cn('text-xs text-muted-foreground', className)} title={labels.label}>
      {text}
    </span>
  );
}
