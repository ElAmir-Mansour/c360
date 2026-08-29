/**
 * Lex Integration Platform — typed API client + domain types (CAP-174..186).
 *
 * This module is the typed HTTP surface for the admin/integrations console: the
 * connector registry (list / create / get / update / delete), the per-kind
 * dynamic-form schema, health probes, connection tests, on-demand sync, and the
 * sync-run ledger. Every method calls the real backend under
 * `/api/v1/lex/integrations/...` via the shared axios instance (baseURL =
 * gateway) through the suite-api envelope helpers — singletons are unwrapped
 * from `{data}` and lists arrive as `{data}` (NOT paginated; the registry List
 * endpoint returns a flat `WriteData([]…)`).
 *
 * The types mirror the Go models/DTOs in `backend/internal/lex/model`
 * (IntegrationEndpoint, IntegrationKind, IntegrationStatus, IntegrationHealth)
 * and `backend/internal/lex/dto` (IntegrationFieldSpecResponse,
 * IntegrationSchemaResponse, IntegrationTestResponse, IntegrationSyncRunResponse)
 * plus `service/integration` (SyncReport, SyncMode, FieldType). Author-facing
 * labels are bilingual {@link LocalizedText} ({ar, en}); resolve them with
 * `resolveLocalized`.
 *
 * GRACEFUL DEGRADATION. The console can render through partial observability
 * data, notably an optional aggregate `health_grade` on list rows and the
 * org-wide `/integrations/health` map. The read helpers here NEVER throw on a
 * read/shape failure: result-shaped helpers carry `degraded`, legacy list
 * wrappers return `[]`, and singleton helpers such as `getIntegrationHealth`
 * return `null`. The mutating helpers (create/update/delete/test/sync) DO
 * surface errors so the caller can toast them. This mirrors the org-entities
 * graceful-degradation pattern (`org-entities/_lib/platform-sync-api.ts`,
 * `org-entities/_lib/org-audit-api.ts`).
 *
 * SECRET FIELDS. The registry masks secret config keys to the sentinel string
 * {@link REDACTED_SENTINEL} (`__redacted__`) on read. The form renders such
 * fields write-only ("•••••• (set)" + Replace). On PUT, leaving the sentinel in
 * place keeps the stored secret (the backend merge skips sentinel values), so do
 * NOT strip it — send it through unchanged. Use {@link isRedacted} to detect it.
 */
import { apiDelete, apiGet, apiPost, apiPut } from '@/lib/api';
import api from '@/lib/api';
import type { LocalizedText } from '@/types/forms';

/* --------------------------------------------------------------------------- *
 * Endpoints. Static sub-paths (/health, /schema/{kind}) register ahead of the
 * /{id} routes on the backend; mirror that ordering when reasoning about URLs.
 * --------------------------------------------------------------------------- */

export const LEX_INTEGRATIONS_ENDPOINT = '/api/v1/lex/integrations';

/** The sentinel value the registry returns for a masked SECRET config field. */
export const REDACTED_SENTINEL = '__redacted__';

/** True when a config value is the write-only redaction sentinel. */
export function isRedacted(value: unknown): boolean {
  return value === REDACTED_SENTINEL;
}

/* --------------------------------------------------------------------------- *
 * Domain enums.
 * --------------------------------------------------------------------------- */

/** Kinds of external systems the lex suite federates with (CAP-174..178). */
export type IntegrationKind =
  | 'najiz'
  | 'nafath_verify'
  | 'sso'
  | 'hr'
  | 'archiving'
  | 'email'
  | 'esign'
  | 'internal'
  | 'custom'
  | 'yardi';

export const INTEGRATION_KINDS: readonly IntegrationKind[] = [
  'najiz',
  'nafath_verify',
  'sso',
  'hr',
  'archiving',
  'email',
  'esign',
  'internal',
  'custom',
  'yardi',
] as const;

/** Lifecycle state of a registered endpoint. New rows default to `planned`. */
export type IntegrationStatus = 'planned' | 'active' | 'disabled' | 'error';

export const INTEGRATION_STATUSES: readonly IntegrationStatus[] = [
  'planned',
  'active',
  'disabled',
  'error',
] as const;

/**
 * Console-derived health grade. The backend does NOT (yet) emit a `health_grade`
 * field on list rows on every build; this client derives one defensively from
 * the endpoint status + last-checked / last-error so the grouped-card list can
 * always render an honest dot. When the backend later sends `health_grade`, the
 * normalizer prefers the wire value.
 *   - healthy    : active and last probe reachable (or freshly active, no error)
 *   - degraded   : active but a recent error / partial / never-probed
 *   - down       : status === 'error'
 *   - unconfigured: status === 'planned' (stub; not configured)
 *   - disabled   : status === 'disabled' (operator turned it off)
 */
export type IntegrationHealthGrade =
  | 'healthy'
  | 'degraded'
  | 'down'
  | 'unconfigured'
  | 'disabled';

export const INTEGRATION_HEALTH_GRADES: readonly IntegrationHealthGrade[] = [
  'healthy',
  'degraded',
  'down',
  'unconfigured',
  'disabled',
] as const;

/** Field input affordance the dynamic console form renders (mirrors FieldType). */
export type FieldSpecType =
  | 'string'
  | 'text'
  | 'url'
  | 'number'
  | 'bool'
  | 'enum'
  | 'secret';

/** Sync breadth executed by a connector's Syncer. */
export type SyncMode = 'full' | 'delta';

export const SYNC_MODES: readonly SyncMode[] = ['full', 'delta'] as const;

/** Terminal state of a recorded sync run (ledger row). */
export type SyncRunStatus = 'succeeded' | 'partial' | 'failed';

/* --------------------------------------------------------------------------- *
 * Domain types (wire shapes).
 * --------------------------------------------------------------------------- */

/**
 * A tenant-scoped integration registry row. `config` arrives MASKED: secret keys
 * collapse to {@link REDACTED_SENTINEL}; non-secret keys echo their stored value
 * so the dynamic form can prefill. `health_grade` is optional — present only on
 * backends that emit it; otherwise derive it with {@link deriveHealthGrade}.
 */
export interface IntegrationEndpoint {
  id: string;
  tenant_id: string;
  kind: IntegrationKind;
  /** Stable per-tenant identifier (unique per tenant). */
  code: string;
  name: string;
  description: string;
  status: IntegrationStatus;
  /** Masked connection config: secret keys === REDACTED_SENTINEL. */
  config: Record<string, unknown>;
  /** Non-sensitive operational annotations (last sync, version, …). */
  metadata: Record<string, unknown>;
  /** Whether the persisted config envelope is encrypted at rest. */
  encrypted?: boolean;
  last_checked_at?: string | null;
  last_error?: string | null;
  /** Optional aggregate grade if the backend emits it; else derive client-side. */
  health_grade?: IntegrationHealthGrade;
  created_by?: string;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
}

export interface IntegrationListResult {
  endpoints: IntegrationEndpoint[];
  /** True when the registry read failed or returned an unreadable list shape. */
  degraded: boolean;
}

