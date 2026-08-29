import { describe, expect, it } from 'vitest';
import {
  cancelAction,
  nextAction,
  type InvestigationLifecycleContext,
} from './investigation-lifecycle';

const ready: InvestigationLifecycleContext = {
  status: 'registered',
  createdBy: 'author-1',
  currentUserId: 'reviewer-1',
  permissions: { canEdit: true, canApprove: true, canClose: true },
  readiness: {
    hasFindings: true,
    hasRecommendations: true,
    hasActionableApprovalTask: true,
  },
};

describe('nextAction', () => {
  it.each([
    ['registered', 'start_investigation', 'in_progress'],
    ['in_progress', 'record_findings', undefined],
    ['results_recorded', 'send_for_approval', undefined],
    ['pending_approval', 'decide_approval', undefined],
    ['approved', 'close_investigation', 'closed'],
    ['rejected', 'reopen_for_rework', 'in_progress'],
  ] as const)('maps %s to its one forward verb', (status, kind, targetStatus) => {
    expect(nextAction({ ...ready, status })).toEqual({
      kind,
      enabled: true,
      ...(targetStatus ? { targetStatus } : {}),
    });
  });

  it.each(['closed', 'cancelled'] as const)('marks %s as terminal', (status) => {
    expect(nextAction({ ...ready, status })).toEqual({ kind: 'terminal', enabled: false });
  });

  it('keeps send-for-approval visible and explains missing readiness', () => {
    expect(
      nextAction({
        ...ready,
        status: 'results_recorded',
        readiness: { ...ready.readiness, hasRecommendations: false },
      }),
    ).toMatchObject({
      kind: 'send_for_approval',
      enabled: false,
      blockedReason: 'recommendations_required',
    });
  });

  it('enforces approval permission and four-eyes independently', () => {
    expect(
      nextAction({
        ...ready,
        status: 'pending_approval',
        permissions: { ...ready.permissions, canApprove: false },
      }),
    ).toMatchObject({ enabled: false, blockedReason: 'approve_permission_required' });

    expect(
      nextAction({
        ...ready,
        status: 'pending_approval',
        currentUserId: 'author-1',
      }),
    ).toMatchObject({ enabled: false, blockedReason: 'four_eyes_required' });
  });

  it('lets a close-only actor close while still requiring close authority', () => {
    expect(
      nextAction({
        ...ready,
        status: 'approved',
        permissions: { ...ready.permissions, canEdit: false },
      }),
    ).toMatchObject({ enabled: true, targetStatus: 'closed' });

    expect(
      nextAction({
        ...ready,
        status: 'approved',
        permissions: { ...ready.permissions, canClose: false },
      }),
    ).toMatchObject({ enabled: false, blockedReason: 'close_permission_required' });
  });
});

describe('cancelAction', () => {
  it('is secondary only on cancellable statuses', () => {
    expect(cancelAction({ ...ready, status: 'in_progress' })).toMatchObject({
      kind: 'cancel_investigation',
      enabled: true,
    });
    expect(cancelAction({ ...ready, status: 'pending_approval' })).toBeNull();
    expect(cancelAction({ ...ready, status: 'closed' })).toBeNull();
  });

  it('uses close authority and the same four-eyes guard', () => {
    expect(
      cancelAction({
        ...ready,
        status: 'registered',
        permissions: { ...ready.permissions, canEdit: false },
      }),
    ).toMatchObject({ enabled: true, targetStatus: 'cancelled' });

    expect(
      cancelAction({
        ...ready,
        status: 'registered',
        currentUserId: 'author-1',
      }),
    ).toMatchObject({ enabled: false, blockedReason: 'four_eyes_required' });
  });
});
