import { describe, expect, it } from 'vitest';

import type { ManagerTask } from '@/lib/lex/manager-tasks';
import {
  canCreateManagerTask,
  canSeeManagerTasks,
  hasManagerTaskOversight,
  managerTaskActions,
  managerTaskAssigneeRoles,
} from './task-policy';

const task = (overrides: Partial<ManagerTask> = {}): ManagerTask => ({
  id: 'task-1',
  tenant_id: 'tenant-1',
  title: 'Review',
  description: 'Review the contract',
  assignee_id: 'assignee-1',
  status: 'assigned',
  created_by: 'manager-1',
  created_at: '2026-07-31T10:00:00Z',
  updated_at: '2026-07-31T10:00:00Z',
  ...overrides,
});

describe('manager task UI policy', () => {
  it('allows every legal-side supervisory role to create tasks', () => {
    for (const role of [
      'legal-director',
      'legal-cases-manager',
      'legal-contracts-manager',
      'legal-shared-services-manager',
      'legal-case-supervisor',
      'legal-contracts-supervisor',
    ]) {
      expect(canCreateManagerTask(role)).toBe(true);
    }
    expect(canCreateManagerTask('legal-advisor')).toBe(false);
    expect(canCreateManagerTask('legal-requester')).toBe(false);
    // Business-tier requesting manager — not legal staff.
    expect(canCreateManagerTask('legal-dept-manager')).toBe(false);
  });

  it('grants tenant-wide task visibility only to the director and admins', () => {
    expect(hasManagerTaskOversight('legal-director')).toBe(true);
    for (const role of [
      'legal-cases-manager',
      'legal-shared-services-manager',
      'legal-case-supervisor',
      'legal-contracts-supervisor',
    ]) {
      expect(hasManagerTaskOversight(role)).toBe(false);
    }
  });

  it('shows the module to assigners and assignees, not to business requesters', () => {
    for (const role of [
      'legal-director',
      'legal-shared-services-manager',
      'legal-case-supervisor',
      'legal-officer',
      'legal-advisor',
    ]) {
      expect(canSeeManagerTasks(role)).toBe(true);
    }
    expect(canSeeManagerTasks('legal-requester')).toBe(false);
    expect(canSeeManagerTasks('legal-dept-manager')).toBe(false);
    expect(canSeeManagerTasks(null)).toBe(false);
  });

  it('uses role-specific assignee pools', () => {
    expect(managerTaskAssigneeRoles('legal-cases-manager')).toEqual([
      'legal-case-supervisor',
      'legal-officer',
    ]);
    expect(managerTaskAssigneeRoles('legal-contracts-manager')).toEqual([
      'legal-contracts-supervisor',
      'legal-advisor',
    ]);
    expect(managerTaskAssigneeRoles('legal-director')).toEqual(
      expect.arrayContaining(['legal-cases-manager', 'legal-contracts-manager']),
    );
  });

  it('lets only the assignee start and submit work in valid states', () => {
    expect(managerTaskActions(task(), 'assignee-1', 'legal-advisor')).toMatchObject({
      canStart: true,
      canSubmit: false,
    });
    expect(
      managerTaskActions(task({ status: 'in_progress' }), 'assignee-1', 'legal-advisor'),
    ).toMatchObject({ canStart: false, canSubmit: true });
    expect(managerTaskActions(task(), 'someone-else', 'legal-advisor')).toMatchObject({
      canStart: false,
      canSubmit: false,
    });
  });

  it('lets directors review globally and managers review work they assigned', () => {
    const submitted = task({ status: 'submitted' });
    expect(managerTaskActions(submitted, 'director-1', 'legal-director').canReview).toBe(
      true,
    );
    expect(managerTaskActions(submitted, 'manager-1', 'legal-cases-manager').canReview).toBe(
      true,
    );
    expect(managerTaskActions(submitted, 'other-manager', 'legal-cases-manager').canReview).toBe(
      false,
    );
    expect(
      managerTaskActions(
        task({ status: 'submitted', assignee_id: 'manager-1' }),
        'manager-1',
        'legal-cases-manager',
      ).canReview,
    ).toBe(false);
    expect(managerTaskActions(submitted, 'director-1', 'legal-advisor').canReview).toBe(false);
  });
});
