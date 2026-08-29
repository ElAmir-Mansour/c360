/**
 * runbook-graph.ts — pure orchestration math for the ClarioDR runbook task-flow.
 * ============================================================================
 *
 * A faithful TypeScript port of the server engine in
 * `backend/internal/dr/runbookstudio/engine.go` (CriticalPath, TopoOrder,
 * Frontier). Keeping the client math IDENTICAL to the server's longest-path /
 * topological-readiness algorithms means the highlighted critical path and the
 * runnable frontier the operator sees match exactly what the engine drives.
 *
 * Pure (no I/O, no React) so the algorithms are deterministic and unit-tested
 * with the real DR shapes (DRRunbookTask + DRRunbookTaskRun + bootgraph tiers).
 *
 * The canonical task-type and status constants come straight from the backend
 * model (`runbookstudio/model.go`):
 *   - task_type:   manual | automated | approval_gate | comms | milestone
 *   - task-run:    pending | runnable | running | complete | skipped | failed | blocked
 */

import type {
  DRRunbookTask,
  DRRunbookTaskRun,
  DRBootService,
} from '@/types/clario-dr';

/** Canonical runbook task types (backend `runbookstudio/model.go`). */
export const RUNBOOK_TASK_TYPES = [
  'manual',
  'automated',
  'approval_gate',
  'comms',
  'milestone',
] as const;
export type RunbookTaskType = (typeof RUNBOOK_TASK_TYPES)[number];

/** Canonical per-task execution statuses within a live run. */
export const RUNBOOK_TASK_RUN_STATUSES = [
  'pending',
  'runnable',
  'running',
  'complete',
  'skipped',
  'failed',
  'blocked',
] as const;
export type RunbookTaskRunStatus = (typeof RUNBOOK_TASK_RUN_STATUSES)[number];

/** Normalise any free-form task_type to a known type (safe fallback `manual`). */
export function normalizeTaskType(value: string | null | undefined): RunbookTaskType {
  const v = (value ?? '').trim().toLowerCase();
  return (RUNBOOK_TASK_TYPES as readonly string[]).includes(v)
    ? (v as RunbookTaskType)
    : 'manual';
}

/** Normalise any free-form task-run status (safe fallback `pending`). */
export function normalizeTaskRunStatus(
  value: string | null | undefined,
): RunbookTaskRunStatus {
  const v = (value ?? '').trim().toLowerCase();
  return (RUNBOOK_TASK_RUN_STATUSES as readonly string[]).includes(v)
    ? (v as RunbookTaskRunStatus)
    : 'pending';
}

/**
 * A task-run status is "done-equivalent" for frontier purposes — a downstream
 * task becomes runnable once all predecessors are complete OR skipped. Mirrors
 * `TaskRunDone` in the engine.
 */
export function isTaskRunDone(status: RunbookTaskRunStatus): boolean {
  return status === 'complete' || status === 'skipped';
}

/** Terminal per-task states (no further change without reset). `TaskRunTerminal`. */
export function isTaskRunTerminal(status: RunbookTaskRunStatus): boolean {
  return status === 'complete' || status === 'skipped' || status === 'failed';
}

/** Index a task list by ID. */
function taskById(tasks: DRRunbookTask[]): Map<string, DRRunbookTask> {
  const m = new Map<string, DRRunbookTask>();
  for (const t of tasks) m.set(t.id, t);
  return m;
}

/** The forward adjacency: task ID -> tasks that list it as a predecessor. */
function successors(tasks: DRRunbookTask[]): Map<string, string[]> {
  const adj = new Map<string, string[]>();
  for (const t of tasks) {
    for (const pre of t.predecessors ?? []) {
      const list = adj.get(pre) ?? [];
      list.push(t.id);
      adj.set(pre, list);
    }
  }
  for (const [k, v] of adj) adj.set(k, [...v].sort());
  return adj;
}

