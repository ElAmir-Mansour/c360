'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { CheckCircle2, Clock, KeyRound, RefreshCw, ShieldCheck, Workflow, XCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/hooks/use-auth';
import { isApiError } from '@/types/api';
import {
  decideMigrateMoveGroup,
  requestMigrateMoveGroupApproval,
  syncMigrateMoveGroupApproval,
} from '@/lib/migrate';
import { showApiError, showSuccess } from '@/lib/toast';
import type {
  MigrateApprovalBindingStatus,
  MigrateApprovalStatus,
  MigrateMoveGroup,
} from '@/types/migrate';
import { useMigrateLabels, type MigrateLabels } from '../_lib/migrate-i18n';

// PERM_MIGRATE_ADMIN mirrors backend PermMigrateAdmin. Only holders may use the
// break-glass manual override; the backend re-checks (403 otherwise).
const PERM_MIGRATE_ADMIN = 'migrate:admin';

// bindingStatusBadge maps an approval-binding lifecycle to a badge tone/label.
// The migrate FSM outcome (move_group.status) is the authoritative approved/
// rejected signal; the binding tells us where the workflow is in the meantime.
function bindingStatusBadge(
  status: MigrateApprovalBindingStatus,
  labels: MigrateLabels,
): {
  variant: 'success' | 'destructive' | 'warning' | 'secondary';
  label: string;
} {
  switch (status) {
    case 'completed':
      return { variant: 'success', label: labels.approval.workflowCompleted };
    case 'cancelled':
      return { variant: 'secondary', label: labels.approval.workflowCancelled };
    case 'failed':
      return { variant: 'destructive', label: labels.approval.workflowFailed };
    default:
      return { variant: 'warning', label: labels.approval.awaitingApprover };
  }
}

// moveGroupApprovalBadge derives the headline approval badge from the move group's
// own status (the authoritative migrate FSM outcome).
function moveGroupApprovalBadge(
  status: MigrateMoveGroup['status'],
  labels: MigrateLabels,
): {
  variant: 'success' | 'destructive' | 'warning' | 'secondary';
  label: string;
  icon: typeof CheckCircle2;
} {
  switch (status) {
    case 'approved':
      return { variant: 'success', label: labels.approval.approved, icon: CheckCircle2 };
    case 'rejected':
      return { variant: 'destructive', label: labels.approval.rejected, icon: XCircle };
    case 'approval_pending':
      return { variant: 'warning', label: labels.approval.pendingApproval, icon: Clock };
    default:
      return { variant: 'secondary', label: status.replace(/_/g, ' '), icon: Workflow };
  }
}

