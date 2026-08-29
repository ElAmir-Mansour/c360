'use client';

/**
 * "What needs you now" — the status-complete Litigation Case detail action bar.
 *
 * Mirrors the service-desk `RequestActionBar` gold standard: instead of a
 * passive "the case advances through its lifecycle" sentence, this surfaces the
 * SINGLE most relevant next action for the case's current state, as an inline
 * button (opening the parent's existing dialog) or a deep-link into the right
 * tab. It covers every {@link CaseStatus} plus the cross-cutting urgency
 * signals (overdue deadlines, missing owner, un-assessed strength).
 *
 * Write-driven actions (intake / status / strength / edit) are delegated to the
 * parent via callbacks so the parent keeps ownership of its dialogs, and are
 * gated on `canWrite` (`lex:case:edit`). Read-only deadline deep-links are shown
 * to everyone. Self-contained + bilingual via `useCaseDetailExtraLabels`.
 */

import {
  ArrowRight,
  CalendarClock,
  ClipboardList,
  GaugeCircle,
  PlayCircle,
  RefreshCw,
  ShieldAlert,
  UserRound,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLexFormat } from '@/lib/lex/ksa';
import { cn } from '@/lib/utils';
import type { CaseStatus, LegalCase } from '@/lib/lex/cases';
import type { DeadlineItem, DeadlineItemType } from '../../_components/detail-workspace/workflow-metrics';
import { useCaseDetailExtraLabels } from './case-detail-labels';

export interface CaseActionBarProps {
  legalCase: LegalCase;
  /** `hasPermission('lex:case:edit')` — gates the write-driven actions. */
  canWrite: boolean;
  /** `hasPermission('lex:case:assign')` — gates Phase-2 handoff and later allocation. */
  canAssign: boolean;
  /** Actor-scoped intake queue contains this case's current Phase-1 task. */
  phase1DecisionAvailable?: boolean;
  /** Deadline items already derived by the parent (tasks/hearings/experts/judgments). */
  deadlineItems: DeadlineItem[];
  onAssign: () => void;
  onIntake: () => void;
  onOpenApprovals: () => void;
  onChangeStatus: () => void;
  onSetStrength: () => void;
  onSetRiskRating: () => void;
  onOpenTab: (tab: string) => void;
}

type BarTone = 'primary' | 'muted' | 'urgent' | 'watch';

interface ResolvedAction {
  tone: BarTone;
  text: string;
  actionLabel?: string;
  icon?: typeof RefreshCw;
  onAction?: () => void;
}

/** Which detail tab owns a given deadline type. */
function tabForDeadline(type: DeadlineItemType | undefined): string {
  switch (type) {
    case 'task':
      return 'tasks';
    case 'hearing':
      return 'hearings';
    case 'expert':
      return 'experts';
    case 'judgment':
      return 'judgments';
    default:
      return 'timeline';
  }
}

