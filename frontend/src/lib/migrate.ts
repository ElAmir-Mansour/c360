import api, { apiGet, apiGetBlob, apiPost } from '@/lib/api';
import { isApiError, type ApiResponse, type PaginatedResponse } from '@/types/api';
import type { Notification } from '@/types/models';
import type {
  MigrateApprovalStatus,
  MigrateCommandCenter,
  MigrateConnector,
  MigrateConnectorInvocation,
  MigrateCriticalPath,
  MigrateCutoverWindow,
  MigrateDependencyGraph,
  MigrateDRTaskAction,
  MigrateEvidenceReport,
  MigrateGateCheck,
  MigrateMoveGroup,
  MigrateProduct,
  MigrateProgram,
  MigrateProgramStatusSummary,
  MigrateRollbackPlan,
  MigrateRollbackRun,
  MigrateRollbackRunView,
  MigrateRunbookBinding,
  MigrateWave,
  MigrateWaveRunbook,
  MigrateWindowRun,
  MigrateWindowType,
  MigrateWorkload,
  MigrateWorkloadDependency,
  MigrateWorkloadStatus,
} from '@/types/migrate';

const BASE = '/api/v1/migrate';

const id = (value: string) => encodeURIComponent(value);

const unwrap = async <T>(promise: Promise<ApiResponse<T>>): Promise<T> =>
  (await promise).data;

export function fetchMigrateProduct(): Promise<MigrateProduct> {
  return unwrap(apiGet<ApiResponse<MigrateProduct>>(`${BASE}/product`));
}

export async function fetchMigratePrograms(): Promise<MigrateProgram[]> {
  const response = await apiGet<PaginatedResponse<MigrateProgram>>(`${BASE}/programs`);
  return response.data;
}

export function createMigrateProgram(input: {
  name: string;
  description?: string;
  owner?: string;
}): Promise<MigrateProgram> {
  return unwrap(apiPost<ApiResponse<MigrateProgram>>(`${BASE}/programs`, input));
}

export async function fetchMigrateWorkloads(programID: string): Promise<MigrateWorkload[]> {
  const response = await apiGet<PaginatedResponse<MigrateWorkload>>(
    `${BASE}/programs/${id(programID)}/workloads`,
    { per_page: 200 },
  );
  return response.data;
}

export function upsertMigrateWorkload(
  programID: string,
  input: {
    app_key: string;
    name: string;
    source_environment?: string;
    target_cloud?: string;
    target_account?: string;
    strategy: string;
    owner_name?: string;
    owner_contact?: string;
    tier?: string;
    readiness_score?: number;
    dependencies?: MigrateWorkloadDependency[];
  },
): Promise<MigrateWorkload> {
  return unwrap(apiPost<ApiResponse<MigrateWorkload>>(
    `${BASE}/programs/${id(programID)}/workloads`,
    input,
  ));
}

export function transitionMigrateWorkload(
  workloadID: string,
  input: { status: MigrateWorkloadStatus; expected_version: number; reason?: string },
): Promise<MigrateWorkload> {
  return unwrap(apiPost<ApiResponse<MigrateWorkload>>(
    `${BASE}/workloads/${id(workloadID)}/transition`,
    input,
  ));
}

export function rollbackMigrateCutover(
  windowID: string,
  input?: { reason?: string },
): Promise<MigrateCutoverWindow> {
  return unwrap(apiPost<ApiResponse<MigrateCutoverWindow>>(
    `${BASE}/windows/${id(windowID)}/rollback`,
    input ?? {},
  ));
}

export function importMigrateWorkloads(programID: string, csvText: string) {
  return unwrap(api.post<ApiResponse<{
    imported: number;
    updated: number;
    skipped: number;
    errors?: string[];
    workloads: MigrateWorkload[];
  }>>(`${BASE}/programs/${id(programID)}/workloads/import`, csvText, {
    headers: { 'Content-Type': 'text/csv' },
  }).then((response) => response.data));
}

