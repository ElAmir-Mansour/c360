import { describe, expect, it } from 'vitest';
import type { ApprovalTask, LegalRequest, RequestStatus } from '@/lib/lex/requests';
import {
  DIAGRAM_A,
  DIAGRAM_B,
  selectDiagram,
  resolveActiveStage,
  statusToHappyIndex,
} from './diagram-models';

function req(partial: Partial<LegalRequest>): LegalRequest {
  return {
    id: 'r1',
    tenant_id: 't1',
    cycle: 1,
    request_number: 'REQ-1',
    request_type: 'general',
    title: { ar: '', en: '' },
    description: '',
    requester_user_id: 'u1',
    requester_name: 'Requester',
    priority: 'normal',
    status: 'draft',
    requester_approval_required: false,
    provider_approval_required: false,
    metadata: {},
    created_by: 'u1',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...partial,
  };
}

function task(role: string, status: string): ApprovalTask {
  return {
    id: `task-${role}-${status}`,
    tenant_id: 't1',
    instance_id: 'wf1',
    step_id: 'step',
    name: role,
    description: '',
    status,
    assignee_role: role,
    sla_breached: false,
    priority: 1,
    metadata: {},
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    can_decide: false,
  };
}

describe('statusToHappyIndex', () => {
  it('collapses the two approval sub-states onto a single index', () => {
    expect(statusToHappyIndex('pending_requester_approval')).toBe(2);
    expect(statusToHappyIndex('pending_provider_approval')).toBe(2);
  });

  it('returns -1 for off-path terminals', () => {
    expect(statusToHappyIndex('returned')).toBe(-1);
    expect(statusToHappyIndex('cancelled')).toBe(-1);
  });

  it('orders the happy path monotonically', () => {
    const order: RequestStatus[] = [
      'draft',
      'submitted',
      'approved',
      'routed',
      'in_execution',
      'delivered',
      'closed',
    ];
    const idxs = order.map(statusToHappyIndex);
    for (let i = 1; i < idxs.length; i += 1) {
      expect(idxs[i]).toBeGreaterThan(idxs[i - 1]);
    }
  });
});

describe('selectDiagram', () => {
  it('routes litigation to Diagram B and everything else to Diagram A', () => {
    expect(selectDiagram(req({ request_type: 'litigation' })).id).toBe('B');
    expect(selectDiagram(req({ request_type: 'general' })).id).toBe('A');
    expect(selectDiagram(req({ request_type: 'consultation' })).id).toBe('A');
  });
});

describe('resolveActiveStage — Diagram A', () => {
  it('marks upstream done, the mapped stage current, downstream future', () => {
    const active = resolveActiveStage(DIAGRAM_A, req({ status: 'in_execution' }));
    expect(active.currentStageId).toBe('a-execution');
    expect(active.stageStates.get('a-draft')).toBe('done');
    expect(active.stageStates.get('a-submitted')).toBe('done');
    expect(active.stageStates.get('a-provider-approval')).toBe('done');
    expect(active.stageStates.get('a-execution')).toBe('current');
    expect(active.stageStates.get('a-delivered')).toBe('future');
    expect(active.stageStates.get('a-closed')).toBe('future');
    expect(active.offPath).toBe(false);
  });

  it('lights the approval stage for either approval sub-state', () => {
    for (const status of ['pending_requester_approval', 'pending_provider_approval'] as const) {
      const active = resolveActiveStage(DIAGRAM_A, req({ status }));
      expect(active.currentStageId).toBe('a-provider-approval');
      expect(active.stageStates.get('a-provider-approval')).toBe('current');
    }
  });

  it('renders returned as off-path with no current stage', () => {
    const active = resolveActiveStage(DIAGRAM_A, req({ status: 'returned' }));
    expect(active.offPath).toBe(true);
    expect(active.terminal).toBe('returned');
    expect(active.currentStageId).toBeNull();
    for (const stage of DIAGRAM_A.stages) {
      expect(active.stageStates.get(stage.id)).toBe('offpath');
    }
  });
});

describe('resolveActiveStage — Diagram B', () => {
  it('highlights the tier whose approval task is still open, prior tiers done', () => {
    const tasks = [
      task('legal-dept-manager', 'completed'),
      task('legal-bu-ceo', 'pending'),
    ];
    const active = resolveActiveStage(DIAGRAM_B, req({ status: 'submitted' }), tasks);
    expect(active.stageStates.get('b-file')).toBe('done');
    expect(active.stageStates.get('b-dept')).toBe('done');
    expect(active.stageStates.get('b-exec')).toBe('current');
    expect(active.currentStageId).toBe('b-exec');
    expect(active.stageStates.get('b-legal')).toBe('future');
    expect(active.stageStates.get('b-filed')).toBe('future');
  });

  it('advances to the next tier as the chain completes', () => {
    const tasks = [
      task('legal-dept-manager', 'completed'),
      task('legal-bu-ceo', 'completed'),
      task('legal-director', 'pending'),
    ];
    const active = resolveActiveStage(DIAGRAM_B, req({ status: 'submitted' }), tasks);
    expect(active.stageStates.get('b-exec')).toBe('done');
    expect(active.currentStageId).toBe('b-legal');
  });

  it('falls back to the first tier when submitted with no task rows', () => {
    const active = resolveActiveStage(DIAGRAM_B, req({ status: 'submitted' }), []);
    expect(active.stageStates.get('b-file')).toBe('done');
    expect(active.currentStageId).toBe('b-dept');
  });

  it('marks the whole chain done once past the filing gate (approved → filed current)', () => {
    const active = resolveActiveStage(DIAGRAM_B, req({ status: 'approved' }), []);
    expect(active.stageStates.get('b-dept')).toBe('done');
    expect(active.stageStates.get('b-exec')).toBe('done');
    expect(active.stageStates.get('b-legal')).toBe('done');
    expect(active.stageStates.get('b-filed')).toBe('current');
    expect(active.currentStageId).toBe('b-filed');
  });

  it('treats draft as still filing', () => {
    const active = resolveActiveStage(DIAGRAM_B, req({ status: 'draft' }), []);
    expect(active.stageStates.get('b-file')).toBe('current');
    expect(active.currentStageId).toBe('b-file');
  });

  it('renders cancelled litigation as off-path', () => {
    const active = resolveActiveStage(DIAGRAM_B, req({ status: 'cancelled' }), []);
    expect(active.offPath).toBe(true);
    expect(active.terminal).toBe('cancelled');
    expect(active.currentStageId).toBeNull();
  });
});
