# Clario Migrate Integration Hardening Design

Status: review draft  
Owner: Clario Migrate / Platform  
Scope: notifications, shared approvals, DR Runbook Studio/topology reuse, and production service registration.

## 1. Executive Summary

The current Migrate implementation has a solid local domain model: programs, workloads, move groups, waves, cutover windows, rollback plans, gate checks, connectors, command-center aggregation, and append-only Migrate audit records. The gap is that several cross-platform capabilities are still shallowly connected.

This design makes Migrate a first-class participant in the platform event, notification, workflow approval, DR execution, and deployment systems. The core change is to stop treating Migrate actions as isolated local records. Every meaningful state transition should stage a platform event in the same transaction as the domain write. Those events then drive notifications, workflow approvals, audit evidence, runbook synchronization, and live UI updates.

The design does not propose a new approvals engine or a new runbook engine. In this codebase, the shared approval capability is the workflow engine's `approval_chain` and human-task surface, while DR Runbook Studio and topology already provide executable runbooks and replication topology. Migrate should compose those services behind Migrate-owned APIs so operators get a single migration command-center experience.

## 2. Current Repo Reality

### Implemented

- Migrate domain and APIs exist under `backend/internal/migrate` and `backend/cmd/migrate-service`.
- Migrate gateway routing exists for `/api/v1/migrate` and `/api/v1/migrate/product`.
- Fleet registry knows about `migrate-service` on ports `8100` and `9100`.
- Migrate local audit actions already cover the important lifecycle points: program creation, portfolio import, move-group approval request/decision, wave creation, cutover scheduling/start/completion, rollback decision, gate checks, and connector invocation.
- Notification service already has an event consumer, rule engine, recipient resolution, channels, notification persistence, websocket push, email, and webhook dispatch.
- Workflow engine already has `approval_chain`, human tasks, task claim/complete/reject APIs, service tasks, and workflow instance APIs.
- DR Runbook Studio already has editable DAG runbooks, live runs, frontier/critical path state, task actions, and outbox event staging.
- DR topology already has DAG topology endpoints, health rollups, and failover-target ranking.

### Gaps

- Migrate audit records are local only. They do not currently emit platform events for notification/workflow consumers.
- Notification rules do not include Migrate-specific events or notification types.
- Migrate approvals are local records/status changes, not workflow human tasks.
- DR Runbook Studio/topology are linked by IDs and enrichment only. Migrate does not yet embed DR Studio execution as the cutover runbook editor/runner.
- Production process/deployment config is incomplete. The gateway and fleet registry know Migrate, but the VPS PM2 ecosystem, database bootstrap, and monitoring scrape config still need Migrate entries.

## 3. Design Principles

1. Reuse shared engines. Migrate must reuse notification-service, workflow-engine approvals, and DR Runbook Studio/topology. It should not fork these capabilities.
2. Keep Migrate as the operator-facing product. Users should not need to understand that approvals live in workflow-engine or that execution lives in DR Studio.
3. Use transactional events. A Migrate state change and the event that announces it must commit together through the outbox pattern.
4. Keep service boundaries clean. Migrate calls other services through clients and service-token endpoints. It should not reach into another service database for writes.
5. Preserve local evidence. Migrate audit remains append-only and readable. Cross-service events add integration, not a replacement for audit evidence.
6. Design for degraded dependencies. If notification, workflow, or DR is unavailable, Migrate should fail closed for governed actions and degrade read-only for informational panels.

## 4. Target Architecture

```text
Migrate UI
  |
  | /api/v1/migrate/*
  v
migrate-service
  |-- local domain DB: migrate_db
  |-- append-only local audit
  |-- transactional outbox events: migrate.cloud.events
  |-- workflow client: approval workflows and human tasks
  |-- DR bridge client: runbook authoring, runs, task actions, topology
  |-- notification deep-link metadata in event payloads
  |
  +--> workflow-engine
  |      approval_chain + human_task + service_task callback
  |
  +--> clario-dr-service
  |      runbookstudio + topology
  |
  +--> notification-service
         consumes Migrate events, creates in-app/email/websocket notifications
```

## 5. Event and Notification Integration

### Current State

Migrate writes local audit actions such as:

- `move_group.approval_requested`
- `move_group.approval_decided`
- `cutover_window.created`
- `cutover.gonogo_decided`
- `cutover.started`
- `cutover.completed`
- `rollback_plan.decided`
- `gate_check.recorded`
- `connector.invoked`

