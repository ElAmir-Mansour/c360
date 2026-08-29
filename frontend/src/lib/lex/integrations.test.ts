/**
 * Unit tests for the Lex Integration Platform client + its pure helpers.
 *
 * Mirrors `request-approval-policies.test.ts`: `@/lib/api` is mocked at the
 * source so we can assert (a) every method hits the expected
 * `/api/v1/lex/integrations/...` URL with the right params, (b) the correct
 * envelope is unwrapped, (c) read helpers DEGRADE GRACEFULLY (return
 * [] / null on failure) while mutating helpers SURFACE the error, and
 * (d) the secret-safety contract: the redaction sentinel is passed through
 * unchanged on update and a real secret value never leaks into a log/return.
 *
 * The raw axios `default` instance is mocked too (the sync helpers call it
 * directly to read the structured 409 mass-change guard body).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { apiDeleteMock, apiGetMock, apiPostMock, apiPutMock, axiosPostMock } = vi.hoisted(
  () => ({
    apiDeleteMock: vi.fn(),
    apiGetMock: vi.fn(),
    apiPostMock: vi.fn(),
    apiPutMock: vi.fn(),
    axiosPostMock: vi.fn(),
  }),
);

vi.mock('@/lib/api', () => ({
  default: { post: axiosPostMock },
  apiDelete: apiDeleteMock,
  apiGet: apiGetMock,
  apiPost: apiPostMock,
  apiPut: apiPutMock,
}));

const mod = await import('./integrations');
const {
  lexIntegrationsApi,
  REDACTED_SENTINEL,
  isRedacted,
  isSecretRef,
  secretRefProvider,
  deriveHealthGrade,
  parseCustomSpec,
  parseSyncRules,
  emptyCustomSpec,
  CUSTOM_SPEC_CONFIG_KEY,
} = mod;

const BASE = '/api/v1/lex/integrations';

afterEach(() => {
  vi.clearAllMocks();
});

/* ─────────────────────────── pure helpers ─────────────────────────── */

describe('isRedacted', () => {
  it('is true only for the exact sentinel string', () => {
    expect(isRedacted(REDACTED_SENTINEL)).toBe(true);
    expect(isRedacted('__redacted__')).toBe(true);
    expect(isRedacted('real-secret')).toBe(false);
    expect(isRedacted('')).toBe(false);
    expect(isRedacted(undefined)).toBe(false);
    expect(isRedacted(null)).toBe(false);
    expect(isRedacted(123)).toBe(false);
  });
});

describe('isSecretRef / secretRefProvider', () => {
  it('detects kms:// and vault:// references (safe to display)', () => {
    expect(isSecretRef('kms://alias/lex-najiz')).toBe(true);
    expect(isSecretRef('vault://secret/lex#client_secret')).toBe(true);
    expect(isSecretRef('plain-secret')).toBe(false);
    expect(isSecretRef(REDACTED_SENTINEL)).toBe(false);
    expect(isSecretRef(undefined)).toBe(false);
    expect(isSecretRef(42)).toBe(false);
  });

  it('infers the provider, defaulting to none', () => {
    expect(secretRefProvider('kms://k')).toBe('kms');
    expect(secretRefProvider('vault://p#f')).toBe('vault');
    expect(secretRefProvider('literal')).toBe('none');
    expect(secretRefProvider(undefined)).toBe('none');
  });
});

describe('deriveHealthGrade', () => {
  it('prefers an explicit wire grade when valid', () => {
    expect(
      deriveHealthGrade({ status: 'active', last_error: null, health_grade: 'down' }),
    ).toBe('down');
  });

  it('maps status → grade when no wire grade', () => {
    expect(deriveHealthGrade({ status: 'planned', last_error: null })).toBe('unconfigured');
    expect(deriveHealthGrade({ status: 'disabled', last_error: null })).toBe('disabled');
    expect(deriveHealthGrade({ status: 'error', last_error: 'boom' })).toBe('down');
    expect(deriveHealthGrade({ status: 'active', last_error: null })).toBe('healthy');
    expect(deriveHealthGrade({ status: 'active', last_error: 'recent' })).toBe('degraded');
  });

  it('folds in a fresh probe for active endpoints', () => {
    expect(
      deriveHealthGrade({ status: 'active', last_error: null }, { reachable: false }),
    ).toBe('degraded');
    expect(
      deriveHealthGrade({ status: 'active', last_error: 'x' }, { reachable: true }),
    ).toBe('healthy');
  });
});

