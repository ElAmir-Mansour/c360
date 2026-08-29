import { describe, expect, it } from 'vitest';
import { toBackendSteps, toDesignerSteps } from './workflow-step-adapter';
import type { BackendStepDefinition, WorkflowStep } from '@/types/models';

describe('workflow-step-adapter', () => {
  it('normalizes backend transitions into designer transitions', () => {
    const steps: BackendStepDefinition[] = [
      {
        id: 'start',
        name: 'Start',
        type: 'human_task',
        config: {},
        transitions: [{ target: 'end' }],
      },
      {
        id: 'end',
        name: 'End',
        type: 'end',
        config: {},
        transitions: [],
      },
    ];

    const designerSteps = toDesignerSteps(steps);

    expect(designerSteps[0].type).toBe('task');
    expect(designerSteps[0].transitions).toEqual([
      {
        id: 'start-end-0',
        target_step_id: 'end',
        label: '',
      },
    ]);
  });

  it('treats missing or non-array transitions as empty arrays', () => {
    const designerSteps = toDesignerSteps([
      {
        id: 'orphan',
        name: 'Orphan',
        type: 'human_task',
        config: {},
        transitions: null,
      },
    ]);

    expect(designerSteps[0].transitions).toEqual([]);
  });

  it('serializes designer steps back to the backend step contract', () => {
    const steps: WorkflowStep[] = [
      {
        id: 'approve',
        name: 'Approve request',
        type: 'approval',
        config: { approval_type: 'single' },
        position: { x: 10, y: 20 },
        transitions: [
          {
            id: 'approve-end',
            target_step_id: 'end',
            label: 'Approved',
            condition: 'variables.approved == true',
          },
        ],
        timeout_minutes: null,
        on_timeout: 'fail',
        assignee_strategy: { type: 'role', role_id: 'legal' },
      },
    ];

    expect(toBackendSteps(steps)).toEqual([
      {
        id: 'approve',
        name: 'Approve request',
        type: 'human_task',
        config: {
          approval_type: 'single',
          _designer: {
            display_type: 'approval',
            position: { x: 10, y: 20 },
            timeout_minutes: null,
            on_timeout: 'fail',
            assignee_strategy: { type: 'role', role_id: 'legal' },
          },
        },
        transitions: [
          {
            target: 'end',
            condition: 'variables.approved == true',
          },
        ],
      },
    ]);
  });

  it('round-trips approval_chain steps to the backend approval_chain type', () => {
    const backend: BackendStepDefinition[] = [
      {
        id: 'chain',
        name: 'Legal sign-off',
        type: 'approval_chain',
        config: {
          approvers: [
            { type: 'role', ref: 'legal-counsel' },
            { type: 'user', ref: '${variables.gm}' },
          ],
          mode: 'sequential',
          quorum: 'n_of_m',
          quorum_n: 2,
        },
        transitions: [{ target: 'end' }],
      },
    ];

    const designer = toDesignerSteps(backend);
    expect(designer[0].type).toBe('approval_chain');
    // The approver config survives normalization on the top-level config.
    expect(designer[0].config.approvers).toHaveLength(2);
    expect(designer[0].config.quorum).toBe('n_of_m');

    const reserialized = toBackendSteps(designer);
    expect(reserialized[0].type).toBe('approval_chain');
    expect(reserialized[0].config).toMatchObject({
      approvers: [
        { type: 'role', ref: 'legal-counsel' },
        { type: 'user', ref: '${variables.gm}' },
      ],
      mode: 'sequential',
      quorum: 'n_of_m',
      quorum_n: 2,
    });
  });

  it('serializes structured transition conditions', () => {
    const steps = toBackendSteps([
      {
        id: 'route',
        name: 'Route',
        type: 'condition',
        config: {},
        position: { x: 0, y: 0 },
        transitions: [
          {
            id: 'route-review',
            target_step_id: 'review',
            label: '',
            condition: {
              field: 'variables.amount',
              operator: 'gte',
              value: 1000,
            },
          },
        ],
        timeout_minutes: null,
        on_timeout: 'fail',
        assignee_strategy: { type: 'role', role_id: '' },
      },
    ]);

    expect(steps[0].transitions[0]).toEqual({
      target: 'review',
      condition: 'variables.amount >= 1000',
    });
  });
});
