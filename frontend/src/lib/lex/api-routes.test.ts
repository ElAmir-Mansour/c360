import { afterEach, describe, expect, it, vi } from 'vitest';

const {
  apiClientGetMock,
  apiDeleteMock,
  apiGetMock,
  apiPatchMock,
  apiPostMock,
  apiPutMock,
} = vi.hoisted(() => ({
  apiClientGetMock: vi.fn(),
  apiDeleteMock: vi.fn(),
  apiGetMock: vi.fn(),
  apiPatchMock: vi.fn(),
  apiPostMock: vi.fn(),
  apiPutMock: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  default: {
    get: apiClientGetMock,
  },
  apiDelete: apiDeleteMock,
  apiGet: apiGetMock,
  apiPatch: apiPatchMock,
  apiPost: apiPostMock,
  apiPut: apiPutMock,
}));

const {
  lexRequestsApi,
  requestCanHaveApprovalTasks,
  requestCanHaveExecutionState,
} = await import('./requests');
const { casesApi } = await import('./cases');
const { casesControlApi } = await import('./cases-control');
const { investigationsApi } = await import('./investigations');
const { consultationsApi } = await import('./consultations');
const { settlementsApi } = await import('./settlements');
const { lexReportsApi } = await import('./reports');
const {
  createReportDefinition,
  deleteReportDefinition,
  listReportDefinitions,
  updateReportDefinition,
} = await import('./report-builder');
const { lexNotificationsApi } = await import('./notifications');
const { lexAdminApi } = await import('./admin');

const page = { page: 1, per_page: 20, order: 'desc' as const };
const meta = { total: 0, page: 1, per_page: 20, total_pages: 0 };

