import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api', () => ({
  apiDelete: vi.fn(),
  apiGet: vi.fn(),
  apiPatch: vi.fn(),
  apiPost: vi.fn(),
  apiPut: vi.fn(),
}));

const { apiDelete, apiGet, apiPatch, apiPost, apiPut } = await import('@/lib/api');
const {
  RESPOND_ENDPOINTS,
  changeRespondSeverity,
  createRespondEvidenceExport,
  createRespondStakeholderToken,
  createRespondTask,
  declareRespondIncident,
  executeRespondQuickAction,
  fetchRespondCockpit,
  fetchRespondProduct,
  ingestRespondIntegrationWebhook,
  mobilizeRespondRole,
  parseRespondFieldMappingText,
  releaseRespondRole,
  saveRespondIntegrationConfig,
  syncRespondIntegration,
  transitionRespondIncident,
  updateRespondIncident,
  updateRespondTaskStatus,
} = await import('./respond');

describe('respond api helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('unwraps product and incident declaration envelopes', async () => {
    const product = {
      id: 'respond',
      name: 'Clario Respond',
      entitlement_key: 'respond.major_incident',
      entitlement_state: 'licensed',
      licensed: true,
      capabilities: [],
    };
    const incident = {
      id: 'inc-1',
      tenant_id: 'tenant-1',
      reference: 'RSP-2026-0001',
      title: 'Payments outage',
      description: 'Checkout failures',
      severity: 'SEV2',
      status: 'Declared',
      declared_by: 'user-1',
      declared_at: '2026-06-28T10:00:00Z',
      impacted_services: ['payments'],
      row_version: 1,
      created_at: '2026-06-28T10:00:00Z',
      updated_at: '2026-06-28T10:00:00Z',
    };

    vi.mocked(apiGet).mockResolvedValueOnce({ data: product });
    vi.mocked(apiPost).mockResolvedValueOnce({ data: incident });

    await expect(fetchRespondProduct()).resolves.toEqual(product);
    expect(apiGet).toHaveBeenCalledWith(RESPOND_ENDPOINTS.product, undefined);

    await expect(
      declareRespondIncident({
        title: 'Payments outage',
        description: 'Checkout failures',
        severity: 'SEV2',
        detected_at: '2026-06-28T09:55:00Z',
        impacted_services: ['payments'],
      }),
    ).resolves.toEqual(incident);
    expect(apiPost).toHaveBeenCalledWith(RESPOND_ENDPOINTS.incidents, {
      title: 'Payments outage',
      description: 'Checkout failures',
      severity: 'SEV2',
      detected_at: '2026-06-28T09:55:00Z',
      impacted_services: ['payments'],
    });
  });

  it('encodes incident identifiers and rejects empty Respond path identifiers', async () => {
    vi.mocked(apiGet).mockResolvedValueOnce({ data: { incident: { id: 'tenant/inc' } } });

    await fetchRespondCockpit('tenant/inc');
    expect(apiGet).toHaveBeenCalledWith(
      '/api/v1/respond/incidents/tenant%2Finc/cockpit',
      undefined,
    );

    expect(() => fetchRespondCockpit('')).toThrow(
      'A valid Respond resource identifier is required.',
    );
    expect(() => fetchRespondCockpit(' undefined ')).toThrow(
      'A valid Respond resource identifier is required.',
    );
  });

  it('builds incident update, severity, and transition command paths', async () => {
    vi.mocked(apiPatch).mockResolvedValueOnce({ data: { id: 'inc-1', row_version: 2 } });
    vi.mocked(apiPost)
      .mockResolvedValueOnce({ data: { id: 'inc-1', severity: 'SEV1' } })
      .mockResolvedValueOnce({ data: { id: 'inc-1', status: 'Triaged' } });

    await updateRespondIncident('inc/1', {
      title: 'Updated',
      description: 'Updated description',
      impacted_services: ['core'],
      expected_version: 1,
    });
    expect(apiPatch).toHaveBeenCalledWith('/api/v1/respond/incidents/inc%2F1', {
      title: 'Updated',
      description: 'Updated description',
      impacted_services: ['core'],
      expected_version: 1,
    });

    await changeRespondSeverity('inc/1', { severity: 'SEV1', expected_version: 2 });
    expect(apiPost).toHaveBeenNthCalledWith(1, '/api/v1/respond/incidents/inc%2F1/severity', {
      severity: 'SEV1',
      expected_version: 2,
    });

    await transitionRespondIncident('inc/1', { to: 'Triaged', expected_version: 3 });
    expect(apiPost).toHaveBeenNthCalledWith(
      2,
      '/api/v1/respond/incidents/inc%2F1/transitions',
      { to: 'Triaged', expected_version: 3 },
    );
  });

  it('builds stakeholder token and later prompt endpoint paths', async () => {
    vi.mocked(apiPost)
      .mockResolvedValueOnce({ data: { id: 'token-1', url_path: '/respond/stakeholder/t' } })
      .mockResolvedValueOnce({ data: { id: 'task-1' } })
      .mockResolvedValueOnce({ data: { id: 'cfg-1' } })
      .mockResolvedValueOnce({ data: { id: 'export-1', format: 'pdf' } });
    vi.mocked(apiPatch).mockResolvedValueOnce({ data: { id: 'task-1', status: 'completed' } });

    await createRespondStakeholderToken('inc/1', {
      expires_at: '2026-06-29T10:00:00Z',
      next_update_at: '2026-06-28T11:00:00Z',
    });
    expect(apiPost).toHaveBeenNthCalledWith(
      1,
      '/api/v1/respond/incidents/inc%2F1/stakeholder-tokens',
      {
        expires_at: '2026-06-29T10:00:00Z',
        next_update_at: '2026-06-28T11:00:00Z',
      },
    );

    await createRespondTask('inc/1', { title: 'Restart gateway' });
    expect(apiPost).toHaveBeenNthCalledWith(2, '/api/v1/respond/incidents/inc%2F1/tasks', {
      title: 'Restart gateway',
    });

    await updateRespondTaskStatus('inc/1', 'task/1', { status: 'completed' });
    expect(apiPatch).toHaveBeenCalledWith(
      '/api/v1/respond/incidents/inc%2F1/tasks/task%2F1/status',
      { status: 'completed' },
    );

    await saveRespondIntegrationConfig({
      name: 'ServiceNow incidents',
      provider: 'servicenow',
      connector_type: 'itsm',
      endpoint_url: 'https://example.service-now.test',
      config: { username: 'svc-respond', auth_type: 'basic' },
      field_mapping: { short_description: 'title' },
      secrets: [{ name: 'password', secret_ref: 'env://SERVICENOW_PASSWORD' }],
    });
    expect(apiPost).toHaveBeenNthCalledWith(3, '/api/v1/respond/integrations/connectors', {
      name: 'ServiceNow incidents',
      provider: 'servicenow',
      endpoint_url: 'https://example.service-now.test',
      config: { username: 'svc-respond', auth_type: 'basic' },
      field_mapping: { short_description: 'title' },
      secrets: [{ name: 'password', secret_ref: 'env://SERVICENOW_PASSWORD' }],
      kind: 'itsm',
    });

    await createRespondEvidenceExport('inc/1', { format: 'pdf' });
    expect(apiPost).toHaveBeenNthCalledWith(
      4,
      '/api/v1/respond/incidents/inc%2F1/evidence-exports',
      { format: 'pdf' },
    );
  });

  it('builds role release, integration sync, and webhook endpoint paths', async () => {
    vi.mocked(apiDelete).mockResolvedValueOnce({ data: { id: 'role-1' } });
    vi.mocked(apiPost)
      .mockResolvedValueOnce({ data: { id: 'role-1' } })
      .mockResolvedValueOnce({ data: { provider: 'servicenow', sync_state: 'succeeded' } })
      .mockResolvedValueOnce({ data: { provider: 'servicenow', sync_state: 'succeeded' } });

    await releaseRespondRole('inc/1', 'role/1');
    expect(apiDelete).toHaveBeenCalledWith('/api/v1/respond/incidents/inc%2F1/roles/role%2F1');

    await mobilizeRespondRole('inc/1', {
      role_assignment_id: 'role/1',
      channels: ['email'],
      escalation_window_minutes: 15,
    });
    expect(apiPost).toHaveBeenNthCalledWith(
      1,
      '/api/v1/respond/incidents/inc%2F1/roles/role%2F1/mobilize',
      {
        role_assignment_id: 'role/1',
        channels: ['email'],
        escalation_window_minutes: 15,
      },
    );

    await syncRespondIntegration('inc/1', {
      connector_id: 'conn/1',
      action: 'update',
      message: 'operator requested sync',
    });
    expect(apiPost).toHaveBeenNthCalledWith(
      2,
      '/api/v1/respond/incidents/inc%2F1/integrations/conn%2F1/sync',
      {
        action: 'update',
        message: 'operator requested sync',
      },
    );

    await ingestRespondIntegrationWebhook({
      tenant_id: 'tenant/1',
      connector_id: 'conn/1',
      event_id: 'evt-1',
      headers: { 'x-signature': 'sig' },
      body: { state: 'resolved' },
    });
    expect(apiPost).toHaveBeenNthCalledWith(
      3,
      '/api/v1/respond/integrations/webhooks/tenant%2F1/conn%2F1',
      { state: 'resolved' },
    );
  });

  it('normalizes Respond field mapping text for connector config payloads', () => {
    expect(
      parseRespondFieldMappingText(`
        incident_number = reference
        short_description=title
        ignored_without_target=
        =ignored_without_source
        detail = description=with equals
      `),
    ).toEqual({
      incident_number: 'reference',
      short_description: 'title',
      detail: 'description=with equals',
    });
  });

  it('executes returned quick actions with the declared HTTP method', async () => {
    vi.mocked(apiPost).mockResolvedValueOnce(undefined);
    vi.mocked(apiPut).mockResolvedValueOnce(undefined);
    vi.mocked(apiPatch).mockResolvedValueOnce(undefined);
    vi.mocked(apiDelete).mockResolvedValueOnce(undefined);

    await executeRespondQuickAction({
      id: 'post',
      label: 'Post',
      endpoint: '/api/v1/respond/incidents/inc-1/transitions',
      method: 'POST',
      payload: { to: 'Triaged' },
      enabled: true,
    });
    await executeRespondQuickAction({
      id: 'put',
      label: 'Put',
      endpoint: '/api/v1/respond/incidents/inc-1/tasks/order',
      method: 'PUT',
      payload: { task_ids: [] },
      enabled: true,
    });
    await executeRespondQuickAction({
      id: 'patch',
      label: 'Patch',
      endpoint: '/api/v1/respond/incidents/inc-1',
      method: 'PATCH',
      payload: { title: 'Updated' },
      enabled: true,
    });
    await executeRespondQuickAction({
      id: 'delete',
      label: 'Delete',
      endpoint: '/api/v1/respond/incidents/inc-1/tasks/task-1',
      method: 'DELETE',
      enabled: true,
    });

    expect(apiPost).toHaveBeenCalledWith('/api/v1/respond/incidents/inc-1/transitions', {
      to: 'Triaged',
    });
    expect(apiPut).toHaveBeenCalledWith('/api/v1/respond/incidents/inc-1/tasks/order', {
      task_ids: [],
    });
    expect(apiPatch).toHaveBeenCalledWith('/api/v1/respond/incidents/inc-1', {
      title: 'Updated',
    });
    expect(apiDelete).toHaveBeenCalledWith('/api/v1/respond/incidents/inc-1/tasks/task-1');
  });
});