/** Create payload for a new integration endpoint. */
export interface CreateIntegrationPayload {
  kind: IntegrationKind;
  code: string;
  name: string;
  description?: string;
  status?: IntegrationStatus;
  /** Plaintext connection config keyed by FieldSpec.key. */
  config: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

/**
 * Update (PUT) payload. Omitted fields are left unchanged. For `config`, any
 * secret field left as {@link REDACTED_SENTINEL} keeps the stored secret — send
 * the sentinel through unchanged; only replace it with a real value to rotate.
 */
export interface UpdateIntegrationPayload {
  name?: string;
  description?: string;
  status?: IntegrationStatus;
  config?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

/**
 * One schema field rendered into the DynamicConnectorForm. The schema is the
 * single source of truth for what fields exist, their bilingual labels, input
 * type, enum choices, required-ness, defaults, and which are secret/write-only.
 */
export interface FieldSpec {
  key: string;
  label: LocalizedText;
  type: FieldSpecType;
  /** True when the value is sensitive (write-only, masked on read). */
  secret: boolean;
  /** True when the field must be present + non-empty for an ACTIVE endpoint. */
  required: boolean;
  /** Allowed values when `type === 'enum'`. */
  enum?: string[];
  /** Value the console pre-populates when the field is unset. */
  default?: string;
  /** Bilingual inline guidance. */
  help?: LocalizedText;
}

/** The GET /integrations/schema/{kind} payload. Drives the dynamic form. */
export interface IntegrationSchema {
  kind: string;
  fields: FieldSpec[];
}

/** Non-persisted health snapshot for one endpoint (readiness probe). */
export interface IntegrationHealth {
  endpoint_id: string;
  kind: IntegrationKind;
  code: string;
  status: IntegrationStatus;
  reachable: boolean;
  detail: string;
  checked_unix: number;
}

export interface IntegrationHealthListResult {
  health: IntegrationHealth[];
  /** True when the aggregate health read failed or returned an unreadable list shape. */
  degraded: boolean;
}

/** Per-check outcome inside a connection test (TestResult.steps[]). */
export type DiagnosticStatus = 'ok' | 'warn' | 'fail' | 'skip';

/**
 * One diagnostic step in a layered connection test
 * (TestResult.steps[]). Lets the Connection panel show a checklist
 * ("DNS resolves ✓ / auth ✓ / scope warn …") instead of one boolean.
 */
export interface DiagnosticStep {
  key: string;
  label: LocalizedText;
  status: DiagnosticStatus;
  /** Latency of this individual step, milliseconds (when measured). */
  latency_ms?: number;
  detail?: string;
  /** Bilingual remediation hint shown for warn / fail steps. */
  hint?: LocalizedText;
}

/** Sanitized connection-test outcome (POST /integrations/{id}/test). */
export interface TestResult {
  endpoint_id: string;
  reachable: boolean;
  detail: string;
  sample_count: number;
  /** Round-trip latency of the probe, milliseconds. */
  latency_millis: number;
  checked_at?: string;
  /** Layered per-check breakdown; absent on older backends. */
  steps?: DiagnosticStep[];
  metadata?: Record<string, unknown>;
}

/** Sync outcome (POST /integrations/{id}/sync?mode=). */
export interface SyncReport {
  mode: SyncMode;
  processed: number;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  /** Opaque connector cursor after the run (secret-free). */
  watermark?: string;
  detail: string;
  metadata?: Record<string, unknown>;
}

/** One sync-run ledger row (GET /integrations/{id}/sync-runs). */
export interface SyncRun {
  id: string;
  endpoint_id: string;
  kind: string;
  mode: SyncMode;
  status: SyncRunStatus;
  processed: number;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  watermark?: string;
  detail: string;
  error?: string;
  metadata?: Record<string, unknown>;
  started_at: string;
  finished_at: string;
}

export interface SyncRunListResult {
  runs: SyncRun[];
  /** True when the sync-run ledger failed or returned an unreadable list shape. */
  degraded: boolean;
}

/* --------------------------------------------------------------------------- *
 * Connector catalog (GET /integrations/catalog).
 * --------------------------------------------------------------------------- */

/** Production-readiness of a catalog connector. */
export type CatalogMaturity = 'production' | 'gov_gated';

export const CATALOG_MATURITIES: readonly CatalogMaturity[] = [
  'production',
  'gov_gated',
] as const;

/**
 * A discoverable connector blueprint surfaced by the "New integration" gallery
 * (GET /integrations/catalog). It is the connector *type* (keyed by
 * {@link IntegrationKind}), distinct from a registered {@link IntegrationEndpoint}
 * instance. `gov_gated` connectors require Saudi government / TSP onboarding
 * before they can go live; `self_serve === false` flags the same.
 */
export interface CatalogEntry {
  kind: IntegrationKind;
  maturity: CatalogMaturity;
  /** Ordered bilingual prerequisite checklist shown before configuring. */
  prerequisite_steps: LocalizedText[];
  /** Callback/redirect URL templates, label → URL template (e.g. {OAuth: "…/{tenant}/callback"}). */
  callback_templates: Record<string, string>;
  /** Saudi-context tags (e.g. "moj", "nafath", "pdpl") for filtering / badging. */
  ksa_tags: string[];
  /** True when a tenant admin can configure this without a manual onboarding gate. */
  self_serve: boolean;
}

export interface CatalogListResult {
  entries: CatalogEntry[];
  /** True when the live catalog failed or returned an unreadable list shape. */
  degraded: boolean;
}

/* --------------------------------------------------------------------------- *
 * Reconciliation (GET /integrations/{id}/reconciliation).
 * --------------------------------------------------------------------------- */

/**
 * One reconciliation finding — either a GAP (present externally, missing/stale in
 * lex) or a CONFLICT (diverging values on both sides). Grouped by the report.
 */
export interface ReconItem {
  /** Identifier of the record in the external system. */
  external_id: string;
  /** The lex domain entity this maps to (e.g. "case", "hearing", "user"). */
  lex_kind: string;
  /** Short machine-ish issue code/summary (e.g. "missing_in_lex", "status_mismatch"). */
  issue: string;
  /** Human-readable detail of the divergence. */
  detail: string;
  /** Suggested remediation (e.g. "import", "overwrite_lex", "ignore"); optional. */
  suggested?: string;
}

/** Aggregate reconciliation outcome (GET /integrations/{id}/reconciliation). */
export interface ReconciliationReport {
  /** Records present externally but missing / not yet imported into lex. */
  gaps: ReconItem[];
  /** Records present on both sides with diverging values. */
  conflicts: ReconItem[];
  /** Free-form bilingual-or-plain summary line; shape is connector-defined. */
  summary: Record<string, unknown>;
}

export interface ReconciliationReportResult {
  report: ReconciliationReport;
  /** True when the reconciliation read failed or returned an unreadable report shape. */
  degraded: boolean;
}

/* --------------------------------------------------------------------------- *
 * Activity log + health history.
 * --------------------------------------------------------------------------- */

/** One audit row for an endpoint (GET /integrations/{id}/activity). */
export interface ActivityEntry {
  /** Display name / id of the actor who performed the action. */
  actor: string;
  /** Action code (e.g. "integration.updated", "secret.rotated", "sync.triggered"). */
  action: string;
  /** ISO-8601 timestamp the action occurred. */
  at: string;
  /** Secret-free contextual detail for the row. */
  detail?: Record<string, unknown>;
}

export interface ActivityListResult {
  entries: ActivityEntry[];
  /** True when the activity log failed or returned an unreadable list shape. */
  degraded: boolean;
}

/** One historical health probe (GET /integrations/{id}/health-history). */
export interface HealthCheckRecord {
  /** Console health grade recorded at probe time. */
  grade: IntegrationHealthGrade;
  reachable: boolean;
  detail: string;
  /** ISO-8601 timestamp the probe ran. */
  checked_at: string;
}

export interface HealthHistoryResult {
  records: HealthCheckRecord[];
  /** True when the health history failed or returned an unreadable list shape. */
  degraded: boolean;
}

/* --------------------------------------------------------------------------- *
 * Sandbox / webhook invocation results.
 * --------------------------------------------------------------------------- */

/**
 * Generic mock-invocation result for the sandbox + webhook-test affordances
 * (POST /integrations/{id}/sandbox and /webhook-test). The connector decides the
 * `output` shape (e.g. nafath `request` → `{transId, random}`; najiz
 * `pull_hearings` → mock hearings), so it stays an opaque bag the caller renders
 * as pretty JSON.
 */
export interface InvokeResult {
  /** Whether the upstream accepted the action (Go `success`). */
  success: boolean;
  /** Connector-defined echo of the invoked operation name (Go `operation`). */
  operation?: string;
  /**
   * Provider-assigned identifier for the action (e.g. an esign envelope id, an
   * archive object key), when any (Go `reference`).
   */
  reference?: string;
  /** Opaque, secret-free result payload. */
  output: Record<string, unknown>;
  detail?: string;
}

/* --------------------------------------------------------------------------- *
 * Inbound SCIM bearer tokens (HR/SCIM connector activation, kind=hr).
 *
 * A `hr` connector authenticates its inbound SCIM 2.0 provisioning server with a
 * per-endpoint bearer token. Issuing MINTS a raw token exposed EXACTLY ONCE
 * ({@link IssuedScimToken.token}); the list surface returns only non-secret
 * metadata (prefix / label / last-used / revoked). The routes are nil-guarded on
 * the backend, so a 404 means "feature not wired" — the read helper collapses
 * that (and any read failure) to `unavailable` so the console can hide the
 * surface rather than error.
 * --------------------------------------------------------------------------- */

/**
 * One SCIM bearer-token row (GET /integrations/{id}/scim-tokens). Mirrors the Go
 * repository.SCIMToken. The raw token is NEVER returned here — only `token_prefix`
 * (a non-secret display shard), the label, and lifecycle timestamps.
 */
export interface ScimToken {
  id: string;
  tenant_id: string;
  endpoint_id: string;
  /** Non-secret leading shard of the token, safe to display (e.g. "lexscim_…"). */
  token_prefix: string;
  label: string;
  created_by?: string | null;
  last_used_at?: string | null;
  expires_at?: string | null;
  /** Set once the token is revoked (rotation revokes prior tokens). */
  revoked_at?: string | null;
  created_at: string;
  updated_at: string;
}

/** Issue payload for a SCIM bearer token (POST /integrations/{id}/scim-token). */
export interface IssueScimTokenPayload {
  label: string;
  /** Revoke every existing non-revoked token on the endpoint for a clean cut-over. */
  rotate?: boolean;
  /** Optional ISO-8601 expiry; omitted = non-expiring. */
  expires_at?: string;
}

/**
 * Result of issuing/rotating a SCIM token. `token` is the CLEARTEXT bearer,
 * exposed exactly ONCE — surface it copy-once and never persist it.
 */
export interface IssuedScimToken {
  /** The raw cleartext bearer — shown once, never re-fetchable. */
  token: string;
  record: ScimToken;
}

/**
 * Graceful list result for the SCIM-token surface. `unavailable` is true when the
 * endpoint is not a SCIM/HR connector, the route is not wired (404), or the read
 * failed — the console hides the surface rather than distinguishing those.
 */
export interface ScimTokenListResult {
  tokens: ScimToken[];
  unavailable: boolean;
}

/* --------------------------------------------------------------------------- *
 * Reliability: dead-letter queue + circuit breaker (CAP — reliability UI).
 *
 * Two operational surfaces that sit *behind* a connector:
 *   - the DEAD-LETTER QUEUE captures operations that failed every retry
 *     ({@link DeadLetter}); an operator can replay a single entry or batch-replay
 *     all still-failed entries for an endpoint.
 *   - the CIRCUIT BREAKER ({@link BreakerState}) trips OPEN after repeated
 *     failures and quarantines the endpoint until a cooldown elapses (then it
 *     goes HALF_OPEN to probe) or an operator manually resets it.
 *
 * GRACEFUL READS. As elsewhere in this client the read helpers never throw:
 * result-shaped DLQ helpers carry an explicit degraded flag, and
 * {@link lexIntegrationsApi.getBreaker} returns `null`. The mutating helpers
 * (replay / replay-failed / reset) DO surface errors so the caller can toast them.
 * --------------------------------------------------------------------------- */

/** Origin of the failed operation captured in the dead-letter queue. */
export type DeadLetterSource = 'sync' | 'webhook' | 'outbox' | 'invoke';

export const DEAD_LETTER_SOURCES: readonly DeadLetterSource[] = [
  'sync',
  'webhook',
  'outbox',
  'invoke',
] as const;

/** Lifecycle of a dead-letter entry. New failures land as `failed`. */
export type DeadLetterStatus = 'failed' | 'replayed' | 'resolved';

export const DEAD_LETTER_STATUSES: readonly DeadLetterStatus[] = [
  'failed',
  'replayed',
  'resolved',
] as const;

/**
 * One dead-letter entry — a connector operation that exhausted its retries.
 * `payload_redacted` is a secret-free, human-readable snapshot of the original
 * payload (safe to render verbatim); the console shows it in an expandable block.
 */
export interface DeadLetter {
  id: string;
  endpoint_id: string;
  source: DeadLetterSource;
  /** Short, human-readable description of the failed operation. */
  summary: string;
  /** The terminal error string from the last attempt. */
  error: string;
  /** How many times the operation was attempted before it was dead-lettered. */
  attempts: number;
  status: DeadLetterStatus;
  /** Secret-free snapshot of the original payload (safe to display). */
  payload_redacted: string;
  created_at: string;
  last_attempt_at?: string | null;
}

export interface DeadLetterListResult {
  entries: DeadLetter[];
  /** True when the DLQ read failed or returned an unreadable list shape. */
  degraded: boolean;
}

/** Result of replaying a single dead-letter entry (POST …/dlq/{dlqId}/replay). */
export interface ReplayResult {
  ok: boolean;
  /** Opaque, secret-free outcome of the re-run. */
  result?: Record<string, unknown>;
}

/** Result of batch-replaying all failed entries for an endpoint. */
export interface ReplayFailedResult {
  /** Count successfully re-run. */
  replayed: number;
  /** Count that failed again (and stayed dead-lettered). */
  failed: number;
}

/** Circuit-breaker state machine value. */
export type BreakerStateValue = 'closed' | 'open' | 'half_open';

export const BREAKER_STATES: readonly BreakerStateValue[] = [
  'closed',
  'open',
  'half_open',
] as const;

/**
 * Live circuit-breaker snapshot for one endpoint
 * (GET /integrations/{id}/breaker). `closed` = healthy (requests flow), `open` =
 * tripped + quarantined (requests short-circuit) until `cooldown_seconds` from
 * `opened_at` elapses, then `half_open` = probing. `quarantined` is the operator
 * gate that {@link lexIntegrationsApi.resetBreaker} clears.
 */
export interface BreakerState {
  state: BreakerStateValue;
  /** Consecutive failures counted in the current window. */
  failures: number;
  /** Failures that trip the breaker OPEN. */
  failure_threshold: number;
  /** ISO-8601 timestamp the breaker last opened (absent while closed). */
  opened_at?: string | null;
  /** Seconds the breaker stays OPEN before probing HALF_OPEN. */
  cooldown_seconds: number;
  /** True when the endpoint is quarantined (operator reset clears it). */
  quarantined: boolean;
}

/* --------------------------------------------------------------------------- *
 * Governance: maker-checker change requests (#13), secret references (#14),
 * egress policy (#15).
 *
 * A PROTECTED endpoint (active production OR a gov-gated kind) routes config
 * edits through a maker-checker queue instead of applying them directly: the
 * "maker" (requester) proposes a config map via {@link lexIntegrationsApi.proposeChange};
 * if the endpoint is protected the backend returns a {@link PendingChange}
 * (status `pending`, `applied:false`) and a "checker" (a *different* operator
 * where SoD is enforced) approves or rejects it. Approve applies the diff and
 * returns the live endpoint; reject records a mandatory note and leaves the
 * stored config untouched.
 *
 * SECRET SAFETY. A {@link ChangeDiff} field flagged `secret:true` NEVER carries
 * plaintext: its `old`/`new` are masked sentinels (e.g. "••••••" / a
 * {@link REDACTED_SENTINEL}, or — for #14 external references — the *reference*
 * string `kms://…` / `vault://…`, which is itself non-secret because the value
 * is resolved at call time by the external key provider). The console renders
 * secret diffs as "changed" without ever showing a cleartext value.
 *
 * GRACEFUL READS, as elsewhere in this client:
 * {@link lexIntegrationsApi.getPendingChangesResult} carries an explicit
 * degraded flag so the queue can distinguish "empty" from "unavailable";
 * {@link lexIntegrationsApi.getEgressPolicy} returns `null` on any 404 / shape
 * mismatch; the mutating helpers surface errors so the caller can toast them.
 * --------------------------------------------------------------------------- */

/** Lifecycle of a maker-checker change request. */
export type PendingChangeStatus = 'pending' | 'approved' | 'rejected';

export const PENDING_CHANGE_STATUSES: readonly PendingChangeStatus[] = [
  'pending',
  'approved',
  'rejected',
] as const;

/**
 * One field-level delta inside a {@link PendingChange}. For a `secret:true`
 * field, `old`/`new` are ALREADY masked by the backend (sentinel or external
 * reference) — they are safe to render verbatim and must never be un-masked.
 */
export interface ChangeDiff {
  /** Config key that changed (matches a {@link FieldSpec.key}). */
  field: string;
  /** Prior value — masked when `secret`. May be absent for a newly-set field. */
  old?: unknown;
  /** Proposed value — masked when `secret`. */
  new?: unknown;
  /** True when the field is a secret/write-only config key (mask the diff). */
  secret: boolean;
}

/**
 * A maker-checker change request awaiting (or past) review
 * (GET /integrations/pending-changes). `kind` mirrors the endpoint's
 * {@link IntegrationKind}; `diff` is the secret-masked field-level delta the
 * change would apply; `reviewer`/`reviewed_at`/`note` are populated once acted on.
 */
export interface PendingChange {
  id: string;
  endpoint_id: string;
  /** Human-readable name of the target endpoint (for the queue without a join). */
  endpoint_name: string;
  kind: IntegrationKind;
  /** Secret-masked field-level deltas the change would apply. */
  diff: ChangeDiff[];
  /** Actor who proposed the change (the "maker"). */
  requested_by: string;
  requested_at: string;
  status: PendingChangeStatus;
  /** Actor who approved/rejected (the "checker"); absent while `pending`. */
  reviewer?: string | null;
  reviewed_at?: string | null;
  /** Reviewer note: optional on approve, REQUIRED on reject. */
  note?: string | null;
}

export interface PendingChangesResult {
  changes: PendingChange[];
  /** True when the pending-change queue failed or returned an unreadable list shape. */
  degraded: boolean;
}

/**
 * Result of proposing a config change (POST /integrations/{id}/changes). When
 * the endpoint is PROTECTED the backend returns a {@link PendingChange}
 * (`applied:false`); otherwise it applies immediately and returns the live
 * {@link IntegrationEndpoint}. The discriminated `applied` flag lets the caller
 * decide whether to show "queued for approval" vs. "saved".
 */
export type ProposeChangeResult =
  | { applied: false; pending: PendingChange }
  | { applied: true; endpoint: IntegrationEndpoint };

/**
 * Egress policy for an endpoint (GET/PUT /integrations/{id}/egress-policy) — the
 * data-residency / DLP guardrail (#15). `allowed_regions` whitelists the
 * destination regions data may leave to (in-Kingdom by default); `allowed_egress_fields`
 * whitelists which lex fields may be sent outbound; `blocked_count` is the
 * running tally of egress attempts the policy has blocked.
 */
export interface EgressPolicy {
  /** Whitelisted destination regions (e.g. "sa-central", "sa-riyadh"). */
  allowed_regions: string[];
  /** Whitelisted outbound field keys; everything else is stripped/blocked. */
  allowed_egress_fields: string[];
  /** Running count of egress attempts blocked by this policy. */
  blocked_count: number;
  updated_at?: string | null;
}

/** PUT payload for {@link lexIntegrationsApi.putEgressPolicy} (counts are read-only). */
export interface EgressPolicyInput {
  allowed_regions: string[];
  allowed_egress_fields: string[];
}

/* --------------------------------------------------------------------------- *
 * Secret references (#14). A secret config field value may be an EXTERNAL
 * REFERENCE resolved at call time by the external key provider instead of a
 * literal stored secret:
 *   - "kms://<keyId>"            (e.g. "kms://alias/lex-najiz-signing")
 *   - "vault://<path>#<field>"   (e.g. "vault://secret/lex/najiz#client_secret")
 * The dynamic form offers a "use external reference" toggle that swaps the
 * password input for a reference input. Two NON-SECRET companion config fields
 * drive rotation: `rotate_every_days` (0 = off) and `secret_ref_provider`
 * (none | kms | vault).
 * --------------------------------------------------------------------------- */

/** Provider that backs an external secret reference (non-secret config field). */
export type SecretRefProvider = 'none' | 'kms' | 'vault';

export const SECRET_REF_PROVIDERS: readonly SecretRefProvider[] = [
  'none',
  'kms',
  'vault',
] as const;

/** Companion non-secret config key: rotation cadence in days (0 = disabled). */
export const SECRET_ROTATE_EVERY_DAYS_KEY = 'rotate_every_days';
/** Companion non-secret config key: which external provider backs the ref. */
export const SECRET_REF_PROVIDER_KEY = 'secret_ref_provider';

/** URI schemes a secret value may use to denote an external reference. */
export const SECRET_REF_SCHEMES = ['kms://', 'vault://'] as const;

/**
 * True when a (string) secret value is an EXTERNAL REFERENCE (`kms://` /
 * `vault://`) rather than a literal secret. References are non-secret (the real
 * value is resolved at call time) so they are safe to display verbatim.
 */
export function isSecretRef(value: unknown): boolean {
  return (
    typeof value === 'string' &&
    SECRET_REF_SCHEMES.some((scheme) => value.startsWith(scheme))
  );
}

/** Infer the {@link SecretRefProvider} from a reference string, else `none`. */
export function secretRefProvider(value: unknown): SecretRefProvider {
  if (typeof value !== 'string') return 'none';
  if (value.startsWith('kms://')) return 'kms';
  if (value.startsWith('vault://')) return 'vault';
  return 'none';
}

/* --------------------------------------------------------------------------- *
 * Observability: SLO metrics (#16) + event inspector (#17).
 *
 * Two read surfaces plus one mutating action that sit ALONGSIDE a connector:
 *   - METRICS roll up a connector's recent traffic into call/error/latency/
 *     throughput figures with an SLO target + breach flag ({@link ConnectorMetrics}),
 *     both per-endpoint and as a tenant rollup ({@link OverviewMetrics}).
 *   - the EVENT INSPECTOR exposes the recent inbound/outbound {@link IntegrationEvent}
 *     stream (signature validity, status, redacted payload), per-endpoint and
 *     tenant-wide, filterable; an INBOUND event can be REPLAYED (re-processed).
 *
 * GRACEFUL READS, as elsewhere in this client: {@link lexIntegrationsApi.getMetrics}
 * returns `null`, while {@link lexIntegrationsApi.getMetricsOverviewResult} and
 * the event result helpers carry an explicit degraded flag; mutating helpers
 * surface errors so the caller can toast them.
 *
 * SECRET SAFETY. {@link IntegrationEvent.payload_redacted} is a secret-free,
 * human-readable snapshot (same contract as {@link DeadLetter.payload_redacted}) —
 * the console renders it verbatim and NEVER an un-redacted payload.
 * --------------------------------------------------------------------------- */

/** Rolling window over which a metrics snapshot is computed (query value). */
export type MetricsWindow = '1h' | '24h' | '7d';

export const METRICS_WINDOWS: readonly MetricsWindow[] = ['1h', '24h', '7d'] as const;

/** Per-operation breakdown inside a {@link ConnectorMetrics} snapshot. */
export interface ConnectorOpMetrics {
  /** Connector operation name (e.g. "pull_hearings", "verify"). */
  op: string;
  calls: number;
  /** Fraction in [0,1] of calls that errored for this op. */
  error_rate: number;
  /** p95 latency for this op, milliseconds. */
  p95_ms: number;
}

/**
 * Full SLO/traffic snapshot for ONE endpoint over `window`
 * (GET /integrations/{id}/metrics?window=). `error_rate` is a fraction in [0,1];
 * `slo_target_pct` is the configured success-rate objective (default 99) and
 * `slo_breached` is true when the observed success rate fell below it.
 */
export interface ConnectorMetrics {
  calls: number;
  errors: number;
  /** Fraction in [0,1] of calls that errored. */
  error_rate: number;
  latency_p50_ms: number;
  latency_p95_ms: number;
  /** Records synced through the connector over the window. */
  sync_throughput: number;
  /** Echo of the window the snapshot covers. */
  window: MetricsWindow | string;
  /** Configured success-rate objective, percent (default 99). */
  slo_target_pct: number;
  /** True when the observed success rate fell below `slo_target_pct`. */
  slo_breached: boolean;
  /** Per-operation breakdown (may be empty). */
  by_op: ConnectorOpMetrics[];
}

/**
 * One tenant-rollup row (GET /integrations/metrics) summarizing an endpoint's
 * recent traffic for the observability grid. `error_rate` is a fraction in [0,1].
 */
export interface OverviewMetrics {
  endpoint_id: string;
  kind: IntegrationKind;
  name: string;
  calls: number;
  /** Fraction in [0,1] of calls that errored. */
  error_rate: number;
  latency_p95_ms: number;
  slo_breached: boolean;
}

export interface MetricsOverviewResult {
  rows: OverviewMetrics[];
  /** True when the tenant metrics rollup failed or returned an unreadable list shape. */
  degraded: boolean;
}

/** Direction of an integration event relative to the platform. */
export type EventDirection = 'inbound' | 'outbound';

export const EVENT_DIRECTIONS: readonly EventDirection[] = ['inbound', 'outbound'] as const;

/** Processing lifecycle of an integration event. */
export type EventStatus = 'received' | 'processed' | 'failed';

export const EVENT_STATUSES: readonly EventStatus[] = [
  'received',
  'processed',
  'failed',
] as const;

/**
 * One inbound/outbound integration event (GET /integrations/{id}/events and
 * GET /integrations/events). `payload_redacted` is a secret-free snapshot safe
 * to render verbatim; `signature_valid` reflects inbound webhook signature
 * verification. Only INBOUND events can be {@link lexIntegrationsApi.replayEvent | replayed}.
 */
export interface IntegrationEvent {
  id: string;
  endpoint_id: string;
  direction: EventDirection;
  /** Event kind / type (connector-defined, e.g. "hearing.updated"). */
  kind: string;
  /** Inbound signature verification result (false / absent for outbound). */
  signature_valid: boolean;
  status: EventStatus;
  /** What the connector did with the event (e.g. "imported", "ignored"). */
  result_action: string;
  /** Secret-free snapshot of the event payload (safe to display). */
  payload_redacted: string;
  /** Terminal error string when `status === 'failed'`. */
  error: string;
  occurred_at: string;
}

export interface IntegrationEventsResult {
  events: IntegrationEvent[];
  /** True when the event stream failed or returned an unreadable list shape. */
  degraded: boolean;
}

/** Filters for the event inspector (per-endpoint and tenant-wide). */
export interface EventFilters {
  direction?: EventDirection;
  kind?: string;
  status?: EventStatus;
  limit?: number;
}

/** Result of replaying (re-processing) an inbound event. */
export interface ReplayEventResult {
  ok: boolean;
  /** Opaque, secret-free outcome of the re-processing. */
  result?: Record<string, unknown>;
}

/* --------------------------------------------------------------------------- *
 * Extensibility #18 — No-code custom REST connector spec.
 *
 * A connector of kind `custom` carries, in its `config`, a declarative REST
 * {@link CustomConnectorSpec} that the backend's CustomConnector adapter executes:
 * a base URL, an auth block, a request template, a response mapping (records path
 * + field map) and a pagination strategy. The no-code builder
 * (`custom-connector-builder.tsx`) edits this spec and produces it as the
 * `config` payload of a normal POST /integrations (kind=custom); the existing
 * GET /integrations/schema/custom returns the FieldSpec list and the existing
 * /test runs it.
 *
 * The spec is stored under the {@link CUSTOM_SPEC_CONFIG_KEY} config key (a single
 * JSON blob) so the dynamic form / schema machinery treats it as one field; the
 * builder serializes it on save and parses it on load via {@link parseCustomSpec}.
 * --------------------------------------------------------------------------- */

/** Authentication strategy a custom REST connector uses. */
export type CustomAuthType = 'none' | 'basic' | 'bearer' | 'oauth2_cc' | 'hmac';

export const CUSTOM_AUTH_TYPES: readonly CustomAuthType[] = [
  'none',
  'basic',
  'bearer',
  'oauth2_cc',
  'hmac',
] as const;

/** HTTP method the request template fires. */
export type CustomHttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export const CUSTOM_HTTP_METHODS: readonly CustomHttpMethod[] = [
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
] as const;

/** Pagination strategy the adapter walks. */
export type CustomPaginationType = 'none' | 'page' | 'cursor';

export const CUSTOM_PAGINATION_TYPES: readonly CustomPaginationType[] = [
  'none',
  'page',
  'cursor',
] as const;

/**
 * Auth block of a {@link CustomConnectorSpec}. Only the fields relevant to the
 * selected `type` are populated; secret material (password / token / client
 * secret / hmac secret) is write-only and masked to {@link REDACTED_SENTINEL} on
 * read, exactly like a schema SECRET field.
 */
export interface CustomAuthSpec {
  type: CustomAuthType;
  /** basic: username. */
  username?: string;
  /** basic: password (SECRET, masked on read). */
  password?: string;
  /** bearer: static bearer token (SECRET, masked on read). */
  token?: string;
  /** oauth2_cc: token endpoint URL. */
  token_url?: string;
  /** oauth2_cc: client id. */
  client_id?: string;
  /** oauth2_cc: client secret (SECRET, masked on read). */
  client_secret?: string;
  /** oauth2_cc: space-separated scopes. */
  scope?: string;
  /** hmac: header name carrying the signature (e.g. "X-Signature"). */
  header?: string;
  /** hmac: shared signing secret (SECRET, masked on read). */
  secret?: string;
}

/** Request template the adapter renders + fires for each sync/test call. */
export interface CustomRequestSpec {
  method: CustomHttpMethod;
  /** Path appended to `base_url` (may carry `{cursor}` / `{page}` tokens). */
  path: string;
  /** Static request headers (header → value). */
  headers: Record<string, string>;
  /** Body template (string; usually JSON) sent for non-GET methods. */
  body_template: string;
}

/**
 * How the adapter extracts records + maps fields out of the response.
 * `records_path` is a dot-path to the array of records (e.g. `data.items`);
 * `field_map` maps a TARGET lex attribute → a source path within each record.
 */
export interface CustomResponseMapping {
  /** Dot-path to the records array in the response body (empty = root array). */
  records_path: string;
  /** Map of lex target attribute → source field path within a record. */
  field_map: Record<string, string>;
}

/** Pagination configuration the adapter walks across pages/cursors. */
export interface CustomPaginationSpec {
  type: CustomPaginationType;
  /** Query/body param carrying the page number or cursor token. */
  param: string;
}

/**
 * The full declarative REST spec a `custom`-kind connector executes. Persisted as
 * a JSON blob under {@link CUSTOM_SPEC_CONFIG_KEY} in the endpoint `config`.
 */
export interface CustomConnectorSpec {
  base_url: string;
  auth: CustomAuthSpec;
  request: CustomRequestSpec;
  response_mapping: CustomResponseMapping;
  pagination: CustomPaginationSpec;
}

/** Config key under which the custom REST spec JSON blob is stored. */
export const CUSTOM_SPEC_CONFIG_KEY = 'spec';

/** A pristine, sensible default spec for the no-code builder's initial state. */
export function emptyCustomSpec(): CustomConnectorSpec {
  return {
    base_url: '',
    auth: { type: 'none' },
    request: { method: 'GET', path: '', headers: {}, body_template: '' },
    response_mapping: { records_path: '', field_map: {} },
    pagination: { type: 'none', param: '' },
  };
}

/**
 * Coerce a stored config value (object | JSON string | undefined) into a
 * {@link CustomConnectorSpec}, folding any missing branch in from
 * {@link emptyCustomSpec} so the builder never reads `undefined`. NEVER throws.
 */
export function parseCustomSpec(value: unknown): CustomConnectorSpec {
  const base = emptyCustomSpec();
  let obj: unknown = value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return base;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      return base;
    }
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return base;
  const src = obj as Partial<CustomConnectorSpec>;
  return {
    base_url: typeof src.base_url === 'string' ? src.base_url : base.base_url,
    auth: { ...base.auth, ...(src.auth ?? {}) },
    request: {
      ...base.request,
      ...(src.request ?? {}),
      headers:
        src.request && typeof src.request.headers === 'object' && src.request.headers
          ? (src.request.headers as Record<string, string>)
          : base.request.headers,
    },
    response_mapping: {
      records_path:
        src.response_mapping && typeof src.response_mapping.records_path === 'string'
          ? src.response_mapping.records_path
          : base.response_mapping.records_path,
      field_map:
        src.response_mapping && typeof src.response_mapping.field_map === 'object'
          ? (src.response_mapping.field_map as Record<string, string>)
          : base.response_mapping.field_map,
    },
    pagination: { ...base.pagination, ...(src.pagination ?? {}) },
  };
}

/* --------------------------------------------------------------------------- *
 * Extensibility #19 — Sync rules (transform / filter pipeline).
 *
 * An endpoint `config` may carry a `sync_rules` array of {@link RuleSpec}: an
 * ordered pipeline of TRANSFORMs (mutate a field) and FILTERs (drop records that
 * fail a predicate) the backend applies during sync (and surfaces in the #5
 * dry-run preview). Edited inline in the connector form by `rules-editor.tsx`.
 * --------------------------------------------------------------------------- */

/** A pipeline rule is either a value transform or a record filter. */
export type RuleType = 'transform' | 'filter';

export const RULE_TYPES: readonly RuleType[] = ['transform', 'filter'] as const;

/** Transform operations a `transform` rule may apply to a field. */
export type TransformOp = 'concat' | 'lookup' | 'default' | 'regex' | 'date_format';

export const TRANSFORM_OPS: readonly TransformOp[] = [
  'concat',
  'lookup',
  'default',
  'regex',
  'date_format',
] as const;

/** Predicate operations a `filter` rule may test on a field. */
export type FilterOp = 'eq' | 'ne' | 'in' | 'exists' | 'gt' | 'lt';

export const FILTER_OPS: readonly FilterOp[] = [
  'eq',
  'ne',
  'in',
  'exists',
  'gt',
  'lt',
] as const;

/** Every op string a {@link RuleSpec} may carry (union of transform + filter). */
export type RuleOp = TransformOp | FilterOp;

/**
 * One rule in the sync pipeline. `op` is a {@link TransformOp} when
 * `type === 'transform'` and a {@link FilterOp} when `type === 'filter'`. `field`
 * is the record field the op targets. `args` are op-specific positional
 * arguments (e.g. concat → other field names; default → the fallback value;
 * regex → [pattern, replacement]; in → the allowed values; date_format → [from,
 * to] format strings). Kept as string[] for a connector-agnostic wire shape.
 */
export interface RuleSpec {
  type: RuleType;
  op: RuleOp;
  field: string;
  args: string[];
}

/** Config key under which the sync-rules pipeline array is stored. */
export const SYNC_RULES_CONFIG_KEY = 'sync_rules';

/** Coerce a stored config value into a {@link RuleSpec}[]. NEVER throws. */
export function parseSyncRules(value: unknown): RuleSpec[] {
  let arr: unknown = value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return [];
    try {
      arr = JSON.parse(trimmed);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(arr)) return [];
  const out: RuleSpec[] = [];
  for (const raw of arr) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Partial<RuleSpec>;
    const type: RuleType = r.type === 'filter' ? 'filter' : 'transform';
    out.push({
      type,
      op: (typeof r.op === 'string' ? r.op : type === 'filter' ? 'eq' : 'default') as RuleOp,
      field: typeof r.field === 'string' ? r.field : '',
      args: Array.isArray(r.args) ? r.args.map((a) => String(a)) : [],
    });
  }
  return out;
}

