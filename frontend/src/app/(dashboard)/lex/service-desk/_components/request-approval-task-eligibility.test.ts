import { describe, expect, it } from 'vitest';
import type { ApprovalTask } from '@/lib/lex/requests';
import { actionableRequestApprovalTasks } from './request-approval-task-eligibility';

function task(overrides: Partial<ApprovalTask> = {}): ApprovalTask {
  return {
    id: 'task-1',
    tenant_id: 'tenant-1',
    instance_id: 'workflow-1',
    step_id: 'request_approval',
    name: 'Approve request',
    description: '',
    status: 'pending',
    assignee_role: 'legal-director',
    sla_breached: false,
    priority: 1,
    metadata: {},
    created_at: '2026-07-22T10:00:00Z',
    updated_at: '2026-07-22T10:00:00Z',
    can_decide: true,
    ...overrides,
  };
}

describe('actionableRequestApprovalTasks', () => {
  it("skips another approver's first task and selects the actor's task", () => {
    const tasks = [
      task({ id: 'other-task', assignee_id: 'other-user', can_decide: false }),
      task({ id: 'my-task', assignee_id: 'current-user', can_decide: true }),
    ];

    expect(actionableRequestApprovalTasks(tasks).map((item) => item.id)).toEqual(['my-task']);
  });

  it('never returns completed tasks even if a stale response marks one actionable', () => {
    expect(actionableRequestApprovalTasks([task({ status: 'completed' })])).toEqual([]);
  });
});