Notification-service can consume event topics and apply rule-engine matches, but there is no Migrate topic or Migrate rule set.

### Target State

Add a first-class Migrate event topic:

```go
Topics.MigrateEvents = "migrate.cloud.events"
```

Add it to `events.AllTopics()` and `DefaultTopicConfigs()`. It should use normal retention and partitioning unless later volume proves otherwise.

Add an event stager to Migrate service:

```go
type eventStager interface {
    Stage(ctx context.Context, tx DBTX, evt *events.Event) error
}
```

The default stager writes to the outbox in the same transaction as the Migrate mutation. Every existing `audit(...)` call should either:

- call a new `recordActivity(...)` helper that writes audit plus event, or
- remain audit-only for low-value internal activity while governed state changes call `stageEvent(...)`.

For this product, the recommended approach is `recordActivity(...)` so audit and integration never drift.

### Event Contract

Use CloudEvent-style names:

```text
com.clario360.migrate.program.created
com.clario360.migrate.portfolio.imported
com.clario360.migrate.workload.upserted
com.clario360.migrate.move_group.created
com.clario360.migrate.move_group.completeness_checked
com.clario360.migrate.move_group.approval_requested
com.clario360.migrate.move_group.approval_decided
com.clario360.migrate.wave.created
com.clario360.migrate.cutover_window.created
com.clario360.migrate.cutover.gonogo_requested
com.clario360.migrate.cutover.gonogo_decided
com.clario360.migrate.cutover.started
com.clario360.migrate.cutover.completed
com.clario360.migrate.rollback_plan.upserted
com.clario360.migrate.rollback_plan.approval_requested
com.clario360.migrate.rollback_plan.decided
com.clario360.migrate.gate_check.created
com.clario360.migrate.gate_check.recorded
com.clario360.migrate.connector.invoked
com.clario360.migrate.connector.failed
```

Payload fields:

```json
{
  "tenant_id": "uuid",
  "program_id": "uuid",
  "program_reference": "MIG-2026-0001",
  "subject_type": "move_group|wave|cutover_window|rollback_plan|gate_check|connector_invocation",
  "subject_id": "uuid",
  "subject_reference": "MG-2026-0003",
  "actor_id": "uuid",
  "action_url": "/migrate/move-groups/{id}",
  "priority": "low|medium|high|critical",
  "severity": "info|warning|critical",
  "status": "requested|approved|rejected|started|completed|failed|blocked",
  "due_at": "2026-07-01T22:00:00Z",
  "roles": ["migration_approver"],
  "user_ids": ["uuid"],
  "summary": "Move group submitted for approval",
  "detail": {}
}
```

### Notification Rules

Add Migrate notification types:

```text
migrate.approval_required
migrate.approval_decided
migrate.cutover_scheduled
migrate.cutover_started
migrate.cutover_completed
migrate.gate_blocked
migrate.rollback_required
migrate.connector_failed
```

Recommended rules:

| Event | Recipients | Channels | Priority | Action |
| --- | --- | --- | --- | --- |
| `move_group.approval_requested` | `migration_approver`, `tenant_admin` | in-app, websocket, email | high | open move group approval |
| `rollback_plan.approval_requested` | `migration_approver`, `rollback_authorizer`, `tenant_admin` | in-app, websocket, email | high | open rollback plan |
| `cutover_window.created` | migration owners/operators | in-app, websocket | medium | open cutover window |
| `cutover.started` | migration owners/operators, approvers | in-app, websocket, optional email | high | open live runbook |
| `gate_check.recorded` with failed required gate | migration owners/operators | in-app, websocket, email | critical | open failed gate |
| `connector.failed` | migration admins/operators | in-app, websocket, email | critical | open connector invocation |
| `cutover.completed` | migration owners/stakeholders | in-app, websocket | medium | open evidence/summary |

### UX Behavior

- Migrate command center gets an activity/notifications rail filtered to `migrate.*`.
- The top nav product badge increments for critical Migrate notifications.
- Approval notifications deep-link to the exact task or Migrate approval panel.
- Gate blocker notifications show the blocking check, owner, and required fix.
- Connector failure notifications include retry eligibility and idempotency key.
- The UI should use existing dashboard tokens/components. Do not introduce a separate Migrate color system.

## 6. Shared Approval Integration

### Current State

There is no separately deployed `approval-service` in the repo. The shared approval capability is workflow-engine:

- `approval_chain` executor creates human tasks.
- Tasks support claim, complete, reject, and role/user assignees.
- Workflows support service tasks that can call configured service URLs.