/* --------------------------------------------------------------------------- *
 * Extensibility #20 — Conflicts queue + mass-change guard.
 *
 * RECONCILE populates a per-endpoint {@link Conflict} queue: a field-level
 * divergence between an external record and its lex counterpart, awaiting an
 * operator resolution (merge / override / ignore). The conflicts route
 * (`[id]/conflicts`) lists them; resolving one is a manage-gated action.
 *
 * The MASS-CHANGE GUARD protects a sync from a runaway deactivation: POST
 * /integrations/{id}/sync returns 409 + a {@link MassChangeGuard} summary when a
 * run would deactivate more than `mass_change_threshold_pct` of mapped org
 * entities, UNLESS `?force=true`. {@link syncNow} / {@link previewSync} surface
 * that as a discriminated {@link GuardedSyncResult} so the preview dialog can ask
 * the operator to confirm + force.
 * --------------------------------------------------------------------------- */

/** Lifecycle of a reconciliation conflict. */
export type ConflictStatus = 'open' | 'resolved';

export const CONFLICT_STATUSES: readonly ConflictStatus[] = ['open', 'resolved'] as const;

/** How an operator resolves a conflict. */
export type ConflictResolution = 'merge' | 'override' | 'ignore';

export const CONFLICT_RESOLUTIONS: readonly ConflictResolution[] = [
  'merge',
  'override',
  'ignore',
] as const;

