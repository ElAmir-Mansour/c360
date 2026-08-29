import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { WorkflowStep } from '@/types/models';
import { useCanvasState } from './use-canvas-state';

function buildStep(overrides: Partial<WorkflowStep> = {}): WorkflowStep {
  return {
    id: 'step-1',
    name: 'Start',
    type: 'task',
    config: {},
    position: { x: 100, y: 80 },
    transitions: [],
    timeout_minutes: null,
    on_timeout: 'fail',
    assignee_strategy: { type: 'role', role_id: 'admin' },
    ...overrides,
  };
}

describe('useCanvasState', () => {
  it('does not add undo history when a step stays at the same position', () => {
    const { result } = renderHook(() => useCanvasState([buildStep()]));
    const before = result.current;

    act(() => result.current.moveStep('step-1', { x: 100, y: 80 }));

    expect(result.current.steps[0].position).toEqual({ x: 100, y: 80 });
    expect(result.current.canUndo).toBe(false);
    expect(result.current).toBe(before);
  });
});
