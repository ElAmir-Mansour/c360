'use client';

/**
 * "What needs you now" — the status-complete Settlements / ADR action bar.
 *
 * Covers EVERY settlement FSM status (`proposed → negotiating →
 * pending_approval → approved → executed`, plus the terminal `rejected` /
 * `abandoned`) and surfaces the single most-relevant next action inline, gated
 * on the domain's DISTINCT verbs:
 *
 *   - mutable (proposed / negotiating / rejected) → record terms / submit /
 *     re-open, on `lex:settlement:edit` (`canWrite`);
 *   - pending_approval → the approval decision, on `lex:settlement:approve`
 *     (`canApprove`) — opens the existing decision dialog (the workflow task is
 *     resolved there); non-approvers get an honest "awaiting decision" line;
 *   - approved → close-by-reconciliation, on `lex:settlement:close` (`canClose`);
 *   - executed / abandoned → a muted terminal line (nothing to act on).
 *
 * Purely a router of the parent's own callbacks/dialogs — it owns no mutation,
 * so the page keeps single ownership of every write path. Presentational chrome
 * mirrors the service-desk `RequestActionBar` (primary-tinted vs. muted band).
 */

import type { ReactNode } from 'react';
import { ArrowRight, CheckCircle2, PencilLine, Plus, Send, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { isSettlementMutable, type Settlement } from '@/lib/lex/settlements';
import { useSettlementDetailExtraLabels } from './detail-extra-labels';

export interface SettlementActionBarProps {
  settlement: Settlement;
  /** `hasPermission('lex:settlement:edit')`. */
  canWrite: boolean;
  /** `hasPermission('lex:settlement:approve')`. */
  canApprove: boolean;
  /** `hasPermission('lex:settlement:close')`. */
  canClose: boolean;
  /** Open the edit/record-terms dialog. */
  onRecordTerms: () => void;
  /** Open the add-negotiation-round dialog. */
  onAddRound: () => void;
  /** Open the submit-for-approval confirm. */
  onSubmit: () => void;
  /** Open the approval-decision dialog. */
  onDecide: () => void;
  /** Open the close-by-reconciliation confirm. */
  onClose: () => void;
  /** Switch to the tab that shows the approval workflow (Overview). */
  onOpenApproval: () => void;
}

export function SettlementActionBar({
  settlement,
  canWrite,
  canApprove,
  canClose,
  onRecordTerms,
  onAddRound,
  onSubmit,
  onDecide,
  onClose,
  onOpenApproval,
}: SettlementActionBarProps) {
  const t = useSettlementDetailExtraLabels().actionBar;
  const mutable = isSettlementMutable(settlement.status);
  const hasTerms = settlement.terms.trim().length > 0;

  const readOnly = <ActionBar heading={t.heading} muted text={t.readOnly} />;

  switch (settlement.status) {
    case 'proposed':
    case 'negotiating': {
      if (!canWrite) return readOnly;
      // Terms not yet captured → record them; once captured → submit for approval.
      if (!hasTerms) {
        return (
          <ActionBar
            heading={t.heading}
            text={t.recordTermsHint}
            action={
              <Button onClick={onRecordTerms}>
                <PencilLine className="me-1.5 h-4 w-4" aria-hidden />
                {t.recordTerms}
              </Button>
            }
          />
        );
      }
      return (
        <ActionBar
          heading={t.heading}
          text={t.submitHint}
          action={
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" onClick={onAddRound}>
                <Plus className="me-1.5 h-4 w-4" aria-hidden />
                {t.addRound}
              </Button>
              <Button onClick={onSubmit}>
                <Send className="me-1.5 h-4 w-4" aria-hidden />
                {t.submit}
              </Button>
            </div>
          }
        />
      );
    }

    case 'rejected': {
      if (!canWrite) return readOnly;
      return (
        <ActionBar
          heading={t.heading}
          text={t.reopenHint}
          action={
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" onClick={onAddRound}>
                <Plus className="me-1.5 h-4 w-4" aria-hidden />
                {t.addRound}
              </Button>
              <Button onClick={onRecordTerms}>
                <PencilLine className="me-1.5 h-4 w-4" aria-hidden />
                {t.recordTerms}
              </Button>
            </div>
          }
        />
      );
    }

    case 'pending_approval': {
      if (canApprove) {
        return (
          <ActionBar
            heading={t.heading}
            text={t.awaitingApprovalHint}
            action={
              <Button onClick={onDecide}>
                <ShieldCheck className="me-1.5 h-4 w-4" aria-hidden />
                {t.decide}
              </Button>
            }
          />
        );
      }
      return (
        <ActionBar
          heading={t.heading}
          text={t.awaitingOthersHint}
          action={
            settlement.workflow_instance_id ? (
              <Button variant="outline" onClick={onOpenApproval}>
                {t.openApproval}
                <ArrowRight className="ms-1.5 h-4 w-4 rtl:rotate-180" aria-hidden />
              </Button>
            ) : undefined
          }
        />
      );
    }

    case 'approved': {
      if (!canClose) {
        return <ActionBar heading={t.heading} muted text={t.awaitingExecutionHint} />;
      }
      return (
        <ActionBar
          heading={t.heading}
          text={t.executeHint}
          action={
            <Button onClick={onClose}>
              <CheckCircle2 className="me-1.5 h-4 w-4" aria-hidden />
              {t.execute}
            </Button>
          }
        />
      );
    }

    case 'executed':
      return <ActionBar heading={t.heading} muted text={t.executedHint} />;
    case 'abandoned':
      return <ActionBar heading={t.heading} muted text={t.abandonedHint} />;
    default:
      return <ActionBar heading={t.heading} muted text={t.noneHint} />;
  }
}

/* ------------------------------------------------------------------------- *
 * Private presentational bar — a rounded band with an overline heading + one
 * line of text on the start and action(s) on the end. Actionable =
 * primary-tinted; `muted` = neutral surface. Mirrors the service-desk bar.
 * ------------------------------------------------------------------------- */

function ActionBar({
  heading,
  text,
  action,
  muted = false,
}: {
  heading: string;
  text: string;
  action?: ReactNode;
  muted?: boolean;
}) {
  return (
    <div
      className={cn(
        'rounded-2xl border px-4 py-3',
        muted ? 'bg-muted/40' : 'border-primary/25 bg-primary/[0.06]',
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 space-y-0.5">
          <p className="text-xs font-semibold uppercase tracking-caps-xwide text-muted-foreground">
            {heading}
          </p>
          <p
            className={cn('text-sm', muted ? 'text-muted-foreground' : 'font-medium text-foreground')}
            dir="auto"
          >
            {text}
          </p>
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
    </div>
  );
}
