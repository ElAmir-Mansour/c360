import type { ApprovalTask } from '@/lib/lex/requests';

/** Human-task statuses that cannot accept another decision. */
const CLOSED_TASK_STATUSES = new Set(['completed', 'rejected', 'cancelled', 'expired']);

/**
 * Select the open approval tasks the backend says this signed-in actor can
 * decide. The server remains authoritative; this prevents the action bar from
 * blindly choosing another approver's first open task.
 */
export function actionableRequestApprovalTasks(
  tasks: readonly ApprovalTask[],
): ApprovalTask[] {
  return tasks.filter(
    (task) => task.can_decide && !task.completed_at && !CLOSED_TASK_STATUSES.has(task.status),
  );
}
