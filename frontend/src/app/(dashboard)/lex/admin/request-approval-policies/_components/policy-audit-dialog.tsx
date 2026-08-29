'use client';

import { useQuery } from '@tanstack/react-query';
import { ScrollText } from 'lucide-react';
import { ErrorState } from '@/components/common/error-state';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { RelativeTime } from '@/components/shared/relative-time';
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
import {
  type RequestApprovalPolicy,
  lexRequestApprovalPoliciesApi,
} from '@/lib/lex/request-approval-policies';
import type { RequestApprovalPolicyLabels } from '../_labels';

export function PolicyAuditDialog({
  labels,
  policy,
  open,
  onOpenChange,
}: {
  labels: RequestApprovalPolicyLabels;
  policy: RequestApprovalPolicy | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const policyId = policy?.id ?? '';

  const auditQuery = useQuery({
    queryKey: ['lex-request-approval-policy-audit', policyId],
    queryFn: () => lexRequestApprovalPoliciesApi.listAudit(policyId),
    enabled: open && policyId !== '',
  });

  const entries = auditQuery.data?.entries ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{labels.auditDialog.title}</DialogTitle>
          <DialogDescription>
            {policy ? policy.name : labels.auditDialog.description}
          </DialogDescription>
        </DialogHeader>

        {auditQuery.isLoading ? (
          <LoadingSkeleton variant="list-item" count={4} />
        ) : auditQuery.isError ? (
          <ErrorState
            message={labels.auditDialog.loadError}
            onRetry={() => void auditQuery.refetch()}
          />
        ) : entries.length === 0 ? (
          <div className="rounded-lg border border-dashed px-4 py-8 text-center">
            <ScrollText className="mx-auto h-6 w-6 text-muted-foreground" aria-hidden />
            <p className="mt-2 text-sm font-medium">{labels.auditDialog.emptyTitle}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {labels.auditDialog.emptyDescription}
            </p>
          </div>
        ) : (
          <ol className="space-y-3">
            {entries.map((entry) => (
              <li
                key={entry.id}
                className="flex items-start justify-between gap-3 rounded-lg border px-4 py-3"
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="secondary">
                      {labels.auditDialog.actionLabels[entry.action] ?? formatToken(entry.action)}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {entry.actor_id?.trim() ? entry.actor_id : labels.auditDialog.systemActor}
                    </span>
                  </div>
                </div>
                <span className="shrink-0 text-xs text-muted-foreground">
                  <RelativeTime date={entry.created_at} />
                </span>
              </li>
            ))}
          </ol>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {labels.auditDialog.close}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function formatToken(value: string): string {
  return value.replace(/_/g, ' ');
}