describe('parseCustomSpec', () => {
  it('returns a pristine default for empty / invalid input (never throws)', () => {
    expect(parseCustomSpec(undefined)).toEqual(emptyCustomSpec());
    expect(parseCustomSpec('')).toEqual(emptyCustomSpec());
    expect(parseCustomSpec('   ')).toEqual(emptyCustomSpec());
    expect(parseCustomSpec('not-json{')).toEqual(emptyCustomSpec());
    expect(parseCustomSpec([1, 2, 3])).toEqual(emptyCustomSpec());
    expect(parseCustomSpec(42)).toEqual(emptyCustomSpec());
  });

  it('parses a JSON string and folds missing branches from the default', () => {
    const spec = parseCustomSpec(
      JSON.stringify({ base_url: 'https://api.x', request: { method: 'POST', path: '/v1' } }),
    );
    expect(spec.base_url).toBe('https://api.x');
    expect(spec.request.method).toBe('POST');
    expect(spec.request.path).toBe('/v1');
    // missing branches come from the default
    expect(spec.auth).toEqual({ type: 'none' });
    expect(spec.pagination).toEqual({ type: 'none', param: '' });
    expect(spec.request.headers).toEqual({});
  });

  it('accepts an already-parsed object', () => {
    const spec = parseCustomSpec({ base_url: 'https://obj', auth: { type: 'bearer' } });
    expect(spec.base_url).toBe('https://obj');
    expect(spec.auth.type).toBe('bearer');
  });
});

describe('parseSyncRules', () => {
  it('returns [] for empty / non-array input (never throws)', () => {
    expect(parseSyncRules(undefined)).toEqual([]);
    expect(parseSyncRules('')).toEqual([]);
    expect(parseSyncRules('bad json')).toEqual([]);
    expect(parseSyncRules({ not: 'array' })).toEqual([]);
  });

  it('normalizes rule shape from a JSON string, defaulting op by type', () => {
    const rules = parseSyncRules(
      JSON.stringify([
        { type: 'filter', field: 'status' },
        { type: 'transform', op: 'concat', field: 'name', args: ['a', 'b'] },
        { type: 'weird', field: 7 },
      ]),
    );
    expect(rules[0]).toEqual({ type: 'filter', op: 'eq', field: 'status', args: [] });
    expect(rules[1]).toEqual({
      type: 'transform',
      op: 'concat',
      field: 'name',
      args: ['a', 'b'],
    });
    // unknown type collapses to transform with default op + stringified args
    expect(rules[2].type).toBe('transform');
    expect(rules[2].op).toBe('default');
    expect(rules[2].field).toBe('');
  });
});

/* ─────────────────────── list / param building ─────────────────────── */

describe('listIntegrations', () => {
  it('builds kind/status params and unwraps a {data:[]} list', async () => {
    apiGetMock.mockResolvedValue({ data: [{ id: 'e1' }, { id: 'e2' }] });
    const out = await lexIntegrationsApi.listIntegrationsResult({ kind: 'najiz', status: 'active' });
    expect(apiGetMock).toHaveBeenCalledWith(BASE, { kind: 'najiz', status: 'active' });
    expect(out).toEqual({ endpoints: [{ id: 'e1' }, { id: 'e2' }], degraded: false });
  });

  it('omits params when no filters and marks the result degraded on failure', async () => {
    apiGetMock.mockRejectedValue(new Error('boom'));
    const out = await lexIntegrationsApi.listIntegrationsResult();
    expect(apiGetMock).toHaveBeenCalledWith(BASE, {});
    expect(out).toEqual({ endpoints: [], degraded: true });
  });

  it('marks malformed registry envelopes degraded instead of treating them as empty success', async () => {
    apiGetMock.mockResolvedValue({ data: null });
    await expect(lexIntegrationsApi.listIntegrationsResult()).resolves.toEqual({
      endpoints: [],
      degraded: true,
    });
  });

  it('accepts a bare array defensively', async () => {
    apiGetMock.mockResolvedValue([{ id: 'e1' }]);
    expect(await lexIntegrationsApi.listIntegrationsResult()).toEqual({
      endpoints: [{ id: 'e1' }],
      degraded: false,
    });
  });

  it('keeps the legacy array helper for existing callers', async () => {
    apiGetMock.mockResolvedValue({ data: [{ id: 'e1' }] });
    await expect(lexIntegrationsApi.listIntegrations()).resolves.toEqual([{ id: 'e1' }]);
  });
});

