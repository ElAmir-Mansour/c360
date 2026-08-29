# Clario Respond Domain Contract

This contract is the backend foundation for downstream Respond modules.

## Persistence

Migrations live in `backend/migrations/respond_db`.

Tables:
- `respond_incident_reference_counter`: per-tenant, per-year counter used transactionally to allocate human references.
- `respond_incident`: authoritative incident aggregate. Incidents are never hard-deleted by the service; terminal outcomes are `Closed` or `Cancelled`.
- `respond_incident_timeline_event`: append-only event log. The service exposes append/list only, and the database rejects `UPDATE` and `DELETE` with triggers.
- `respond_stakeholder_token`: token-scoped stakeholder status access. Raw tokens are never stored; `token_hash` stores a SHA-256 hash. Revocation and expiry are enforced in the read query.
- `respond_service_registry`: local persisted Metastore default for service/application metadata used by Respond triage. Stores service key, owner team, owner contacts, tier, lifecycle state, row version, and timestamps.
- `respond_service_dependency`: dependency rows for services in the local registry.
- `respond_incident_impact_assessment`: append-style triage input records for user scope, business criticality, revenue impact, regulatory exposure, affected service keys, assessor, and timestamp.
- `respond_incident_severity_decision`: severity-decision provenance: previous/recommended/chosen severity, override flag/reason, rule version, rule trace, deciding actor, decision timestamp, and incident row version.
- `respond_incident_affected_service`: incident-to-service linkage with a persisted metadata snapshot from the Metastore default.
- `respond_stakeholder_update_dispatch`: persisted stakeholder update dispatch log. Rows include reason, channel, recipient reference, generated subject/body, source timeline event, next update time, dispatch actor/time, and status.
- `respond_incident_approval`: incident-scoped approval gates for high-impact actions. Rows store requested/decided provenance, decision, required incident role, workflow approval references, and action metadata.
- `respond_incident_pir`: generated post-incident review assembled from incident state, timeline, approvals, notifications, integrations, tasks, roles, MTTR, factors, lessons, sign-off, and content hash.
- `respond_incident_pir_action_item`: assignable PIR action items with owner, due date, status, and completion time.
- `respond_incident_evidence_export`: append-only evidence export audit with format, artifact SHA-256, byte size, timeline event count, PIR hash, actor, and timestamp.

Reference format is `INC-YYYY-NNNN`, monotonic per tenant and year.

## Incident Entity

`respond.Incident` fields:
- `id`, `tenant_id`
- `reference`
- `title`, `description`
- `severity`
- `status`
- `declared_by`, `declared_at`, `detected_at`
- `mitigated_at`, `resolved_at`, `closed_at`
- `impacted_services`
- `row_version`
- `created_at`, `updated_at`

Optimistic concurrency is enforced with `row_version`. Mutating calls require `ExpectedVersion`; stale writes return `ErrVersionConflict`.

## Severities

Typed enum values:
- `SEV1`
- `SEV2`
- `SEV3`
- `SEV4`

`SeverityDefinitions` documents user-base scope, business-process impact, revenue impact, and regulatory exposure criteria for each value.

## Lifecycle

Allowed transitions:

| From | To |
| --- | --- |
| `Declared` | `Triaged`, `Cancelled` |
| `Triaged` | `Mobilizing`, `Cancelled` |
| `Mobilizing` | `Investigating`, `Cancelled` |
| `Investigating` | `Mitigating`, `Cancelled` |
| `Mitigating` | `Mitigated`, `Cancelled` |
| `Mitigated` | `Resolved`, `Cancelled` |
| `Resolved` | `Closed` |
| `Closed` | none |
| `Cancelled` | none |

Use `ValidateTransition(from, to)` or `CanTransition(from, to)`; downstream modules must not duplicate transition logic.

## Service API

Construct with:
- `NewService(pool, logger, entitlementResolver...)`
- `NewServiceWithDeps(runner, repository, feed, logger, entitlementResolver...)` for tests and composed services.

`Product(ctx, tenantID, authorization)` requires a real `EntitlementResolver`. Production wiring uses `CheckerResolver` over the existing licensing checker, forwarding the caller's bearer token to the license service. If the resolver is unavailable, the product endpoint fails closed with `ErrEntitlementUnavailable`.

