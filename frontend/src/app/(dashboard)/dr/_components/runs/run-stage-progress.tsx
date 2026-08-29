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
import { cn } from '@/lib/utils';
import type { DRFailoverRun } from '@/types/clario-dr';
import { useRunWarRoomLabels, type RunWarRoomCopy } from './run-war-room-labels';
import {
  deriveGateTimeline,
  type WarRoomGateState,
} from './run-war-room-derivations';

/**
 * Horizontal stage-progress strip for the live execution pipeline
 * (validate -> approve -> execute -> attest), summarising the four recovery
 * gates as a single scannable rail above the detailed vertical {@link RunGateTimeline}.
 *
 * It is a presentation-only consumer of the existing pure {@link deriveGateTimeline}
 * derivation and the bilingual {@link useRunWarRoomLabels} copy — no new run fields,
 * no clock, no fabricated steps. Each stage's state is conveyed by an ICON + TEXT
 * marker (never colour alone, WCAG 2.1 AA) and the connector fill mirrors the
 * cleared-gate count. Motion (the spinning "in progress" icon) is the only
 * animation and respects the global `prefers-reduced-motion` guard via Tailwind's
 * `motion-reduce` utilities.
 */

interface StageStateMeta {
  icon: LucideIcon;
  spin: boolean;
  ring: string;
  iconText: string;
  marker: string;
  markerClass: string;
  labelClass: string;
  /** Whether the connector LEADING INTO this stage should read as completed. */
  connectorDone: boolean;
}

function stageStateMeta(state: WarRoomGateState, labels: RunWarRoomCopy): StageStateMeta {
  switch (state) {
    case 'done':
      return {
        icon: CheckCircle2,
        spin: false,
        ring: 'border-state-success bg-state-success/10',
        iconText: 'text-state-success',
        marker: labels.doneMarker,
        markerClass: 'text-state-success',
        labelClass: 'font-medium text-content-secondary',
        connectorDone: true,
      };
    case 'current':
      return {
        icon: Loader2,
        spin: true,
        ring: 'border-state-warning bg-state-warning/10',
        iconText: 'text-state-warning',
        marker: labels.currentMarker,
        markerClass: 'text-state-warning',
        labelClass: 'font-semibold text-content-primary',
        connectorDone: true,
      };
    case 'next':
      return {
        icon: CircleDot,
        spin: false,
        ring: 'border-state-info bg-state-info/10',
        iconText: 'text-state-info',
        marker: labels.nextMarker,
        markerClass: 'text-state-info',
        labelClass: 'font-semibold text-content-primary',
        connectorDone: false,
      };
    case 'failed':
      return {
        icon: XCircle,
        spin: false,
        ring: 'border-state-error bg-state-error/10',
        iconText: 'text-state-error',
        marker: labels.failedMarker,
        markerClass: 'text-state-error',
        labelClass: 'font-semibold text-content-primary',
        connectorDone: true,
      };
    case 'skipped':
      return {
        icon: CircleDashed,
        spin: false,
        ring: 'border-outline-subtle bg-surface-sunken',
        iconText: 'text-content-muted',
        marker: labels.skippedMarker,
        markerClass: 'text-content-muted',
        labelClass: 'font-medium text-content-muted',
        connectorDone: false,
      };
    default:
      return {
        icon: CircleDashed,
        spin: false,
        ring: 'border-outline-subtle bg-surface-sunken',
        iconText: 'text-content-muted',
        marker: labels.pendingMarker,
        markerClass: 'text-content-muted',
        labelClass: 'font-medium text-content-muted',
        connectorDone: false,
      };
  }
}

export interface RunStageProgressProps {
  run: DRFailoverRun;
}

/**
 * Compact horizontal pipeline summarising the run's four recovery gates. Reads
 * the same `deriveGateTimeline` state machine the vertical timeline uses, so the
 * two surfaces can never disagree.
 */
export function RunStageProgress({ run }: RunStageProgressProps) {
  const labels = useRunWarRoomLabels();
  const gates = useMemo(() => deriveGateTimeline(run), [run]);
  const clearedCount = gates.filter((gate) => gate.state === 'done').length;

  return (
    <ol
      className="card flex items-stretch gap-0 overflow-x-auto p-3"
      aria-label={labels.timelineTitle}
    >
      {gates.map((gate, index) => {
        const meta = stageStateMeta(gate.state, labels);
        const Icon = meta.icon;
        const label = labels.gateLabels[gate.key] ?? gate.key;
        const showLeadingConnector = index > 0;
        // The connector LEADING INTO this stage is "filled" once the previous
        // stage has been cleared (or is being cleared / failed).
        const prevDone =
          index > 0 ? stageStateMeta(gates[index - 1].state, labels).connectorDone : false;

        return (
          <li
            key={gate.key}
            className="flex min-w-[7rem] flex-1 flex-col items-center gap-2"
            data-gate={gate.key}
            data-gate-state={gate.state}
          >
            <div className="flex w-full items-center">
              {showLeadingConnector ? (
                <span
                  className={cn(
                    'h-0.5 flex-1 rounded-full',
                    prevDone ? 'bg-state-success/60' : 'bg-outline-subtle',
                  )}
                  aria-hidden
                />
              ) : (
                <span className="flex-1" aria-hidden />
              )}
              <span
                className={cn(
                  'mx-1.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border',
                  meta.ring,
                )}
              >
                <Icon
                  className={cn(
                    'h-4 w-4',
                    meta.iconText,
                    meta.spin && 'animate-spin motion-reduce:animate-none',
                  )}
                  aria-hidden
                />
              </span>
              {index < gates.length - 1 ? (
                <span
                  className={cn(
                    'h-0.5 flex-1 rounded-full',
                    meta.connectorDone ? 'bg-state-success/60' : 'bg-outline-subtle',
                  )}
                  aria-hidden
                />
              ) : (
                <span className="flex-1" aria-hidden />
              )}
            </div>
            <div className="flex flex-col items-center gap-0.5 text-center">
              <span className={cn('text-sm', meta.labelClass)}>{label}</span>
              <span className={cn('text-caption font-medium', meta.markerClass)}>
                {meta.marker}
              </span>
            </div>
          </li>
        );
      })}
      <li className="sr-only" aria-live="polite">
        {`${clearedCount} / ${gates.length}`}
      </li>
    </ol>
  );
}