describe('getIntegration', () => {
  it('unwraps {data} for a singleton', async () => {
    apiGetMock.mockResolvedValue({ data: { id: 'e1', kind: 'najiz' } });
    const out = await lexIntegrationsApi.getIntegration('e1');
    expect(apiGetMock).toHaveBeenCalledWith(`${BASE}/e1`);
    expect(out.id).toBe('e1');
  });

  it('THROWS (not graceful) when the body is empty so the page can 404', async () => {
    apiGetMock.mockResolvedValue({});
    await expect(lexIntegrationsApi.getIntegration('missing')).rejects.toThrow();
  });
});

describe('getSchema', () => {
  it('returns the fields array and degrades to [] for an unknown kind', async () => {
    apiGetMock.mockResolvedValueOnce({ data: { kind: 'najiz', fields: [{ key: 'token' }] } });
    expect(await lexIntegrationsApi.getSchema('najiz')).toEqual([{ key: 'token' }]);

    apiGetMock.mockRejectedValueOnce(new Error('404'));
    expect(await lexIntegrationsApi.getSchema('custom')).toEqual([]);
  });
});

/* ───────────────────── secret-safety contract ───────────────────── */

describe('secret safety on update', () => {
  it('passes the redaction sentinel THROUGH unchanged (keeps stored secret)', async () => {
    apiPutMock.mockResolvedValue({ data: { id: 'e1' } });
    await lexIntegrationsApi.updateIntegration('e1', {
      config: { client_secret: REDACTED_SENTINEL, base_url: 'https://x' },
    });
    const [, body] = apiPutMock.mock.calls[0];
    // The sentinel is forwarded verbatim — NOT stripped, NOT replaced with a value.
    expect(body.config.client_secret).toBe(REDACTED_SENTINEL);
    expect(body.config.base_url).toBe('https://x');
  });

  it('rotateSecret never echoes the secret back; result stays masked', async () => {
    // The backend returns the endpoint with the secret STILL the sentinel.
    apiPostMock.mockResolvedValue({
      data: { id: 'e1', config: { client_secret: REDACTED_SENTINEL } },
    });
    const out = await lexIntegrationsApi.rotateSecret('e1', 'client_secret', 'super-secret-value');
    expect(apiPostMock).toHaveBeenCalledWith(
      `${BASE}/e1/secrets/client_secret/rotate`,
      { value: 'super-secret-value' },
    );
    // The returned endpoint NEVER carries the cleartext secret.
    const serialized = JSON.stringify(out);
    expect(serialized).not.toContain('super-secret-value');
    expect(out.config.client_secret).toBe(REDACTED_SENTINEL);
  });

  it('URL-encodes the field name in the rotate path', async () => {
    apiPostMock.mockResolvedValue({ data: { id: 'e1' } });
    await lexIntegrationsApi.rotateSecret('e1', 'odd field/name', 'v');
    expect(apiPostMock).toHaveBeenCalledWith(
      `${BASE}/e1/secrets/odd%20field%2Fname/rotate`,
      { value: 'v' },
    );
  });
});

/* ───────────────────── mutating helpers SURFACE errors ───────────────────── */

describe('mutating helpers surface errors (no graceful swallow)', () => {
  it('createIntegration rejects on failure', async () => {
    apiPostMock.mockRejectedValue(new Error('409 conflict'));
    await expect(
      lexIntegrationsApi.createIntegration({
        kind: 'custom',
        code: 'c',
        name: 'n',
        config: {},
      }),
    ).rejects.toThrow('409 conflict');
  });

  it('deleteIntegration rejects on failure', async () => {
    apiDeleteMock.mockRejectedValue(new Error('boom'));
    await expect(lexIntegrationsApi.deleteIntegration('e1')).rejects.toThrow('boom');
  });

  it('testConnection rejects on failure', async () => {
    apiPostMock.mockRejectedValue(new Error('422 unsupported'));
    await expect(lexIntegrationsApi.testConnection('e1')).rejects.toThrow('422 unsupported');
  });
});