function sortedTaskIds(tasks: DRRunbookTask[]): string[] {
  return tasks.map((t) => t.id).sort();
}

/**
 * Kahn's topological order (every predecessor before its dependents), processing
 * ready tasks in sorted order for a stable result. Returns `null` on a cycle —
 * mirrors `TopoOrder` returning ok=false. Unknown-predecessor edges are ignored.
 */
export function topoOrder(tasks: DRRunbookTask[]): string[] | null {
  const adj = successors(tasks);
  const present = new Set(tasks.map((t) => t.id));
  const indeg = new Map<string, number>();
  for (const t of tasks) if (!indeg.has(t.id)) indeg.set(t.id, 0);
  for (const t of tasks) {
    for (const pre of t.predecessors ?? []) {
      if (present.has(pre)) indeg.set(t.id, (indeg.get(t.id) ?? 0) + 1);
    }
  }

  const ready = sortedTaskIds(tasks).filter((id) => (indeg.get(id) ?? 0) === 0);
  const order: string[] = [];
  while (ready.length > 0) {
    ready.sort();
    const cur = ready.shift() as string;
    order.push(cur);
    for (const succ of adj.get(cur) ?? []) {
      indeg.set(succ, (indeg.get(succ) ?? 0) - 1);
      if ((indeg.get(succ) ?? 0) === 0) ready.push(succ);
    }
  }
  return order.length === tasks.length ? order : null;
}

/** Result of the critical-path computation — mirrors `CriticalPathResult`. */
export interface CriticalPathResult {
  /** Planned duration (seconds) of the longest dependency chain. */
  totalSeconds: number;
  /** Ordered task IDs forming the critical path. */
  path: string[];
  /** Membership set of the path (O(1) lookup for highlighting). */
  pathSet: Set<string>;
  /** task ID -> earliest planned finish (seconds from run start). */
  earliestFinish: Map<string, number>;
}

/**
 * The real critical path: the longest planned-duration chain through the task
 * DAG (longest-path-in-a-DAG over the topological order). Each task's earliest
 * finish = its planned duration + the max earliest finish of its predecessors.
 * Identical recurrence + deterministic tie-break (sorted predecessors, then the
 * lexically-first finishing task) to the server `CriticalPath`, so the client
 * highlight matches the engine baseline exactly. Returns an empty path on a
 * cycle (caller should validate first).
 */
export function computeCriticalPath(tasks: DRRunbookTask[]): CriticalPathResult {
  const order = topoOrder(tasks);
  if (!order) {
    return { totalSeconds: 0, path: [], pathSet: new Set(), earliestFinish: new Map() };
  }
  const tasksByID = taskById(tasks);
  const earliestFinish = new Map<string, number>();
  const best = new Map<string, string>();

  for (const id of order) {
    const t = tasksByID.get(id);
    if (!t) continue;
    let start = 0;
    let chosen = '';
    const preds = [...(t.predecessors ?? [])].sort();
    for (const pre of preds) {
      const pf = earliestFinish.get(pre) ?? 0;
      if (pf > start) {
        start = pf;
        chosen = pre;
      }
    }
    earliestFinish.set(id, start + Math.max(0, t.planned_duration_seconds ?? 0));
    if (chosen) best.set(id, chosen);
  }

  let total = 0;
  let finish = '';
  for (const id of sortedTaskIds(tasks)) {
    const ef = earliestFinish.get(id) ?? 0;
    if (ef > total) {
      total = ef;
      finish = id;
    }
  }

  const rev: string[] = [];
  for (let cur = finish; cur; cur = best.get(cur) ?? '') {
    rev.push(cur);
    if (!best.has(cur)) break;
  }
  const path = rev.reverse();

  return { totalSeconds: total, path, pathSet: new Set(path), earliestFinish };
}

/**
 * The runnable frontier: task IDs runnable right now — not terminal, not running,
 * with all predecessors complete-equivalent (and none failed/blocked). Mirrors
 * `RunState.Frontier`. `statusByTaskId` maps each task to its per-task run status
 * (absent = pending).
 */
