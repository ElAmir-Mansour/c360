'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useApiMutation } from '@/hooks/use-api-mutation';
import { API_ENDPOINTS } from '@/lib/constants';
import type {
  VCISOApprovalRequest,
  ApprovalRequestStatus,
} from '@/types/cyber';
import { useVcisoWorkflowLabels } from '../../_lib/vciso-i18n';

type ActionType = 'approve' | 'reject' | 'escalate';

interface ApprovalActionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  approval: VCISOApprovalRequest;
  action: ActionType;
  onSuccess: () => void;
}

export function ApprovalActionDialog({
  open,
  onOpenChange,
  approval,
  action,
  onSuccess,
}: ApprovalActionDialogProps) {
  const t = useVcisoWorkflowLabels().approvalAction;
  const [decisionNotes, setDecisionNotes] = useState('');

  const config: {
    title: string;
    description: string;
    confirmLabel: string;
    status: ApprovalRequestStatus;
    variant: 'default' | 'destructive';
    successMessage: string;
  } = {
    approve: {
      title: t.approveTitle,
      description: t.approveDesc(approval.title),
      confirmLabel: t.approveConfirm,
      status: 'approved' as ApprovalRequestStatus,
      variant: 'default' as const,
      successMessage: t.approvedToast,
    },
    reject: {
      title: t.rejectTitle,
      description: t.rejectDesc(approval.title),
      confirmLabel: t.rejectConfirm,
      status: 'rejected' as ApprovalRequestStatus,
      variant: 'destructive' as const,
      successMessage: t.rejectedToast,
    },
    escalate: {
      title: t.escalateTitle,
      description: t.escalateDesc(approval.title),
      confirmLabel: t.escalateConfirm,
      status: 'escalated' as ApprovalRequestStatus,
      variant: 'default' as const,
      successMessage: t.escalatedToast,
    },
  }[action];

  const mutation = useApiMutation<VCISOApprovalRequest, Record<string, unknown>>(
    'put',
    `${API_ENDPOINTS.CYBER_VCISO_APPROVALS}/${approval.id}/decision`,
    {
      successMessage: config.successMessage,
      invalidateKeys: ['vciso-approvals'],
      onSuccess: () => {
        setDecisionNotes('');
        onOpenChange(false);
        onSuccess();
      },
    },
  );

  const handleSubmit = () => {
    if (!decisionNotes.trim()) {
      toast.error(t.decisionNotesRequired);
      return;
    }
    mutation.mutate({
      status: config.status,
      decision_notes: decisionNotes.trim(),
    });
  };

  const handleOpenChange = (o: boolean) => {
    if (!o) {
      setDecisionNotes('');
    }
    onOpenChange(o);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{config.title}</DialogTitle>
          <DialogDescription>{config.description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="action-decision-notes">
              {t.decisionNotes} <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="action-decision-notes"
              value={decisionNotes}
              onChange={(e) => setDecisionNotes(e.target.value)}
              placeholder={t.notesPlaceholder}
              rows={4}
              disabled={mutation.isPending}
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={mutation.isPending}
          >
            {t.cancel}
          </Button>
          <Button
            variant={config.variant === 'destructive' ? 'destructive' : 'default'}
            onClick={handleSubmit}
            disabled={mutation.isPending || !decisionNotes.trim()}
          >
            {mutation.isPending ? t.processing : config.confirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
