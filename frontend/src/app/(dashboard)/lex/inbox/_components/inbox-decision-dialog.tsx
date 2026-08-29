'use client';

/**
 * <InboxDecisionDialog> — the quick approve / reject / request-changes dialog
 * for an inbox item that carries an inline {@link InboxItemAction}.
 *
 * It dispatches to the correct backend endpoint by the action's discriminant:
 *   • settlement → settlementsApi.decide(id, wf, wf, …) (task resolved server-side
 *                  from the workflow's single open human task — same convention as
 *                  the settlement approver queue)
 *   • case       → case-intake decision endpoint (keeps workflow + case FSM atomic)
 *   • workflow   → enterpriseApi.lex.decideWorkflowTask(wf, task, …)
 *
 * Bilingual + RTL-safe (the host stamps `dir`); KSA-neutral (no dates/numbers).
 */

import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { apiPost } from '@/lib/api';
import { showApiError, showSuccess } from '@/lib/toast';
import { settlementsApi } from '@/lib/lex/settlements';
import { enterpriseApi } from '@/lib/enterprise/api';
import type { InboxItemAction } from '../_lib/use-inbox';
import { useInboxLabels } from '../_lib/labels';

type Decision = 'approve' | 'reject' | 'request_changes';

interface InboxDecisionDialogProps {
  /** The action to decide; `null` closes the dialog. */
  action: InboxItemAction | null;
  onOpenChange: (open: boolean) => void;
  /** Invoked after a successful decision so the host can refetch the queue. */
  onDecided: () => void;
}

export function InboxDecisionDialog({
  action,
  onOpenChange,
  onDecided,
}: InboxDecisionDialogProps) {
  const L = useInboxLabels().decision;
  const { direction } = useLocaleOrDefault();
  const queryClient = useQueryClient();

  const [decision, setDecision] = useState<Decision>('approve');
  const [notes, setNotes] = useState('');
  const [evidenceId, setEvidenceId] = useState('');
  const [lateJustification, setLateJustification] = useState('');

  // Reset the form each time a new action opens the dialog.
  useEffect(() => {
    if (action) {
      setDecision('approve');
      setNotes('');
      setEvidenceId(action.type === 'case' ? action.evidenceId : '');
      setLateJustification('');
    }
  }, [action]);

  const mutation = useMutation({
    mutationFn: async (vars: { action: InboxItemAction; decision: Decision; notes?: string; lateJustification?: string }) => {
      if (vars.action.type === 'settlement') {
        // The settlement decision endpoint maps `approve`/`reject` only; treat
        // request_changes as a rejection-with-notes for that surface.
        const settlementDecision = vars.decision === 'approve' ? 'approve' : 'reject';
        const wf = vars.action.workflowInstanceId;
        await settlementsApi.decide(vars.action.settlementId, wf, wf, {
          decision: settlementDecision,
          notes: vars.notes,
          ...(vars.lateJustification
            ? { late_justification: vars.lateJustification }
            : {}),
        });
        return;
      }
      if (vars.action.type === 'case') {
        await apiPost(
          `/api/v1/lex/legal-cases/${vars.action.caseId}/intake/${vars.action.workflowInstanceId}/tasks/${vars.action.taskId}/decision`,
          {
            decision: vars.decision,
            notes: vars.notes ?? null,
            ...(vars.lateJustification
              ? { late_justification: vars.lateJustification }
              : {}),
            ...(vars.decision === 'approve'
              ? {
                  authority_evidence: {
                    role: vars.action.approverRole,
                    authority_amount: 0,
                    currency: 'SAR',
                    evidence_id: evidenceId.trim(),
                    source: 'case_intake',
                  },
                }
              : {}),
          },
        );
        return;
      }
      await enterpriseApi.lex.decideWorkflowTask(
        vars.action.workflowInstanceId,
        vars.action.taskId,
        {
          decision: vars.decision,
          notes: vars.notes ?? null,
          ...(vars.lateJustification
            ? { late_justification: vars.lateJustification }
            : {}),
        },
      );
    },
    onSuccess: async (_data, vars) => {
      const msg =
        vars.decision === 'approve'
          ? L.successApproved
          : vars.decision === 'reject'
            ? L.successRejected
            : L.successChanges;
      showSuccess(msg);
      onOpenChange(false);
      await queryClient.invalidateQueries({ queryKey: ['lex-inbox'] });
      onDecided();
    },
    onError: showApiError,
  });

  const open = action !== null;
  const entityLabel = action?.entityLabel ?? '';
  // Settlement surface only models approve/reject (no request-changes step).
  const allowRequestChanges = action?.type === 'workflow' || action?.type === 'case';
  const caseApproval = action?.type === 'case' && decision === 'approve';
  const isLate = Boolean(
    action?.slaDeadline && Date.now() > new Date(action.slaDeadline).getTime(),
  );

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onOpenChange(false))}>
      <DialogContent className="sm:max-w-md" dir={direction}>
        <DialogHeader>
          <DialogTitle>{L.title(entityLabel)}</DialogTitle>
          <DialogDescription>{L.description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="inbox-decision">{L.field}</Label>
            <Select
              value={decision}
              onValueChange={(v) => setDecision(v as Decision)}
            >
              <SelectTrigger id="inbox-decision">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="approve">{L.approve}</SelectItem>
                <SelectItem value="reject">{L.reject}</SelectItem>
                {allowRequestChanges ? (
                  <SelectItem value="request_changes">{L.requestChanges}</SelectItem>
                ) : null}
              </SelectContent>
            </Select>
          </div>
          {isLate ? (
            <div className="space-y-2 rounded-lg border border-warning-300 bg-warning-50/60 p-3 dark:bg-warning-700/10">
              <Label htmlFor="inbox-late-justification">Late SLA justification *</Label>
              <Textarea
                id="inbox-late-justification"
                rows={3}
                value={lateJustification}
                onChange={(event) => setLateJustification(event.target.value)}
                placeholder="Explain why this record ended after its SLA deadline."
              />
              <p className="text-xs text-muted-foreground">
                Visible only to the Legal Director and corresponding manager.
              </p>
            </div>
          ) : null}

          {caseApproval ? (
            <div className="space-y-2">
              <Label htmlFor="inbox-authority-evidence">{L.evidence}</Label>
              <input
                id="inbox-authority-evidence"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                value={evidenceId}
                onChange={(event) => setEvidenceId(event.target.value)}
                placeholder={L.evidencePlaceholder}
                required
              />
              <p className="text-xs text-muted-foreground">{L.evidenceHint}</p>
            </div>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="inbox-decision-notes">{L.notes}</Label>
            <Textarea
              id="inbox-decision-notes"
              rows={3}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder={L.notesPlaceholder}
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={mutation.isPending}
          >
            {L.cancel}
          </Button>
          <Button
            type="button"
            className="gap-2"
            disabled={mutation.isPending || !action || Boolean(caseApproval && !evidenceId.trim()) || (isLate && !lateJustification.trim())}
            onClick={() => {
              if (action) {
                mutation.mutate({
                  action,
                  decision,
                  notes: notes.trim() || undefined,
                  lateJustification: isLate ? lateJustification.trim() : undefined,
                });
              }
            }}
          >
            {mutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <CheckCircle2 className="h-4 w-4" aria-hidden />
            )}
            {mutation.isPending ? L.submitting : L.submit}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
