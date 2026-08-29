import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  RECOVER_EVIDENCE_ENDPOINT,
  RECOVER_EVIDENCE_LIST_KEY,
  recoverEvidenceReportKey,
  fetchRecoverEvidenceEvents,
  fetchRecoverEvidenceReport,
  downloadRecoverEvidenceExport,
} from './evidence';
import type {
  RecoverAuditEventSummary,
  RecoverEvidenceReport,
} from '@/types/recover-evidence';

// Mock the api layer so the client contract is exercised without a network.
const apiGet = vi.fn();
const apiGetBlob = vi.fn();
vi.mock('@/lib/api', () => ({
  apiGet: (...args: unknown[]) => apiGet(...args),
  apiGetBlob: (...args: unknown[]) => apiGetBlob(...args),
}));

describe('recover evidence client contract', () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiGetBlob.mockReset();
  });

  it('binds the published /api/recover/evidence routes', () => {
    expect(RECOVER_EVIDENCE_ENDPOINT).toBe('/api/recover/evidence');
    expect(RECOVER_EVIDENCE_LIST_KEY).toEqual(['recover', 'evidence', 'list']);
    expect(recoverEvidenceReportKey('e1')).toEqual(['recover', 'evidence', 'report', 'e1']);
  });

  it('lists events with a bounded page', async () => {
    apiGet.mockResolvedValue([] as RecoverAuditEventSummary[]);
    await fetchRecoverEvidenceEvents();
    expect(apiGet).toHaveBeenCalledWith('/api/recover/evidence', { per_page: 100 });
  });

  it('fetches one event report by id', async () => {
    apiGet.mockResolvedValue({ event_id: 'e1' } as RecoverEvidenceReport);
    await fetchRecoverEvidenceReport('e1');
    expect(apiGet).toHaveBeenCalledWith('/api/recover/evidence/e1');
  });

  it('the report shape carries the runbook RTO-vs-RTA, approvals, integrity checks and timeline', () => {
    const sample: RecoverEvidenceReport = {
      event_id: 'e1',
      tenant_id: 't1',
      sub_solution: 'cyber_recovery',
      application_key: 'core-banking',
      runbook_execution: {
        run_id: 'r1',
        runbook_id: 'rb1',
        runbook_name: 'Failover',
        mode: 'rehearsal',
        status: 'completed',
        succeeded: true,
        started_at: '2026-06-29T00:00:00Z',
        rto_target_seconds: 600,
        rta_actual_seconds: 900,
        rta_breach: true,
        breach_seconds: 300,
      },
      approvals: [{ action: 'cyber.approval.granted', approver: 'ciso@bank.test', approved_at: '2026-06-29T00:00:00Z' }],
      integrity_checks: [{ verdict: 'CLEAN', passed: true, checked_at: '2026-06-29T00:00:00Z' }],
      timeline: [{ at: '2026-06-29T00:00:00Z', sub_solution: 'cyber_recovery', action: 'cyber.return_to_production', actor: 'ciso@bank.test', summary: 'returned' }],
      generated_at: '2026-06-29T00:00:00Z',
    };
    expect(sample.runbook_execution!.rta_breach).toBe(true);
    expect(sample.integrity_checks[0].passed).toBe(true);
    expect(sample.timeline).toHaveLength(1);
  });
});

describe('downloadRecoverEvidenceExport', () => {
  const createObjectURL = vi.fn(() => 'blob:url');
  const revokeObjectURL = vi.fn();
  let clickSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    apiGetBlob.mockReset();
    createObjectURL.mockClear();
    revokeObjectURL.mockClear();
    // jsdom lacks URL.createObjectURL; stub it.
    Object.defineProperty(window.URL, 'createObjectURL', { value: createObjectURL, writable: true });
    Object.defineProperty(window.URL, 'revokeObjectURL', { value: revokeObjectURL, writable: true });
    clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('downloads through the authenticated pipeline and honours the server filename', async () => {
    apiGetBlob.mockResolvedValue({
      blob: new Blob(['%PDF-'], { type: 'application/pdf' }),
      filename: 'recover-evidence-e1.pdf',
    });

    await downloadRecoverEvidenceExport('e1', 'pdf');

    expect(apiGetBlob).toHaveBeenCalledWith('/api/recover/evidence/e1/export', { format: 'pdf' });
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:url');
  });

  it('falls back to a generated filename when the server provides none', async () => {
    apiGetBlob.mockResolvedValue({ blob: new Blob(['a,b'], { type: 'text/csv' }), filename: null });
    await downloadRecoverEvidenceExport('e2', 'csv');
    expect(apiGetBlob).toHaveBeenCalledWith('/api/recover/evidence/e2/export', { format: 'csv' });
    expect(clickSpy).toHaveBeenCalled();
  });
});
