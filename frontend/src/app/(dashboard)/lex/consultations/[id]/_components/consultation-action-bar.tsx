'use client';

/**
 * "What needs you now" — the status-complete Legal Consultation detail action
 * bar. It covers every consultation FSM status and surfaces the single most
 * relevant next action inline, gated on the domain permission verbs:
 *
 *   submitted   → Classify          (lex:consultation:edit)
 *   classified  → Route to advisor  (lex:consultation:edit)
 *   routed      → Record response   (lex:consultation:edit)
 *   responded   → inline Approve/Reject when an open approval task exists and the
 *                 viewer holds lex:consultation:approve; else Start approval
 *                 (also lex:consultation:approve); else "awaiting a decision"
 *   approved    → Archive           (lex:consultation:edit; blocked under a legal hold)
 *   archived    → terminal, no action
 *
 * Self-contained: it owns the approval-task query (SAME key the page uses, so
 * one shared fetch) + the inline decision mutation. Write-driven actions are
 * delegated to the parent via callbacks so the parent keeps ownership of its
 * dialogs; the approval decision gates on the DISTINCT approve verb.
 */

import type { ReactNode } from 'react';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Archive,
  CheckCircle2,
  ClipboardCheck,
  Loader2,
  Route as RouteIcon,
  Send,
  Tag,
  XCircle,
} from 'lucide-react';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { WithTooltip } from '@/components/ui/with-tooltip';
import { showApiError, showSuccess } from '@/lib/toast';
import { cn } from '@/lib/utils';
import {
  consultationsApi,
  type Consultation,
  type ConsultationApprovalTask,
} from '@/lib/lex/consultations';
import { useConsultationDetailLabels } from './detail-extra-labels';

export interface ConsultationActionBarProps {
  consultation: Consultation;
  /** `hasPermission('lex:consultation:edit')` — gates the write-driven actions. */
  canWrite: boolean;
  /** `hasPermission('lex:consultation:approve')` — gates inline approve/reject. */
  canApprove: boolean;
  /** True while the consultation is under an active legal hold (archive blocked). */
  onHold: boolean;
  onClassify: () => void;
  onRoute: () => void;
  onRespond: () => void;
  onStartApproval: () => void;
  onArchive: () => void;
  /** Refetch the consultation/audit after an inline approve/reject. */
  onChanged: () => void;
}

/** Human-task statuses that are no longer actionable. */
const CLOSED_TASK_STATUSES = new Set([
  'completed',
  'approved',
  'rejected',
  'cancelled',
  'expired',
]);