/* ───────────────────── sync + mass-change guard (409) ───────────────────── */

describe('syncNow / previewSync — mass-change guard', () => {
  it('returns {guarded:false, report} on success and builds the mode query', async () => {
    axiosPostMock.mockResolvedValue({ data: { data: { mode: 'delta', processed: 5 } } });
    const out = await lexIntegrationsApi.syncNow('e1', 'delta');
    expect(axiosPostMock).toHaveBeenCalledWith(`${BASE}/e1/sync?mode=delta`);
    expect(out).toEqual({ guarded: false, report: { mode: 'delta', processed: 5 } });
  });

  it('appends &force=true when forced', async () => {
    axiosPostMock.mockResolvedValue({ data: { data: { mode: 'full' } } });
    await lexIntegrationsApi.syncNow('e1', 'full', true);
    expect(axiosPostMock).toHaveBeenCalledWith(`${BASE}/e1/sync?mode=full&force=true`);
  });

  it('normalizes a 409 axios error into a {guarded:true, guard} summary', async () => {
    axiosPostMock.mockRejectedValue({
      response: {
        status: 409,
        data: { would_deactivate: 30, mapped_total: 100, pct: 30, threshold_pct: 20 },
      },
    });
    const out = await lexIntegrationsApi.syncNow('e1');
    expect(out).toEqual({
      guarded: true,
      guard: { would_deactivate: 30, mapped_total: 100, pct: 30, threshold_pct: 20, detail: undefined },
    });
  });

  it('reads the guard summary nested under data / guard', async () => {
    axiosPostMock.mockRejectedValue({
      response: { status: 409, data: { guard: { would_deactivate: 7, percent: 12 } } },
    });
    const out = await lexIntegrationsApi.syncNow('e1');
    expect(out.guarded).toBe(true);
    if (out.guarded) {
      expect(out.guard.would_deactivate).toBe(7);
      expect(out.guard.pct).toBe(12);
    }
  });

  it('RE-THROWS non-409 errors so the caller can toast', async () => {
    axiosPostMock.mockRejectedValue({ response: { status: 500 } });
    await expect(lexIntegrationsApi.syncNow('e1')).rejects.toBeDefined();
  });

  it('previewSync sends mode=preview', async () => {
    axiosPostMock.mockResolvedValue({ data: { data: { mode: 'delta' } } });
    await lexIntegrationsApi.previewSync('e1');
    expect(axiosPostMock).toHaveBeenCalledWith(`${BASE}/e1/sync?mode=preview`);
  });
});

/* ───────────────────── propose change discrimination ───────────────────── */

describe('proposeChange', () => {
  it('returns {applied:false, pending} when the body carries a diff array', async () => {
    apiPostMock.mockResolvedValue({
      data: { id: 'pc1', diff: [{ field: 'token', secret: true }], status: 'pending' },
    });
    const out = await lexIntegrationsApi.proposeChange('e1', { token: 'x' });
    expect(out.applied).toBe(false);
    if (!out.applied) expect(out.pending.id).toBe('pc1');
  });

  it('returns {applied:true, endpoint} for an immediate apply', async () => {
    apiPostMock.mockResolvedValue({ data: { id: 'e1', kind: 'custom' } });
    const out = await lexIntegrationsApi.proposeChange('e1', { foo: 'bar' });
    expect(out.applied).toBe(true);
    if (out.applied) expect(out.endpoint.id).toBe('e1');
  });
});

/* ───────────────────── graceful reads return defaults ───────────────────── */

