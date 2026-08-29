'use client';

import { useMemo } from 'react';
import {
  CheckCircle2,
  CircleDashed,
  CircleDot,
  Loader2,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { DRFailoverRun, DRFailoverStep } from '@/types/clario-dr';
import { useRunWarRoomLabels, type RunWarRoomCopy } from './run-war-room-labels';
import {
  deriveGateTimeline,
  WAR_ROOM_GATES,
  type WarRoomGateKey,
  type WarRoomGateState,
} from './run-war-room-derivations';

/**
 * Live four-gate timeline (validate -> approve -> execute -> attest) for the
 * incident-command view.
 *
 * The gate ladder is driven by the LIVE `run.status` FSM (current/next gate
 * emphasised); completed gates are stamped with the real timestamp from the
 * driver's `DRFailoverStep[]`. Step names carry `gate1.`/`gate2.`/`gate3.`/
 * `gate4.` prefixes, which map to validate/approve/execute/attest — that is the
 * only mapping done here; no steps are fabricated.
 *
 * Accessibility: each gate's state is conveyed by an ICON + TEXT marker (never
 * colour alone); the ladder is an ordered list so screen readers read the
 * sequence.
 */

const GATE_STEP_PREFIX: Record<WarRoomGateKey, string> = {
  validate: 'gate1.',
  approve: 'gate2.',
  execute: 'gate3.',
  attest: 'gate4.',
};

interface GateStateMeta {
  icon: LucideIcon;
  spin: boolean;
  ring: string;
  text: string;
  marker: string;
  markerClass: string;
  emphasis: boolean;
}

function gateStateMeta(state: WarRoomGateState, labels: RunWarRoomCopy): GateStateMeta {
  switch (state) {
    case 'done':
      return {
        icon: CheckCircle2,
        spin: false,
        ring: 'border-state-success bg-state-success/10',
        text: 'text-state-success',
        marker: labels.doneMarker,
        markerClass: 'text-state-success',
        emphasis: false,
      };
    case 'current':
      return {
        icon: Loader2,
        spin: true,
        ring: 'border-state-warning bg-state-warning/10',
        text: 'text-state-warning',
        marker: labels.currentMarker,
        markerClass: 'text-state-warning',
        emphasis: true,
      };
    case 'next':
      return {
        icon: CircleDot,
        spin: false,
        ring: 'border-state-info bg-state-info/10',
        text: 'text-state-info',
        marker: labels.nextMarker,
        markerClass: 'text-state-info',
        emphasis: true,
      };
    case 'failed':
      return {
        icon: XCircle,
        spin: false,
        ring: 'border-state-error bg-state-error/10',
        text: 'text-state-error',
        marker: labels.failedMarker,
        markerClass: 'text-state-error',
        emphasis: true,
      };
    case 'skipped':
      return {
        icon: CircleDashed,
        spin: false,
        ring: 'border-outline-subtle bg-surface-sunken',
        text: 'text-content-muted',
        marker: labels.skippedMarker,
        markerClass: 'text-content-muted',
        emphasis: false,
      };
    default:
      return {
        icon: CircleDashed,
        spin: false,
        ring: 'border-outline-subtle bg-surface-sunken',
        text: 'text-content-muted',
        marker: labels.pendingMarker,
        markerClass: 'text-content-muted',
        emphasis: false,
      };
  }
}

function tsMs(value?: string | null): number {
  if (!value) return 0;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? 0 : ms;
}

function formatStamp(value?: string | null): string | null {
  if (!value) return null;
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) return null;
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(ms));
}

export interface RunGateTimelineProps {
  run: DRFailoverRun;
  steps: DRFailoverStep[];
}

export function RunGateTimeline({ run, steps }: RunGateTimelineProps) {
  const labels = useRunWarRoomLabels();
  const gates = useMemo(() => deriveGateTimeline(run), [run]);

  // Latest finished timestamp per gate, from the real driver steps.
  const stampByGate = useMemo(() => {
    const map = new Map<WarRoomGateKey, string>();
    for (const key of WAR_ROOM_GATES) {
      const prefix = GATE_STEP_PREFIX[key];
      let latest = 0;
      let stamp: string | null = null;
      for (const step of steps) {
        if (!step.step?.startsWith(prefix)) continue;
        const at = tsMs(step.finished_at) || tsMs(step.started_at);
        if (at >= latest) {
          latest = at;
          stamp = step.finished_at ?? step.started_at ?? null;
        }
      }
      if (stamp) map.set(key, stamp);
    }
    return map;
  }, [steps]);

  return (
    <Card data-testid="run-gate-timeline">
      <CardHeader>
        <CardTitle className="text-base">{labels.timelineTitle}</CardTitle>
        <CardDescription>{labels.timelineDescription}</CardDescription>
      </CardHeader>
      <CardContent>
        <ol className="space-y-3">
          {gates.map((gate, index) => {
            const meta = gateStateMeta(gate.state, labels);
            const Icon = meta.icon;
            const stamp = formatStamp(stampByGate.get(gate.key));
            const label = labels.gateLabels[gate.key] ?? gate.key;
            return (
              <li key={gate.key} className="flex gap-3" data-gate={gate.key} data-gate-state={gate.state}>
                <div className="flex flex-col items-center">
                  <span
                    className={cn(
                      'flex h-8 w-8 shrink-0 items-center justify-center rounded-full border',
                      meta.ring,
                    )}
                  >
                    <Icon className={cn('h-4 w-4', meta.text, meta.spin && 'animate-spin')} aria-hidden />
                  </span>
                  {index < gates.length - 1 ? (
                    <span className="mt-1 w-px flex-1 bg-outline-subtle" aria-hidden />
                  ) : null}
                </div>
                <div className="min-w-0 flex-1 pb-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span
                      className={cn(
                        'truncate text-sm',
                        meta.emphasis ? 'font-semibold text-content-primary' : 'font-medium text-content-secondary',
                      )}
                    >
                      {label}
                    </span>
                    <span className={cn('inline-flex items-center gap-1 text-caption font-medium', meta.markerClass)}>
                      {meta.marker}
                    </span>
                  </div>
                  {stamp ? (
                    <p className="mt-0.5 text-xs text-content-muted" dir="ltr">
                      {stamp}
                    </p>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
      </CardContent>
    </Card>
  );
}
