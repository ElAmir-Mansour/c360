'use client';

import { useState } from 'react';
import {
  Calendar,
  Clock,
  Edit,
  Send,
  CheckCircle,
  Archive,
  User,
  Tag,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { DetailPanel } from '@/components/shared/detail-panel';
import { StatusBadge } from '@/components/shared/status-badge';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { policyStatusConfig } from '@/lib/status-configs';
import { formatDate } from '@/lib/format';
import { titleCase } from '@/lib/format';
import { useApiMutation } from '@/hooks/use-api-mutation';
import { API_ENDPOINTS } from '@/lib/constants';
import { cn } from '@/lib/utils';
import type { VCISOPolicy, PolicyStatus } from '@/types/cyber';
import { useVcisoLabels, useVcisoWorkflowLabels } from '../../_lib/vciso-i18n';

interface PolicyDetailPanelProps {
  policy: VCISOPolicy;
  open: boolean;
  onClose: () => void;
  onEdit: () => void;
  onRefresh: () => void;
}

export function PolicyDetailPanel({
  policy,
  open,
  onClose,
  onEdit,
  onRefresh,
}: PolicyDetailPanelProps) {
  const t = useVcisoWorkflowLabels().policyDetail;
  const domainLabels = useVcisoLabels().pages.policies.domains as Record<string, string>;
  const [confirmAction, setConfirmAction] = useState<{
    type: 'submit_review' | 'publish' | 'retire';
    title: string;
    description: string;
  } | null>(null);

  const statusMutation = useApiMutation<VCISOPolicy, { status: PolicyStatus }>(
    'put',
    () => `${API_ENDPOINTS.CYBER_VCISO_POLICIES}/${policy.id}/status`,
    {
      invalidateKeys: ['vciso-policies'],
      onSuccess: () => {
        onRefresh();
        setConfirmAction(null);
      },
    },
  );

  const handleStatusChange = async () => {
    if (!confirmAction) return;

    const statusMap: Record<string, PolicyStatus> = {
      submit_review: 'review',
      publish: 'published',
      retire: 'retired',
    };

    statusMutation.mutate({ status: statusMap[confirmAction.type] });
  };

  const isOverdue = new Date(policy.review_due) < new Date();

  return (
    <>
      <DetailPanel
        open={open}
        onOpenChange={(o) => !o && onClose()}
        title={policy.title}
        description={t.subtitle(policy.version)}
        width="xl"
      >
        <div className="space-y-6">
          {/* Status and Actions Bar */}
          <div className="flex items-center justify-between">
            <StatusBadge
              status={policy.status}
              config={policyStatusConfig}
              size="lg"
            />
            <div className="flex items-center gap-2">
              {(policy.status === 'draft' || policy.status === 'approved') && (
                <Button variant="outline" size="sm" onClick={onEdit}>
                  <Edit className="me-1.5 h-3.5 w-3.5" />
                  {t.edit}
                </Button>
              )}
              {policy.status === 'draft' && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setConfirmAction({
                      type: 'submit_review',
                      title: t.confirmSubmitTitle,
                      description: t.confirmSubmitDesc,
                    })
                  }
                >
                  <Send className="me-1.5 h-3.5 w-3.5" />
                  {t.submitReview}
                </Button>
              )}
              {policy.status === 'approved' && (
                <Button
                  size="sm"
                  onClick={() =>
                    setConfirmAction({
                      type: 'publish',
                      title: t.confirmPublishTitle,
                      description: t.confirmPublishDesc,
                    })
                  }
                >
                  <CheckCircle className="me-1.5 h-3.5 w-3.5" />
                  {t.publish}
                </Button>
              )}
              {policy.status === 'published' && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setConfirmAction({
                      type: 'retire',
                      title: t.confirmRetireTitle,
                      description: t.confirmRetireDesc,
                    })
                  }
                >
                  <Archive className="me-1.5 h-3.5 w-3.5" />
                  {t.retire}
                </Button>
              )}
            </div>
          </div>

          <Separator />

          {/* Metadata Grid */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                {t.domain}
              </p>
              <Badge variant="outline">
                {domainLabels[policy.domain] ?? titleCase(policy.domain)}
              </Badge>
            </div>

            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                {t.version}
              </p>
              <p className="text-sm font-medium">{policy.version}</p>
            </div>

            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                {t.owner}
              </p>
              <div className="flex items-center gap-1.5">
                <User className="h-3.5 w-3.5 text-muted-foreground" />
                <p className="text-sm">{policy.owner_name}</p>
              </div>
            </div>

            {policy.reviewer_name && (
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  {t.reviewer}
                </p>
                <div className="flex items-center gap-1.5">
                  <User className="h-3.5 w-3.5 text-muted-foreground" />
                  <p className="text-sm">{policy.reviewer_name}</p>
                </div>
              </div>
            )}

            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                {t.reviewDue}
              </p>
              <div className="flex items-center gap-1.5">
                <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                <p
                  className={cn(
                    'text-sm',
                    isOverdue && 'text-status-error font-medium',
                  )}
                >
                  {formatDate(policy.review_due)}
                  {isOverdue && t.overdueSuffix}
                </p>
              </div>
            </div>

            {policy.last_reviewed_at && (
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  {t.lastReviewed}
                </p>
                <div className="flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                  <p className="text-sm">{formatDate(policy.last_reviewed_at)}</p>
                </div>
              </div>
            )}

            {policy.approved_by_name && (
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  {t.approvedBy}
                </p>
                <div className="flex items-center gap-1.5">
                  <CheckCircle className="h-3.5 w-3.5 text-primary" />
                  <p className="text-sm">{policy.approved_by_name}</p>
                </div>
              </div>
            )}

            {policy.approved_at && (
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  {t.approvedAt}
                </p>
                <p className="text-sm">{formatDate(policy.approved_at)}</p>
              </div>
            )}

            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                {t.exceptions}
              </p>
              <p className="text-sm">
                {policy.exceptions_count > 0 ? (
                  <span className="font-medium text-severity-high">
                    {t.activeSuffix(policy.exceptions_count)}
                  </span>
                ) : (
                  <span className="text-muted-foreground">{t.none}</span>
                )}
              </p>
            </div>

            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                {t.lastUpdated}
              </p>
              <p className="text-sm">{formatDate(policy.updated_at)}</p>
            </div>
          </div>

          {/* Tags */}
          {policy.tags && policy.tags.length > 0 && (
            <>
              <Separator />
              <div className="space-y-2">
                <div className="flex items-center gap-1.5">
                  <Tag className="h-3.5 w-3.5 text-muted-foreground" />
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    {t.tags}
                  </p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {policy.tags.map((tag) => (
                    <Badge key={tag} variant="secondary">
                      {tag}
                    </Badge>
                  ))}
                </div>
              </div>
            </>
          )}

          <Separator />

          {/* Policy Content */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-foreground">{t.policyContent}</h3>
            <div className="rounded-lg border border-border bg-muted/30 p-4">
              <div className="prose prose-sm max-w-none whitespace-pre-wrap text-sm leading-relaxed text-foreground">
                {policy.content}
              </div>
            </div>
          </div>
        </div>
      </DetailPanel>

      {confirmAction && (
        <ConfirmDialog
          open={!!confirmAction}
          onOpenChange={(o) => !o && setConfirmAction(null)}
          title={confirmAction.title}
          description={confirmAction.description}
          confirmLabel={confirmAction.title}
          onConfirm={handleStatusChange}
          loading={statusMutation.isPending}
        />
      )}
    </>
  );
}