export function computeFrontier(
  tasks: DRRunbookTask[],
  statusByTaskId: Map<string, RunbookTaskRunStatus>,
): string[] {
  const statusOf = (id: string): RunbookTaskRunStatus =>
    statusByTaskId.get(id) ?? 'pending';

  const predecessorsComplete = (t: DRRunbookTask) =>
    (t.predecessors ?? []).every((pre) => isTaskRunDone(statusOf(pre)));
  const predecessorFailed = (t: DRRunbookTask) =>
    (t.predecessors ?? []).some((pre) => {
      const s = statusOf(pre);
      return s === 'failed' || s === 'blocked';
    });

  const frontier: string[] = [];
  for (const t of tasks) {
    const s = statusOf(t.id);
    if (isTaskRunTerminal(s) || s === 'running') continue;
    if (predecessorFailed(t)) continue;
    if (predecessorsComplete(t)) frontier.push(t.id);
  }
  return frontier.sort();
}

/**
 * Build a task-id -> per-task status map from the run's TaskRun rows, derived
 * against the runbook tasks so tasks with no row default to a derived state:
 *   - on the frontier  -> runnable
 *   - predecessor failed/blocked -> blocked
 *   - otherwise        -> pending
 * This gives a complete status for EVERY task even before the engine has emitted
 * a row, matching what `LiveState` surfaces.
 */
export function deriveTaskStatuses(
  tasks: DRRunbookTask[],
  taskRuns: DRRunbookTaskRun[],
): Map<string, RunbookTaskRunStatus> {
  const explicit = new Map<string, RunbookTaskRunStatus>();
  for (const tr of taskRuns) {
    explicit.set(tr.task_id, normalizeTaskRunStatus(tr.status));
  }

  const frontier = new Set(computeFrontier(tasks, explicit));
  const result = new Map<string, RunbookTaskRunStatus>();
  const statusOf = (id: string): RunbookTaskRunStatus =>
    explicit.get(id) ?? 'pending';

  for (const t of tasks) {
    if (explicit.has(t.id)) {
      result.set(t.id, explicit.get(t.id) as RunbookTaskRunStatus);
      continue;
    }
    const predFailed = (t.predecessors ?? []).some((pre) => {
      const s = statusOf(pre);
      return s === 'failed' || s === 'blocked';
    });
    if (frontier.has(t.id)) {
      result.set(t.id, 'runnable');
    } else if (predFailed) {
      result.set(t.id, 'blocked');
    } else {
      result.set(t.id, 'pending');
    }
  }
  return result;
}

/**
 * Order tasks for sequential presentation: topological order (predecessors first)
 * when the DAG is acyclic, with a stable tie-break by the longest-path earliest
 * finish, then task_key, then name. Falls back to task_key ordering on a cycle so
 * the view never blanks out on bad data.
 */
export function orderTasksForFlow(tasks: DRRunbookTask[]): DRRunbookTask[] {
  const order = topoOrder(tasks);
  const byId = taskById(tasks);
  if (order) {
    const rank = new Map(order.map((id, i) => [id, i]));
    return [...tasks].sort(
      (a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0),
    );
  }
  return [...tasks].sort((a, b) =>
    (a.task_key || a.name).localeCompare(b.task_key || b.name),
  );
}

/** A row in the flattened task-flow with its derived run/critical-path facets. */
export interface RunbookFlowRow {
  task: DRRunbookTask;
  taskType: RunbookTaskType;
  status: RunbookTaskRunStatus;
  taskRun: DRRunbookTaskRun | null;
  onCriticalPath: boolean;
  /** 1-based sequence index within the ordered flow. */
  sequence: number;
  /** Earliest planned finish (seconds from run start) for schedule context. */
  earliestFinishSeconds: number;
  /** Resolved predecessor display labels (task_key) for dependency chips. */
  predecessorKeys: string[];
}