/**
 * One reconciliation conflict (GET /integrations/{id}/conflicts). `source_value`
 * is the external system's value, `lex_value` the platform's; `suggested` is the
 * connector's recommended {@link ConflictResolution}; `resolution` is populated
 * once an operator acts (and `status` flips to `resolved`).
 */
export interface Conflict {
  id: string;
  endpoint_id: string;
  external_id: string;
  field: string;
  source_value: string;
  lex_value: string;
  status: ConflictStatus;
  /** Applied resolution once resolved; absent/empty while open. */
  resolution?: ConflictResolution | string;
  /** Connector-suggested resolution; optional. */
  suggested?: ConflictResolution | string;
  detected_at: string;
}

export interface ConflictListResult {
  conflicts: Conflict[];
  /** True when the conflicts queue failed or returned an unreadable list shape. */
  degraded: boolean;
}

/**
 * The guard summary returned alongside a 409 when a sync would deactivate too
 * large a share of mapped org entities. `would_deactivate` is the absolute count,
 * `mapped_total` the denominator, `pct` the resulting percentage, `threshold_pct`
 * the configured ceiling. All fields are read defensively.
 */
export interface MassChangeGuard {
  would_deactivate: number;
  mapped_total: number;
  /** Percentage of mapped entities the run would deactivate (0–100). */
  pct: number;
  /** Configured ceiling (`mass_change_threshold_pct`, default 20). */
  threshold_pct: number;
  detail?: string;
}

