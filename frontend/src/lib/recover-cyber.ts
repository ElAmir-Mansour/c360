// Clario Recover — CYBER RECOVERY workspace API client.
//
// Thin wrappers over the suiteapi `{data}` envelope for the
// /api/recover/cyber-recovery surface. Every call hits the real backend
// endpoint; the workspace UI never fabricates flow/gate state.
import { apiGet, apiPost } from '@/lib/api';
import type { ApiResponse as DataEnvelope } from '@/types/api';
import type {
  CyberCleanPoint,
  CyberRecoveryFlow,
  CyberRecoveryFlowDetail,
  CyberRecoveryOverview,
  SelectCleanPointRequest,
} from '@/types/recover-cyber';

const BASE = '/api/recover/cyber-recovery';

async function getData<T>(url: string): Promise<T> {
  const envelope = await apiGet<DataEnvelope<T>>(url);
  return envelope.data;
}

async function postData<T>(url: string, body?: unknown): Promise<T> {
  const envelope = await apiPost<DataEnvelope<T>>(url, body);
  return envelope.data;
}

/** GET /api/recover/cyber-recovery/overview — the live workspace dashboard. */
export function fetchCyberRecoveryOverview(): Promise<CyberRecoveryOverview> {
  return getData<CyberRecoveryOverview>(`${BASE}/overview`);
}

/** GET /clean-points — last-known-good restore candidates with freshness. */
export function fetchCyberCleanPoints(): Promise<CyberCleanPoint[]> {
  return getData<CyberCleanPoint[]>(`${BASE}/clean-points`);
}

/** GET /flows — the tenant's recovery flows, newest first. */
export function fetchCyberRecoveryFlows(): Promise<CyberRecoveryFlow[]> {
  return getData<CyberRecoveryFlow[]>(`${BASE}/flows`);
}

/** GET /flows/{id} — a flow plus its append-only transition history. */
export function fetchCyberRecoveryFlow(id: string): Promise<CyberRecoveryFlowDetail> {
  return getData<CyberRecoveryFlowDetail>(`${BASE}/flows/${id}`);
}

/** POST /flows — start a flow by selecting a last-known-good clean point. */
export function selectCleanPoint(body: SelectCleanPointRequest): Promise<CyberRecoveryFlow> {
  return postData<CyberRecoveryFlow>(`${BASE}/flows`, body);
}

/** POST /flows/{id}/provision — provision the clean point to the target. */
export function provisionFlow(id: string): Promise<CyberRecoveryFlow> {
  return postData<CyberRecoveryFlow>(`${BASE}/flows/${id}/provision`);
}

/** POST /flows/{id}/run-recovery — execute runbook recovery on the target. */
export function runFlowRecovery(id: string, runbookRunId?: string): Promise<CyberRecoveryFlow> {
  return postData<CyberRecoveryFlow>(`${BASE}/flows/${id}/run-recovery`, {
    runbook_run_id: runbookRunId ?? '',
  });
}

/** POST /flows/{id}/integrity-check — run the MANDATORY clean-room gate. */
export function runIntegrityCheck(id: string): Promise<CyberRecoveryFlow> {
  return postData<CyberRecoveryFlow>(`${BASE}/flows/${id}/integrity-check`);
}

/** POST /flows/{id}/request-approval — move a passed flow to awaiting approval. */
export function requestApproval(id: string): Promise<CyberRecoveryFlow> {
  return postData<CyberRecoveryFlow>(`${BASE}/flows/${id}/request-approval`);
}

/** POST /flows/{id}/approve — authorized sign-off (provenance recorded). */
export function approveFlow(id: string, note?: string): Promise<CyberRecoveryFlow> {
  return postData<CyberRecoveryFlow>(`${BASE}/flows/${id}/approve`, { note: note ?? '' });
}

/** POST /flows/{id}/return-to-production — HARD-gated terminal action. */
export function returnToProduction(id: string): Promise<CyberRecoveryFlow> {
  return postData<CyberRecoveryFlow>(`${BASE}/flows/${id}/return-to-production`);
}

/** POST /flows/{id}/abort — abandon a non-terminal flow. */
export function abortFlow(id: string, reason: string): Promise<CyberRecoveryFlow> {
  return postData<CyberRecoveryFlow>(`${BASE}/flows/${id}/abort`, { reason });
}
