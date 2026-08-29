'use client';

/**
 * Immutable version-history dialog for a contract approval policy.
 *
 * Reads `enterpriseApi.lex.listApprovalPolicyVersions(id)` and, when the actor
 * holds the restore permission, restores a snapshot via
 * `restoreApprovalPolicyVersion(id, version)` (which appends a NEW version).
 * Mirrors the request-side `PolicyVersionsDialog`.
 */

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { History, RotateCcw } from 'lucide-react';
import { ErrorState } from '@/components/common/error-state';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
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
import { showApiError, showSuccess } from '@/lib/toast';
import { enterpriseApi } from '@/lib/enterprise/api';
import type { LexApprovalPolicy } from '@/types/suites';
import type { ContractApprovalPolicyLabels } from '../_labels';

const VERSIONS_KEY = 'lex-contract-approval-policy-versions';

export function PolicyVersionsDialog({
  labels,
  policy,
  open,
  onOpenChange,
  canRestore,
  onRestored,
}: {
  labels: ContractApprovalPolicyLabels;
  policy: LexApprovalPolicy | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canRestore: boolean;
  onRestored: () => Promise<void>;
}) {
  const queryClient = useQueryClient();
  const [restoreVersion, setRestoreVersion] = useState<number | null>(null);
  const policyId = policy?.id ?? '';

  const versionsQuery = useQuery({
    queryKey: [VERSIONS_KEY, policyId],
    queryFn: () => enterpriseApi.lex.listApprovalPolicyVersions(policyId),
    enabled: open && policyId !== '',
  });

  const restoreMutation = useMutation({
    mutationFn: (version: number) =>
      enterpriseApi.lex.restoreApprovalPolicyVersion(policyId, version),
    onSuccess: async () => {
      showSuccess(labels.versionsDialog.restored);
      setRestoreVersion(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: [VERSIONS_KEY, policyId] }),
        onRestored(),
      ]);
    },
    onError: showApiError,
  });

  const versions = versionsQuery.data?.versions ?? [];

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{labels.versionsDialog.title}</DialogTitle>
            <DialogDescription>
              {policy ? policy.name : labels.versionsDialog.description}
            </DialogDescription>
          </DialogHeader>

          {versionsQuery.isLoading ? (
            <LoadingSkeleton variant="list-item" count={4} />
          ) : versionsQuery.isError ? (
            <ErrorState
              message={labels.versionsDialog.loadError}
              onRetry={() => void versionsQuery.refetch()}
            />
          ) : versions.length === 0 ? (
            <div className="rounded-lg border border-dashed px-4 py-8 text-center">
              <History className="mx-auto h-6 w-6 text-muted-foreground" aria-hidden />
              <p className="mt-2 text-sm font-medium">{labels.versionsDialog.emptyTitle}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {labels.versionsDialog.emptyDescription}
              </p>
            </div>
          ) : (
            <ul className="space-y-3">
              {versions.map((version) => (
                <li
                  key={version.id}
                  className="flex items-start justify-between gap-3 rounded-lg border px-4 py-3"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline">
                        {labels.versionsDialog.versionLabel(version.version)}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        <RelativeTime date={version.created_at} />
                      </span>
                    </div>
                    <p className="text-sm">
                      {version.change_reason?.trim()
                        ? version.change_reason
                        : labels.versionsDialog.noReason}
                    </p>
                  </div>
                  {canRestore ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setRestoreVersion(version.version)}
                      disabled={restoreMutation.isPending}
                    >
                      <RotateCcw className="me-1.5 h-3.5 w-3.5" />
                      {labels.versionsDialog.restore}
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {labels.versionsDialog.close}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={restoreVersion != null}
        onOpenChange={(o) => {
          if (!o) {
            setRestoreVersion(null);
          }
        }}
        title={labels.versionsDialog.restoreConfirmTitle}
        description={
          restoreVersion != null
            ? labels.versionsDialog.restoreConfirmDescription(restoreVersion)
            : labels.versionsDialog.description
        }
        confirmLabel={labels.versionsDialog.restoreConfirm}
        loading={restoreMutation.isPending}
        onConfirm={async () => {
          if (restoreVersion != null) {
            await restoreMutation.mutateAsync(restoreVersion);
          }
        }}
      />
    </>
  );
}