export async function fetchMigrateMoveGroups(programID: string): Promise<MigrateMoveGroup[]> {
  const response = await apiGet<PaginatedResponse<MigrateMoveGroup>>(
    `${BASE}/programs/${id(programID)}/move-groups`,
    { per_page: 100 },
  );
  return response.data;
}

export function createMigrateMoveGroup(
  programID: string,
  input: { name: string; description?: string; constraints?: string; app_keys: string[] },
): Promise<MigrateMoveGroup> {
  return unwrap(apiPost<ApiResponse<MigrateMoveGroup>>(
    `${BASE}/programs/${id(programID)}/move-groups`,
    input,
  ));
}

export function suggestMigrateMoveGroup(programID: string, appKeys: string[]) {
  return unwrap(apiPost<ApiResponse<{ app_keys: string[] }>>(
    `${BASE}/programs/${id(programID)}/move-groups/suggestions`,
    { app_keys: appKeys },
  ));
}

export function validateMigrateMoveGroup(group: MigrateMoveGroup): Promise<MigrateMoveGroup> {
  return unwrap(apiPost<ApiResponse<MigrateMoveGroup>>(
    `${BASE}/move-groups/${id(group.id)}/validate`,
    { expected_version: group.row_version },
  ));
}

export function submitMigrateMoveGroup(group: MigrateMoveGroup): Promise<MigrateMoveGroup> {
  return unwrap(apiPost<ApiResponse<MigrateMoveGroup>>(
    `${BASE}/move-groups/${id(group.id)}/submit`,
    { expected_version: group.row_version },
  ));
}

// ── Workflow-backed approvals (Wave 5, H2) ────────────────────────────────────
// Move-group approvals are decided through the SHARED workflow engine, not a local
// status flip. requestMigrateMoveGroupApproval OPENS (or returns) the workflow
// approval instance for a submitted group; syncMigrateMoveGroupApproval PULLS the
// workflow's decision and applies it to the migrate FSM. decideMigrateMoveGroup is
// now the guarded manual-override break-glass path.

// requestMigrateMoveGroupApproval opens (or returns the existing) shared-workflow-
// engine approval for a submitted move group and returns the approval status
// (move group + bound workflow instance). Requires migrate:plan. The backend fails
// closed with 503 workflow_engine_unavailable when no engine is wired.
export function requestMigrateMoveGroupApproval(
  moveGroupID: string,
): Promise<MigrateApprovalStatus> {
  return unwrap(apiPost<ApiResponse<MigrateApprovalStatus>>(
    `${BASE}/move-groups/${id(moveGroupID)}/request-approval`,
    {},
  ));
}

// syncMigrateMoveGroupApproval pulls the bound workflow instance's decision and, if
// terminal, applies it to the migrate FSM (status -> approved/rejected). Requires
// migrate:approve. The backend returns 409 approval_pending while the workflow is
// still running, and 404 approval_not_started when no approval has been opened.
export function syncMigrateMoveGroupApproval(
  moveGroupID: string,
): Promise<MigrateMoveGroup> {
  return unwrap(apiPost<ApiResponse<MigrateMoveGroup>>(
    `${BASE}/move-groups/${id(moveGroupID)}/sync-approval`,
    {},
  ));
}

// decideMigrateMoveGroup is the GUARDED MANUAL-OVERRIDE break-glass decision path.
// When the workflow engine is configured the backend refuses a plain decision (403
// approval_workflow_required) unless allowOverride is set AND the caller holds
// migrate:admin. When no engine is wired it is the ordinary decision path.
export function decideMigrateMoveGroup(
  group: MigrateMoveGroup,
  approved: boolean,
  rationale: string,
  allowOverride = false,
): Promise<MigrateMoveGroup> {
  return unwrap(apiPost<ApiResponse<MigrateMoveGroup>>(
    `${BASE}/move-groups/${id(group.id)}/decision`,
    { approved, rationale, expected_version: group.row_version, allow_override: allowOverride },
  ));
}