describe('lex frontend API route coverage', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('routes service desk, intake, SLA, approval, and execution calls under /api/v1/lex', async () => {
    apiGetMock.mockResolvedValue({ data: [], meta });
    apiPostMock.mockResolvedValue({ data: {} });

    await lexRequestsApi.listServices(page);
    await lexRequestsApi.submitIntake({ service_id: 'svc-1' } as never);
    await lexRequestsApi.createRequest({ request_type: 'consultation' } as never);
    await lexRequestsApi.startApproval('req-1');
    await lexRequestsApi.getRequestClock('req-1');
    await lexRequestsApi.confirmCompleteness('req-1', { notes: 'complete' });
    await lexRequestsApi.getRequestFeedback('req-1');
    await lexRequestsApi.submitRequestFeedback('req-1', {
      rating: 5,
      comment: 'Excellent advice',
    });

    expect(apiGetMock).toHaveBeenNthCalledWith(1, '/api/v1/lex/service-catalog', {
      page: 1,
      per_page: 20,
      sort: undefined,
      order: 'desc',
      search: undefined,
    });
    expect(apiPostMock).toHaveBeenNthCalledWith(1, '/api/v1/lex/intake/submit', {
      service_id: 'svc-1',
    });
    expect(apiPostMock).toHaveBeenNthCalledWith(2, '/api/v1/lex/legal-requests', {
      request_type: 'consultation',
    });
    expect(apiPostMock).toHaveBeenNthCalledWith(3, '/api/v1/lex/requests/req-1/approval/start');
    expect(apiGetMock).toHaveBeenNthCalledWith(2, '/api/v1/lex/sla/requests/req-1/clock', undefined);
    expect(apiPostMock).toHaveBeenNthCalledWith(
      4,
      '/api/v1/lex/requests/req-1/execution/confirm-completeness',
      { notes: 'complete' },
    );
    expect(apiGetMock).toHaveBeenNthCalledWith(
      3,
      '/api/v1/lex/legal-requests/req-1/feedback',
      undefined,
    );
    expect(apiPostMock).toHaveBeenNthCalledWith(
      5,
      '/api/v1/lex/legal-requests/req-1/feedback',
      { rating: 5, comment: 'Excellent advice' },
    );
  });

  it('only expects an execution read model once the request enters execution-capable states', () => {
    expect(requestCanHaveExecutionState(undefined)).toBe(false);
    expect(requestCanHaveExecutionState('draft')).toBe(false);
    expect(requestCanHaveExecutionState('submitted')).toBe(false);
    expect(requestCanHaveExecutionState('pending_requester_approval')).toBe(false);
    expect(requestCanHaveExecutionState('pending_provider_approval')).toBe(false);
    expect(requestCanHaveExecutionState('approved')).toBe(false);
    expect(requestCanHaveExecutionState('cancelled')).toBe(false);

    expect(requestCanHaveExecutionState('routed')).toBe(true);
    expect(requestCanHaveExecutionState('in_execution')).toBe(true);
    expect(requestCanHaveExecutionState('delivered')).toBe(true);
    expect(requestCanHaveExecutionState('closed')).toBe(true);
    expect(requestCanHaveExecutionState('returned')).toBe(true);
  });

  it('only expects approval tasks after approval has a workflow instance', () => {
    expect(requestCanHaveApprovalTasks(undefined)).toBe(false);
    expect(requestCanHaveApprovalTasks(null)).toBe(false);
    expect(requestCanHaveApprovalTasks('')).toBe(false);
    expect(requestCanHaveApprovalTasks('   ')).toBe(false);

    expect(requestCanHaveApprovalTasks('workflow-1')).toBe(true);
  });

  it('keeps report definitions on the fixed report-only endpoint', async () => {
    const saved = {
      id: 'report-1',
      name: 'Renewals',
      scope: 'personal',
      payload: {},
    };
    apiGetMock.mockResolvedValue({ data: [saved] });
    apiPostMock.mockResolvedValue({ data: saved });
    apiPutMock.mockResolvedValue({ data: saved });
    apiDeleteMock.mockResolvedValue({ data: { status: 'deleted' } });

    await listReportDefinitions();
    await createReportDefinition({
      name: 'Renewals',
      scope: 'personal',
      payload: {},
    });
    await updateReportDefinition('report-1', { name: 'Renewals Q3' });
    await deleteReportDefinition('report-1');

    expect(apiGetMock).toHaveBeenCalledWith(
      '/api/v1/lex/report-definitions',
      undefined,
    );
    expect(apiPostMock).toHaveBeenCalledWith(
      '/api/v1/lex/report-definitions',
      {
        name: 'Renewals',
        scope: 'personal',
        payload: {},
      },
    );
    expect(apiPutMock).toHaveBeenCalledWith(
      '/api/v1/lex/report-definitions/report-1',
      { name: 'Renewals Q3' },
    );
    expect(apiDeleteMock).toHaveBeenCalledWith(
      '/api/v1/lex/report-definitions/report-1',
    );
  });

  it('requests only approval requests actionable by the signed-in actor', async () => {
    apiGetMock.mockResolvedValue({ data: [], meta });

    await lexRequestsApi.listMyApprovalRequests(page);

    expect(apiGetMock).toHaveBeenCalledWith('/api/v1/lex/legal-requests', {
      page: 1,
      per_page: 20,
      sort: undefined,
      order: 'desc',
      search: undefined,
      approval_mine: true,
    });
  });

  it('routes litigation, plaintiff, and defendant case calls under /api/v1/lex', async () => {
    apiGetMock.mockResolvedValue({ data: [], meta });
    apiPostMock.mockResolvedValue({ data: {} });

    await casesApi.listCases(page);
    await casesApi.createPleading('case-1', {
      type: 'statement_of_claim',
      title: 'Statement',
      body: 'Claim body',
    });
    await casesApi.createExpert('case-1', {
      expert_name: 'Expert',
      specialization: 'Forensics',
      mandate: 'Assess evidence',
    });
    await casesApi.createJudgment('case-1', {
      judgment_ref: 'J-1',
      summary: 'Judgment summary',
    });
    await casesApi.registerDefendant('case-1', { plaintiff_name: 'Claimant' });
    await casesApi.startResponseReview('case-1', 'def-1', {});

    expect(apiGetMock).toHaveBeenCalledWith('/api/v1/lex/legal-cases', {
      page: 1,
      per_page: 20,
      sort: undefined,
      order: 'desc',
      search: undefined,
    });
    expect(apiPostMock).toHaveBeenNthCalledWith(
      1,
      '/api/v1/lex/legal-cases/case-1/pleadings',
      expect.objectContaining({ type: 'statement_of_claim' }),
    );
    expect(apiPostMock).toHaveBeenNthCalledWith(
      2,
      '/api/v1/lex/legal-cases/case-1/experts',
      expect.objectContaining({ expert_name: 'Expert' }),
    );
    expect(apiPostMock).toHaveBeenNthCalledWith(
      3,
      '/api/v1/lex/legal-cases/case-1/judgments',
      expect.objectContaining({ judgment_ref: 'J-1' }),
    );
    expect(apiPostMock).toHaveBeenNthCalledWith(4, '/api/v1/lex/legal-cases/case-1/defendant', {
      plaintiff_name: 'Claimant',
    });
    expect(apiPostMock).toHaveBeenNthCalledWith(
      5,
      '/api/v1/lex/legal-cases/case-1/defendant/def-1/response-review',
      {},
    );
  });

  it('routes the case control panel through its consolidated dashboard endpoint', async () => {
    apiGetMock.mockResolvedValue({ data: {} });

    await casesControlApi.getDashboard();

    expect(apiGetMock).toHaveBeenCalledWith(
      '/api/v1/lex/dashboard/cases-control',
      undefined,
    );
  });

  it('routes investigations and consultations under /api/v1/lex', async () => {
    apiGetMock.mockResolvedValue({ data: [], meta });
    apiPostMock.mockResolvedValue({ data: {} });

    await investigationsApi.list(page);
    await investigationsApi.recordResults('inv-1', { findings: 'Findings' } as never);
    await investigationsApi.startApproval('inv-1', {
      approver_role: 'legal_manager',
      notes: 'Route for review',
    });
    await consultationsApi.list(page);
    await consultationsApi.submit({
      type: 'general',
      title: { ar: 'استشارة', en: 'Consultation' },
      priority: 'medium',
      requester_name: 'Requester',
      question: 'Question',
      tags: [],
    } as never);
    await consultationsApi.respond('consult-1', {
      response: 'Response',
      use_ai: false,
      notes: 'Reviewed',
    });

    expect(apiGetMock).toHaveBeenNthCalledWith(1, '/api/v1/lex/investigations', expect.any(Object));
    expect(apiPostMock).toHaveBeenNthCalledWith(1, '/api/v1/lex/investigations/inv-1/results', {
      findings: 'Findings',
    });
    expect(apiPostMock).toHaveBeenNthCalledWith(
      2,
      '/api/v1/lex/investigations/inv-1/approval/start',
      { approver_role: 'legal_manager', notes: 'Route for review' },
    );
    expect(apiGetMock).toHaveBeenNthCalledWith(2, '/api/v1/lex/consultations', expect.any(Object));
    expect(apiPostMock).toHaveBeenNthCalledWith(
      3,
      '/api/v1/lex/consultations',
      expect.objectContaining({ requester_name: 'Requester' }),
    );
    expect(apiPostMock).toHaveBeenNthCalledWith(
      4,
      '/api/v1/lex/consultations/consult-1/respond',
      expect.objectContaining({ response: 'Response' }),
    );
  });

  it('routes settlements, ADR, and case timeline calls under /api/v1/lex', async () => {
    apiGetMock.mockResolvedValue({ data: [], meta });
    apiPostMock.mockResolvedValue({ data: {} });
    apiPutMock.mockResolvedValue({ data: {} });

    await settlementsApi.list(page);
    await settlementsApi.open({
      matter_id: 'matter-1',
      method: 'reconciliation',
      title: 'Settlement',
      terms: 'Terms',
    });
    await settlementsApi.addRound('settlement-1', {
      proposed_by: 'Legal',
      terms: 'Updated terms',
    });
    await settlementsApi.getTimeline('matter-1');
    await settlementsApi.updateTimeline('matter-1', { estimated_duration_days: 20 });
    await settlementsApi.setExternalHold('matter-1', {
      held: true,
      category: 'court',
      reason: 'Court delay',
    });

    expect(apiGetMock).toHaveBeenNthCalledWith(1, '/api/v1/lex/settlements', expect.any(Object));
    expect(apiPostMock).toHaveBeenNthCalledWith(
      1,
      '/api/v1/lex/settlements',
      expect.objectContaining({ matter_id: 'matter-1' }),
    );
    expect(apiPostMock).toHaveBeenNthCalledWith(
      2,
      '/api/v1/lex/settlements/settlement-1/rounds',
      expect.objectContaining({ proposed_by: 'Legal' }),
    );
    expect(apiGetMock).toHaveBeenNthCalledWith(2, '/api/v1/lex/matters/matter-1/timeline', undefined);
    expect(apiPutMock).toHaveBeenCalledWith('/api/v1/lex/matters/matter-1/timeline', {
      estimated_duration_days: 20,
    });
    expect(apiPostMock).toHaveBeenNthCalledWith(
      3,
      '/api/v1/lex/matters/matter-1/timeline/external-hold',
      expect.objectContaining({ category: 'court' }),
    );
  });

  it('routes reporting, notifications, and legal admin calls under /api/v1/lex', async () => {
    apiClientGetMock.mockResolvedValue({ data: new Blob(['csv']) });
    apiGetMock.mockResolvedValue({ data: [], meta });
    apiPutMock.mockResolvedValue({ data: {} });

    await lexReportsApi.getSlaCompliance({ quarters: 4 });
    await lexReportsApi.exportPerformanceKpisCsv({ department: 'Legal' });
    await lexReportsApi.getDetailedAnalytics({
      from: '2026-01-01',
      to: '2026-07-22',
      priority: 'urgent',
      compare: false,
    });
    await lexReportsApi.exportDetailedAnalyticsXlsx({ department: 'Legal' });
    await lexNotificationsApi.getInboxCounts();
    await lexNotificationsApi.upsertSubscription({
      category: 'case',
      channel: 'in_app',
      enabled: false,
    });
    await lexAdminApi.listWorkingCalendars(page);
    await lexAdminApi.listServiceCatalog(page);
    await lexAdminApi.listSLATargets(page);
    await lexAdminApi.listAttachmentPolicies(page);

    expect(apiGetMock).toHaveBeenNthCalledWith(1, '/api/v1/lex/kpis/sla-compliance', {
      quarters: 4,
    });
    expect(apiClientGetMock).toHaveBeenCalledWith('/api/v1/lex/reports/performance', {
      params: { department: 'Legal', format: 'csv' },
      responseType: 'blob',
    });
    expect(apiGetMock).toHaveBeenNthCalledWith(2, '/api/v1/lex/reports/detailed-analytics', {
      from: '2026-01-01',
      to: '2026-07-22',
      priority: 'urgent',
      compare: false,
    });
    expect(apiClientGetMock).toHaveBeenCalledWith('/api/v1/lex/reports/detailed-analytics', {
      params: { department: 'Legal', format: 'xlsx' },
      responseType: 'blob',
    });
    expect(apiGetMock).toHaveBeenNthCalledWith(
      3,
      '/api/v1/lex/notifications/inbox/counts',
      undefined,
    );
    expect(apiPutMock).toHaveBeenCalledWith('/api/v1/lex/notifications/subscriptions', {
      category: 'case',
      channel: 'in_app',
      enabled: false,
    });
    expect(apiGetMock).toHaveBeenNthCalledWith(4, '/api/v1/lex/working-calendars', expect.any(Object));
    expect(apiGetMock).toHaveBeenNthCalledWith(5, '/api/v1/lex/service-catalog', expect.any(Object));
    expect(apiGetMock).toHaveBeenNthCalledWith(6, '/api/v1/lex/sla/targets', expect.any(Object));
    expect(apiGetMock).toHaveBeenNthCalledWith(
      7,
      '/api/v1/lex/attachment-policies',
      expect.any(Object),
    );
  });
});