Migrate currently stores approval state locally on move groups and rollback/go-no-go flows.

### Target State

Migrate should use workflow-engine as the shared approval plane, while preserving local status fields for query speed and evidence.

Add Migrate approval binding table:

```sql
CREATE TABLE migrate_approval_binding (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    program_id UUID NOT NULL,
    subject_type TEXT NOT NULL,
    subject_id UUID NOT NULL,
    approval_kind TEXT NOT NULL,
    workflow_definition_id TEXT NOT NULL,
    workflow_instance_id TEXT NOT NULL,
    workflow_task_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
    status TEXT NOT NULL,
    requested_by UUID NOT NULL,
    requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    decided_by UUID,
    decided_at TIMESTAMPTZ,
    decision TEXT,
    rationale TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, subject_type, subject_id, approval_kind, workflow_instance_id)
);
```

Approval kinds:

```text
move_group_plan
rollback_plan
go_no_go
gate_override
cutover_start_override
```

Seed workflow definitions:

```text
migrate.move_group_plan.approval.v1
migrate.rollback_plan.approval.v1
migrate.go_no_go.approval.v1
migrate.gate_override.approval.v1
```

Each definition should use `approval_chain` with role-based approvers by default. A final `service_task` calls Migrate's internal callback endpoint to finalize the local Migrate status.

### API Design

External Migrate APIs:

```text
POST /api/v1/migrate/move-groups/{id}/approval-requests
GET  /api/v1/migrate/move-groups/{id}/approvals
POST /api/v1/migrate/rollback-plans/{id}/approval-requests
GET  /api/v1/migrate/rollback-plans/{id}/approvals
POST /api/v1/migrate/windows/{id}/go-no-go/approval-requests
POST /api/v1/migrate/gate-checks/{id}/override-approval-requests
```

Internal service-token callback:

```text
POST /internal/migrate/workflow/approvals/{bindingID}/decision
```

Callback payload:

```json
{
  "workflow_instance_id": "wf-inst-id",
  "workflow_task_id": "task-id",
  "decision": "approved|rejected",
  "decided_by": "uuid",
  "rationale": "Approved after dependency review",
  "form_data": {}
}
```

### Service Behavior

Move-group approval flow:

1. User submits a move group for approval from Migrate.
2. Migrate validates completeness and authorization.
3. Migrate starts workflow instance `migrate.move_group_plan.approval.v1`.
4. Migrate stores `migrate_approval_binding` with status `pending`.
5. Workflow creates approver tasks.
6. Notification rules alert approvers.
7. Approver completes task in workflow UI or embedded Migrate approval panel.
8. Workflow final service task calls Migrate callback.
9. Migrate updates local move-group status to approved/rejected, appends audit, and stages `approval_decided` event.

Rollback/go-no-go flows follow the same pattern.

### Backward Compatibility

Existing local endpoints such as move-group decision and rollback decision should not disappear immediately. For one release:

- Keep them as compatibility wrappers.
- If no binding exists, create a workflow binding and complete the approval through workflow in one request only for privileged migration admins.
- Mark direct local decision paths as deprecated in the README and OpenAPI.

After compatibility, local direct decisions become emergency override endpoints requiring `migrate:admin`, explicit rationale, and a high-priority event.

### UX Behavior

- Migrate screens show approval state: `not requested`, `pending`, `approved`, `rejected`, `overdue`, `overridden`.
- Operators see "Request approval" when eligible.
- Approvers see "Open approval task" or an embedded approval form if the task is assigned to them.
- Rejections show rationale inline and guide the operator to the blocked checklist.
- The command center has an "Approvals" queue with SLA and owner columns.

## 7. DR Runbook Studio and Topology Reuse

### Current State

Migrate has fields/links for runbooks, waves, rollback plans, and dependencies. DR Runbook Studio has the real editable/executable DAG runbook engine. DR topology has the real DAG topology and failover target selection. Migrate does not yet embed that functionality as a live runbook editor/runner.

### Target State

Migrate owns the migration context and operator workflow. DR Studio owns runbook execution mechanics. DR topology owns dependency and health graph mechanics.

Add a Migrate DR bridge:

