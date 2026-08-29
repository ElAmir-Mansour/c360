import type { ManagerTask } from '@/lib/lex/manager-tasks';

export interface ManagerTaskActions {
  canStart: boolean;
  canSubmit: boolean;
  canReview: boolean;
}

/**
 * Legal-side supervisory roles that may assign an ad-hoc task. Mirrors
 * `managerTaskCanCreate` in backend/internal/lex/service/manager_task_service.go —
 * keep the two in step, or the UI offers a button the API will reject.
 *
 * `legal-dept-manager` is deliberately absent: it is a BUSINESS-tier requesting
 * manager, and the legal team's internal task board is not theirs to see.
 */
const MANAGER_TASK_CREATOR_ROLES = new Set([
  'legal-director',
  'legal-cases-manager',
  'legal-contracts-manager',
  'legal-shared-services-manager',
  'legal-case-supervisor',
  'legal-contracts-supervisor',
  'tenant-admin',
  'super-admin',
]);

/** Roles whose task board spans the whole tenant. Everyone else sees only the
 * tasks they created or were assigned — enforced server-side by
 * `managerTaskOversight`; repeated here only so the UI can label the scope. */
const MANAGER_TASK_OVERSIGHT_ROLES = new Set([
  'legal-director',
  'tenant-admin',
  'super-admin',
]);

export function hasManagerTaskOversight(roleSlug: string | null | undefined): boolean {
  return Boolean(roleSlug && MANAGER_TASK_OVERSIGHT_ROLES.has(roleSlug));
}

/** Roles that can be on the receiving end of a task. */
const MANAGER_TASK_ASSIGNABLE_ROLES = new Set([
  'legal-officer',
  'legal-advisor',
  'legal-case-supervisor',
  'legal-contracts-supervisor',
  'legal-cases-manager',
  'legal-contracts-manager',
]);

/** True when the role gets the Task Management module at all — either because it
 * can assign work, or because it can be assigned work. */
export function canSeeManagerTasks(roleSlug: string | null | undefined): boolean {
  return canCreateManagerTask(roleSlug) || MANAGER_TASK_ASSIGNABLE_ROLES.has(roleSlug ?? '');
}

export function canCreateManagerTask(roleSlug: string | null | undefined): boolean {
  return Boolean(roleSlug && MANAGER_TASK_CREATOR_ROLES.has(roleSlug));
}

export function managerTaskAssigneeRoles(
  roleSlug: string | null | undefined,
): string[] {
  if (roleSlug === 'legal-cases-manager') {
    return ['legal-case-supervisor', 'legal-officer'];
  }
  if (roleSlug === 'legal-contracts-manager') {
    return ['legal-contracts-supervisor', 'legal-advisor'];
  }
  // Supervisors assign only to the handling tier directly beneath them.
  if (roleSlug === 'legal-case-supervisor') {
    return ['legal-officer'];
  }
  if (roleSlug === 'legal-contracts-supervisor') {
    return ['legal-advisor'];
  }
  // Shared Services sits on the oversight tier and coordinates across both
  // sections, so it draws from the same pool as the Director.
  if (
    roleSlug === 'legal-shared-services-manager' ||
    roleSlug === 'legal-director' ||
    roleSlug === 'tenant-admin' ||
    roleSlug === 'super-admin'
  ) {
    return [
      'legal-cases-manager',
      'legal-contracts-manager',
      'legal-case-supervisor',
      'legal-contracts-supervisor',
      'legal-officer',
      'legal-advisor',
    ];
  }
  return [];
}

export function managerTaskActions(
  task: ManagerTask,
  userID: string | null | undefined,
  roleSlug: string | null | undefined,
): ManagerTaskActions {
  const isAssignee = Boolean(userID && task.assignee_id === userID);
  const isCreator = Boolean(userID && task.created_by === userID);
  const hasGlobalReview = hasManagerTaskOversight(roleSlug);
  // Every other creator role reviews only what it assigned itself — mirrors
  // `managerTaskCanReview` server-side.
  const hasCreatorReview = !hasGlobalReview && canCreateManagerTask(roleSlug) && isCreator;
  return {
    canStart:
      isAssignee &&
      (task.status === 'assigned' || task.status === 'correction_required'),
    canSubmit: isAssignee && task.status === 'in_progress',
    canReview:
      task.status === 'submitted' &&
      Boolean(userID) &&
      !isAssignee &&
      (hasGlobalReview || hasCreatorReview),
  };
}