export async function fetchMigrateWaves(programID: string): Promise<MigrateWave[]> {
  const response = await apiGet<PaginatedResponse<MigrateWave>>(
    `${BASE}/programs/${id(programID)}/waves`,
    { per_page: 100 },
  );
  return response.data;
}

export function createMigrateWave(
  programID: string,
  input: {
    name: string;
    description?: string;
    sequence: number;
    planned_duration_seconds?: number;
    move_group_ids: string[];
  },
): Promise<MigrateWave> {
  return unwrap(apiPost<ApiResponse<MigrateWave>>(
    `${BASE}/programs/${id(programID)}/waves`,
    input,
  ));
}

// fetchMigrateWave returns a single wave HYDRATED with its move groups (and their
// workloads) — unlike the program waves list, which returns flat wave rows.
export function fetchMigrateWave(waveID: string): Promise<MigrateWave> {
  return unwrap(apiGet<ApiResponse<MigrateWave>>(`${BASE}/waves/${id(waveID)}`));
}

export function fetchMigrateCriticalPath(waveID: string): Promise<MigrateCriticalPath> {
  return unwrap(apiGet<ApiResponse<MigrateCriticalPath>>(
    `${BASE}/waves/${id(waveID)}/critical-path`,
  ));
}

// fetchMigrateDependencyGraph returns the wave's move-group / workload dependency
// graph (nodes + edges + topo order) for react-flow visualization. When any move
// group is bound to a DR consistency group, the DR replication topology is
// overlaid; the native dependency structure renders regardless.
export function fetchMigrateDependencyGraph(waveID: string): Promise<MigrateDependencyGraph> {
  return unwrap(apiGet<ApiResponse<MigrateDependencyGraph>>(
    `${BASE}/waves/${id(waveID)}/dependency-graph`,
  ));
}

// generateMigrateWaveRunbook authors the wave's parent + per-move-group DR
// runbooks in the existing DR Runbook Studio engine and returns the persisted
// binding (201). The backend fails closed with 503 dr_engine_unavailable when no
// DR engine is wired, or 502 dr_engine_rejected on a DR authoring error.
export function generateMigrateWaveRunbook(waveID: string): Promise<MigrateWaveRunbook> {
  return unwrap(apiPost<ApiResponse<MigrateWaveRunbook>>(
    `${BASE}/waves/${id(waveID)}/generate-runbook`,
    {},
  ));
}

// fetchMigrateWaveRunbook returns the generated runbook binding for a wave plus
// the hydrated live DR runbook/run state. The endpoint returns 404 when no runbook
// has been generated yet; we map that single case to null so the UI can render the
// "not generated" state without treating it as an error. Any other failure (incl.
// the DR engine being unavailable for hydration) propagates.
export async function fetchMigrateWaveRunbook(waveID: string): Promise<MigrateWaveRunbook | null> {
  try {
    return await unwrap(apiGet<ApiResponse<MigrateWaveRunbook>>(
      `${BASE}/waves/${id(waveID)}/runbook`,
    ));
  } catch (error) {
    if (isApiError(error) && error.status === 404) {
      return null;
    }
    throw error;
  }
}

export async function fetchMigrateWindows(programID: string): Promise<MigrateCutoverWindow[]> {
  const response = await apiGet<PaginatedResponse<MigrateCutoverWindow>>(
    `${BASE}/programs/${id(programID)}/windows`,
    { per_page: 100 },
  );
  return response.data;
}

export function createMigrateWindow(
  programID: string,
  input: {
    wave_id: string;
    name: string;
    window_type: MigrateWindowType;
    starts_at: string;
    ends_at: string;
    constraints?: string;
  },
): Promise<MigrateCutoverWindow> {
  return unwrap(apiPost<ApiResponse<MigrateCutoverWindow>>(
    `${BASE}/programs/${id(programID)}/windows`,
    input,
  ));
}