```go
type DRBridge interface {
    CreateRunbook(ctx context.Context, tenantID uuid.UUID, in CreateDRRunbookRequest) (*DRRunbook, error)
    GetRunbook(ctx context.Context, tenantID uuid.UUID, runbookID uuid.UUID) (*DRRunbook, error)
    StartRun(ctx context.Context, tenantID uuid.UUID, runbookID uuid.UUID, in StartDRRunRequest) (*DRRun, error)
    GetRun(ctx context.Context, tenantID uuid.UUID, runID uuid.UUID) (*DRRunLiveState, error)
    ActOnTask(ctx context.Context, tenantID uuid.UUID, runID, taskID uuid.UUID, action string, payload map[string]any) error
    GetTopology(ctx context.Context, tenantID uuid.UUID, groupID uuid.UUID) (*Topology, error)
    GetFailoverTarget(ctx context.Context, tenantID uuid.UUID, groupID uuid.UUID) (*FailoverSelection, error)
}
```

The production implementation should use DR HTTP APIs through an internal base URL and service token. Tests can use fake clients at the boundary.

### Data Model Additions

```sql
ALTER TABLE migrate_wave
    ADD COLUMN dr_runbook_id UUID,
    ADD COLUMN dr_topology_group_id UUID;

ALTER TABLE migrate_cutover_window
    ADD COLUMN dr_runbook_id UUID,
    ADD COLUMN dr_run_id UUID;

ALTER TABLE migrate_move_group
    ADD COLUMN dr_topology_group_id UUID;

CREATE TABLE migrate_runbook_binding (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    program_id UUID NOT NULL,
    wave_id UUID,
    window_id UUID,
    move_group_id UUID,
    dr_runbook_id UUID NOT NULL,
    dr_run_id UUID,
    source TEXT NOT NULL,
    status TEXT NOT NULL,
    created_by UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, window_id, dr_runbook_id)
);
```

### Runbook Generation

Add endpoint:

```text
POST /api/v1/migrate/waves/{waveID}/runbook
```

The service generates a DR Studio runbook from:

- wave move groups
- workload dependencies
- rollback plan
- readiness and validation gates
- selected DR topology group when linked
- planned durations
- owner/approver roles

Generated import steps:

1. Freeze source writes.
2. Capture final backup/snapshot evidence.
3. Run pre-cutover readiness checks.
4. Final sync or replication lag check.
5. Stop source-side schedulers/integrations.
6. Apply target infrastructure/IaC connector action when configured.
7. Switch DNS/routing/load balancer.
8. Run application smoke validation.
9. Run data validation checks.
10. Approval gate: go/no-go.
11. Stakeholder communication milestone.
12. Rollback branch tasks with success criteria.
13. Close evidence and post-wave review.

This generated runbook becomes editable in DR Studio through the embedded Migrate panel. Regeneration should create a new runbook version rather than overwriting a runbook that has already been executed.

### Runbook Execution

Add endpoints:

```text
GET  /api/v1/migrate/windows/{windowID}/runbook
POST /api/v1/migrate/windows/{windowID}/runbook/start
GET  /api/v1/migrate/windows/{windowID}/runbook/runs/{runID}
POST /api/v1/migrate/windows/{windowID}/runbook/runs/{runID}/tasks/{taskID}:complete
POST /api/v1/migrate/windows/{windowID}/runbook/runs/{runID}/tasks/{taskID}:skip
POST /api/v1/migrate/windows/{windowID}/runbook/runs/{runID}/tasks/{taskID}:fail
```

Execution rules:

- Starting a cutover starts or attaches to a DR Studio run.
- Completing a cutover requires the DR run to be completed and required validation gates to pass.
- Failing a required DR runbook task blocks Migrate cutover completion.
- Rollback starts either the rollback branch in the same run or a separate rollback runbook, depending on DR Studio support at implementation time.
- Migrate stores the run ID and mirrors high-level state for command-center queries.

### Topology Reuse

Add endpoints:

```text
GET /api/v1/migrate/move-groups/{id}/topology
GET /api/v1/migrate/move-groups/{id}/failover-target
POST /api/v1/migrate/move-groups/{id}/topology-link
```

Behavior:

- If a move group links to a DR topology group, Migrate proxies topology and failover selection through the DR bridge.
- If no DR topology exists, Migrate still shows workload dependency relationships from Migrate inventory but labels the DR topology as unlinked.
- The move-group completeness check should warn when critical workloads have no topology/dependency mapping.

### UX Behavior

Migrate wave detail tabs:

- Overview
- Move groups
- Dependency map
- Runbook
- Approvals
- Evidence

Cutover detail live execution:

- left: runbook DAG/frontier/critical path
- center: current task details and action form
- right: blockers, approvals, notifications, evidence
- header: planned vs actual duration, window timer, rollback readiness