/** Config key for the non-secret mass-change deactivation ceiling (percent). */
export const MASS_CHANGE_THRESHOLD_KEY = 'mass_change_threshold_pct';

/** Default mass-change deactivation ceiling (percent) when unset. */
export const MASS_CHANGE_THRESHOLD_DEFAULT = 20;

/**
 * Result of a sync attempt that may be blocked by the mass-change guard:
 * `guarded:false` carries the normal {@link SyncReport}; `guarded:true` carries
 * the {@link MassChangeGuard} summary so the caller can confirm + re-run with
 * `force`.
 */
export type GuardedSyncResult =
  | { guarded: false; report: SyncReport }
  | { guarded: true; guard: MassChangeGuard };

/* --------------------------------------------------------------------------- *
 * Internal envelope helpers. The integration handlers respond with the suite
 * `WriteData` envelope: `{ data: T }` for singletons and `{ data: T[] }` for
 * lists (NOT paginated — the registry List returns a flat array).
 * --------------------------------------------------------------------------- */

function unwrapData<T>(payload: unknown): T | undefined {
  if (payload && typeof payload === 'object' && 'data' in payload) {
    return (payload as { data: T }).data;
  }
  return undefined;
}

function unwrapList<T>(payload: unknown): T[] {
  const data = unwrapData<T[]>(payload);
  if (Array.isArray(data)) return data;
  // Some endpoints may return a bare array; accept that defensively.
  if (Array.isArray(payload)) return payload as T[];
  return [];
}

function unwrapListResult<T>(payload: unknown): { items: T[]; degraded: boolean } {
  const data = unwrapData<T[]>(payload);
  if (Array.isArray(data)) return { items: data, degraded: false };
  // Some endpoints may return a bare array; accept that defensively.
  if (Array.isArray(payload)) return { items: payload as T[], degraded: false };
  return { items: [], degraded: true };
}

/* --------------------------------------------------------------------------- *
 * Mass-change guard (#20) extraction. The 409 guard body is NOT a plain
 * validation error, so it is read off the RAW axios error (the shared
 * `buildApiError` flattens the response and would drop the structured summary).
 * The sync helpers below therefore call the axios `api` instance directly and
 * route 409s through this normalizer; any other error re-throws untouched so the
 * caller's `showApiError` still works.
 * --------------------------------------------------------------------------- */

function readNumber(obj: Record<string, unknown> | undefined, ...keys: string[]): number {
  if (!obj) return 0;
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
  }
  return 0;
}

/**
 * True when an unknown error is an axios-style 409 (mass-change guard). Reads the
 * status defensively from either the axios `response.status` or our flattened
 * {@link import('@/types/api').ApiError}.`status`.
 */
function isGuard409(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as { response?: { status?: number }; status?: number };
  return e.response?.status === 409 || e.status === 409;
}

/** Pull the {@link MassChangeGuard} summary out of a raw 409 axios error body. */
function extractGuard(error: unknown): MassChangeGuard {
  const e = error as { response?: { data?: unknown } } | undefined;
  const body = (e?.response?.data ?? {}) as Record<string, unknown>;
  // The summary may sit at the body root, under `data`, or under `guard`.
  const candidates: Array<Record<string, unknown>> = [];
  if (body && typeof body === 'object') candidates.push(body);
  const data = body['data'];
  if (data && typeof data === 'object') candidates.push(data as Record<string, unknown>);
  const guard = body['guard'];
  if (guard && typeof guard === 'object') candidates.push(guard as Record<string, unknown>);
  // Prefer the candidate that actually carries a deactivation count.
  const src =
    candidates.find(
      (c) =>
        'would_deactivate' in c ||
        'deactivate' in c ||
        'deactivated' in c ||
        'pct' in c ||
        'percent' in c,
    ) ?? body;
  return {
    would_deactivate: readNumber(src, 'would_deactivate', 'deactivate', 'deactivated'),
    mapped_total: readNumber(src, 'mapped_total', 'mapped', 'total'),
    pct: readNumber(src, 'pct', 'percent', 'percentage'),
    threshold_pct: readNumber(src, 'threshold_pct', 'threshold', MASS_CHANGE_THRESHOLD_KEY),
    detail: typeof src['detail'] === 'string' ? (src['detail'] as string) : undefined,
  };
}

/**
 * Run a sync-style POST through the RAW axios instance and normalize a 409 into a
 * {@link GuardedSyncResult}. Any non-409 error re-throws so the caller can toast.
 */
async function postSyncGuarded(url: string): Promise<GuardedSyncResult> {
  try {
    const res = await api.post<{ data: SyncReport }>(url);
    return { guarded: false, report: res.data.data };
  } catch (error) {
    if (isGuard409(error)) {
      return { guarded: true, guard: extractGuard(error) };
    }
    throw error;
  }
}

/* --------------------------------------------------------------------------- *
 * Health-grade derivation. Used by the grouped-card list when the backend does
 * not emit `health_grade`. Pure + deterministic.
 * --------------------------------------------------------------------------- */

/**
 * Derive an honest console health grade for an endpoint. Prefers an explicit
 * `endpoint.health_grade` from the wire; otherwise maps status + last-error.
 * Optionally folds in a fresh {@link IntegrationHealth} probe (reachable flag).
 */
export function deriveHealthGrade(
  endpoint: Pick<IntegrationEndpoint, 'status' | 'last_error' | 'health_grade'>,
  probe?: Pick<IntegrationHealth, 'reachable'> | null,
): IntegrationHealthGrade {
  if (endpoint.health_grade && INTEGRATION_HEALTH_GRADES.includes(endpoint.health_grade)) {
    return endpoint.health_grade;
  }
  switch (endpoint.status) {
    case 'planned':
      return 'unconfigured';
    case 'disabled':
      return 'disabled';
    case 'error':
      return 'down';
    case 'active': {
      if (probe) return probe.reachable ? 'healthy' : 'degraded';
      return endpoint.last_error ? 'degraded' : 'healthy';
    }
    default:
      return 'degraded';
  }
}

/* --------------------------------------------------------------------------- *
 * API client.
 * --------------------------------------------------------------------------- */