describe('graceful read helpers return safe defaults on failure', () => {
  beforeEach(() => {
    apiGetMock.mockRejectedValue(new Error('down'));
  });

  it('getIntegrationsHealth → []', async () => {
    expect(await lexIntegrationsApi.getIntegrationsHealth()).toEqual([]);
  });
  it('getIntegrationsHealthResult marks the aggregate read degraded', async () => {
    expect(await lexIntegrationsApi.getIntegrationsHealthResult()).toEqual({
      health: [],
      degraded: true,
    });
  });
  it('getIntegrationHealth → null', async () => {
    expect(await lexIntegrationsApi.getIntegrationHealth('e1')).toBeNull();
  });
  it('listSyncRuns → []', async () => {
    expect(await lexIntegrationsApi.listSyncRuns('e1')).toEqual([]);
  });
  it('listSyncRunsResult marks the ledger read degraded', async () => {
    expect(await lexIntegrationsApi.listSyncRunsResult('e1')).toEqual({
      runs: [],
      degraded: true,
    });
  });
  it('getCatalog → []', async () => {
    expect(await lexIntegrationsApi.getCatalog()).toEqual([]);
  });
  it('getCatalogResult marks the catalog read degraded', async () => {
    expect(await lexIntegrationsApi.getCatalogResult()).toEqual({
      entries: [],
      degraded: true,
    });
  });
  it('getBreaker → null', async () => {
    expect(await lexIntegrationsApi.getBreaker('e1')).toBeNull();
  });
  it('getPendingChanges → []', async () => {
    expect(await lexIntegrationsApi.getPendingChanges()).toEqual([]);
  });
  it('getPendingChangesResult marks the queue read degraded', async () => {
    expect(await lexIntegrationsApi.getPendingChangesResult()).toEqual({
      changes: [],
      degraded: true,
    });
  });
  it('getDlq / getDlqAll → []', async () => {
    expect(await lexIntegrationsApi.getDlq('e1')).toEqual([]);
    expect(await lexIntegrationsApi.getDlqAll()).toEqual([]);
  });
  it('getDlqResult / getDlqAllResult mark DLQ reads degraded', async () => {
    expect(await lexIntegrationsApi.getDlqResult('e1')).toEqual({
      entries: [],
      degraded: true,
    });
    expect(await lexIntegrationsApi.getDlqAllResult()).toEqual({
      entries: [],
      degraded: true,
    });
  });
  it('getEgressPolicy → null', async () => {
    expect(await lexIntegrationsApi.getEgressPolicy('e1')).toBeNull();
  });
  it('getMetrics → null', async () => {
    expect(await lexIntegrationsApi.getMetrics('e1')).toBeNull();
  });
  it('getReconciliation → empty report', async () => {
    expect(await lexIntegrationsApi.getReconciliation('e1')).toEqual({
      gaps: [],
      conflicts: [],
      summary: {},
    });
  });
  it('getReconciliationResult marks the reconciliation read degraded', async () => {
    expect(await lexIntegrationsApi.getReconciliationResult('e1')).toEqual({
      report: { gaps: [], conflicts: [], summary: {} },
      degraded: true,
    });
  });
  it('getConflicts → []', async () => {
    expect(await lexIntegrationsApi.getConflicts('e1')).toEqual([]);
  });
  it('getConflictsResult marks the conflicts read degraded', async () => {
    expect(await lexIntegrationsApi.getConflictsResult('e1')).toEqual({
      conflicts: [],
      degraded: true,
    });
  });
  it('getActivity → []', async () => {
    expect(await lexIntegrationsApi.getActivity('e1')).toEqual([]);
  });
  it('getActivityResult marks the activity read degraded', async () => {
    expect(await lexIntegrationsApi.getActivityResult('e1')).toEqual({
      entries: [],
      degraded: true,
    });
  });
  it('getHealthHistory → []', async () => {
    expect(await lexIntegrationsApi.getHealthHistory('e1')).toEqual([]);
  });
  it('getHealthHistoryResult marks the health-history read degraded', async () => {
    expect(await lexIntegrationsApi.getHealthHistoryResult('e1')).toEqual({
      records: [],
      degraded: true,
    });
  });
  it('getEvents / getEventsAll → []', async () => {
    expect(await lexIntegrationsApi.getEvents('e1')).toEqual([]);
    expect(await lexIntegrationsApi.getEventsAll()).toEqual([]);
  });
  it('getEventsResult / getEventsAllResult mark event reads degraded', async () => {
    expect(await lexIntegrationsApi.getEventsResult('e1')).toEqual({
      events: [],
      degraded: true,
    });
    expect(await lexIntegrationsApi.getEventsAllResult()).toEqual({
      events: [],
      degraded: true,
    });
  });
});