export function decideMigrateGoNoGo(
  window: MigrateCutoverWindow,
  decision: 'go' | 'no_go',
  rationale: string,
): Promise<MigrateCutoverWindow> {
  return unwrap(apiPost<ApiResponse<MigrateCutoverWindow>>(
    `${BASE}/windows/${id(window.id)}/go-no-go`,
    { decision, rationale, expected_version: window.row_version },
  ));
}

export function startMigrateCutover(windowID: string): Promise<MigrateCutoverWindow> {
  return unwrap(apiPost<ApiResponse<MigrateCutoverWindow>>(
    `${BASE}/windows/${id(windowID)}/start`,
    {},
  ));
}

export function completeMigrateCutover(windowID: string): Promise<MigrateCutoverWindow> {
  return unwrap(apiPost<ApiResponse<MigrateCutoverWindow>>(
    `${BASE}/windows/${id(windowID)}/complete`,
    {},
  ));
}

// ── Cutover run EXECUTION (Wave 3, P7) ────────────────────────────────────────
// These drive the LIVE run of the wave's generated cutover runbook through the
// existing DR Runbook Studio engine (the backend proxies StartRun/ActOnTask/
// GetRun). The DR engine is the system of record; the run status it reports is
// the authoritative validation gate — no client-side "canned" completion.

// startMigrateWindowRun starts a live DR run of the wave's generated parent
// runbook for a window (201). It is gated exactly like Start cutover (a go
// decision, an approved rollback plan, passing readiness checks) — the backend
// returns 409 gate_blocked otherwise, or 503 dr_engine_unavailable / 502
// dr_engine_rejected when the DR engine fails.
export function startMigrateWindowRun(
  windowID: string,
  mode?: string,
): Promise<MigrateWindowRun> {
  return unwrap(apiPost<ApiResponse<MigrateWindowRun>>(
    `${BASE}/windows/${id(windowID)}/start-run`,
    mode ? { mode } : {},
  ));
}

// fetchMigrateWindowRun returns the live cutover run state for a window (its
// binding + live DR run state hydrated from the engine). Before a run has been
// started the response carries no live_state; the window must exist (a missing
// window is a real 404 and propagates).
export function fetchMigrateWindowRun(windowID: string): Promise<MigrateWindowRun> {
  return unwrap(apiGet<ApiResponse<MigrateWindowRun>>(
    `${BASE}/windows/${id(windowID)}/run`,
  ));
}

// actOnMigrateWindowTask completes/skips/fails one task of the window's live
// cutover run by proxying to the DR engine, and returns the recomputed live
// state. The verb is carried as a ':<action>' suffix on the task path segment,
// matching the DR Studio contract. failRun forces the whole run to fail when
// failing a non-required task; note is an optional operator annotation.
export function actOnMigrateWindowTask(
  windowID: string,
  taskID: string,
  action: MigrateDRTaskAction,
  input?: { note?: string; fail_run?: boolean },
): Promise<MigrateWindowRun> {
  // chi treats the ':' as part of the segment; the backend splits {taskID}:{verb}.
  // We must NOT URL-encode the ':' — encodeURIComponent leaves ':' intact.
  return unwrap(apiPost<ApiResponse<MigrateWindowRun>>(
    `${BASE}/windows/${id(windowID)}/tasks/${id(taskID)}:${action}`,
    input ?? {},
  ));
}

// ── Rollback EXECUTION (Wave 3, P8) ───────────────────────────────────────────

// generateMigrateRollbackRunbook authors an isolated rollback runbook in the DR
// engine for the window's wave (one task per workload, reverse cutover order) and
// returns the persisted role='rollback' binding (201). Requires an approved
// rollback plan (409 gate_blocked otherwise).
export function generateMigrateRollbackRunbook(windowID: string): Promise<MigrateRunbookBinding> {
  return unwrap(apiPost<ApiResponse<MigrateRunbookBinding>>(
    `${BASE}/windows/${id(windowID)}/rollback/generate-runbook`,
    {},
  ));
}

