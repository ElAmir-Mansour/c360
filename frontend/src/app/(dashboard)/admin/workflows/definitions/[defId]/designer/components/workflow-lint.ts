import type { WorkflowStep } from '@/types/models';
import { validateWorkflow, type WorkflowValidationResult } from '@/lib/workflow-validation';
import { getDefinitionLabels } from '../../../definition-i18n';

export interface LintIssue {
  level: 'error' | 'warning';
  message: string;
  /** Step id the issue is anchored to, when it can be attributed to one. */
  stepId?: string;
}

export interface LintResult extends WorkflowValidationResult {
  /** Flat, attributed issue list for the overlay panel. */
  issues: LintIssue[];
  /** Per-step issues for painting validation rings on nodes. */
  byStep: Map<string, LintIssue[]>;
}

function transitionsFor(step: WorkflowStep) {
  return Array.isArray(step.transitions) ? step.transitions : [];
}

/**
 * Static lint over the designer graph. Reuses {@link validateWorkflow} for the
 * blocking/valid verdict (so the publish gate stays identical) and additionally
 * attributes each finding to the offending step so the canvas can ring nodes and
 * the overlay can list them. Surfaces: orphan/unreachable steps, dangling
 * transition targets, missing/duplicate end, and invalid step config.
 */
export function lintWorkflow(steps: WorkflowStep[], locale = 'en'): LintResult {
  const base = validateWorkflow(steps);
  const labels = getDefinitionLabels(locale).lint;
  const issues: LintIssue[] = [];
  const byStep = new Map<string, LintIssue[]>();

  const push = (level: 'error' | 'warning', message: string, stepId?: string) => {
    const issue: LintIssue = { level, message, stepId };
    issues.push(issue);
    if (stepId) {
      const list = byStep.get(stepId) ?? [];
      list.push(issue);
      byStep.set(stepId, list);
    }
  };

  if (steps.length === 0) {
    return { ...base, issues, byStep };
  }

  const byId = new Map(steps.map((s) => [s.id, s]));

  // ── Dangling transition targets (anchored to the source step) ──
  for (const step of steps) {
    for (const t of transitionsFor(step)) {
      if (!byId.has(t.target_step_id)) {
        push('error', labels.danglingTransition, step.id);
      }
    }
  }

  // ── Incoming-edge counts (valid targets only) ──
  const incoming = new Map<string, number>();
  steps.forEach((s) => incoming.set(s.id, 0));
  for (const step of steps) {
    for (const t of transitionsFor(step)) {
      if (byId.has(t.target_step_id)) {
        incoming.set(t.target_step_id, (incoming.get(t.target_step_id) ?? 0) + 1);
      }
    }
  }

  // ── Reachability from entry point(s) — flags unreachable steps ──
  const roots = steps.filter((s) => (incoming.get(s.id) ?? 0) === 0);
  const reachable = new Set<string>();
  const stack = [...roots.map((r) => r.id)];
  while (stack.length) {
    const id = stack.pop()!;
    if (reachable.has(id)) continue;
    reachable.add(id);
    const step = byId.get(id);
    if (step) {
      for (const t of transitionsFor(step)) {
        if (byId.has(t.target_step_id)) stack.push(t.target_step_id);
      }
    }
  }
  for (const step of steps) {
    if (!reachable.has(step.id) && (incoming.get(step.id) ?? 0) > 0) {
      push('warning', labels.unreachableCycle, step.id);
    }
  }

  // ── Orphan / disconnected steps ──
  if (steps.length > 1) {
    for (const step of steps) {
      if ((incoming.get(step.id) ?? 0) === 0 && transitionsFor(step).length === 0) {
        push('warning', labels.orphanStep, step.id);
      }
    }
  }

  // ── Missing / duplicate end ──
  const endSteps = steps.filter((s) => s.type === 'end');
  if (endSteps.length === 0) {
    push('warning', labels.noEndStep);
  }
  // A non-end leaf is effectively an undeclared terminal.
  for (const step of steps) {
    if (step.type !== 'end' && transitionsFor(step).length === 0) {
      push('warning', labels.nonEndLeaf, step.id);
    }
  }

  // ── Invalid step config ──
  for (const step of steps) {
    switch (step.type) {
      case 'approval':
        if (
          step.assignee_strategy?.type === 'role' &&
          !step.assignee_strategy.role_id
        ) {
          push('warning', labels.approvalNoRole, step.id);
        }
        break;
      case 'task':
      case 'review':
        if (
          step.assignee_strategy?.type === 'role' &&
          !step.assignee_strategy.role_id
        ) {
          push('warning', labels.humanNoRole, step.id);
        }
        break;
      case 'approval_chain':
        if (!step.config.approvers || step.config.approvers.length === 0) {
          push('error', labels.approvalChainNoApprovers, step.id);
        } else if (step.config.approvers.some((a) => !a.ref)) {
          push('warning', labels.approvalChainEmptyReference, step.id);
        }
        if (step.config.quorum === 'n_of_m' && !step.config.quorum_n) {
          push('warning', labels.quorumNoCount, step.id);
        }
        break;
      case 'webhook':
        if (!step.config.webhook_url) {
          push('warning', labels.webhookNoUrl, step.id);
        }
        break;
      case 'sub_workflow':
        if (!step.config.sub_workflow_id) {
          push('warning', labels.subWorkflowNoTarget, step.id);
        }
        break;
      case 'script':
        if (!step.config.script_id) {
          push('warning', labels.scriptNoScript, step.id);
        }
        break;
      case 'notification':
        if (!step.config.notification_channels?.length) {
          push('warning', labels.notificationNoChannels, step.id);
        }
        break;
      default:
        break;
    }
  }

  return { ...base, issues, byStep };
}