export const lexIntegrationsApi = {
  /**
   * List registered endpoints for the tenant, optionally filtered by kind /
   * status. Never throws; callers that need to distinguish a successful empty
   * registry from a failed read should use `degraded`.
   */
  async listIntegrationsResult(filters?: {
    kind?: IntegrationKind;
    status?: IntegrationStatus;
  }): Promise<IntegrationListResult> {
    try {
      const params: Record<string, string> = {};
      if (filters?.kind) params.kind = filters.kind;
      if (filters?.status) params.status = filters.status;
      const payload = await apiGet<unknown>(LEX_INTEGRATIONS_ENDPOINT, params);
      const parsed = unwrapListResult<IntegrationEndpoint>(payload);
      return { endpoints: parsed.items, degraded: parsed.degraded };
    } catch {
      return { endpoints: [], degraded: true };
    }
  },

  /** Contract-shaped convenience wrapper returning just the endpoint array. */
  async listIntegrations(filters?: {
    kind?: IntegrationKind;
    status?: IntegrationStatus;
  }): Promise<IntegrationEndpoint[]> {
    const result = await lexIntegrationsApi.listIntegrationsResult(filters);
    return result.endpoints;
  },

  /**
   * Get one endpoint by id (masked config). Throws on failure so the detail page
   * can render a proper error/not-found state.
   */
  async getIntegration(id: string): Promise<IntegrationEndpoint> {
    const payload = await apiGet<unknown>(`${LEX_INTEGRATIONS_ENDPOINT}/${id}`);
    const data = unwrapData<IntegrationEndpoint>(payload);
    if (!data) {
      throw new Error('integration endpoint not found');
    }
    return data;
  },

  /** Register a new endpoint. Surfaces errors (validation / conflict) to caller. */
  async createIntegration(payload: CreateIntegrationPayload): Promise<IntegrationEndpoint> {
    const res = await apiPost<{ data: IntegrationEndpoint }>(LEX_INTEGRATIONS_ENDPOINT, payload);
    return res.data;
  },

  /**
   * Patch an endpoint (PUT; omitted fields unchanged). Secret config fields left
   * as {@link REDACTED_SENTINEL} keep the stored secret — pass them through.
   */
  async updateIntegration(
    id: string,
    payload: UpdateIntegrationPayload,
  ): Promise<IntegrationEndpoint> {
    const res = await apiPut<{ data: IntegrationEndpoint }>(
      `${LEX_INTEGRATIONS_ENDPOINT}/${id}`,
      payload,
    );
    return res.data;
  },

  /** Delete an endpoint (204). Surfaces errors to caller. */
  async deleteIntegration(id: string): Promise<void> {
    await apiDelete<void>(`${LEX_INTEGRATIONS_ENDPOINT}/${id}`);
  },

  /**
   * Probe every endpoint for the tenant (GET /integrations/health). Never throws;
   * callers that surface health-read failures can inspect `degraded`.
   */
  async getIntegrationsHealthResult(): Promise<IntegrationHealthListResult> {
    try {
      const payload = await apiGet<unknown>(`${LEX_INTEGRATIONS_ENDPOINT}/health`);
      const parsed = unwrapListResult<IntegrationHealth>(payload);
      return { health: parsed.items, degraded: parsed.degraded };
    } catch {
      return { health: [], degraded: true };
    }
  },

  /** Contract-shaped convenience wrapper returning just the aggregate health array. */
  async getIntegrationsHealth(): Promise<IntegrationHealth[]> {
    const result = await lexIntegrationsApi.getIntegrationsHealthResult();
    return result.health;
  },

  /**
   * Probe a single endpoint (GET /integrations/{id}/health). Graceful: returns
   * `null` on failure so the right-rail Connection panel can show "unknown".
   */
  async getIntegrationHealth(id: string): Promise<IntegrationHealth | null> {
    try {
      const payload = await apiGet<unknown>(`${LEX_INTEGRATIONS_ENDPOINT}/${id}/health`);
      return unwrapData<IntegrationHealth>(payload) ?? null;
    } catch {
      return null;
    }
  },

  /**
   * Fetch the dynamic-form field specs for a kind
   * (GET /integrations/schema/{kind}). Graceful: returns `[]` for an unknown
   * kind / 404 so the form can render an explanatory empty-state rather than
   * crashing. The returned specs DRIVE the DynamicConnectorForm.
   */
  async getSchema(kind: IntegrationKind): Promise<FieldSpec[]> {
    try {
      const payload = await apiGet<unknown>(`${LEX_INTEGRATIONS_ENDPOINT}/schema/${kind}`);
      const schema = unwrapData<IntegrationSchema>(payload);
      return Array.isArray(schema?.fields) ? schema!.fields : [];
    } catch {
      return [];
    }
  },

  /**
   * Run the connector's connection test (POST /integrations/{id}/test). Surfaces
   * errors (e.g. 422 capability-not-supported) to the caller so the panel can
   * distinguish "unsupported" from "unreachable".
   */
  async testConnection(id: string): Promise<TestResult> {
    const res = await apiPost<{ data: TestResult }>(`${LEX_INTEGRATIONS_ENDPOINT}/${id}/test`);
    return res.data;
  },

  /**
   * Trigger a sync (POST /integrations/{id}/sync?mode=full|delta). Returns a
   * discriminated {@link GuardedSyncResult}: `guarded:false` carries the
   * {@link SyncReport}; `guarded:true` carries the mass-change guard summary (#20)
   * when the run would deactivate more than the configured threshold and `force`
   * was not set. Pass `force` to bypass the guard (`?force=true`). Non-guard
   * errors re-throw so the caller can toast them.
   */
  async syncNow(
    id: string,
    mode: SyncMode = 'delta',
    force = false,
  ): Promise<GuardedSyncResult> {
    const qs = `mode=${mode}${force ? '&force=true' : ''}`;
    return postSyncGuarded(`${LEX_INTEGRATIONS_ENDPOINT}/${id}/sync?${qs}`);
  },

  /**
   * Fetch the sync-run ledger for an endpoint
   * (GET /integrations/{id}/sync-runs?limit=). Never throws; inspect
   * `degraded` to distinguish an empty ledger from an unavailable one.
   */
  async listSyncRunsResult(id: string, limit = 50): Promise<SyncRunListResult> {
    try {
      const payload = await apiGet<unknown>(
        `${LEX_INTEGRATIONS_ENDPOINT}/${id}/sync-runs`,
        { limit },
      );
      const parsed = unwrapListResult<SyncRun>(payload);
      return { runs: parsed.items, degraded: parsed.degraded };
    } catch {
      return { runs: [], degraded: true };
    }
  },

  /** Contract-shaped convenience wrapper returning just the sync-run ledger. */
  async listSyncRuns(id: string, limit = 50): Promise<SyncRun[]> {
    const result = await lexIntegrationsApi.listSyncRunsResult(id, limit);
    return result.runs;
  },

  /**
   * Fetch the discoverable connector catalog (GET /integrations/catalog) that
   * powers the "New integration" gallery. Never throws; inspect `degraded` so
   * callers can warn while still falling back to the static kind list.
   */
  async getCatalogResult(): Promise<CatalogListResult> {
    try {
      const payload = await apiGet<unknown>(`${LEX_INTEGRATIONS_ENDPOINT}/catalog`);
      const parsed = unwrapListResult<CatalogEntry>(payload);
      return { entries: parsed.items, degraded: parsed.degraded };
    } catch {
      return { entries: [], degraded: true };
    }
  },

  /** Contract-shaped convenience wrapper returning just the catalog entries. */
  async getCatalog(): Promise<CatalogEntry[]> {
    const result = await lexIntegrationsApi.getCatalogResult();
    return result.entries;
  },

  /**
   * DRY-RUN sync preview (POST /integrations/{id}/sync?mode=preview). Commits
   * NOTHING; returns a discriminated {@link GuardedSyncResult}: `guarded:false`
   * carries the {@link SyncReport} (with `dry_run: true`) describing what a real
   * run *would* do; `guarded:true` carries the mass-change guard summary (#20)
   * when even the dry run trips the deactivation ceiling. Non-guard errors
   * re-throw so the caller can toast a failed preview. NOTE: `mode=preview` is a
   * distinct query value from the {@link SyncMode} (`full`/`delta`) used by
   * {@link syncNow}; it is sent verbatim.
   */
  async previewSync(id: string): Promise<GuardedSyncResult> {
    return postSyncGuarded(`${LEX_INTEGRATIONS_ENDPOINT}/${id}/sync?mode=preview`);
  },

  /**
   * Fetch the reconciliation report (GET /integrations/{id}/reconciliation):
   * gaps (external-only records) and conflicts (diverging values). Never throws;
   * inspect `degraded` before treating an empty report as clean.
   */
  async getReconciliationResult(id: string): Promise<ReconciliationReportResult> {
    try {
      const payload = await apiGet<unknown>(
        `${LEX_INTEGRATIONS_ENDPOINT}/${id}/reconciliation`,
      );
      const data = unwrapData<ReconciliationReport>(payload);
      const valid =
        data &&
        typeof data === 'object' &&
        !Array.isArray(data) &&
        Array.isArray(data.gaps) &&
        Array.isArray(data.conflicts);
      return {
        report: {
          gaps: Array.isArray(data?.gaps) ? data!.gaps : [],
          conflicts: Array.isArray(data?.conflicts) ? data!.conflicts : [],
          summary:
            data?.summary && typeof data.summary === 'object' && !Array.isArray(data.summary)
              ? (data.summary as Record<string, unknown>)
              : {},
        },
        degraded: !valid,
      };
    } catch {
      return { report: { gaps: [], conflicts: [], summary: {} }, degraded: true };
    }
  },

  /** Contract-shaped convenience wrapper returning just the reconciliation report. */
  async getReconciliation(id: string): Promise<ReconciliationReport> {
    const result = await lexIntegrationsApi.getReconciliationResult(id);
    return result.report;
  },

  /* ───────────────── Extensibility: conflicts queue (#20) ───────────────── */

  /**
   * Fetch the reconciliation conflicts queue for an endpoint
   * (GET /integrations/{id}/conflicts), populated by Reconcile. Never throws;
   * inspect `degraded` before treating an empty queue as resolved.
   */
  async getConflictsResult(id: string): Promise<ConflictListResult> {
    try {
      const payload = await apiGet<unknown>(`${LEX_INTEGRATIONS_ENDPOINT}/${id}/conflicts`);
      const parsed = unwrapListResult<Conflict>(payload);
      return { conflicts: parsed.items, degraded: parsed.degraded };
    } catch {
      return { conflicts: [], degraded: true };
    }
  },

  /** Contract-shaped convenience wrapper returning just the conflicts queue. */
  async getConflicts(id: string): Promise<Conflict[]> {
    const result = await lexIntegrationsApi.getConflictsResult(id);
    return result.conflicts;
  },

  /**
   * Resolve a single conflict
   * (POST /integrations/conflicts/{conflictId}/resolve, body `{ resolution }`)
   * with merge | override | ignore (#20, manage-gated). Returns the resolved
   * {@link Conflict} (`status:resolved`). Surfaces errors so the caller can toast.
   */
  async resolveConflict(
    conflictId: string,
    resolution: ConflictResolution,
  ): Promise<Conflict> {
    const res = await apiPost<{ data: Conflict }>(
      `${LEX_INTEGRATIONS_ENDPOINT}/conflicts/${encodeURIComponent(conflictId)}/resolve`,
      { resolution },
    );
    return res.data;
  },

  /**
   * Rotate a single secret config field
   * (POST /integrations/{id}/secrets/{field}/rotate, body `{ value }`). Returns
   * the updated endpoint with the secret STILL masked to {@link REDACTED_SENTINEL}
   * (write-only). Surfaces errors so the caller can toast a failed rotation.
   */
  async rotateSecret(
    id: string,
    field: string,
    value: string,
  ): Promise<IntegrationEndpoint> {
    const res = await apiPost<{ data: IntegrationEndpoint }>(
      `${LEX_INTEGRATIONS_ENDPOINT}/${id}/secrets/${encodeURIComponent(field)}/rotate`,
      { value },
    );
    return res.data;
  },

  /**
   * Fire a synthetic webhook event at the endpoint
   * (POST /integrations/{id}/webhook-test) to validate inbound delivery /
   * signature handling. Surfaces errors to the caller.
   */
  async sendWebhookTest(id: string): Promise<InvokeResult> {
    const res = await apiPost<{ data: InvokeResult }>(
      `${LEX_INTEGRATIONS_ENDPOINT}/${id}/webhook-test`,
    );
    return res.data;
  },

  /**
   * Invoke a MOCK connector operation (POST /integrations/{id}/sandbox, body
   * `{ operation, payload }`) — e.g. nafath `operation=request` → `{transId,
   * random}`, najiz `operation=pull_hearings` → mock hearings. Side-effect-free;
   * for operator exploration. The backend DTO binds `operation` (SandboxInvokeRequest)
   * and strict-decodes unknown keys, so the op MUST ride the `operation` field.
   * Surfaces errors to the caller.
   */
  async sandboxInvoke(
    id: string,
    op: string,
    payload: Record<string, unknown> = {},
  ): Promise<InvokeResult> {
    const res = await apiPost<{ data: InvokeResult }>(
      `${LEX_INTEGRATIONS_ENDPOINT}/${id}/sandbox`,
      { operation: op, payload },
    );
    return res.data;
  },

  /**
   * Issue (or rotate) an inbound SCIM bearer token for a kind=hr endpoint
   * (POST /integrations/{id}/scim-token). Returns the {@link IssuedScimToken}
   * whose `token` is the CLEARTEXT bearer exposed exactly ONCE — surface it
   * copy-once and never persist it. Surfaces errors to the caller so a 404
   * (feature not wired) or a validation/conflict can be toasted.
   */
  async issueScimToken(
    id: string,
    payload: IssueScimTokenPayload,
  ): Promise<IssuedScimToken> {
    const res = await apiPost<{ data: IssuedScimToken }>(
      `${LEX_INTEGRATIONS_ENDPOINT}/${id}/scim-token`,
      {
        label: payload.label.trim(),
        rotate: payload.rotate ?? false,
        ...(payload.expires_at ? { expires_at: payload.expires_at } : {}),
      },
    );
    return res.data;
  },

  /**
   * List the non-secret SCIM-token rows for an endpoint
   * (GET /integrations/{id}/scim-tokens). Never throws: a 404 (route not wired)
   * or any read failure collapses to `unavailable:true` so the console can hide
   * the SCIM surface for connectors that do not support it.
   */
  async listScimTokensResult(id: string): Promise<ScimTokenListResult> {
    try {
      const payload = await apiGet<unknown>(
        `${LEX_INTEGRATIONS_ENDPOINT}/${id}/scim-tokens`,
      );
      const parsed = unwrapListResult<ScimToken>(payload);
      // A readable list (even empty) means the feature is available; a shape
      // failure is treated as unavailable, same as a 404.
      return { tokens: parsed.items, unavailable: parsed.degraded };
    } catch {
      return { tokens: [], unavailable: true };
    }
  },

  /**
   * Fetch the audit/activity log for an endpoint
   * (GET /integrations/{id}/activity). Never throws; inspect `degraded` to
   * distinguish no activity from an unavailable audit feed.
   */
  async getActivityResult(id: string): Promise<ActivityListResult> {
    try {
      const payload = await apiGet<unknown>(
        `${LEX_INTEGRATIONS_ENDPOINT}/${id}/activity`,
      );
      const parsed = unwrapListResult<ActivityEntry>(payload);
      return { entries: parsed.items, degraded: parsed.degraded };
    } catch {
      return { entries: [], degraded: true };
    }
  },

  /** Contract-shaped convenience wrapper returning just the activity log. */
  async getActivity(id: string): Promise<ActivityEntry[]> {
    const result = await lexIntegrationsApi.getActivityResult(id);
    return result.entries;
  },

  /**
   * Fetch the historical health-probe series for an endpoint
   * (GET /integrations/{id}/health-history?limit=) so the Connection panel can
   * render a sparkline / uptime strip. Never throws; inspect `degraded` before
   * treating an empty series as no recorded probes.
   */
  async getHealthHistoryResult(id: string, limit = 30): Promise<HealthHistoryResult> {
    try {
      const payload = await apiGet<unknown>(
        `${LEX_INTEGRATIONS_ENDPOINT}/${id}/health-history`,
        { limit },
      );
      const parsed = unwrapListResult<HealthCheckRecord>(payload);
      return { records: parsed.items, degraded: parsed.degraded };
    } catch {
      return { records: [], degraded: true };
    }
  },

  /** Contract-shaped convenience wrapper returning just the health history. */
  async getHealthHistory(id: string, limit = 30): Promise<HealthCheckRecord[]> {
    const result = await lexIntegrationsApi.getHealthHistoryResult(id, limit);
    return result.records;
  },

  /* ─────────────────────────── Reliability: DLQ ─────────────────────────── */

  /**
   * Fetch the dead-letter queue for one endpoint
   * (GET /integrations/{id}/dlq). Never throws; callers that need to distinguish
   * successful empty queues from failed reads should use `degraded`.
   */
  async getDlqResult(id: string): Promise<DeadLetterListResult> {
    try {
      const payload = await apiGet<unknown>(`${LEX_INTEGRATIONS_ENDPOINT}/${id}/dlq`);
      const parsed = unwrapListResult<DeadLetter>(payload);
      return { entries: parsed.items, degraded: parsed.degraded };
    } catch {
      return { entries: [], degraded: true };
    }
  },

  /** Contract-shaped convenience wrapper returning just the DLQ entries. */
  async getDlq(id: string): Promise<DeadLetter[]> {
    const result = await lexIntegrationsApi.getDlqResult(id);
    return result.entries;
  },

  /**
   * Fetch the tenant-wide dead-letter queue across every endpoint
   * (GET /integrations/dlq). Never throws; inspect `degraded` for read failures.
   */
  async getDlqAllResult(): Promise<DeadLetterListResult> {
    try {
      const payload = await apiGet<unknown>(`${LEX_INTEGRATIONS_ENDPOINT}/dlq`);
      const parsed = unwrapListResult<DeadLetter>(payload);
      return { entries: parsed.items, degraded: parsed.degraded };
    } catch {
      return { entries: [], degraded: true };
    }
  },

  /** Contract-shaped convenience wrapper returning just the tenant DLQ entries. */
  async getDlqAll(): Promise<DeadLetter[]> {
    const result = await lexIntegrationsApi.getDlqAllResult();
    return result.entries;
  },

  /**
   * Replay a single dead-letter entry — re-runs the failed operation
   * (POST /integrations/dlq/{dlqId}/replay). Surfaces errors so the caller can
   * toast a failed replay.
   */
  async replayDlq(dlqId: string): Promise<ReplayResult> {
    const res = await apiPost<{ data: ReplayResult }>(
      `${LEX_INTEGRATIONS_ENDPOINT}/dlq/${encodeURIComponent(dlqId)}/replay`,
    );
    return res.data;
  },

  /**
   * Batch-replay every still-failed entry for an endpoint
   * (POST /integrations/{id}/dlq/replay-failed). Returns the replayed / failed
   * counts. Surfaces errors to the caller.
   */
  async replayFailed(id: string): Promise<ReplayFailedResult> {
    const res = await apiPost<{ data: ReplayFailedResult }>(
      `${LEX_INTEGRATIONS_ENDPOINT}/${id}/dlq/replay-failed`,
    );
    return res.data;
  },

  /* ───────────────────────── Reliability: breaker ───────────────────────── */

  /**
   * Fetch the live circuit-breaker state for an endpoint
   * (GET /integrations/{id}/breaker). Graceful: returns `null` on failure so the
   * panel can show an "unknown" state instead of crashing.
   */
  async getBreaker(id: string): Promise<BreakerState | null> {
    try {
      const payload = await apiGet<unknown>(`${LEX_INTEGRATIONS_ENDPOINT}/${id}/breaker`);
      return unwrapData<BreakerState>(payload) ?? null;
    } catch {
      return null;
    }
  },

  /**
   * Manually reset (close) the breaker and clear quarantine
   * (POST /integrations/{id}/breaker/reset). Returns the fresh
   * {@link BreakerState}. Surfaces errors to the caller.
   */
  async resetBreaker(id: string): Promise<BreakerState> {
    const res = await apiPost<{ data: BreakerState }>(
      `${LEX_INTEGRATIONS_ENDPOINT}/${id}/breaker/reset`,
    );
    return res.data;
  },

  /* ───────────────── Governance: maker-checker (#13) ───────────────── */

  /**
   * Fetch the tenant's maker-checker review queue
   * (GET /integrations/pending-changes). Never throws; inspect `degraded` for
   * read failures.
   */
  async getPendingChangesResult(): Promise<PendingChangesResult> {
    try {
      const payload = await apiGet<unknown>(
        `${LEX_INTEGRATIONS_ENDPOINT}/pending-changes`,
      );
      const parsed = unwrapListResult<PendingChange>(payload);
      return { changes: parsed.items, degraded: parsed.degraded };
    } catch {
      return { changes: [], degraded: true };
    }
  },

  /** Contract-shaped convenience wrapper returning just the pending changes. */
  async getPendingChanges(): Promise<PendingChange[]> {
    const result = await lexIntegrationsApi.getPendingChangesResult();
    return result.changes;
  },

  /**
   * Propose a config change (POST /integrations/{id}/changes, body = proposed
   * config map). If the endpoint is PROTECTED (active production OR gov-gated
   * kind) the backend returns a {@link PendingChange} (`status:pending`,
   * `applied:false`) for review; otherwise it applies immediately and returns
   * the live {@link IntegrationEndpoint}. Normalized into a discriminated
   * {@link ProposeChangeResult} so the caller can branch on `applied`. Surfaces
   * errors so the caller can toast them.
   */
  async proposeChange(
    id: string,
    config: Record<string, unknown>,
  ): Promise<ProposeChangeResult> {
    const res = await apiPost<{ data: unknown }>(
      `${LEX_INTEGRATIONS_ENDPOINT}/${id}/changes`,
      config,
    );
    const data = res.data as Record<string, unknown> | undefined;
    // A PendingChange carries a `diff` array + `status`; an endpoint does not.
    if (data && Array.isArray((data as { diff?: unknown }).diff)) {
      return { applied: false, pending: data as unknown as PendingChange };
    }
    return { applied: true, endpoint: data as unknown as IntegrationEndpoint };
  },

  /**
   * Approve a pending change (POST /integrations/changes/{changeId}/approve,
   * body `{ note? }`) — applies the diff and returns the live endpoint. SoD:
   * where enforced, the approver must differ from the requester (the backend
   * rejects a self-approval). Surfaces errors to the caller.
   */
  async approveChange(changeId: string, note?: string): Promise<IntegrationEndpoint> {
    const res = await apiPost<{ data: IntegrationEndpoint }>(
      `${LEX_INTEGRATIONS_ENDPOINT}/changes/${encodeURIComponent(changeId)}/approve`,
      note ? { note } : {},
    );
    return res.data;
  },

  /**
   * Reject a pending change (POST /integrations/changes/{changeId}/reject, body
   * `{ note }`) — records a MANDATORY note and leaves the stored config
   * untouched. Returns the resolved {@link PendingChange} (`status:rejected`).
   * Surfaces errors to the caller.
   */
  async rejectChange(changeId: string, note: string): Promise<PendingChange> {
    const res = await apiPost<{ data: PendingChange }>(
      `${LEX_INTEGRATIONS_ENDPOINT}/changes/${encodeURIComponent(changeId)}/reject`,
      { note },
    );
    return res.data;
  },

  /* ───────────────── Governance: egress policy (#15) ───────────────── */

  /**
   * Fetch the egress / data-residency policy for an endpoint
   * (GET /integrations/{id}/egress-policy). Graceful: returns `null` on any 404
   * / shape mismatch so the editor can render an explanatory unconfigured state.
   */
  async getEgressPolicy(id: string): Promise<EgressPolicy | null> {
    try {
      const payload = await apiGet<unknown>(
        `${LEX_INTEGRATIONS_ENDPOINT}/${id}/egress-policy`,
      );
      const data = unwrapData<EgressPolicy>(payload);
      if (!data) return null;
      return {
        allowed_regions: Array.isArray(data.allowed_regions) ? data.allowed_regions : [],
        allowed_egress_fields: Array.isArray(data.allowed_egress_fields)
          ? data.allowed_egress_fields
          : [],
        blocked_count: typeof data.blocked_count === 'number' ? data.blocked_count : 0,
        updated_at: data.updated_at ?? null,
      };
    } catch {
      return null;
    }
  },

  /**
   * Replace the egress policy for an endpoint
   * (PUT /integrations/{id}/egress-policy). `blocked_count` / `updated_at` are
   * server-owned and ignored on write. Surfaces errors to the caller.
   */
  async putEgressPolicy(id: string, policy: EgressPolicyInput): Promise<EgressPolicy> {
    const res = await apiPut<{ data: EgressPolicy }>(
      `${LEX_INTEGRATIONS_ENDPOINT}/${id}/egress-policy`,
      policy,
    );
    return res.data;
  },

  /* ───────────────── Observability: SLO metrics (#16) ───────────────── */

  /**
   * Fetch the SLO/traffic snapshot for one endpoint over a window
   * (GET /integrations/{id}/metrics?window=24h). Graceful: returns `null` on any
   * 404 / shape mismatch so the metrics section renders an "unavailable" state.
   */
  async getMetrics(id: string, window: MetricsWindow = '24h'): Promise<ConnectorMetrics | null> {
    try {
      const payload = await apiGet<unknown>(`${LEX_INTEGRATIONS_ENDPOINT}/${id}/metrics`, {
        window,
      });
      const data = unwrapData<ConnectorMetrics>(payload);
      if (!data) return null;
      return {
        calls: typeof data.calls === 'number' ? data.calls : 0,
        errors: typeof data.errors === 'number' ? data.errors : 0,
        error_rate: typeof data.error_rate === 'number' ? data.error_rate : 0,
        latency_p50_ms: typeof data.latency_p50_ms === 'number' ? data.latency_p50_ms : 0,
        latency_p95_ms: typeof data.latency_p95_ms === 'number' ? data.latency_p95_ms : 0,
        sync_throughput: typeof data.sync_throughput === 'number' ? data.sync_throughput : 0,
        window: data.window ?? window,
        slo_target_pct: typeof data.slo_target_pct === 'number' ? data.slo_target_pct : 99,
        slo_breached: Boolean(data.slo_breached),
        by_op: Array.isArray(data.by_op) ? data.by_op : [],
      };
    } catch {
      return null;
    }
  },

  /**
   * Fetch the tenant-wide metrics rollup across every endpoint
   * (GET /integrations/metrics?window=). Never throws; callers that need to
   * distinguish a successful empty rollup from a failed read should use
   * `degraded`.
   */
  async getMetricsOverviewResult(window: MetricsWindow = '24h'): Promise<MetricsOverviewResult> {
    try {
      const payload = await apiGet<unknown>(`${LEX_INTEGRATIONS_ENDPOINT}/metrics`, { window });
      const parsed = unwrapListResult<OverviewMetrics>(payload);
      return { rows: parsed.items, degraded: parsed.degraded };
    } catch {
      return { rows: [], degraded: true };
    }
  },

  /** Contract-shaped convenience wrapper returning just the metrics rollup rows. */
  async getMetricsOverview(window: MetricsWindow = '24h'): Promise<OverviewMetrics[]> {
    const result = await lexIntegrationsApi.getMetricsOverviewResult(window);
    return result.rows;
  },

  /* ───────────────── Observability: event inspector (#17) ───────────────── */

  /**
   * Fetch the recent event stream for one endpoint
   * (GET /integrations/{id}/events?direction=&kind=&status=&limit=). Never
   * throws; inspect `degraded` for read failures.
   */
  async getEventsResult(id: string, filters?: EventFilters): Promise<IntegrationEventsResult> {
    try {
      const params: Record<string, string | number> = {};
      if (filters?.direction) params.direction = filters.direction;
      if (filters?.kind) params.kind = filters.kind;
      if (filters?.status) params.status = filters.status;
      if (filters?.limit) params.limit = filters.limit;
      const payload = await apiGet<unknown>(
        `${LEX_INTEGRATIONS_ENDPOINT}/${id}/events`,
        params,
      );
      const parsed = unwrapListResult<IntegrationEvent>(payload);
      return { events: parsed.items, degraded: parsed.degraded };
    } catch {
      return { events: [], degraded: true };
    }
  },

  /** Contract-shaped convenience wrapper returning just the endpoint events. */
  async getEvents(id: string, filters?: EventFilters): Promise<IntegrationEvent[]> {
    const result = await lexIntegrationsApi.getEventsResult(id, filters);
    return result.events;
  },

  /**
   * Fetch the tenant-wide event stream across every endpoint
   * (GET /integrations/events?direction=&kind=&status=&limit=). Never throws;
   * inspect `degraded` for read failures.
   */
  async getEventsAllResult(filters?: EventFilters): Promise<IntegrationEventsResult> {
    try {
      const params: Record<string, string | number> = {};
      if (filters?.direction) params.direction = filters.direction;
      if (filters?.kind) params.kind = filters.kind;
      if (filters?.status) params.status = filters.status;
      if (filters?.limit) params.limit = filters.limit;
      const payload = await apiGet<unknown>(`${LEX_INTEGRATIONS_ENDPOINT}/events`, params);
      const parsed = unwrapListResult<IntegrationEvent>(payload);
      return { events: parsed.items, degraded: parsed.degraded };
    } catch {
      return { events: [], degraded: true };
    }
  },

  /** Contract-shaped convenience wrapper returning just the tenant events. */
  async getEventsAll(filters?: EventFilters): Promise<IntegrationEvent[]> {
    const result = await lexIntegrationsApi.getEventsAllResult(filters);
    return result.events;
  },

  /**
   * Replay (re-process) an INBOUND event
   * (POST /integrations/events/{eventId}/replay). Surfaces errors so the caller
   * can toast a failed replay.
   */
  async replayEvent(eventId: string): Promise<ReplayEventResult> {
    const res = await apiPost<{ data: ReplayEventResult }>(
      `${LEX_INTEGRATIONS_ENDPOINT}/events/${encodeURIComponent(eventId)}/replay`,
    );
    return res.data;
  },
};