// executeMigrateRollback records the trigger-decision provenance (who + why) and
// STARTS the rollback runbook run via the DR engine (201). It auto-generates the
// rollback runbook if one has not been generated yet. The reason is mandatory
// provenance; requires the rollback permission + an approved rollback plan.
export function executeMigrateRollback(
  windowID: string,
  input: { reason: string; mode?: string },
): Promise<MigrateRollbackRun> {
  return unwrap(apiPost<ApiResponse<MigrateRollbackRun>>(
    `${BASE}/windows/${id(windowID)}/rollback/execute`,
    input,
  ));
}

// fetchMigrateRollbackRun returns the latest rollback-run provenance for a window
// plus its live DR run state. Before any rollback has been executed the backend
// returns 404 (no rollback run for this window); we map that single case to a
// null view so the UI can render the "not triggered" state without an error.
export async function fetchMigrateRollbackRun(windowID: string): Promise<MigrateRollbackRunView | null> {
  try {
    return await unwrap(apiGet<ApiResponse<MigrateRollbackRunView>>(
      `${BASE}/windows/${id(windowID)}/rollback/run`,
    ));
  } catch (error) {
    if (isApiError(error) && error.status === 404) {
      return null;
    }
    throw error;
  }
}

export function upsertMigrateRollbackPlan(
  windowID: string,
  input: Pick<MigrateRollbackPlan, 'strategy' | 'procedures' | 'success_criteria'>,
): Promise<MigrateRollbackPlan> {
  return unwrap(apiPost<ApiResponse<MigrateRollbackPlan>>(
    `${BASE}/windows/${id(windowID)}/rollback-plan`,
    input,
  ));
}

export function fetchMigrateRollbackPlan(windowID: string): Promise<MigrateRollbackPlan | null> {
  return unwrap(apiGet<ApiResponse<MigrateRollbackPlan | null>>(
    `${BASE}/windows/${id(windowID)}/rollback-plan`,
  ));
}

export function decideMigrateRollbackPlan(
  plan: MigrateRollbackPlan,
  decision: 'approved' | 'rejected',
  rationale: string,
): Promise<MigrateRollbackPlan> {
  if (!plan.id || plan.row_version === undefined) {
    return Promise.reject(new Error('Rollback plan has not been persisted.'));
  }
  return unwrap(apiPost<ApiResponse<MigrateRollbackPlan>>(
    `${BASE}/rollback-plans/${id(plan.id)}/decision`,
    { decision, rationale, expected_version: plan.row_version },
  ));
}

export function createMigrateGateCheck(
  windowID: string,
  input: {
    kind: string;
    name: string;
    check_type?: string;
    required?: boolean;
  },
): Promise<MigrateGateCheck> {
  return unwrap(apiPost<ApiResponse<MigrateGateCheck>>(
    `${BASE}/windows/${id(windowID)}/gate-checks`,
    input,
  ));
}

export function fetchMigrateGateChecks(windowID: string, kind?: string): Promise<MigrateGateCheck[]> {
  return unwrap(apiGet<ApiResponse<MigrateGateCheck[]>>(
    `${BASE}/windows/${id(windowID)}/gate-checks`,
    kind ? { kind } : undefined,
  ));
}

export function recordMigrateGateCheck(
  checkID: string,
  input: { status: string; evidence?: string; result?: string },
): Promise<MigrateGateCheck> {
  return unwrap(apiPost<ApiResponse<MigrateGateCheck>>(
    `${BASE}/gate-checks/${id(checkID)}/result`,
    input,
  ));
}

export function fetchMigrateCommandCenter(programID: string): Promise<MigrateCommandCenter> {
  return unwrap(apiGet<ApiResponse<MigrateCommandCenter>>(
    `${BASE}/programs/${id(programID)}/command-center`,
  ));
}

// fetchMigrateStatusSummary returns the concise exec/stakeholder program status
// view (waves + %complete, blockers, current run, variance). Read-only.
export function fetchMigrateStatusSummary(programID: string): Promise<MigrateProgramStatusSummary> {
  return unwrap(apiGet<ApiResponse<MigrateProgramStatusSummary>>(
    `${BASE}/programs/${id(programID)}/status-summary`,
  ));
}