export function CaseActionBar({
  legalCase,
  canWrite,
  canAssign,
  phase1DecisionAvailable = false,
  deadlineItems,
  onAssign,
  onIntake,
  onOpenApprovals,
  onChangeStatus,
  onSetStrength,
  onSetRiskRating,
  onOpenTab,
}: CaseActionBarProps) {
  const t = useCaseDetailExtraLabels().actionBar;
  const f = useLexFormat();

  const status = legalCase.status as CaseStatus;
  const overdue = deadlineItems.filter((item) => item.daysUntil < 0);
  const nextCritical = deadlineItems.find((item) => item.daysUntil >= 0 && item.daysUntil <= 2);
  const terminal = status === 'closed' || status === 'cancelled';

  const action = ((): ResolvedAction => {
    // Terminal states first — muted, with an optional reopen for writers.
    if (terminal) {
      return {
        tone: 'muted',
        text: status === 'closed' ? t.closedHint : t.cancelledHint,
        ...(canWrite
          ? { actionLabel: t.reopenCase, icon: RefreshCw, onAction: onChangeStatus }
          : {}),
      };
    }

    // Intake still open.
    if (status === 'intake') {
      return canWrite
        ? { tone: 'primary', text: t.intakeHint, actionLabel: t.completeIntake, icon: ClipboardList, onAction: onIntake }
        : { tone: 'muted', text: t.readOnly };
    }

    // The governed pipeline never advances through the generic status dialog.
    // Phase 1 is resolved from Awaiting me; Phase 2 is completed by an assigner
    // through the entity-scoped intake handoff.
    if (status === 'phase1') {
      return phase1DecisionAvailable
        ? {
            tone: 'primary',
            text: t.phase1Hint,
            actionLabel: t.openApprovals,
            icon: ClipboardList,
            onAction: onOpenApprovals,
          }
        : { tone: 'muted', text: t.phase1AwaitingManagerHint };
    }
    if (status === 'phase2') {
      return canAssign
        ? {
            tone: 'primary',
            text: t.phase2Hint,
            actionLabel: t.completeHandoff,
            icon: UserRound,
            onAction: onIntake,
          }
        : { tone: 'muted', text: t.phase2Hint };
    }

    // Overdue deadlines dominate once a case is operational — read-only deep
    // link, shown to everyone.
    if (overdue.length > 0) {
      return {
        tone: 'urgent',
        text: t.overdueHint(f.formatNumber(overdue.length)),
        actionLabel: t.reviewDeadlines,
        icon: CalendarClock,
        onAction: () => onOpenTab(tabForDeadline(overdue[0]?.type)),
      };
    }

    // Paused.
    if (status === 'on_hold') {
      return canWrite
        ? { tone: 'primary', text: t.onHoldHint, actionLabel: t.resumeCase, icon: PlayCircle, onAction: onChangeStatus }
        : { tone: 'muted', text: t.onHoldHint };
    }

    // Operational (open / under_procedure): surface the biggest gap.
    if (!legalCase.handling_officer_id && !legalCase.responsible_lawyer) {
      return canAssign
        ? { tone: 'primary', text: t.assignOwnerHint, actionLabel: t.assignLawyer, icon: UserRound, onAction: onAssign }
        : { tone: 'muted', text: t.assignOwnerHint };
    }
    if (!legalCase.strength) {
      return canWrite
        ? { tone: 'primary', text: t.assessStrengthHint, actionLabel: t.assessStrength, icon: GaugeCircle, onAction: onSetStrength }
        : { tone: 'muted', text: t.assessStrengthHint };
    }
    if (!legalCase.risk_rating) {
      return canWrite
        ? { tone: 'primary', text: t.assessRiskHint, actionLabel: t.assessRisk, icon: ShieldAlert, onAction: onSetRiskRating }
        : { tone: 'muted', text: t.assessRiskHint };
    }
    if (nextCritical) {
      return {
        tone: 'watch',
        text: t.upcomingHint(f.formatRelative(nextCritical.date)),
        actionLabel: t.reviewDeadlines,
        icon: CalendarClock,
        onAction: () => onOpenTab(tabForDeadline(nextCritical.type)),
      };
    }

    // Steady state.
    return canWrite
      ? { tone: 'primary', text: t.steadyHint, actionLabel: t.changeStatus, icon: RefreshCw, onAction: onChangeStatus }
      : { tone: 'muted', text: t.readOnly };
  })();

  const Icon = action.icon;

  return (
    <div
      className={cn(
        'rounded-2xl border px-4 py-3',
        action.tone === 'muted' && 'bg-muted/40',
        action.tone === 'primary' && 'border-primary/25 bg-primary/[0.06]',
        action.tone === 'urgent' && 'border-destructive/30 bg-destructive/[0.06]',
        action.tone === 'watch' && 'border-warning-300/50 bg-warning-50/60 dark:bg-warning-700/10',
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 space-y-0.5">
          <p className="text-xs font-semibold uppercase tracking-caps-xwide text-muted-foreground">
            {t.heading}
          </p>
          <p
            className={cn(
              'text-sm',
              action.tone === 'muted' ? 'text-muted-foreground' : 'font-medium text-foreground',
            )}
            dir="auto"
          >
            {action.text}
          </p>
        </div>
        {action.actionLabel && action.onAction ? (
          <div className="shrink-0">
            <Button
              variant={action.tone === 'urgent' ? 'destructive' : action.tone === 'primary' ? 'default' : 'outline'}
              onClick={action.onAction}
              className="motion-safe:duration-fast"
            >
              {Icon ? <Icon className="me-1.5 h-4 w-4" aria-hidden /> : null}
              {action.actionLabel}
              {action.tone === 'urgent' || action.tone === 'watch' ? (
                <ArrowRight className="ms-1.5 h-4 w-4 rtl:rotate-180" aria-hidden />
              ) : null}
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