Core methods:
- `Product(ctx, tenantID, authorization)`
- `DeclareIncident(ctx, tenantID, DeclareIncidentInput)`
- `GetIncident(ctx, tenantID, incidentID, actor)`
- `ListIncidents(ctx, tenantID, actor, status, severity, limit, offset)`
- `UpdateIncident(ctx, tenantID, UpdateIncidentInput)`
- `ChangeSeverity(ctx, tenantID, ChangeSeverityInput)`
- `TriageIncident(ctx, tenantID, TriageIncidentInput)`
- `LatestSeverityDecision(ctx, tenantID, incidentID, actor)`
- `TransitionIncident(ctx, tenantID, TransitionIncidentInput)`
- `RecordTimelineEvent(ctx, tenantID, incidentID, actor, eventType, payload)`
- `ListTimelineEvents(ctx, tenantID, incidentID, actor, TimelineFilter)`
- `Cockpit(ctx, tenantID, incidentID, actor)`
- `CreateStakeholderToken(ctx, tenantID, CreateStakeholderTokenInput)`
- `StakeholderStatusByToken(ctx, token)`
- `GenerateStakeholderUpdate(ctx, tenantID, GenerateStakeholderUpdateInput)`
- `DispatchStakeholderUpdate(ctx, tenantID, DispatchStakeholderUpdateInput)`
- `RequestApproval(ctx, tenantID, RequestApprovalInput)`
- `DecideApproval(ctx, tenantID, DecideApprovalInput)`
- `RequireApprovedAction(ctx, tenantID, RequireApprovedActionInput)`
- `GeneratePIR(ctx, tenantID, GeneratePIRInput)`
- `GetPIR(ctx, tenantID, incidentID, actor)`
- `SignOffPIR(ctx, tenantID, SignOffPIRInput)`
- `UpdatePIRActionItemStatus(ctx, tenantID, UpdatePIRActionItemInput)`
- `RequirePIRClosureReady(ctx, tenantID, incidentID, actor)`
- `TransitionIncidentWithClosureGate(ctx, tenantID, TransitionIncidentInput)`
- `ExportIncidentEvidence(ctx, tenantID, EvidenceExportInput)`

Each mutating method writes an append-only timeline event in the same tenant transaction as the state change.

## Timeline

`TimelineEvent` fields:
- `id`, `tenant_id`, `incident_id`
- `actor_id`
- `occurred_at`
- `event_type`
- `payload`

Foundation event types:
- `respond.incident.declared`
- `respond.incident.updated`
- `respond.incident.status_transitioned`
- `respond.incident.severity_changed`
- `respond.incident.severity_triaged`

Downstream modules should use `RecordTimelineEvent` for module events such as roles, tasks, notifications, approvals, and integrations.

`TimelineFeed` provides process-local SSE/live delivery over persisted events. Clients reconnect by calling the list endpoint for backfill, then subscribing to the stream.

## Triage

`RecommendSeverity(IncidentImpactAssessmentInput)` is deterministic rule logic with rule version `respond-severity-rules-v1`. It recommends the most severe severity implied by:
- user scope: `none`, `individual_users`, `limited_user_group`, `large_user_group`, `all_users`
- business criticality: `none`, `non_critical`, `important_degraded`, `critical_degraded`, `critical_stopped`
- revenue impact: `none`, `low`, `material`, `severe`
- regulatory exposure: `none`, `unlikely`, `potential`, `confirmed`

`TriageIncident` requires both `respond:incident:severity` and `respond:incident:transition`. It resolves affected service keys through the Metastore default, records impact-assessment inputs, records the severity decision and rule trace, updates incident severity, transitions `Declared -> Triaged` through the central state machine, persists affected-service snapshots, and emits timeline events in one tenant transaction. If the chosen severity differs from the recommendation, `override_reason` is required and persisted.

## Metastore Seam

`MetastoreClient` is the Respond service/application metadata seam:
- `ResolveService(ctx, tenantID, serviceKey)`
- `ListServices(ctx, tenantID, limit, offset)`
- `UpsertService(ctx, tenantID, ServiceMetadata)`

The default implementation is `SQLMetastore`, constructed with `NewSQLMetastore(pool)` or `NewSQLMetastoreWithDeps(runner, repository)`. It is backed by the local `respond_service_registry` and `respond_service_dependency` tables and returns persisted metadata only. Future Metastore product integration can replace this interface; it must preserve the same service key, owner, tier, dependency, and error semantics.

## Integration Layer

Prompt 7 integration code lives under `backend/internal/respond`:
- `ITSMAdapter`: pluggable ticketing connector interface for outbound create/update and inbound webhook parsing.
- `CommsAdapter`: pluggable communications connector interface for channel creation and message posting.
- `RespondIntegrationService`: orchestration layer that loads persisted connector config, resolves encrypted/secret-ref credentials, performs outbound sync, ingests authenticated webhooks idempotently, records sync audit, and emits timeline events through `TimelineEmitter`.

Shipped adapters:
- ServiceNow-style ITSM over real authenticated HTTP (`servicenow.go`), with configurable field mapping, outbound incident-to-ticket mapping, inbound HMAC/bearer webhook validation, and ServiceNow state/severity mapping.
- Slack comms over real Slack Web API calls (`slack.go`) for `conversations.create` and `chat.postMessage`.