export function fetchMigrateConnectors(): Promise<MigrateConnector[]> {
  return unwrap(apiGet<ApiResponse<MigrateConnector[]>>(`${BASE}/connectors`));
}

export function saveMigrateConnector(input: {
  name: string;
  provider?: string;
  endpoint_url: string;
  auth_type: 'none' | 'bearer' | 'basic';
  secret_ref?: string;
  enabled: boolean;
}): Promise<MigrateConnector> {
  return unwrap(apiPost<ApiResponse<MigrateConnector>>(`${BASE}/connectors`, input));
}

export function invokeMigrateConnector(
  connectorID: string,
  input: {
    window_id: string;
    idempotency_key: string;
    action: string;
    payload?: Record<string, unknown>;
  },
): Promise<MigrateConnectorInvocation> {
  return unwrap(apiPost<ApiResponse<MigrateConnectorInvocation>>(
    `${BASE}/connectors/${id(connectorID)}/invoke`,
    input,
  ));
}

export function downloadMigrateEvidence(programID: string, format: 'csv' | 'pdf') {
  return apiGetBlob(`${BASE}/programs/${id(programID)}/evidence`, { format });
}

// ── Structured evidence report (Wave 6, P10b) ─────────────────────────────────

// fetchMigrateEvidenceReport returns the STRUCTURED, regulator-ready evidence
// report for a program: a sectioned document (program → summary → per-wave slices
// with move groups, runbook bindings, windows, gate decisions + evidence, and the
// cutover run's real per-task outcomes → workflow approvals → rollback provenance →
// connector invocations the runs drove). Requires migrate:evidence:export. Go
// serialises empty slices as null, so we normalise them to arrays for the UI.
export async function fetchMigrateEvidenceReport(
  programID: string,
): Promise<MigrateEvidenceReport> {
  const report = await unwrap(
    apiGet<ApiResponse<MigrateEvidenceReport>>(`${BASE}/programs/${id(programID)}/evidence-report`),
  );
  return {
    ...report,
    waves: (report.waves ?? []).map((wave) => ({
      ...wave,
      move_groups: wave.move_groups ?? [],
      windows: (wave.windows ?? []).map((window) => ({
        ...window,
        gate_checks: window.gate_checks ?? [],
      })),
    })),
    approvals: report.approvals ?? [],
    rollbacks: report.rollbacks ?? [],
    connector_invocations: report.connector_invocations ?? [],
  };
}

// downloadMigrateEvidenceReport downloads the SAME structured evidence report
// rendered as a sectioned PDF (?format=pdf). Reuses the authenticated blob-download
// pipeline (the access token is in memory, so a plain anchor cannot authenticate).
export function downloadMigrateEvidenceReport(programID: string) {
  return apiGetBlob(`${BASE}/programs/${id(programID)}/evidence-report`, { format: 'pdf' });
}

// ── Command-center notification rail (Wave 5, H1) ─────────────────────────────
// Migrate stages migrate.* CloudEvents on the shared platform outbox; the shared
// notification-service consumer materialises them into the platform notifications
// inbox under the 'migration' category. There is no separate migrate notifications
// endpoint — the rail reads the platform inbox filtered to category=migration (the
// inbox is already scoped to the current user + tenant server-side).
const MIGRATE_NOTIFICATION_CATEGORY = 'migration';

// fetchMigrateNotifications returns the current user's recent migrate notifications
// (most recent first) from the platform notifications inbox filtered to the migrate
// category. limit caps the rail size.
export async function fetchMigrateNotifications(limit = 12): Promise<Notification[]> {
  const response = await apiGet<PaginatedResponse<Notification>>('/api/v1/notifications', {
    category: MIGRATE_NOTIFICATION_CATEGORY,
    per_page: limit,
    sort: 'created_at',
    order: 'desc',
  });
  return (response.data ?? []).map((notification) => ({
    ...notification,
    read: notification.read ?? Boolean(notification.read_at),
  }));
}
