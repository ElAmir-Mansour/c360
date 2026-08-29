import type { InvestigationStatus } from '@/lib/lex/investigations';

export type InvestigationLifecycleActionKind =
  | 'start_investigation'
  | 'record_findings'
  | 'send_for_approval'
  | 'decide_approval'
  | 'close_investigation'
  | 'reopen_for_rework'
  | 'terminal';

export type InvestigationLifecycleBlockReason =
  | 'edit_permission_required'
  | 'approve_permission_required'
  | 'close_permission_required'
  | 'findings_required'
  | 'recommendations_required'
  | 'four_eyes_required'
  | 'approval_task_loading'
  | 'approval_task_required';

export interface InvestigationLifecyclePermissions {
  canEdit: boolean;
  canApprove: boolean;
  canClose: boolean;
}

export interface InvestigationLifecycleReadiness {
  hasFindings: boolean;
  hasRecommendations: boolean;
  approvalTasksLoading?: boolean;
  hasActionableApprovalTask?: boolean;
}

export interface InvestigationLifecycleContext {
  status: InvestigationStatus;
  createdBy?: string | null;
  currentUserId?: string | null;
  permissions: InvestigationLifecyclePermissions;
  readiness: InvestigationLifecycleReadiness;
}

export interface InvestigationLifecycleAction {
  kind: InvestigationLifecycleActionKind;
  enabled: boolean;
  blockedReason?: InvestigationLifecycleBlockReason;
  targetStatus?: InvestigationStatus;
}

export interface InvestigationCancelAction {
  kind: 'cancel_investigation';
  enabled: boolean;
  blockedReason?: InvestigationLifecycleBlockReason;
  targetStatus: 'cancelled';
}

/**
 * Resolve the single forward lifecycle action for an investigation.
 *
 * This deliberately models domain verbs instead of exposing the generic status
 * transition map. Callers decide which existing dialog or endpoint performs the
 * returned verb, while this function remains deterministic and easy to test.
 */
export function nextAction(context: InvestigationLifecycleContext): InvestigationLifecycleAction {
  const { status, permissions, readiness } = context;

  switch (status) {
    case 'registered':
      return requireEdit('start_investigation', 'in_progress', permissions);
    case 'in_progress':
      return requireEdit('record_findings', undefined, permissions);
    case 'results_recorded':
      if (!permissions.canEdit) return blocked('send_for_approval', 'edit_permission_required');
      if (!readiness.hasFindings) return blocked('send_for_approval', 'findings_required');
      if (!readiness.hasRecommendations) {
        return blocked('send_for_approval', 'recommendations_required');
      }
      return enabled('send_for_approval');
    case 'pending_approval':
      if (!permissions.canApprove) {
        return blocked('decide_approval', 'approve_permission_required');
      }
      if (violatesFourEyes(context)) {
        return blocked('decide_approval', 'four_eyes_required');
      }
      if (readiness.approvalTasksLoading) {
        return blocked('decide_approval', 'approval_task_loading');
      }
      if (!readiness.hasActionableApprovalTask) {
        return blocked('decide_approval', 'approval_task_required');
      }
      return enabled('decide_approval');
    case 'approved':
      if (!permissions.canClose) {
        return blocked('close_investigation', 'close_permission_required');
      }
      if (violatesFourEyes(context)) {
        return blocked('close_investigation', 'four_eyes_required');
      }
      return enabled('close_investigation', 'closed');
    case 'rejected':
      return requireEdit('reopen_for_rework', 'in_progress', permissions);
    case 'closed':
    case 'cancelled':
      return { kind: 'terminal', enabled: false };
  }
}

/** Resolve the demoted cancel side-action for statuses where cancellation is legal. */
export function cancelAction(
  context: InvestigationLifecycleContext,
): InvestigationCancelAction | null {
  if (!['registered', 'in_progress', 'results_recorded', 'rejected'].includes(context.status)) {
    return null;
  }
  if (!context.permissions.canClose) {
    return {
      kind: 'cancel_investigation',
      enabled: false,
      blockedReason: 'close_permission_required',
      targetStatus: 'cancelled',
    };
  }
  if (violatesFourEyes(context)) {
    return {
      kind: 'cancel_investigation',
      enabled: false,
      blockedReason: 'four_eyes_required',
      targetStatus: 'cancelled',
    };
  }
  return { kind: 'cancel_investigation', enabled: true, targetStatus: 'cancelled' };
}

function requireEdit(
  kind: InvestigationLifecycleActionKind,
  targetStatus: InvestigationStatus | undefined,
  permissions: InvestigationLifecyclePermissions,
): InvestigationLifecycleAction {
  return permissions.canEdit
    ? enabled(kind, targetStatus)
    : blocked(kind, 'edit_permission_required', targetStatus);
}

function enabled(
  kind: InvestigationLifecycleActionKind,
  targetStatus?: InvestigationStatus,
): InvestigationLifecycleAction {
  return { kind, enabled: true, targetStatus };
}

function blocked(
  kind: InvestigationLifecycleActionKind,
  blockedReason: InvestigationLifecycleBlockReason,
  targetStatus?: InvestigationStatus,
): InvestigationLifecycleAction {
  return { kind, enabled: false, blockedReason, targetStatus };
}

function violatesFourEyes(context: InvestigationLifecycleContext): boolean {
  const creator = context.createdBy?.trim();
  const actor = context.currentUserId?.trim();
  return Boolean(creator && actor && creator === actor);
}