describe('sync/catalog/detail result helpers', () => {
  it('distinguishes genuine empty sync ledgers from malformed reads', async () => {
    apiGetMock.mockResolvedValueOnce({ data: [] });
    await expect(lexIntegrationsApi.listSyncRunsResult('e1', 25)).resolves.toEqual({
      runs: [],
      degraded: false,
    });
    expect(apiGetMock).toHaveBeenCalledWith(`${BASE}/e1/sync-runs`, { limit: 25 });

    apiGetMock.mockResolvedValueOnce({ data: null });
    await expect(lexIntegrationsApi.listSyncRunsResult('e1')).resolves.toEqual({
      runs: [],
      degraded: true,
    });

    apiGetMock.mockResolvedValueOnce({ data: [{ id: 'run-1' }] });
    await expect(lexIntegrationsApi.listSyncRuns('e1')).resolves.toEqual([{ id: 'run-1' }]);
  });

  it('distinguishes genuine empty catalogs from malformed reads', async () => {
    apiGetMock.mockResolvedValueOnce({ data: [] });
    await expect(lexIntegrationsApi.getCatalogResult()).resolves.toEqual({
      entries: [],
      degraded: false,
    });
    expect(apiGetMock).toHaveBeenCalledWith(`${BASE}/catalog`);

    apiGetMock.mockResolvedValueOnce({ data: null });
    await expect(lexIntegrationsApi.getCatalogResult()).resolves.toEqual({
      entries: [],
      degraded: true,
    });

    apiGetMock.mockResolvedValueOnce({ data: [{ kind: 'email' }] });
    await expect(lexIntegrationsApi.getCatalog()).resolves.toEqual([{ kind: 'email' }]);
  });

  it('distinguishes a clean reconciliation report from malformed reads', async () => {
    apiGetMock.mockResolvedValueOnce({
      data: { gaps: [], conflicts: [], summary: { checked: 0 } },
    });
    await expect(lexIntegrationsApi.getReconciliationResult('e1')).resolves.toEqual({
      report: { gaps: [], conflicts: [], summary: { checked: 0 } },
      degraded: false,
    });
    expect(apiGetMock).toHaveBeenCalledWith(`${BASE}/e1/reconciliation`);

    apiGetMock.mockResolvedValueOnce({ data: { gaps: [], summary: {} } });
    await expect(lexIntegrationsApi.getReconciliationResult('e1')).resolves.toEqual({
      report: { gaps: [], conflicts: [], summary: {} },
      degraded: true,
    });

    apiGetMock.mockResolvedValueOnce({
      data: { gaps: [{ external_id: 'EXT-1' }], conflicts: [], summary: {} },
    });
    await expect(lexIntegrationsApi.getReconciliation('e1')).resolves.toEqual({
      gaps: [{ external_id: 'EXT-1' }],
      conflicts: [],
      summary: {},
    });
  });

  it('distinguishes empty conflict and activity lists from malformed reads', async () => {
    apiGetMock.mockResolvedValueOnce({ data: [] });
    await expect(lexIntegrationsApi.getConflictsResult('e1')).resolves.toEqual({
      conflicts: [],
      degraded: false,
    });
    expect(apiGetMock).toHaveBeenCalledWith(`${BASE}/e1/conflicts`);

    apiGetMock.mockResolvedValueOnce({ data: null });
    await expect(lexIntegrationsApi.getConflictsResult('e1')).resolves.toEqual({
      conflicts: [],
      degraded: true,
    });

    apiGetMock.mockResolvedValueOnce({ data: [] });
    await expect(lexIntegrationsApi.getActivityResult('e1')).resolves.toEqual({
      entries: [],
      degraded: false,
    });
    expect(apiGetMock).toHaveBeenCalledWith(`${BASE}/e1/activity`);

    apiGetMock.mockResolvedValueOnce({ data: null });
    await expect(lexIntegrationsApi.getActivityResult('e1')).resolves.toEqual({
      entries: [],
      degraded: true,
    });
  });

  it('distinguishes empty health history from malformed reads and keeps the legacy wrapper', async () => {
    apiGetMock.mockResolvedValueOnce({ data: [] });
    await expect(lexIntegrationsApi.getHealthHistoryResult('e1', 12)).resolves.toEqual({
      records: [],
      degraded: false,
    });
    expect(apiGetMock).toHaveBeenCalledWith(`${BASE}/e1/health-history`, { limit: 12 });

    apiGetMock.mockResolvedValueOnce({ data: null });
    await expect(lexIntegrationsApi.getHealthHistoryResult('e1')).resolves.toEqual({
      records: [],
      degraded: true,
    });

    apiGetMock.mockResolvedValueOnce({ data: [{ checked_at: '2026-06-20T10:00:00Z' }] });
    await expect(lexIntegrationsApi.getHealthHistory('e1')).resolves.toEqual([
      { checked_at: '2026-06-20T10:00:00Z' },
    ]);
  });
});

