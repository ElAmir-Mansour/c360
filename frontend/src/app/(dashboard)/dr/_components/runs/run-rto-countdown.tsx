'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  TimerReset,
  XOctagon,
  type LucideIcon,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { DRFailoverRun } from '@/types/clario-dr';
import {
  breachState,
  elapsedSeconds,
  formatCountdown,
  remainingToObjective,
  type RTOBreachState,
} from '../../_lib/rto';
import { formatRecoveryDuration, isRunActive } from '@/components/product';
import { useRunWarRoomLabels, type RunWarRoomCopy } from './run-war-room-labels';

/**
 * Live RTO countdown for the incident-command view.
 *
 * A ticking stopwatch vs the run's `rto_objective_seconds`, computed entirely by
 * the pure `rto.ts` helpers (no FSM re-encoding here). The clock advances via a
 * 1s `setInterval` that is cleaned up on unmount and is NOT armed once the run is
 * terminal (the figures are frozen from the sealed run, so nothing needs to
 * tick).
 *
 * Accessibility: the breach state is conveyed with an ICON + TEXT label as well
 * as the state-* colour token — never colour alone (WCAG 1.4.1). The live region
 * announces the remaining/overrun figure politely so screen-reader operators
 * track the countdown without it stealing focus.
 */

interface BreachMeta {
  icon: LucideIcon;
  /** Token-driven text colour for the headline figure. */
  text: string;
  /** Token-driven badge classes (border + tinted fill + text). */
  badge: string;
  label: string;
}

function breachMeta(state: RTOBreachState, labels: RunWarRoomCopy): BreachMeta {
  switch (state) {
    case 'breached':
      return {
        icon: XOctagon,
        text: 'text-state-error',
        badge: 'border-state-error/40 bg-state-error/10 text-state-error',
        label: labels.rtoBreached,
      };
    case 'at_risk':
      return {
        icon: AlertTriangle,
        text: 'text-state-warning',
        badge: 'border-state-warning/40 bg-state-warning/10 text-state-warning',
        label: labels.rtoAtRisk,
      };
    default:
      return {
        icon: CheckCircle2,
        text: 'text-state-success',
        badge: 'border-state-success/40 bg-state-success/10 text-state-success',
        label: labels.rtoOnTrack,
      };
  }
}

export interface RunRtoCountdownProps {
  run: DRFailoverRun;
  /**
   * Optional projection (e.g. a forecast horizon) that can flip a live run to
   * `at_risk`/`breached` earlier than the elapsed clock alone. Not read off the
   * run object.
   */
  projectedSeconds?: number | null;
  /** Injected clock for deterministic tests. Defaults to `Date.now()`. */
  now?: number;
}

export function RunRtoCountdown({ run, projectedSeconds = null, now }: RunRtoCountdownProps) {
  const labels = useRunWarRoomLabels();
  const live = isRunActive(run.status);

  // Ticking clock. Seeded from the injected `now` (tests) or wall clock, then
  // advanced once per second WHILE the run is live. A terminal run freezes.
  const [tick, setTick] = useState<number>(() => now ?? Date.now());

  useEffect(() => {
    if (now !== undefined) {
      // Deterministic mode (tests): pin to the injected instant, no interval.
      setTick(now);
      return;
    }
    if (!live) {
      // Terminal run: figures are frozen; no need to tick.
      setTick(Date.now());
      return;
    }
    setTick(Date.now());
    const id = setInterval(() => setTick(Date.now()), 1_000);
    return () => clearInterval(id);
  }, [live, now]);

  const objective = Math.max(0, run.rto_objective_seconds || 0);
  const state = useMemo(() => breachState(run, tick, { projectedSeconds }), [run, tick, projectedSeconds]);
  const elapsed = useMemo(() => elapsedSeconds(run, tick), [run, tick]);
  const remaining = useMemo(() => remainingToObjective(run, tick), [run, tick]);

  const meta = breachMeta(state, labels);
  const Icon = meta.icon;

  // Headline figure: for terminal runs show the sealed actual; for live runs the
  // remaining countdown (negative once overrun → formatCountdown adds the '-').
  const headlineSeconds = !live && run.rto_actual_seconds != null ? run.rto_actual_seconds : remaining;
  const overrun = remaining != null && remaining < 0;

  return (
    <Card data-testid="run-rto-countdown" data-breach-state={state}>
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <TimerReset className="h-4 w-4 text-content-muted" aria-hidden />
            {labels.rtoTitle}
          </CardTitle>
          <CardDescription>{labels.rtoObjective}: {formatRecoveryDuration(objective)}</CardDescription>
        </div>
        <span
          className={cn(
            'inline-flex items-center gap-1.5 rounded-button border px-2.5 py-1 text-caption font-medium',
            meta.badge,
          )}
        >
          <Icon className="h-3.5 w-3.5" aria-hidden />
          {meta.label}
        </span>
      </CardHeader>
      <CardContent className="space-y-4">
        {objective <= 0 ? (
          <p className="text-sm text-content-muted">{labels.rtoNoObjective}</p>
        ) : (
          <>
            <div className="flex items-end justify-between gap-4">
              <div className="min-w-0">
                <p className="text-caption uppercase tracking-caps text-content-muted">
                  {!live && run.rto_actual_seconds != null
                    ? labels.rtoActual
                    : overrun
                      ? labels.rtoOverrun
                      : labels.rtoRemaining}
                </p>
                <p
                  className={cn('font-mono text-3xl font-semibold tabular-nums', meta.text)}
                  dir="ltr"
                  aria-live="polite"
                  aria-atomic="true"
                >
                  {formatCountdown(headlineSeconds)}
                </p>
              </div>
              <div className="text-end">
                <p className="text-caption uppercase tracking-caps text-content-muted">
                  {labels.rtoElapsed}
                </p>
                <p className="font-mono text-lg tabular-nums text-content-primary" dir="ltr">
                  {formatCountdown(elapsed)}
                </p>
              </div>
            </div>

            <RtoProgressBar
              elapsed={elapsed}
              objective={objective}
              state={state}
              ariaLabel={labels.rtoTitle}
            />
          </>
        )}
      </CardContent>
    </Card>
  );
}

const TRACK_FILL: Record<RTOBreachState, string> = {
  on_track: 'bg-state-success',
  at_risk: 'bg-state-warning',
  breached: 'bg-state-error',
};

function RtoProgressBar({
  elapsed,
  objective,
  state,
  ariaLabel,
}: {
  elapsed: number | null;
  objective: number;
  state: RTOBreachState;
  ariaLabel: string;
}) {
  const ratio = elapsed != null && objective > 0 ? Math.min(1, Math.max(0, elapsed / objective)) : 0;
  const percent = Math.round(ratio * 100);

  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      aria-label={ariaLabel}
      className="relative h-2 w-full overflow-hidden rounded-pill bg-surface-sunken"
    >
      <span
        className={cn('absolute inset-y-0 start-0 rounded-pill transition-all', TRACK_FILL[state])}
        style={{ width: `${percent}%` }}
        aria-hidden
      />
    </div>
  );
}
