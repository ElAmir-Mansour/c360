import { describe, expect, it, vi } from 'vitest';
import { apiGet } from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';
import type { HumanTask } from '@/types/models';
import {
  caseTaskToItem,
  inboxSourceAccess,
  listVisibleCaseIntakeTasks,
  workflowToItem,
} from './use-inbox';
import type { LexWorkflowSummary } from '@/types/suites';

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return { ...actual, apiGet: vi.fn() };
});

function task(overrides: Partial<HumanTask> = {}): HumanTask {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    name: 'Approve case directive',
    description: '',
    instance_id: '22222222-2222-2222-2222-222222222222',
    step_id: 'case_directive_approval',
    status: 'pending',
    priority: 1,
    form_schema: [],
    form_data: null,
    sla_deadline: null,
    sla_breached: false,
    claimed_by: null,
    assignee_role: 'legal-cases-manager',
    assignee_id: null,
    metadata: {
      subject_type: 'legal_case',
      source: 'lex_case_intake',
      case_id: '33333333-3333-3333-3333-333333333333',
      case_number: 'CASE-2026-0042',
      submitted_by: '44444444-4444-4444-4444-444444444444',
      submitted_by_name: 'Reem Al-Qahtani',
      doa_authority_ref: 'DOA-2026-001',
    },
    created_at: '2026-07-13T10:00:00Z',
    updated_at: '2026-07-13T10:00:00Z',
    ...overrides,
  };
}

describe('caseTaskToItem', () => {
  it('turns a visible case intake task into an actionable case approval', () => {
    const item = caseTaskToItem(task());

    expect(item).toMatchObject({
      id: 'case:11111111-1111-1111-1111-111111111111',
      kind: 'case',
      title: 'CASE-2026-0042',
      requestedBy: 'Reem Al-Qahtani',
      href: '/lex/cases/33333333-3333-3333-3333-333333333333',
    });
    expect(item?.action).toMatchObject({
      type: 'case',
      approverRole: 'legal-cases-manager',
      evidenceId: 'DOA-2026-001',
    });
  });

  it('falls back to the initiator id and never presents the approver role as requester', () => {
    const item = caseTaskToItem(
      task({
        metadata: {
          subject_type: 'legal_case',
          source: 'lex_case_intake',
          case_id: '33333333-3333-3333-3333-333333333333',
          submitted_by: '44444444-4444-4444-4444-444444444444',
        },
      }),
    );

    expect(item?.requestedBy).toBe('44444444-4444-4444-4444-444444444444');
    expect(item?.requestedBy).not.toBe('legal-cases-manager');
  });

  it('leaves requester blank when initiator metadata is unavailable', () => {
    const item = caseTaskToItem(
      task({
        metadata: {
          subject_type: 'legal_case',
          source: 'lex_case_intake',
          case_id: '33333333-3333-3333-3333-333333333333',
        },
      }),
    );

    expect(item?.requestedBy).toBe('');
    expect(item?.requestedBy).not.toBe('legal-cases-manager');
  });

  it('ignores non-case and completed workflow tasks', () => {
    expect(caseTaskToItem(task({ metadata: { subject_type: 'contract' } }))).toBeNull();
    expect(caseTaskToItem(task({ metadata: { source: 'lex_case_intake' } }))).toBeNull();
    expect(caseTaskToItem(task({ status: 'completed' }))).toBeNull();
  });
});

describe('listVisibleCaseIntakeTasks', () => {
  it('reads the Lex-owned case intake queue rather than workflow-engine tasks', async () => {
    vi.mocked(apiGet).mockResolvedValueOnce({
      data: [],
      meta: { page: 1, per_page: 100, total: 0, total_pages: 1 },
    });

    await listVisibleCaseIntakeTasks();

    expect(apiGet).toHaveBeenCalledWith(API_ENDPOINTS.LEX_CASE_INTAKE_TASKS, {
      page: 1,
      per_page: 100,
    });
    expect(apiGet).not.toHaveBeenCalledWith(API_ENDPOINTS.WORKFLOWS_TASKS, expect.anything());
  });
});

describe('workflowToItem', () => {
  const workflow: LexWorkflowSummary = {
    workflow_instance_id: 'workflow-1',
    task_id: 'task-1',
    contract_id: 'contract-1',
    contract_title: 'Supply agreement',
    contract_status: 'draft',
    workflow_status: 'running',
    started_at: '2026-07-22T10:00:00Z',
    task_status: 'pending',
  };

  it('keeps every actor-scoped open task actionable', () => {
    expect(workflowToItem({ ...workflow, task_status: 'pending' })?.action).toBeDefined();
    expect(workflowToItem({ ...workflow, task_status: 'claimed' })?.action).toBeDefined();
    expect(workflowToItem({ ...workflow, task_status: 'escalated' })?.action).toBeDefined();
  });

  it('rejects closed workflow tasks', () => {
    expect(workflowToItem({ ...workflow, task_status: 'completed' })).toBeNull();
  });
});

describe('inboxSourceAccess', () => {
  it('keeps Contracts Manager tasks on authorized backend sources', () => {
    const permissions = new Set([
      'lex:request:view',
      'lex:contract:view',
      'lex:consultation:view',
      'lex:document:view',
    ]);

    expect(inboxSourceAccess((permission) => permissions.has(permission))).toEqual({
      settlements: false,
      cases: false,
      workflows: true,
      requests: true,
    });
  });

  it('enables case and settlement sources only with their dedicated grants', () => {
    const permissions = new Set([
      'lex:settlement:view',
      'lex:case:approve',
    ]);

    expect(inboxSourceAccess((permission) => permissions.has(permission))).toEqual({
      settlements: true,
      cases: true,
      workflows: false,
      requests: false,
    });
  });
});