Operator affordances:

- "Generate runbook" from wave.
- "Open in DR Studio" as a secondary link for users with DR permissions.
- "Start cutover run" from the cutover window.
- Inline task complete/skip/fail, permission-gated server-side.
- Visible degraded state if DR service is unavailable.

## 8. Deployment and Process Registration

### Current State

Gateway and fleet registry have Migrate awareness. Production process manager and infra bootstrap do not fully enumerate it.

### Required Changes

VPS PM2 ecosystem:

- Add `migrate` and `migrateAdmin` to `PORT`.
- Add `serviceApp("migrate-service", ...)`.
- Add `GW_SVC_URL_MIGRATE` to gateway env.
- Add `migrate=${svcUrl(PORT.migrate)}` to workflow `WF_SERVICE_URLS` so workflow service tasks can call Migrate callbacks.

Recommended env:

```js
serviceApp("migrate-service", {
  MIGRATE_HTTP_PORT: PORT.migrate,
  MIGRATE_ADMIN_PORT: PORT.migrateAdmin,
  MIGRATE_DATABASE_URL: pgUrl("migrate_db"),
  MIGRATE_DR_DATABASE_URL: pgUrl("dr_db"),
  MIGRATE_DB_MIN_CONNS: "1",
  MIGRATE_DB_MAX_CONNS: "8",
  MIGRATE_LICENSE_SERVICE_URL: svcUrl(PORT.license),
  MIGRATE_JWT_PUBLIC_KEY_PATH: jwtPublicKeyPath,
  MIGRATE_CONNECTOR_TIMEOUT: "15s",
  MIGRATE_ENTITLEMENT_FAIL_OPEN: "false",
  MIGRATE_WORKFLOW_SERVICE_URL: svcUrl(PORT.workflow),
  MIGRATE_DR_SERVICE_URL: svcUrl(PORT.dr),
  MIGRATE_INTERNAL_TOKEN: env("MIGRATE_INTERNAL_TOKEN", ""),
})
```

Database bootstrap:

- Add `CREATE DATABASE migrate_db;`
- Grant privileges to `clario`.
- Enable `pgcrypto` and `uuid-ossp`.

Prometheus:

- Add scrape job for `migrate-service:9100`.
- Keep Migrate-specific metrics under `migrate_*`.
- Relabel shared `db_*`, `kafka_*`, and `http_*` like other services.

Gateway:

- Confirm production env sets `GW_SVC_URL_MIGRATE`.
- No nginx route change is expected if nginx proxies `/api` to gateway.

Helm/Kubernetes:

- Add `migrate-service` deployment, service, configmap, and optional ServiceMonitor if Kubernetes is a production path.
- Add values for `migrateService.enabled`, image, ports, DB URL secret, license URL, workflow URL, DR URL, and internal token.

## 9. Security and Authorization

Permissions should remain Migrate-scoped at the product boundary:

```text
migrate:read
migrate:plan
migrate:approve
migrate:cutover
migrate:rollback
migrate:integrations
migrate:evidence:export
migrate:admin
```

Cross-service calls:

- Frontend calls Migrate only for Migrate workflow screens.
- Migrate calls workflow/DR via internal service credentials.
- Internal callbacks require service token validation and tenant/subject verification.
- A user action inside embedded approval/runbook UI must still carry the actor identity and be authorized by Migrate before proxying.

Audit:

- Every approval decision, override, DR task action, cutover start, cutover completion, rollback action, and connector retry appends local Migrate audit.
- Cross-service IDs should be recorded: workflow instance ID, workflow task ID, DR runbook ID, DR run ID, DR task ID, source event ID.

## 10. Failure Handling

Notification unavailable:

- Migrate write succeeds if domain state and outbox commit.
- Outbox retry handles notification consumer downtime.
- UI still shows local status.

Workflow unavailable:

- Approval request fails with `503` and no local approval status change.
- Already requested approvals show "approval service unavailable" but remain pending.

Workflow callback duplicate:

- Migrate callback is idempotent by `binding_id + workflow_instance_id + decision`.
- Replayed callback returns `200` with current binding state.

DR unavailable:

- Existing Migrate planning pages remain available.
- Runbook generation/start/task action endpoints return `503`.
- Cutover cannot start if DR runbook is required by policy.

Connector failure:

- Invocation record captures status and HTTP response.
- Event `connector.failed` triggers critical notification.
- Retry requires same idempotency key or explicit new invocation reason.

## 11. Implementation Phases

