'use client';

/**
 * #1 "What needs you now" — the status-complete Matters detail action bar.
 *
 * A matter is an umbrella work item that moves through a small lifecycle FSM
 * (intake → open → in_review → closed, with waiting_on_business / on_hold /
 * cancelled off to the side). This bar reads the current status and surfaces the
 * single most relevant next action inline — never a dead end — and, when the
 * matter's SLA is at risk (overdue / breached and still active), it overrides
 * the status hint with an urgent triage call-to-action.
 *
 * All mutating actions are delegated to the parent via callbacks (the parent
 * owns the triage / status dialogs) and gated on `canWrite`
 * (`lex:case:edit`); a read-only viewer sees a muted informational bar.
 */

import type { ReactNode } from 'react';
import { AlertTriangle, RefreshCw, SlidersHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { LexMatter } from '@/types/suites';
import {
  isMatterAtRisk,
  matterSlaTier,
  matterSlaTimingText,
  useMatterSlaLabels,
} from '../../_lib/matter-sla';
import { useMatterActionBarLabels } from './matter-detail-labels';

export interface MatterActionBarProps {
  matter: LexMatter;
  /** `hasPermission('lex:case:edit')` — gates the mutating actions. */
  canWrite: boolean;
  /** Forward status transitions allowed from the current status (disables the
   *  change-status action when empty). */
  allowedStatuses: readonly string[];
  /** Open the triage dialog. */
  onTriage: () => void;
  /** Open the change-status dialog. */
  onStatus: () => void;
}

type BarTone = 'primary' | 'muted' | 'danger';

const TERMINAL_STATUSES = new Set(['closed', 'cancelled']);

export function MatterActionBar({
  matter,
  canWrite,
  allowedStatuses,
  onTriage,
  onStatus,
}: MatterActionBarProps) {
  const l = useMatterActionBarLabels();
  const slaLabels = useMatterSlaLabels();

  const readOnlyBar = <ActionBar heading={l.heading} tone="muted" text={l.readOnly} />;

  if (!canWrite) {
    return readOnlyBar;
  }

  // At-risk override — an active matter that is overdue/breached jumps to an
  // urgent triage CTA regardless of the raw lifecycle hint.
  if (!TERMINAL_STATUSES.has(matter.status) && isMatterAtRisk(matter)) {
    const tier = slaLabels.tier[matterSlaTier(matter)];
    const timing = matterSlaTimingText(matter, slaLabels);
    return (
      <ActionBar
        heading={l.heading}
        tone="danger"
        text={l.riskHint(tier, timing)}
        icon={<AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />}
        action={
          <Button variant="destructive" onClick={onTriage}>
            <SlidersHorizontal className="me-1.5 h-4 w-4" aria-hidden />
            {l.riskAction}
          </Button>
        }
      />
    );
  }

  const triageAction = (
    <Button onClick={onTriage}>
      <SlidersHorizontal className="me-1.5 h-4 w-4" aria-hidden />
      {l.triage}
    </Button>
  );

  const statusAction = (label: string) => (
    <Button onClick={onStatus} disabled={allowedStatuses.length === 0}>
      <RefreshCw className="me-1.5 h-4 w-4" aria-hidden />
      {label}
    </Button>
  );

  switch (matter.status) {
    case 'intake':
      return <ActionBar heading={l.heading} text={l.intakeHint} action={triageAction} />;
    case 'open':
      return (
        <ActionBar heading={l.heading} text={l.openHint} action={statusAction(l.changeStatus)} />
      );
    case 'in_review':
      return (
        <ActionBar heading={l.heading} text={l.inReviewHint} action={statusAction(l.changeStatus)} />
      );
    case 'waiting_on_business':
      return (
        <ActionBar heading={l.heading} text={l.waitingHint} action={statusAction(l.changeStatus)} />
      );
    case 'on_hold':
      return <ActionBar heading={l.heading} text={l.onHoldHint} action={statusAction(l.resume)} />;
    case 'closed':
      return <ActionBar heading={l.heading} tone="muted" text={l.closedHint} />;
    case 'cancelled':
      return <ActionBar heading={l.heading} tone="muted" text={l.cancelledHint} />;
    default:
      return <ActionBar heading={l.heading} tone="muted" text={l.genericHint} />;
  }
}

/* ------------------------------------------------------------------------- *
 * Private presentational bar — a rounded-2xl band with an overline heading + one
 * line of text on the start and the action on the end. Actionable = primary
 * tint; `danger` = destructive tint; `muted` = neutral surface.
 * ------------------------------------------------------------------------- */

function ActionBar({
  heading,
  text,
  action,
  icon,
  tone = 'primary',
}: {
  heading: string;
  text: string;
  action?: ReactNode;
  icon?: ReactNode;
  tone?: BarTone;
}) {
  return (
    <div
      className={cn(
        'rounded-2xl border px-4 py-3',
        tone === 'muted' && 'bg-muted/40',
        tone === 'primary' && 'border-primary/25 bg-primary/[0.06]',
        tone === 'danger' &&
          'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-800/60 dark:bg-rose-900/25 dark:text-rose-200',
      )}
      role={tone === 'danger' ? 'alert' : undefined}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          {icon}
          <div className="min-w-0 space-y-0.5">
            <p className="text-xs font-semibold uppercase tracking-caps-xwide text-muted-foreground">
              {heading}
            </p>
            <p
              className={cn(
                'text-sm',
                tone === 'muted' ? 'text-muted-foreground' : 'font-medium',
                tone === 'primary' && 'text-foreground',
              )}
              dir="auto"
            >
              {text}
            </p>
          </div>
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
    </div>
  );
}