describe('DLQ result helpers', () => {
  it('distinguish genuine empty queues from failed or malformed reads', async () => {
    apiGetMock.mockResolvedValueOnce({ data: [] });
    await expect(lexIntegrationsApi.getDlqResult('e1')).resolves.toEqual({
      entries: [],
      degraded: false,
    });
    expect(apiGetMock).toHaveBeenCalledWith(`${BASE}/e1/dlq`);

    apiGetMock.mockResolvedValueOnce({ data: null });
    await expect(lexIntegrationsApi.getDlqResult('e1')).resolves.toEqual({
      entries: [],
      degraded: true,
    });

    apiGetMock.mockRejectedValueOnce(new Error('down'));
    await expect(lexIntegrationsApi.getDlqResult('e1')).resolves.toEqual({
      entries: [],
      degraded: true,
    });
  });

  it('covers tenant-wide DLQ reads and preserves legacy array wrappers', async () => {
    apiGetMock.mockResolvedValueOnce({ data: [{ id: 'dlq-1' }] });
    await expect(lexIntegrationsApi.getDlqAllResult()).resolves.toEqual({
      entries: [{ id: 'dlq-1' }],
      degraded: false,
    });
    expect(apiGetMock).toHaveBeenCalledWith(`${BASE}/dlq`);

    apiGetMock.mockResolvedValueOnce({ data: [{ id: 'dlq-2' }] });
    await expect(lexIntegrationsApi.getDlq('e1')).resolves.toEqual([{ id: 'dlq-2' }]);
  });
});

describe('getPendingChangesResult', () => {
  it('distinguishes a genuine empty queue from failed or malformed reads', async () => {
    apiGetMock.mockResolvedValueOnce({ data: [] });
    await expect(lexIntegrationsApi.getPendingChangesResult()).resolves.toEqual({
      changes: [],
      degraded: false,
    });
    expect(apiGetMock).toHaveBeenCalledWith(`${BASE}/pending-changes`);

    apiGetMock.mockResolvedValueOnce({ data: null });
    await expect(lexIntegrationsApi.getPendingChangesResult()).resolves.toEqual({
      changes: [],
      degraded: true,
    });

    apiGetMock.mockRejectedValueOnce(new Error('down'));
    await expect(lexIntegrationsApi.getPendingChangesResult()).resolves.toEqual({
      changes: [],
      degraded: true,
    });
  });

  it('keeps the legacy array helper for existing callers', async () => {
    apiGetMock.mockResolvedValue({ data: [{ id: 'change-1' }] });
    await expect(lexIntegrationsApi.getPendingChanges()).resolves.toEqual([
      { id: 'change-1' },
    ]);
  });
});

describe('event inspector param building', () => {
  it('builds direction/kind/status/limit params', async () => {
    apiGetMock.mockResolvedValue({ data: [] });
    await lexIntegrationsApi.getEvents('e1', {
      direction: 'inbound',
      kind: 'hearing.updated',
      status: 'failed',
      limit: 10,
    });
    expect(apiGetMock).toHaveBeenCalledWith(`${BASE}/e1/events`, {
      direction: 'inbound',
      kind: 'hearing.updated',
      status: 'failed',
      limit: 10,
    });
  });

  it('replayEvent URL-encodes the event id and surfaces errors', async () => {
    apiPostMock.mockResolvedValue({ data: { ok: true } });
    await lexIntegrationsApi.replayEvent('ev/1');
    expect(apiPostMock).toHaveBeenCalledWith(`${BASE}/events/ev%2F1/replay`);

    apiPostMock.mockRejectedValueOnce(new Error('boom'));
    await expect(lexIntegrationsApi.replayEvent('ev2')).rejects.toThrow('boom');
  });
});

