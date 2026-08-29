import { describe, it, expect } from 'vitest';
import { validateWorkflow } from '@/lib/workflow-validation';
import type { WorkflowStep } from '@/types/models';

function step(id: string, targets: string[] = [], overrides: Partial<WorkflowStep> = {}): WorkflowStep {
  return {
    id,
    name: id,
    type: 'task',
    config: {},
    position: { x: 0, y: 0 },
    transitions: targets.map((t, i) => ({ id: `${id}-${t}-${i}`, target_step_id: t, label: '' })),
    timeout_minutes: null,
    on_timeout: 'fail',
    assignee_strategy: { type: 'role', role_id: 'r1' },
    ...overrides,
  };
}

describe('validateWorkflow', () => {
  it('flags an empty workflow as invalid', () => {
    const result = validateWorkflow([]);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/no steps/i);
  });

  it('accepts a simple linear DAG ending in an end step', () => {
    const steps = [
      step('start', ['mid']),
      step('mid', ['end']),
      step('end', [], { type: 'end' }),
    ];
    const result = validateWorkflow(steps);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('detects a cycle as a blocking error', () => {
    const steps = [
      step('a', ['b']),
      step('b', ['a']),
    ];
    const result = validateWorkflow(steps);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /cycle/i.test(e))).toBe(true);
  });

  it('errors on a transition to a missing step', () => {
    const steps = [step('a', ['ghost'])];
    const result = validateWorkflow(steps);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /no longer exists/i.test(e))).toBe(true);
  });

  it('does not throw when a step has a malformed transitions value', () => {
    const steps = [
      step('a', [], { transitions: null as unknown as WorkflowStep['transitions'] }),
      step('end', [], { type: 'end' }),
    ];

    expect(() => validateWorkflow(steps)).not.toThrow();
  });

  it('warns about disconnected island steps', () => {
    const steps = [
      step('start', ['end'], { type: 'task' }),
      step('end', [], { type: 'end' }),
      step('orphan', [], { type: 'end' }),
    ];
    const result = validateWorkflow(steps);
    expect(result.warnings.some((w) => /disconnected/i.test(w))).toBe(true);
  });

  it('warns when a human-task step has no assignee role', () => {
    const steps = [
      step('approve', ['done'], { type: 'approval', assignee_strategy: { type: 'role', role_id: '' } }),
      step('done', [], { type: 'end' }),
    ];
    const result = validateWorkflow(steps);
    expect(result.warnings.some((w) => /assignee role/i.test(w))).toBe(true);
  });
});
