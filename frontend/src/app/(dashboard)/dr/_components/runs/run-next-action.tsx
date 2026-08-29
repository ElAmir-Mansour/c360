'use client';

import {
  BadgeCheck,
  CheckCircle2,
  ShieldAlert,
  ShieldCheck,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type { DRFailoverRun } from '@/types/clario-dr';
import { useRunWarRoomLabels } from './run-war-room-labels';
import { deriveNextAction, type RunNextActionKind } from './run-war-room-derivations';

/**
 * "Next required action" panel — the operator-facing centrepiece of the
 * incident-command view.
 *
 * Surfaces, from the LIVE `run.status` FSM:
 *  - a plain-language headline of what the run is doing right now;
 *  - the single next required operator CTA (Approve at the approval gate;
 *    Cancel for an in-flight run; Cancel / roll back for a failed run); or an
 *    honest "no action required" / "complete" state otherwise.
 *
 * All write CTAs are gated by `dr:write` (passed in as `canWrite`); when absent
 * the button is disabled and explains itself via a tooltip. The visual emphasis
 * pairs an ICON + TEXT with the state-* colour token — never colour alone.
 */

export interface RunNextActionProps {
  run: DRFailoverRun;
  canWrite: boolean;
  onApprove: () => void;
  onCancel: () => void;
  approvePending: boolean;
  cancelPending: boolean;
}

interface ActionTone {
  icon: LucideIcon;
  accent: string;
  badge: string;
}

function toneForKind(kind: RunNextActionKind): ActionTone {
  switch (kind) {
    case 'approve':
      return {
        icon: ShieldAlert,
        accent: 'text-state-warning',
        badge: 'border-state-warning/40 bg-state-warning/10 text-state-warning',
      };
    case 'rollback':
      return {
        icon: XCircle,
        accent: 'text-state-error',
        badge: 'border-state-error/40 bg-state-error/10 text-state-error',
      };
    case 'cancel':
      return {
        icon: ShieldCheck,
        accent: 'text-state-info',
        badge: 'border-state-info/40 bg-state-info/10 text-state-info',
      };
    default:
      return {
        icon: CheckCircle2,
        accent: 'text-state-success',
        badge: 'border-state-success/40 bg-state-success/10 text-state-success',
      };
  }
}

export function RunNextAction({
  run,
  canWrite,
  onApprove,
  onCancel,
  approvePending,
  cancelPending,
}: RunNextActionProps) {
  const labels = useRunWarRoomLabels();
  const action = deriveNextAction(run);
  const tone = toneForKind(action.kind);
  const Icon = tone.icon;
  const status = String(run.status).toUpperCase();
  const headline =
    labels.statusHeadline[status] ?? labels.statusHeadline.INITIATED;

  return (
    <Card
      data-testid="run-next-action"
      data-action-kind={action.kind}
      className={cn(action.kind === 'approve' && 'border-state-warning/40')}
    >
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div className="min-w-0">
          <CardTitle className="text-base">{labels.nextActionTitle}</CardTitle>
          <CardDescription>{labels.nextActionDescription}</CardDescription>
        </div>
        <span
          className={cn(
            'inline-flex shrink-0 items-center gap-1.5 rounded-button border px-2.5 py-1 text-caption font-medium',
            tone.badge,
          )}
        >
          <Icon className="h-3.5 w-3.5" aria-hidden />
          {action.kind === 'approve'
            ? labels.approveLabel
            : action.kind === 'rollback'
              ? labels.rollbackLabel
              : action.kind === 'cancel'
                ? labels.cancelLabel
                : labels.terminalTitle}
        </span>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className={cn('text-base font-medium', tone.accent)}>{headline}</p>

        {action.kind === 'approve' ? (
          <div className="space-y-3">
            <p className="text-sm text-content-muted">{labels.approveHelp}</p>
            <div className="flex flex-wrap gap-2">
              <GatedButton
                label={labels.approveLabel}
                icon={<BadgeCheck className="h-4 w-4" aria-hidden />}
                variant="default"
                onClick={onApprove}
                pending={approvePending}
                disabledReason={canWrite ? null : labels.noWriteTooltip}
              />
              <GatedButton
                label={labels.cancelLabel}
                icon={<XCircle className="h-4 w-4" aria-hidden />}
                variant="outline"
                onClick={onCancel}
                pending={cancelPending}
                disabledReason={canWrite ? null : labels.noWriteTooltip}
              />
            </div>
          </div>
        ) : action.kind === 'rollback' ? (
          <div className="space-y-3">
            {run.last_error ? (
              <p className="rounded-button border border-state-error/40 bg-state-error/5 px-3 py-2 text-sm text-state-error">
                {run.last_error}
              </p>
            ) : null}
            <p className="text-sm text-content-muted">{labels.rollbackHelp}</p>
            <GatedButton
              label={labels.rollbackLabel}
              icon={<XCircle className="h-4 w-4" aria-hidden />}
              variant="destructive"
              onClick={onCancel}
              pending={cancelPending}
              disabledReason={canWrite ? null : labels.noWriteTooltip}
            />
          </div>
        ) : action.kind === 'cancel' ? (
          <div className="space-y-3">
            <p className="text-sm text-content-muted">{labels.waitingDescription}</p>
            <GatedButton
              label={labels.cancelLabel}
              icon={<XCircle className="h-4 w-4" aria-hidden />}
              variant="outline"
              onClick={onCancel}
              pending={cancelPending}
              disabledReason={canWrite ? null : labels.noWriteTooltip}
            />
          </div>
        ) : (
          <p className="text-sm text-content-muted">{labels.terminalDescription}</p>
        )}
      </CardContent>
    </Card>
  );
}

interface GatedButtonProps {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  disabledReason: string | null;
  pending: boolean;
  variant?: 'default' | 'destructive' | 'outline';
}

/** A write-gated CTA that disables + explains itself via a tooltip. */
function GatedButton({
  label,
  icon,
  onClick,
  disabledReason,
  pending,
  variant = 'outline',
}: GatedButtonProps) {
  const disabled = disabledReason !== null || pending;
  const button = (
    <Button
      type="button"
      variant={variant}
      onClick={onClick}
      disabled={disabled}
      aria-disabled={disabled || undefined}
    >
      {pending ? (
        <Spinner size="sm" className="me-1.5" />
      ) : (
        <span className="me-1.5 inline-flex">{icon}</span>
      )}
      {label}
    </Button>
  );

  if (!disabledReason) return button;

  return (
    <Tooltip>
      {/* Disabled buttons swallow pointer events, so wrap for the tooltip trigger. */}
      <TooltipTrigger asChild>
        <span tabIndex={0} className="inline-flex">
          {button}
        </span>
      </TooltipTrigger>
      <TooltipContent>{disabledReason}</TooltipContent>
    </Tooltip>
  );
}
