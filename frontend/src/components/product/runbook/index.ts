/**
 * ClarioDR runbook — Phase-3 product components.
 * ==============================================
 * Composable, token-driven, bilingual-ready components wired to the real DR data
 * contract (runbookstudio run/task DAG + bootgraph tiers). No full page assembly
 * — these are the building blocks the Phase-4 recovery-dashboard PROOF screen
 * composes.
 */

export { RunbookTaskFlow } from './runbook-task-flow';
export type {
  RunbookTaskFlowProps,
  RunbookTaskFlowLabels,
} from './runbook-task-flow';

export {
  RUNBOOK_TASK_TYPES,
  RUNBOOK_TASK_RUN_STATUSES,
  normalizeTaskType,
  normalizeTaskRunStatus,
  isTaskRunDone,
  isTaskRunTerminal,
  topoOrder,
  computeCriticalPath,
  computeFrontier,
  deriveTaskStatuses,
  orderTasksForFlow,
  buildRunbookFlow,
  bootTiersToRunbookTasks,
  formatDurationSeconds,
} from './runbook-graph';
export type {
  RunbookTaskType,
  RunbookTaskRunStatus,
  CriticalPathResult,
  RunbookFlowRow,
} from './runbook-graph';