function formatWhen(value?: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

// MigrateMoveGroupApproval renders the workflow-backed approval surface for a single
// move group (Wave 5, H2). It replaces the former local-only Approve/Reject buttons:
//   • "Request approval" opens the approval in the SHARED workflow engine.
//   • "Sync decision" pulls the workflow's terminal decision and applies it to the
//     migrate FSM (approved/rejected).
// The decision is the approver's, made IN the workflow engine — this UI never flips
// the status locally. It shows the live workflow/binding state and the recorded
// decision + rationale once the workflow has decided.
export function MigrateMoveGroupApproval({
  group,
  onChanged,
}: {
  group: MigrateMoveGroup;
  onChanged: () => Promise<void>;
}) {
  const labels = useMigrateLabels();
  // The binding is discovered by requesting approval (idempotent) or, once a
  // decision syncs, reflected by the move group's own status. We keep the last
  // status response so the workflow instance id + binding decision are visible.
  const [status, setStatus] = useState<MigrateApprovalStatus | null>(null);
  // engineUnavailable is set when request-approval returns 503 (no engine wired):
  // the workflow path is not available on this deployment; the guarded manual
  // override is then the only decision path.
  const [engineUnavailable, setEngineUnavailable] = useState(false);
  // Break-glass manual override (admin-gated) UI state.
  const [showOverride, setShowOverride] = useState(false);
  const [overrideRationale, setOverrideRationale] = useState('');

  const { hasPermission } = useAuth();
  const canOverride = hasPermission(PERM_MIGRATE_ADMIN);

  const isPending = group.status === 'approval_pending';
  const isDecided = group.status === 'approved' || group.status === 'rejected';

  const request = useMutation({
    mutationFn: () => requestMigrateMoveGroupApproval(group.id),
    onSuccess: async (result) => {
      setStatus(result);
      setEngineUnavailable(false);
      showSuccess(
        labels.approval.toastApprovalOpened,
        result.binding ? labels.approval.toastInstance(result.binding.workflow_instance_id) : undefined,
      );
      await onChanged();
    },
    onError: (error) => {
      // 503 workflow_engine_unavailable: no engine wired on this deployment.
      if (isApiError(error) && error.status === 503) {
        setEngineUnavailable(true);
      }
      showApiError(error);
    },
  });

  const sync = useMutation({
    mutationFn: () => syncMigrateMoveGroupApproval(group.id),
    onSuccess: async (updated) => {
      setStatus(null);
      showSuccess(
        updated.status === 'approved' ? labels.approval.toastMoveGroupApproved : labels.approval.toastMoveGroupRejected,
        labels.approval.toastRefStatus(updated.reference, updated.status.replace(/_/g, ' ')),
      );
      await onChanged();
    },
    onError: (error) => {
      // 409 approval_pending: the workflow has not been decided yet — expected while
      // the approver has not acted. Surface it as a gentle notice, not a hard error.
      if (isApiError(error) && error.status === 409) {
        showSuccess(labels.approval.toastStillPending, labels.approval.toastStillPendingDetail);
        return;
      }
      // 404 approval_not_started: no approval has been opened for this group yet.
      showApiError(error);
    },
  });

  // Break-glass override: decides the group locally, cancelling the in-flight
  // workflow binding. The backend requires migrate:admin + allow_override; it is
  // audited as a manual override. Only surfaced to admins.
  const override = useMutation({
    mutationFn: (approved: boolean) =>
      decideMigrateMoveGroup(group, approved, overrideRationale.trim(), true),
    onSuccess: async (updated) => {
      setShowOverride(false);
      setOverrideRationale('');
      setStatus(null);
      showSuccess(
        labels.approval.toastOverrideApplied(
          updated.status === 'approved' ? labels.approval.approved : labels.approval.rejected,
        ),
        labels.approval.toastRefStatus(updated.reference, updated.status.replace(/_/g, ' ')),
      );
      await onChanged();
    },
    onError: showApiError,
  });

  const headline = moveGroupApprovalBadge(group.status, labels);
  const HeadlineIcon = headline.icon;
  const binding = status?.binding ?? null;
  const decidedWhen = formatWhen(binding?.decided_at);

  return (
    <div className="mt-2 space-y-2 rounded-lg border bg-muted/30 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5" />
          {labels.approval.label}
        </span>
        <Badge variant={headline.variant} className="gap-1">
          <HeadlineIcon className="h-3 w-3" />
          {headline.label}
        </Badge>
        {binding ? (
          <Badge variant={bindingStatusBadge(binding.status, labels).variant}>
            {bindingStatusBadge(binding.status, labels).label}
          </Badge>
        ) : null}
      </div>

      {binding ? (
        <p className="text-caption text-muted-foreground">
          {labels.approval.workflowInstance}{' '}
          <span className="font-mono">{binding.workflow_instance_id}</span>
          {binding.decision ? labels.approval.decisionSuffix(binding.decision) : ''}
          {decidedWhen ? ` · ${decidedWhen}` : ''}
        </p>
      ) : null}

      {binding?.rationale ? (
        <p className="text-caption text-muted-foreground">{labels.approval.rationaleLabel} {binding.rationale}</p>
      ) : null}

      {engineUnavailable ? (
        <p className="text-caption text-warning-700 dark:text-warning-300">
          {labels.approval.engineUnavailable}
        </p>
      ) : null}

      {isPending ? (
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={request.isPending}
            onClick={() => request.mutate()}
          >
            <Workflow className="me-2 h-3.5 w-3.5" />
            {binding ? labels.approval.reopenApproval : labels.approval.requestApproval}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={sync.isPending}
            onClick={() => sync.mutate()}
          >
            <RefreshCw className="me-2 h-3.5 w-3.5" />
            {labels.approval.syncDecision}
          </Button>
        </div>
      ) : null}

      {isDecided ? (
        <p className="text-caption text-muted-foreground">
          {labels.approval.decidedNoAction}
        </p>
      ) : null}

      {!isPending && !isDecided ? (
        <p className="text-caption text-muted-foreground">
          {labels.approval.submitToOpen}
        </p>
      ) : null}

      {isPending && canOverride ? (
        <div className="border-t pt-2">
          {!showOverride ? (
            <Button
              size="sm"
              variant="ghost"
              className="text-warning-700 dark:text-warning-300"
              onClick={() => setShowOverride(true)}
            >
              <KeyRound className="me-2 h-3.5 w-3.5" />
              {labels.approval.breakGlass}
            </Button>
          ) : (
            <div className="space-y-2">
              <p className="text-caption text-muted-foreground">
                {labels.approval.overrideExplain}
              </p>
              <Textarea
                className="min-h-[60px] text-xs"
                placeholder={labels.approval.overrideRationalePlaceholder}
                value={overrideRationale}
                onChange={(event) => setOverrideRationale(event.target.value)}
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!overrideRationale.trim() || override.isPending}
                  onClick={() => override.mutate(true)}
                >
                  <CheckCircle2 className="me-2 h-3.5 w-3.5" />
                  {labels.approval.approveOverride}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!overrideRationale.trim() || override.isPending}
                  onClick={() => override.mutate(false)}
                >
                  <XCircle className="me-2 h-3.5 w-3.5" />
                  {labels.approval.rejectOverride}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={override.isPending}
                  onClick={() => {
                    setShowOverride(false);
                    setOverrideRationale('');
                  }}
                >
                  {labels.approval.cancel}
                </Button>
              </div>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
