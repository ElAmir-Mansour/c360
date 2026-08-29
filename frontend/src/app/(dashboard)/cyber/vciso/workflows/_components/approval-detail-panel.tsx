'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import {
  User,
  Calendar,
  Clock,
  Link2,
  CheckCircle,
  XCircle,
  ArrowUpCircle,
} from 'lucide-react';
import { DetailPanel } from '@/components/shared/detail-panel';
import { StatusBadge } from '@/components/shared/status-badge';
import { SeverityIndicator, type Severity } from '@/components/shared/severity-indicator';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import { useApiMutation } from '@/hooks/use-api-mutation';
import { API_ENDPOINTS } from '@/lib/constants';
import { approvalStatusConfig } from '@/lib/status-configs';
import { formatDate, formatDateTime, titleCase } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { VCISOApprovalRequest } from '@/types/cyber';
import { useVcisoWorkflowLabels } from '../../_lib/vciso-i18n';

interface ApprovalDetailPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  approval: VCISOApprovalRequest;
  onActionComplete: () => void;
}

export function ApprovalDetailPanel({
  open,
  onOpenChange,
  approval,
  onActionComplete,
}: ApprovalDetailPanelProps) {
  const labels = useVcisoWorkflowLabels();
  const t = labels.approvalDetail;
  const typeLabels = labels.approvalTypes as Record<string, string>;
  const typeLabel = typeLabels[approval.type] ?? titleCase(approval.type);

  const [decisionNotes, setDecisionNotes] = useState('');
  const isPending = approval.status === 'pending';
  const isOverdue = new Date(approval.deadline) < new Date();

  const approveMutation = useApiMutation<VCISOApprovalRequest, Record<string, unknown>>(
    'put',
    `${API_ENDPOINTS.CYBER_VCISO_APPROVALS}/${approval.id}/decision`,
    {
      successMessage: t.grantedToast,
      invalidateKeys: ['vciso-approvals'],
      onSuccess: () => {
        setDecisionNotes('');
        onOpenChange(false);
        onActionComplete();
      },
    },
  );

  const rejectMutation = useApiMutation<VCISOApprovalRequest, Record<string, unknown>>(
    'put',
    `${API_ENDPOINTS.CYBER_VCISO_APPROVALS}/${approval.id}/decision`,
    {
      successMessage: t.rejectedToast,
      invalidateKeys: ['vciso-approvals'],
      onSuccess: () => {
        setDecisionNotes('');
        onOpenChange(false);
        onActionComplete();
      },
    },
  );

  const escalateMutation = useApiMutation<VCISOApprovalRequest, Record<string, unknown>>(
    'put',
    `${API_ENDPOINTS.CYBER_VCISO_APPROVALS}/${approval.id}/decision`,
    {
      successMessage: t.escalatedToast,
      invalidateKeys: ['vciso-approvals'],
      onSuccess: () => {
        setDecisionNotes('');
        onOpenChange(false);
        onActionComplete();
      },
    },
  );

  const isActioning =
    approveMutation.isPending ||
    rejectMutation.isPending ||
    escalateMutation.isPending;

  const handleApprove = () => {
    if (!decisionNotes.trim()) {
      toast.error(t.notesRequired);
      return;
    }
    approveMutation.mutate({
      status: 'approved',
      decision_notes: decisionNotes.trim(),
    });
  };

  const handleReject = () => {
    if (!decisionNotes.trim()) {
      toast.error(t.notesRequired);
      return;
    }
    rejectMutation.mutate({
      status: 'rejected',
      decision_notes: decisionNotes.trim(),
    });
  };

  const handleEscalate = () => {
    if (!decisionNotes.trim()) {
      toast.error(t.notesRequired);
      return;
    }
    escalateMutation.mutate({
      status: 'escalated',
      decision_notes: decisionNotes.trim(),
    });
  };

  return (
    <DetailPanel
      open={open}
      onOpenChange={(o) => {
        if (!o) setDecisionNotes('');
        onOpenChange(o);
      }}
      title={approval.title}
      description={typeLabel}
      width="xl"
    >
      <div className="space-y-6">
        {/* Status & Priority */}
        <div className="flex items-center gap-3">
          <StatusBadge
            status={approval.status}
            config={approvalStatusConfig}
            size="lg"
          />
          <SeverityIndicator severity={approval.priority as Severity} />
        </div>

        <Separator />

        {/* Metadata */}
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
            {t.requestDetails}
          </h3>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                {t.type}
              </p>
              <Badge variant="outline">{typeLabel}</Badge>
            </div>
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                {t.priority}
              </p>
              <SeverityIndicator severity={approval.priority as Severity} />
            </div>
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                {t.requestedBy}
              </p>
              <div className="flex items-center gap-1.5 text-sm">
                <User className="h-3.5 w-3.5 text-muted-foreground" />
                {approval.requested_by_name}
              </div>
            </div>
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                {t.approver}
              </p>
              <div className="flex items-center gap-1.5 text-sm">
                <User className="h-3.5 w-3.5 text-muted-foreground" />
                {approval.approver_name}
              </div>
            </div>
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                {t.deadline}
              </p>
              <div className="flex items-center gap-1.5 text-sm">
                <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                <span className={cn(isOverdue && isPending && 'text-status-error font-medium')}>
                  {formatDate(approval.deadline)}
                  {isOverdue && isPending && t.overdueSuffix}
                </span>
              </div>
            </div>
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                {t.created}
              </p>
              <div className="flex items-center gap-1.5 text-sm">
                <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                {formatDateTime(approval.created_at)}
              </div>
            </div>
          </div>
        </div>

        <Separator />

        {/* Linked Entity */}
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
            {t.linkedEntity}
          </h3>
          <div className="flex items-center gap-2 rounded-lg border p-3">
            <Link2 className="h-4 w-4 text-muted-foreground shrink-0" />
            <div>
              <p className="text-sm font-medium">{titleCase(approval.linked_entity_type)}</p>
              <p className="text-xs text-muted-foreground font-mono">
                {approval.linked_entity_id}
              </p>
            </div>
          </div>
        </div>

        <Separator />

        {/* Description */}
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
            {t.description}
          </h3>
          <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">
            {approval.description}
          </p>
        </div>

        {/* Decision Info (if already decided) */}
        {approval.decided_at && approval.decision_notes && (
          <>
            <Separator />
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                {t.decision}
              </h3>
              <div
                className={cn(
                  'rounded-lg border p-4 space-y-2',
                  approval.status === 'approved' && 'border-primary/30 bg-primary/10',
                  approval.status === 'rejected' && 'border-error-100 bg-error-50 dark:border-error-700 dark:bg-error-700/30',
                  approval.status === 'escalated' && 'border-purple-200 bg-purple-50 dark:border-purple-900 dark:bg-purple-950/30',
                )}
              >
                <div className="flex items-center gap-2 text-sm font-medium">
                  {approval.status === 'approved' && (
                    <CheckCircle className="h-4 w-4 text-primary" />
                  )}
                  {approval.status === 'rejected' && (
                    <XCircle className="h-4 w-4 text-status-error" />
                  )}
                  {approval.status === 'escalated' && (
                    <ArrowUpCircle className="h-4 w-4 text-purple-600" />
                  )}
                  <span>{titleCase(approval.status)}</span>
                </div>
                <p className="text-sm whitespace-pre-wrap">{approval.decision_notes}</p>
                <p className="text-xs text-muted-foreground">
                  {t.decidedPrefix(formatDateTime(approval.decided_at))}
                </p>
              </div>
            </div>
          </>
        )}

        {/* Decision Form (only for pending) */}
        {isPending && (
          <>
            <Separator />
            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                {t.makeDecision}
              </h3>
              <div className="space-y-2">
                <Label htmlFor="decision-notes">
                  {t.decisionNotes} <span className="text-destructive">*</span>
                </Label>
                <Textarea
                  id="decision-notes"
                  value={decisionNotes}
                  onChange={(e) => setDecisionNotes(e.target.value)}
                  placeholder={t.notesPlaceholder}
                  rows={4}
                  disabled={isActioning}
                />
              </div>
              <div className="flex items-center gap-2">
                <Button
                  onClick={handleApprove}
                  disabled={isActioning || !decisionNotes.trim()}
                >
                  <CheckCircle className="me-1.5 h-4 w-4" />
                  {approveMutation.isPending ? t.approving : t.approve}
                </Button>
                <Button
                  variant="destructive"
                  onClick={handleReject}
                  disabled={isActioning || !decisionNotes.trim()}
                >
                  <XCircle className="me-1.5 h-4 w-4" />
                  {rejectMutation.isPending ? t.rejecting : t.reject}
                </Button>
                <Button
                  variant="outline"
                  onClick={handleEscalate}
                  disabled={isActioning || !decisionNotes.trim()}
                >
                  <ArrowUpCircle className="me-1.5 h-4 w-4" />
                  {escalateMutation.isPending ? t.escalating : t.escalate}
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
    </DetailPanel>
  );
}