Persistence is owned by `backend/migrations/respond_db/000006_respond_integrations.*.sql`:
- `respond_integration_connector`: tenant-scoped connector metadata and non-secret config.
- `respond_integration_connector_secret`: secret references or encrypted secret values only; raw secret values are never returned.
- `respond_incident_integration_link`: incident-to-external-ticket/channel linkage.
- `respond_integration_webhook_dedupe`: inbound webhook idempotency by connector and external event id.
- `respond_integration_sync_audit`: append records for outbound, inbound, duplicate, failure, and retry-scheduled integration actions.

## Stakeholder Tokens

`CreateStakeholderToken` requires `respond:incident:update`, confirms the incident exists in the tenant transaction, generates a 32-byte random URL-safe token, stores only its SHA-256 hash, and returns the raw token once.

`StakeholderStatusByToken` runs a system read because the token is the credential and tenant is unknown before lookup. It returns only:
- incident reference/title
- severity/status/current phase
- impact summary from persisted incident description or impacted services
- last update time and optional next update time

Invalid, expired, or revoked tokens return `ErrStakeholderNotFound`.

## Stakeholder Updates

`DeterministicStakeholderUpdateGenerator` composes stakeholder-safe update text from persisted incident state and the latest timeline summary. It includes reference, title, severity, status, impact summary, impacted services, timeline event count, latest timeline event, generation time, and next update time.

`DispatchStakeholderUpdate` requires `respond:timeline:append`, persists `respond_stakeholder_update_dispatch`, updates active stakeholder tokens with the next-update time, and emits `respond.stakeholder_update.dispatched` to the append-only timeline in the same transaction. Notification-service or comms adapters should call this method after external delivery, passing the concrete channel/receipt; the persisted status-page channel works without external dependencies.

## Approval Gates

High-impact actions use `RequestApproval`, `DecideApproval`, and `RequireApprovedAction`. Supported built-in action constants are:
- `authorize_failover`
- `declare_major_business_impact`
- `close_incident`

Approvals enforce separation of duties: the requester cannot approve the same gate. If `required_role` is set, only an actor with that incident role or `respond:admin` may decide. Without a required role, the incident commander or `respond:admin` may decide. Approved gates are checked server-side with `RequireApprovedAction`; pending, rejected, cancelled, or missing records return `ErrApprovalRequired`.

`ApprovalWorkflowGateway` is the workflow-engine seam for composing with `approval_chain` workflows. Respond stores `workflow_system`, `workflow_instance_id`, and `workflow_task_id` on the local approval record while keeping enforcement local to the incident transaction.

Timeline events:
- `respond.approval.requested`
- `respond.approval.decided`

## PIR And Evidence

`GeneratePIR` requires a resolved incident and assembles the PIR from the persisted incident, full append-only timeline, and approval records. The default assembler extracts roles, tasks, notifications, and integrations from timeline event types/payloads. Future modules can publish richer timeline events or implement the `PIRSupplementalProvider` contract with equivalent section data.

MTTR target policy:
- `SEV1`: 4 hours
- `SEV2`: 8 hours
- `SEV3`: 24 hours
- `SEV4`: 72 hours

`SignOffPIR` can be performed by the incident commander or `respond:admin` and records actor/time on the PIR. `UpdatePIRActionItemStatus` tracks action items through `open`, `in_progress`, `closed`, or `cancelled`.

`ExportIncidentEvidence` returns real artifact bytes for `csv` or `pdf`, persists an append-only export audit row, and emits `respond.evidence.exported`. CSV is generated with Go's CSV writer. PDF is generated by a deterministic local PDF writer; no placeholder files are returned.

Closure wiring note: shared lifecycle callers should use `TransitionIncidentWithClosureGate` for `Resolved -> Closed`, or call `RequirePIRClosureReady` before invoking `TransitionIncident`. The current method enforces PIR signed-off status and returns `ErrPIRNotComplete` until the PIR is complete and signed off.

## RBAC Scaffolding

Global permissions:
- `respond:incident:read`
- `respond:incident:declare`
- `respond:incident:update`
- `respond:incident:transition`
- `respond:incident:severity`
- `respond:timeline:append`
- `respond:admin`

Incident roles:
- `incident_commander`
- `communications_lead`
- `technical_lead`
- `subject_matter_expert`
- `scribe`
- `stakeholder_liaison`
- `resolver`

`Actor.Can(permission)` enforces global permissions and incident-role permissions. Current role policy allows Commanders to declare/update/transition/change severity/append timeline; Resolvers may update details and append timeline but may not transition or close incidents.