// Named convenience re-exports (call-site ergonomics mirroring `lexAdminApi.*`).
export const {
  listIntegrations,
  listIntegrationsResult,
  getIntegration,
  createIntegration,
  updateIntegration,
  deleteIntegration,
  getIntegrationsHealth,
  getIntegrationsHealthResult,
  getIntegrationHealth,
  getSchema,
  testConnection,
  syncNow,
  listSyncRunsResult,
  listSyncRuns,
  getCatalogResult,
  getCatalog,
  previewSync,
  getReconciliationResult,
  getReconciliation,
  getConflictsResult,
  getConflicts,
  resolveConflict,
  rotateSecret,
  sendWebhookTest,
  sandboxInvoke,
  issueScimToken,
  listScimTokensResult,
  getActivityResult,
  getActivity,
  getHealthHistoryResult,
  getHealthHistory,
  getDlq,
  getDlqResult,
  getDlqAll,
  getDlqAllResult,
  replayDlq,
  replayFailed,
  getBreaker,
  resetBreaker,
  getPendingChanges,
  getPendingChangesResult,
  proposeChange,
  approveChange,
  rejectChange,
  getEgressPolicy,
  putEgressPolicy,
  getMetrics,
  getMetricsOverview,
  getMetricsOverviewResult,
  getEvents,
  getEventsResult,
  getEventsAll,
  getEventsAllResult,
  replayEvent,
} = lexIntegrationsApi;
