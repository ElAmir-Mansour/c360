import type { WorkflowStep } from '@/types/models';

export interface WorkflowValidationResult {
  valid: boolean;
  /** Blocking problems — publishing should be prevented. */
  errors: string[];
  /** Non-blocking concerns — surfaced but don't prevent publishing. */
  warnings: string[];
}

function transitionsFor(step: WorkflowStep) {
  return Array.isArray(step.transitions) ? step.transitions : [];
}

/**
 * Static analysis of a workflow definition graph. Run before publishing to
 * catch structural problems the backend would otherwise reject (or that would
 * strand running instances).
 */
export function validateWorkflow(steps: WorkflowStep[]): WorkflowValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (steps.length === 0) {
    return { valid: false, errors: ['Workflow has no steps.'], warnings };
  }

  const byId = new Map(steps.map((s) => [s.id, s]));
  const nameFor = (id: string) => byId.get(id)?.name ?? id;

  // 1. Dangling transition targets.
  for (const step of steps) {
    for (const t of transitionsFor(step)) {
      if (!byId.has(t.target_step_id)) {
        errors.push(
          `Step "${step.name}" has a transition to a step that no longer exists.`,
        );
      }
    }
  }

  // 2. Incoming-edge map (only counting valid targets).
  const incoming = new Map<string, number>();
  steps.forEach((s) => incoming.set(s.id, 0));
  for (const step of steps) {
    for (const t of transitionsFor(step)) {
      if (byId.has(t.target_step_id)) {
        incoming.set(t.target_step_id, (incoming.get(t.target_step_id) ?? 0) + 1);
      }
    }
  }

  // 3. Entry points (no incoming edges).
  const roots = steps.filter((s) => (incoming.get(s.id) ?? 0) === 0);
  if (roots.length === 0) {
    errors.push('No start step found — every step has an incoming transition (the workflow contains a cycle with no entry point).');
  } else if (roots.length > 1) {
    warnings.push(
      `Multiple start steps detected (${roots.map((r) => `"${r.name}"`).join(', ')}). Workflows usually have a single entry point.`,
    );
  }

  // 4. Cycle detection (DFS with coloring).
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>(steps.map((s) => [s.id, WHITE]));
  let cycleFound = false;
  const visit = (id: string) => {
    color.set(id, GRAY);
    const step = byId.get(id);
    if (step) {
      for (const t of transitionsFor(step)) {
        if (!byId.has(t.target_step_id)) continue;
        const c = color.get(t.target_step_id);
        if (c === GRAY) {
          cycleFound = true;
        } else if (c === WHITE) {
          visit(t.target_step_id);
        }
      }
    }
    color.set(id, BLACK);
  };
  for (const s of steps) {
    if (color.get(s.id) === WHITE) visit(s.id);
  }
  if (cycleFound) {
    errors.push('Workflow contains a cycle — steps must form a directed acyclic graph (DAG).');
  }

  // 5. Disconnected islands: a step that has neither incoming nor outgoing
  // edges (and isn't the sole step) can never participate in a run.
  if (steps.length > 1) {
    const islands = steps.filter(
      (s) => (incoming.get(s.id) ?? 0) === 0 && transitionsFor(s).length === 0,
    );
    if (islands.length > 0) {
      warnings.push(
        `Disconnected step(s): ${islands.map((s) => `"${s.name}"`).join(', ')}. They have no transitions in or out.`,
      );
    }
  }

  // 6. Terminal steps. A leaf (no outgoing transitions) should be an `end` step.
  const leaves = steps.filter((s) => transitionsFor(s).length === 0);
  if (!steps.some((s) => s.type === 'end') && !leaves.length) {
    warnings.push('No terminal/end step — the workflow may never complete.');
  }
  for (const leaf of leaves) {
    if (leaf.type !== 'end') {
      warnings.push(
        `Step "${leaf.name}" has no outgoing transition and is not an end step — execution will stop here.`,
      );
    }
  }

  // 7. Empty assignee on human-task steps.
  for (const step of steps) {
    if (
      (step.type === 'approval' || step.type === 'review' || step.type === 'task') &&
      step.assignee_strategy?.type === 'role' &&
      !step.assignee_strategy.role_id
    ) {
      warnings.push(`Step "${nameFor(step.id)}" has no assignee role configured.`);
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}