### Phase 1: Migrate Events and Notifications

Deliverables:

- `Topics.MigrateEvents`
- Migrate event stager and `recordActivity(...)`
- Outbox writes for key domain transitions
- Notification types and rule-engine rules for Migrate
- Command-center activity/notification rail
- Tests for event staging, notification matching, and idempotency

Exit criteria:

- Creating/submitting/approving a move group emits an event and creates a notification for approvers.
- A failed gate emits a critical notification with a deep link.

### Phase 2: Workflow-Backed Approvals

Deliverables:

- Approval binding migration and repository
- Workflow client
- Seeded Migrate workflow definitions
- Approval request APIs
- Internal workflow callback
- Compatibility wrapper for existing local decision endpoints
- Embedded approval task UI states
- Integration tests from request to task completion to local status update

Exit criteria:

- Move-group approval cannot bypass workflow except through admin emergency override.
- Workflow task completion updates Migrate state and audit.

### Phase 3: DR Studio and Topology Bridge

Deliverables:

- DR bridge client
- Runbook binding migration
- Wave-to-runbook generation
- Cutover run start and task action APIs
- Topology proxy/link endpoints
- Embedded runbook and topology UI panels
- Tests with fake DR client plus at least one integration smoke against DR router contracts

Exit criteria:

- A wave can generate an editable DR Studio runbook.
- A cutover can start a run and reflect live run/task state inside Migrate.
- Required failed tasks/gates block cutover completion.

### Phase 4: Production Registration

Deliverables:

- PM2 ecosystem service entry and env
- DB init entry for `migrate_db`
- Prometheus scrape config
- Helm/Kubernetes service registration if used in production
- Deploy smoke checks

Exit criteria:

- Production process manager starts `migrate-service`.
- Gateway routes `/api/v1/migrate/product` and `/api/v1/migrate/programs`.
- Prometheus target is up.

### Phase 5: End-to-End Validation

Deliverables:

- Backend integration path:
  - create program
  - import workload
  - create move group
  - request workflow approval
  - approve task
  - create wave
  - generate runbook
  - start cutover run
  - complete required tasks/gates
  - complete cutover
- Frontend authenticated Playwright smoke for the same happy path.
- Negative tests for entitlement denied, approval denied, failed gate, DR unavailable, duplicate callback.

Exit criteria:

- The Migrate operator journey is usable end-to-end without direct workflow/DR navigation.

## 12. Test Matrix

Backend unit:

- event name and payload contract
- `recordActivity(...)` writes audit and stages event
- approval binding transitions
- idempotent workflow callback
- DR runbook step generation
- cutover completion blocked by incomplete DR run

Backend integration:

- outbox event committed with Migrate domain write
- notification rule matches Migrate events
- workflow approval request creates human task and callback updates Migrate
- DR bridge contract against DR router test server
- production config smoke for service env validation

Frontend:

- Migrate notification rail renders critical/pending/completed states
- approval panel states and deep links
- runbook panel loading, live run, task action, and unavailable states
- topology linked/unlinked states
- route guards and entitlement behavior

E2E:

- migration approval and cutover path
- failed readiness gate blocks start
- failed validation gate blocks completion
- connector failure triggers notification and retry UI

## 13. Review Decisions Needed

1. Approval authority: should default approvers be `tenant_admin`, a new `migration_approver` role, or both?
2. Workflow ownership: should Migrate seed workflow definitions globally, per tenant, or from workflow templates during onboarding?
3. DR embedding: should the UI proxy all DR Studio actions through Migrate, or allow direct DR calls for users who also have DR permissions? Recommendation: proxy through Migrate for the primary workflow.
4. Runbook regeneration: should editing a wave after runbook generation create a new version automatically, or require an explicit "regenerate" action? Recommendation: explicit regenerate with diff preview.
5. Production target: is VPS PM2 the only immediate production path, or must Helm/Kubernetes be updated in the same implementation wave?
6. Notification channels: should critical cutover/gate failures send email by default, or only in-app/websocket unless the tenant enables email?

## 14. Recommended First Implementation Slice

Start with Phase 1 and the move-group approval part of Phase 2. That gives immediate UX value:

- approvers receive actionable notifications
- Migrate command center shows pending approvals and blockers
- approval decisions move from local records to workflow tasks
- audit and event streams become consistent

Once that is stable, implement DR Studio embedding for waves/cutovers. That is larger and should not be mixed into the first approval/notification PR unless the team is ready for a bigger integration test surface.