/**
 * Assemble the ordered, fully-derived flow rows the RunbookTaskFlow renders.
 * Combines ordering, critical-path membership, derived statuses, and the per-task
 * TaskRun (actual timing) into one typed array — the single source the view maps.
 */
export function buildRunbookFlow(
  tasks: DRRunbookTask[],
  taskRuns: DRRunbookTaskRun[] = [],
): { rows: RunbookFlowRow[]; criticalPath: CriticalPathResult } {
  const ordered = orderTasksForFlow(tasks);
  const criticalPath = computeCriticalPath(tasks);
  const statuses = deriveTaskStatuses(tasks, taskRuns);
  const runByTask = new Map<string, DRRunbookTaskRun>();
  for (const tr of taskRuns) runByTask.set(tr.task_id, tr);
  const keyById = new Map(tasks.map((t) => [t.id, t.task_key] as const));

  const rows = ordered.map((task, index) => ({
    task,
    taskType: normalizeTaskType(task.task_type),
    status: statuses.get(task.id) ?? ('pending' as RunbookTaskRunStatus),
    taskRun: runByTask.get(task.id) ?? null,
    onCriticalPath: criticalPath.pathSet.has(task.id),
    sequence: index + 1,
    earliestFinishSeconds: criticalPath.earliestFinish.get(task.id) ?? 0,
    predecessorKeys: (task.predecessors ?? []).map(
      (pre) => keyById.get(pre) ?? pre,
    ),
  }));

  return { rows, criticalPath };
}

/**
 * Convert a bootgraph boot plan (ordered tiers of services) into runbook tasks —
 * each service becomes an `automated` task whose predecessors are EVERY service
 * in the prior tier (the bootgraph "tier i+1 starts after tier i" contract). The
 * synthesized tasks carry the real boot fields (probe/timeout) in `params`, so a
 * boot plan can be visualised in the same critical-path task-flow as an authored
 * runbook. Tier index drives a deterministic synthetic planned duration when the
 * service does not carry one (boot_timeout_seconds).
 */
export function bootTiersToRunbookTasks(
  groupId: string,
  tiers: DRBootService[][],
): DRRunbookTask[] {
  const tasks: DRRunbookTask[] = [];
  let prevTierIds: string[] = [];
  tiers.forEach((tier, tierIndex) => {
    const currentTierIds: string[] = [];
    for (const svc of tier) {
      const id = svc.id;
      currentTierIds.push(id);
      tasks.push({
        id,
        tenant_id: svc.tenant_id,
        runbook_id: `bootplan:${groupId}`,
        task_key: `tier${tierIndex + 1}.${svc.name}`,
        name: svc.name,
        task_type: 'automated',
        required: true,
        owner: 'recovery-orchestrator',
        team: 'platform',
        instructions: `Boot service "${svc.name}" (${svc.kind}) via ${svc.boot_action}, then verify ${svc.probe_kind} probe ${svc.probe_target} returns ${svc.probe_expect_status}.`,
        planned_duration_seconds: Math.max(1, svc.boot_timeout_seconds ?? 0),
        automation_action: svc.boot_action,
        predecessors: [...prevTierIds],
        params: {
          tier: tierIndex + 1,
          probe_kind: svc.probe_kind,
          probe_target: svc.probe_target,
          probe_expect_status: svc.probe_expect_status,
          health_retries: svc.health_retries,
        },
        created_at: svc.created_at,
        updated_at: svc.updated_at,
      });
    }
    prevTierIds = currentTierIds;
  });
  return tasks;
}

/** Human-readable duration: seconds -> "Xh Ym Zs" (compact, locale-neutral). */
export function formatDurationSeconds(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return '0s';
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const parts: string[] = [];
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  if (s || parts.length === 0) parts.push(`${s}s`);
  return parts.join(' ');
}