describe('event result helpers', () => {
  it('distinguish genuine empty streams from failed or malformed reads', async () => {
    apiGetMock.mockResolvedValueOnce({ data: [] });
    await expect(lexIntegrationsApi.getEventsResult('e1')).resolves.toEqual({
      events: [],
      degraded: false,
    });
    expect(apiGetMock).toHaveBeenCalledWith(`${BASE}/e1/events`, {});

    apiGetMock.mockResolvedValueOnce({ data: null });
    await expect(lexIntegrationsApi.getEventsResult('e1')).resolves.toEqual({
      events: [],
      degraded: true,
    });

    apiGetMock.mockRejectedValueOnce(new Error('down'));
    await expect(lexIntegrationsApi.getEventsResult('e1')).resolves.toEqual({
      events: [],
      degraded: true,
    });
  });

  it('covers tenant-wide event reads and preserves legacy array wrappers', async () => {
    apiGetMock.mockResolvedValueOnce({ data: [{ id: 'evt-1' }] });
    await expect(lexIntegrationsApi.getEventsAllResult({ limit: 25 })).resolves.toEqual({
      events: [{ id: 'evt-1' }],
      degraded: false,
    });
    expect(apiGetMock).toHaveBeenCalledWith(`${BASE}/events`, { limit: 25 });

    apiGetMock.mockResolvedValueOnce({ data: [{ id: 'evt-2' }] });
    await expect(lexIntegrationsApi.getEvents('e1')).resolves.toEqual([{ id: 'evt-2' }]);
  });
});

describe('getMetrics normalizes a partial wire payload with safe numeric defaults', () => {
  it('coerces missing fields and defaults slo_target_pct to 99', async () => {
    apiGetMock.mockResolvedValue({ data: { calls: 5, window: '24h' } });
    const m = await lexIntegrationsApi.getMetrics('e1', '24h');
    expect(m).not.toBeNull();
    expect(m!.calls).toBe(5);
    expect(m!.errors).toBe(0);
    expect(m!.slo_target_pct).toBe(99);
    expect(m!.by_op).toEqual([]);
    expect(apiGetMock).toHaveBeenCalledWith(`${BASE}/e1/metrics`, { window: '24h' });
  });
});

describe('getMetricsOverviewResult', () => {
  it('passes the selected window and distinguishes empty success from failure', async () => {
    apiGetMock.mockResolvedValueOnce({ data: [] });

    const result = await lexIntegrationsApi.getMetricsOverviewResult('1h');

    expect(apiGetMock).toHaveBeenCalledWith(`${BASE}/metrics`, { window: '1h' });
    expect(result).toEqual({ rows: [], degraded: false });
  });

  it('marks malformed or failed rollups degraded', async () => {
    apiGetMock.mockResolvedValueOnce({ data: null });
    await expect(lexIntegrationsApi.getMetricsOverviewResult('24h')).resolves.toEqual({
      rows: [],
      degraded: true,
    });

    apiGetMock.mockRejectedValueOnce(new Error('down'));
    await expect(lexIntegrationsApi.getMetricsOverviewResult('7d')).resolves.toEqual({
      rows: [],
      degraded: true,
    });
  });

  it('keeps the legacy array helper for existing callers', async () => {
    apiGetMock.mockResolvedValue({ data: [{ endpoint_id: 'ep-1' }] });
    await expect(lexIntegrationsApi.getMetricsOverview('24h')).resolves.toEqual([
      { endpoint_id: 'ep-1' },
    ]);
  });
});

describe('CUSTOM_SPEC_CONFIG_KEY contract', () => {
  it('is the stable "spec" config key the builder serializes under', () => {
    expect(CUSTOM_SPEC_CONFIG_KEY).toBe('spec');
  });
});