export function ConsultationActionBar({
  consultation,
  canWrite,
  canApprove,
  onHold,
  onClassify,
  onRoute,
  onRespond,
  onStartApproval,
  onArchive,
  onChanged,
}: ConsultationActionBarProps) {
  const ab = useConsultationDetailLabels().actionBar;
  const qc = useQueryClient();

  const isResponded = consultation.status === 'responded';

  const [notes, setNotes] = useState('');
  const [rejectOpen, setRejectOpen] = useState(false);

  // Shares the query key with the page's approval query so both stay in sync.
  const tasksQuery = useQuery({
    queryKey: ['lex-consultation-approval', consultation.id],
    queryFn: () => consultationsApi.listApprovalTasks(consultation.id),
    enabled: isResponded && Boolean(consultation.id),
    retry: false,
  });

  const openTasks = (tasksQuery.data ?? []).filter(
    (task) => !CLOSED_TASK_STATUSES.has(String(task.status ?? '')),
  );
  const pendingTask: ConsultationApprovalTask | undefined = openTasks[0];

  const decideMutation = useMutation({
    mutationFn: (vars: { task: ConsultationApprovalTask; decision: 'approve' | 'reject' }) =>
      consultationsApi.decideApproval(
        consultation.id,
        String(vars.task.workflow_instance_id ?? consultation.workflow_instance_id ?? ''),
        String(vars.task.id),
        { decision: vars.decision, notes: notes.trim() || undefined },
      ),
    onSuccess: async () => {
      showSuccess(ab.decisionSuccess);
      setNotes('');
      setRejectOpen(false);
      await qc.invalidateQueries({ queryKey: ['lex-consultation-approval', consultation.id] });
      onChanged();
    },
    onError: showApiError,
  });

  const readOnlyBar = <ActionBar heading={ab.heading} muted text={ab.readOnly} />;

  const renderApproval = (): ReactNode => {
    if (tasksQuery.isLoading) {
      return (
        <ActionBar
          heading={ab.heading}
          text={ab.loadingTasks}
          action={<Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden />}
        />
      );
    }

    // A pending task exists and this viewer can decide → inline approve/reject.
    if (pendingTask && canApprove) {
      return (
        <ActionBar
          heading={ab.heading}
          text={ab.pendingApprovalHint}
          action={<Badge variant="secondary">{ab.openTaskCount(openTasks.length)}</Badge>}
        >
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="consultation-action-bar-notes">{ab.decisionNotesLabel}</Label>
              <Textarea
                id="consultation-action-bar-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={ab.decisionNotesPlaceholder}
                rows={2}
                disabled={decideMutation.isPending}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                onClick={() => decideMutation.mutate({ task: pendingTask, decision: 'approve' })}
                disabled={decideMutation.isPending}
              >
                {decideMutation.isPending ? (
                  <Loader2 className="me-1.5 h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <CheckCircle2 className="me-1.5 h-4 w-4" aria-hidden />
                )}
                {decideMutation.isPending ? ab.deciding : ab.approve}
              </Button>
              <Button
                variant="destructive"
                onClick={() => setRejectOpen(true)}
                disabled={decideMutation.isPending}
              >
                <XCircle className="me-1.5 h-4 w-4" aria-hidden />
                {ab.reject}
              </Button>
            </div>
          </div>
        </ActionBar>
      );
    }

    // No approval chain started yet and the viewer can approve → offer to start
    // it. Kicking off the chain gates on the DISTINCT approve verb to match the
    // backend (POST /consultations/{id}/approval/start → lex:consultation:approve).
    if (!pendingTask && canApprove) {
      return (
        <ActionBar
          heading={ab.heading}
          text={ab.startApprovalHint}
          action={
            <Button onClick={onStartApproval}>
              <ClipboardCheck className="me-1.5 h-4 w-4" aria-hidden />
              {ab.startApproval}
            </Button>
          }
        />
      );
    }

    // Read-only viewers still see that a sign-off task is active without being
    // offered an action they cannot complete.
    return (
      <ActionBar
        heading={ab.heading}
        text={ab.awaitingApprovalHint}
        action={
          pendingTask ? (
            <Badge variant="secondary">{ab.openTaskCount(openTasks.length)}</Badge>
          ) : undefined
        }
      />
    );
  };

  const renderBody = (): ReactNode => {
    switch (consultation.status) {
      case 'submitted':
        if (!canWrite) return readOnlyBar;
        return (
          <ActionBar
            heading={ab.heading}
            text={ab.classifyHint}
            action={
              <Button onClick={onClassify}>
                <Tag className="me-1.5 h-4 w-4" aria-hidden />
                {ab.classify}
              </Button>
            }
          />
        );

      case 'classified':
        if (!canWrite) return readOnlyBar;
        return (
          <ActionBar
            heading={ab.heading}
            text={ab.routeHint}
            action={
              <Button onClick={onRoute}>
                <RouteIcon className="me-1.5 h-4 w-4" aria-hidden />
                {ab.route}
              </Button>
            }
          />
        );

      case 'routed':
        if (!canWrite) return readOnlyBar;
        return (
          <ActionBar
            heading={ab.heading}
            text={ab.respondHint}
            action={
              <Button onClick={onRespond}>
                <Send className="me-1.5 h-4 w-4" aria-hidden />
                {ab.respond}
              </Button>
            }
          />
        );

      case 'responded':
        return renderApproval();

      case 'approved':
        if (!canWrite) return readOnlyBar;
        return (
          <ActionBar
            heading={ab.heading}
            text={onHold ? ab.archiveBlockedHint : ab.archiveHint}
            action={
              <WithTooltip content={onHold ? ab.archiveBlockedHint : undefined} wrapDisabled={onHold}>
                <Button onClick={onArchive} disabled={onHold}>
                  <Archive className="me-1.5 h-4 w-4" aria-hidden />
                  {ab.archive}
                </Button>
              </WithTooltip>
            }
          />
        );

      case 'archived':
        return <ActionBar heading={ab.heading} muted text={ab.archivedHint} />;

      default:
        return <ActionBar heading={ab.heading} muted text={ab.archivedHint} />;
    }
  };

  return (
    <>
      {renderBody()}
      {isResponded && canApprove ? (
        <ConfirmDialog
          open={rejectOpen}
          onOpenChange={(open) => {
            if (!open) setRejectOpen(false);
          }}
          title={ab.rejectConfirm.title}
          description={ab.rejectConfirm.description}
          confirmLabel={ab.rejectConfirm.confirm}
          variant="destructive"
          loading={decideMutation.isPending}
          onConfirm={async () => {
            if (pendingTask) {
              await decideMutation.mutateAsync({ task: pendingTask, decision: 'reject' });
            }
          }}
        />
      ) : null}
    </>
  );
}

/* ------------------------------------------------------------------------- *
 * Private presentational bar — a rounded-2xl band with an overline heading + one
 * line of text on the start and action(s) on the end, plus an optional
 * full-width body slot (used by the inline approval editor). Actionable =
 * primary-tinted; `muted` = neutral surface.
 * ------------------------------------------------------------------------- */

function ActionBar({
  heading,
  text,
  action,
  muted = false,
  children,
}: {
  heading: string;
  text: string;
  action?: ReactNode;
  muted?: boolean;
  children?: ReactNode;
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
          <p className="text-xs font-semibold uppercase tracking-caps-xwide text-foreground">
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
      {children ? <div className="mt-3">{children}</div> : null}
    </div>
  );
}
