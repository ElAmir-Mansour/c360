'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Loader2, ShieldCheck, XCircle } from 'lucide-react';
import { SectionCard } from '@/components/suites/section-card';
import { EmptyState } from '@/components/common/empty-state';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/hooks/use-auth';
import { formatDateTime } from '@/lib/format';
import { showApiError, showSuccess } from '@/lib/toast';
import {
  lexRequestsApi,
  requestCanHaveApprovalTasks,
  type ApprovalTask,
  type LegalRequest,
  type ReturnIncompleteReasonCode,
} from '@/lib/lex/requests';
import { useServiceDeskLabels } from './labels';
import { useApprovalTaskLabel, useApprovalTaskStatusLabel } from './lex-enums-i18n';
import { RETURN_REASON_CODES } from './return-reason-codes';

interface ApprovalPanelProps {
  requestId: string;
  request: LegalRequest;
  attachmentsReady?: boolean;
  onChanged: () => void;
}

export function ApprovalPanel({ requestId, request, attachmentsReady = true, onChanged }: ApprovalPanelProps) {
  const labels = useServiceDeskLabels();
  const t = labels.approval;
  const qc = useQueryClient();
  const { hasPermission } = useAuth();
  // §9/§18.4 — request approval gates strictly on the request approve verb
  // (NOT coarse lex:write/approve), so a non-approver requester/officer does
  // not see approve/reject controls. `lex:*` wildcard still satisfies this.
  const canApprove = hasPermission('lex:request:approve');
  const approvalTaskLabel = useApprovalTaskLabel();
  const approvalTaskStatusLabel = useApprovalTaskStatusLabel();

  const [notes, setNotes] = useState('');
  const [rejectTarget, setRejectTarget] = useState<ApprovalTask | null>(null);
  const [rejectReasonCode, setRejectReasonCode] = useState<ReturnIncompleteReasonCode | ''>('');
  const [rejectError, setRejectError] = useState('');
  const hasWorkflow = requestCanHaveApprovalTasks(request.workflow_instance_id);

  const closeRejectDialog = () => {
    setRejectTarget(null);
    setRejectReasonCode('');
    setRejectError('');
  };

  const tasksQuery = useQuery({
    queryKey: ['lex-approval-tasks', requestId],
    queryFn: () => lexRequestsApi.listApprovalTasks(requestId),
    enabled: Boolean(requestId) && hasWorkflow,
    retry: false,
  });

  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ['lex-approval-tasks', requestId] });
    onChanged();
  };

  const startMutation = useMutation({
    mutationFn: () => lexRequestsApi.startApproval(requestId),
    onSuccess: async () => {
      showSuccess(t.toast.started);
      await refresh();
    },
    onError: showApiError,
  });

  const decideMutation = useMutation({
    mutationFn: (vars: {
      task: ApprovalTask;
      decision: 'approve' | 'reject';
      returnReasonCode?: ReturnIncompleteReasonCode;
    }) =>
      lexRequestsApi.decideApprovalTask(requestId, vars.task.instance_id, vars.task.id, {
        decision: vars.decision,
        notes: notes.trim() || undefined,
        return_reason_code: vars.returnReasonCode,
      }),
    onSuccess: async () => {
      showSuccess(t.toast.decided);
      setNotes('');
      closeRejectDialog();
      await refresh();
    },
    onError: showApiError,
  });

  const tasks = tasksQuery.data ?? [];

  return (
    <SectionCard
      title={t.title}
      description={t.description}
      actions={
        canApprove && !hasWorkflow ? (
          <Button size="sm" onClick={() => startMutation.mutate()} disabled={startMutation.isPending}>
            {startMutation.isPending ? (
              <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <ShieldCheck className="me-1.5 h-3.5 w-3.5" />
            )}
            {startMutation.isPending ? t.starting : t.start}
          </Button>
        ) : undefined
      }
    >
      {!hasWorkflow ? (
        <EmptyState icon={ShieldCheck} title={t.notStarted} description="" />
      ) : tasksQuery.isLoading ? (
        <LoadingSkeleton variant="list-item" count={2} />
      ) : tasks.length === 0 ? (
        <EmptyState icon={CheckCircle2} title={t.noTasks} description="" />
      ) : (
        <div className="space-y-4">
          <p className="text-sm font-medium">{t.tasksTitle}</p>
          {tasks.map((task) => (
            <div key={task.id} className="relative overflow-hidden rounded-lg border px-4 py-3 ps-5">
              <span className="absolute inset-y-0 start-0 w-1 bg-warning-300/70" aria-hidden />
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium" dir="auto">{approvalTaskLabel(task.name)}</p>
                  {task.description ? (
                    <p className="mt-0.5 text-xs text-muted-foreground">{task.description}</p>
                  ) : null}
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t.taskStatusLabel}: {approvalTaskStatusLabel(task.status)}
                    {task.sla_deadline
                      ? ` · ${t.slaDeadline}: ${formatDateTime(task.sla_deadline)}`
                      : ''}
                  </p>
                </div>
                {task.sla_breached ? (
                  <Badge variant="destructive">{t.slaBreached}</Badge>
                ) : null}
              </div>

              {canApprove && task.can_decide ? (
                <div className="mt-3 space-y-3">
                  <div className="space-y-1.5">
                    <Label htmlFor={`notes-${task.id}`}>{t.decisionNotesLabel}</Label>
                    <Textarea
                      id={`notes-${task.id}`}
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder={t.decisionNotesPlaceholder}
                      rows={2}
                    />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      onClick={() => decideMutation.mutate({ task, decision: 'approve' })}
                      disabled={decideMutation.isPending || !attachmentsReady}
                    >
                      {decideMutation.isPending ? (
                        <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <CheckCircle2 className="me-1.5 h-3.5 w-3.5" />
                      )}
                      {t.approve}
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => setRejectTarget(task)}
                      disabled={decideMutation.isPending}
                    >
                      <XCircle className="me-1.5 h-3.5 w-3.5" />
                      {t.reject}
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}

      {canApprove ? (
        <Dialog
          open={Boolean(rejectTarget)}
          onOpenChange={(open) => {
            if (!open) closeRejectDialog();
          }}
        >
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>{t.confirmReject.title}</DialogTitle>
              <DialogDescription>{t.confirmReject.description}</DialogDescription>
            </DialogHeader>

            <div className="space-y-1.5">
              <Label htmlFor="reject-reason">{t.rejectReasonLabel}</Label>
              <Select
                value={rejectReasonCode}
                onValueChange={(value) => {
                  setRejectReasonCode(value as ReturnIncompleteReasonCode);
                  setRejectError('');
                }}
              >
                <SelectTrigger id="reject-reason">
                  <SelectValue placeholder={t.rejectReasonPlaceholder} />
                </SelectTrigger>
                <SelectContent>
                  {RETURN_REASON_CODES.map((code) => (
                    <SelectItem key={code} value={code}>
                      {labels.returnDialog.reasons[code]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {rejectError ? <p className="text-sm text-destructive">{rejectError}</p> : null}
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={closeRejectDialog}>
                {labels.returnDialog.cancel}
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={decideMutation.isPending}
                onClick={async () => {
                  if (!rejectReasonCode) {
                    setRejectError(t.rejectReasonRequired);
                    return;
                  }
                  if (rejectTarget) {
                    await decideMutation.mutateAsync({
                      task: rejectTarget,
                      decision: 'reject',
                      returnReasonCode: rejectReasonCode,
                    });
                  }
                }}
              >
                {decideMutation.isPending ? (
                  <Loader2 className="me-1.5 h-4 w-4 animate-spin" />
                ) : null}
                {t.confirmReject.confirm}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </SectionCard>
  );
}
