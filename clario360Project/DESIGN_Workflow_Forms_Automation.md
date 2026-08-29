# Clario360 — Workflow & Forms Engine (completion) + Automation Engine
## Detailed Implementation Design (agent-executable)

- **Version:** 1.0 · 13 June 2026 · **Author:** Engineering
- **Source spec:** SRS Core Engines v0.2 §4.1 (Workflow & Forms) / §4.3 (Automation); ADR-001 v0.2 Addendum A2/A4; Solution Architecture deck S19–S21. FRs: FR-WORKFLOW-001…006, FR-AUTOMATION-001…005, cross-cutting FR-XC-001…009.
- **Runtime decision:** **D-7 RESOLVED → Go** for both engines (CTO, 13 Jun 2026). Integration Engine already shipped in Go. This supersedes the earlier "lean NestJS".
- **Status:** decomposed into WP-0…WP-13 (§12). Not started — this document is the build spec.
- **Audience:** AI coding agents. Every section cites the exact existing code to reuse (with file:line). **No stubs, no fakes** — every WP delivers working, tested code.

---

## 0 · How to use this document

Build in WP order (§12). `GOWORK=off` on every Go command; module `github.com/clario360/platform`; backend root `/Users/mac/clario360/backend`. **Two hard rules, no exceptions:**

1. **Reuse before building.** Consult the reuse map (§2.3). The platform already has bootstrap, the transactional outbox, leadership election, the events bus + consumers + idempotency guard, the expression DSL, a dynamic form renderer, an Admin-Studio designer, a cron parser, and the five action targets. Do **not** re-implement any of them.
2. **Every state change is transactional with its events.** `database.RunInTx`/`RunWithTenant` + `outbox.Write(ctx, tx, topic, event)` in the same transaction. No dual-writes. High-volume telemetry only may use direct `Producer.Publish`.

A third rule for this work specifically: **extend the existing `internal/workflow` engine — never rewrite it.** It is ~15.7k LOC of working, outbox-backed code. New behavior is additive (new packages, new columns via real migrations, new executors registered into the existing registry, new orchestrator behind the existing seam).

---

## 1 · Scope & success criteria

### 1.1 What we are building
Two core engines, both Go, both first-class services behind the gateway (ADR Addendum A1: "the core scales by addition, not modification").

**A. Workflow & Forms Engine — complete the existing seed to the FR bar.** The seed (`internal/workflow` + `cmd/workflow-engine`) is a custom JSON step+transition state machine that already does definitions, instances, human/service/condition/timer/event tasks, an expression DSL, event-driven triggers, and outbox publishing. We add the six FR gaps:
- **Forms engine** (`internal/forms`) — a real form-definition model (rich field types, declarative validation, conditional visibility, **bilingual AR/EN content**) that the human-task step and the existing frontend renderer consume.
- **Versioning + environment promotion** — stable definition lineage, dev→staging→prod stages, immutable-on-promote, fork-on-edit, a promote action ("config release without deploy", FR-WORKFLOW-002/003).
- **Approval chains + multi-level SLA/escalation** — first-class sequential/parallel approver chains; tiered escalation with reminders and working-hours awareness.
- **Sandbox simulation** (FR-WORKFLOW-006) — side-effect-free dry-run of a definition.
- **D-9 execution seam** — freeze the `StepExecutor`/`ErrParked` contract and extract an `Orchestrator` interface so the FSM-vs-BPMN decision can land later without touching the API/FRs.
- **Production hardening** — register the implemented-but-unwired `parallel_gateway`; add leader election to the scheduler/recovery loops; implement the cron-schedule trigger runtime (validated config today fires nothing); add per-action RBAC; move the self-managed `schema.go` to real `migrations/workflow_db/`.

**B. Automation Engine — greenfield, "orchestrate don't rebuild"** (`internal/automation` + `cmd/automation-service`). Unattended, event/rule-driven counterpart to the (human-in-the-loop) Workflow engine. Triggers (event/schedule/threshold/manual/webhook) → no-code rules (reuse the workflow expression DSL) → multi-step runbooks with human approval gates → execution log + replay. Its actions invoke the other engines via API/event (never their DBs): start a workflow, run an integration, send a notification, execute a DR runbook step, call any service API. Benchmarks: ControlMonkey (policy/drift automation) + Cutover (collaborative runbooks, immutable audit).

### 1.2 Out of scope
- The Admin-Studio **frontend** build-out (a dynamic renderer + designer already exist; this doc specifies the *backend* contract they consume and lists the FE gaps as forward seams §13). Net-new FE work is a separate track.
- A BPMN engine (D-9 is a Sprint-2 spike; we design the seam, we do not pick BPMN here).
- Marketplace packaging (D-8, Horizon 3).
- Porting Business+ apps onto these engines (consumers come later; §13).

### 1.3 Success criteria (mapped to FRs, each measurable)

| FR | Acceptance (how measured) |
|---|---|
| FR-WORKFLOW-001 | An admin authors a process with a multi-approver chain, an SLA timer, and a form via the API; `ValidateDefinition` accepts it; an instance runs it end-to-end (integration test). |
| FR-WORKFLOW-002 | A promoted definition version is immutable (edit → 409, fork → new draft); a `promote` call moves a version dev→staging→prod; lineage queryable. Integration test asserts immutability + stage transitions. |
| FR-WORKFLOW-003 | A definition change goes live via `promote` with **no service redeploy** — timed "config-release" integration test (NFR-FSUIT-002). |
| FR-WORKFLOW-004 | A form renders RTL with Arabic labels; missing AR label fails a validation check. Backend stores `{ar,en}`; renderer resolves via `useLocale()`. |
| FR-WORKFLOW-005 | Every instance/task state change emits `platform.workflow.events` **via the outbox in the same tx** (already true for publish; WP tightens to same-tx `outbox.Write`). Integration test: kill broker, event survives. |
| FR-WORKFLOW-006 | `POST /definitions/{id}/simulate` runs a definition over supplied trigger data with **zero side effects** (no HTTP service calls, no events, no task rows, no timers) and returns the executed path + gate evaluations. |
| FR-AUTOMATION-001 | All five trigger types fire the right automation **exactly once** (dedupe-by-event-id via `IdempotencyGuard`). Integration test per trigger type. |
| FR-AUTOMATION-002 | Two matching rules evaluate in priority order, duplicates suppressed, higher priority wins; conflict logged. |
| FR-AUTOMATION-003 | A runbook with an approval gate pauses until a human approves, then continues; gate timeout escalates/aborts per policy. Mirrors the DR gated-FSM discipline. |
| FR-AUTOMATION-004 | Every run is logged; `POST /runs/{id}/replay` re-executes from recorded inputs; a log gap marks the run non-replayable. |
| FR-AUTOMATION-005 | An automation action starts a workflow, runs an integration, sends a notification, and executes a DR runbook step — each via API/event, each audited. Integration test per action. |

Cross-cutting (FR-XC-*) are inherited from platform core, not re-implemented: SSO/JWT (FR-XC-001), audit-via-bus (002), schema-per-service (003), API/event-only cross-service access (004), transactional outbox (005), tenant RLS (007), bilingual (008), air-gap clean (009).

---

## 2 · Architecture

### 2.1 Topology
```
              ┌──────────────── API Gateway (Go) ────────────────┐
              │  /api/v1/workflows         /api/v1/automation     │
              └───────┬───────────────────────────┬──────────────┘
        Auth+Tenant   │                            │  Auth+Tenant(+RBAC)
                ┌─────▼─────┐                 ┌─────▼──────┐
                │ workflow- │                 │ automation-│
                │  engine   │◄───start WF─────│  service   │
                │ (extend)  │  (HTTP API)     │  (new)     │
                └─────┬─────┘                 └──┬───┬───┬─┘
                      │ outbox                   │   │   │ outbox
        platform.workflow.events          publish events / HTTP
                      │                          │   │   │
                      ▼                  ┌───────┘   │   └────────┐
            (BOSALAH / audit /           ▼           ▼            ▼
             notification consumers) Integration  Notification  ClarioDR
                                     (event fan-out) (event)    (HTTP ActOnTask)
        Triggers into automation: bus events · cron (leader) · alert/threshold events · manual API · inbound webhook
```

### 2.2 Deployables

| Deployable | Where it runs | What it is | Skeleton it clones |
|---|---|---|---|
| `workflow-engine` (extend) | platform core | the existing service, hardened + forms/promotion/sandbox/approval added | already exists; align wiring to `cmd/license-service/main.go` (per-instance registry, `database.RunMigrations`, leader loops) |
| `automation-service` (new) | platform core | the new Automation Engine | `cmd/license-service/main.go` |

Both register at the gateway with versioned OpenAPI contracts and integrate only via API/event (ADR A1).

### 2.3 Reuse map — the load-bearing table (do NOT re-implement)

| Need | Reuse | Path | Key API (file:line) |
|---|---|---|---|
| Bootstrap + Service bundle | `observability/bootstrap` | `internal/observability/bootstrap` | `Bootstrap(ctx, *ServiceConfig) (*Service,error)` `bootstrap.go:54`; `Service{Logger,Metrics,Tracer,DBPool,Redis,Router,AdminRouter,Health}` `:26`; `AuthenticatedGroup()` `:219` |
| Event envelope + topics | `internal/events` | — | `NewEvent(type,source,tenant,data)` `event.go:39`; `Topics.WorkflowEvents="platform.workflow.events"` `topics.go:59`; add `AutomationEvents` (§8) |
| Transactional outbox | `internal/events/outbox` | — | `Write(ctx, tx, topic, *Event)` `outbox.go:67`; `NewRelay(...).Run(ctx)` `relay.go:99/116` (claims `FOR UPDATE SKIP LOCKED`) |
| Bus consumer | `internal/events` | — | `NewConsumer(cfg,log)` `consumer.go:61`; `.Subscribe(topic,handler)` `:125`; `.Start(ctx)` `:190`; `TypedEventHandler` `:22` |
| Idempotency / dedupe | `internal/events` | — | `NewIdempotencyGuard(redis,ttl)` `idempotency.go:29`; `IsProcessed/MarkProcessed/Release` `:43/:66/:82` (copy `notification_consumer.go:96-138`) |
| Leadership (scheduler singleton) | `internal/leadership` | — | `NewRedisElection(rdb,role,instID,ttl,renew,log)` `redis.go:90`; `Elector.Run(ctx, RunOpts{OnAcquire,OnLose})` `:134`; pattern `cmd/clario-dr-service/main.go:653` |
| DB tx + RLS | `internal/database` | — | `RunInTx` `tx.go:13`; `RunWithTenant` `tenant_context.go:50`; `RunReadWithTenant` `:81`; `RunSystemTx/RunSystemRead` `:107/:129` (bg loops) |
| HTTP helpers | `internal/suiteapi` | — | `TenantID(r)` `http.go:136`; `UserID(r)` `:148`; `WriteData/WriteError/DecodeJSON/UUIDParam/ParsePagination` |
| Middleware | `internal/middleware` | — | `Auth(jwtMgr)` `auth.go:13`; `RequirePermission(p)` `auth.go:54`; `Tenant` `tenant.go:15` (also `X-Tenant-ID` for svc-to-svc) |
| Expression DSL (rules + conditions) | `internal/workflow/expression` | — | `Evaluator.Evaluate(expr,ctx) bool` (`== != < > >= <= && || ! in [...]`, dotted paths) `evaluator.go`; `VariableResolver` (`${path}` templating); `Sanitizer` |
| Cron parser (schedule triggers) | `internal/dr/drillsched` | — | `ParseCron` `cron.go:67`; `(*CronSchedule).NextAfter(t)` `:251`; `NextN` `:291`. **Extract to a shared `internal/cron` package** (WP-2) so both drillsched and automation use one copy. |
| Step-execution seam (D-9) | `internal/workflow/executor` | — | `StepExecutor.Execute(...) (*ExecutionResult,error)` `registry.go:25`; `ExecutorRegistry` `:46`; `ErrParked`/`ExecutionResult{Output,Parked}` `:13/:16` |
| Dynamic form renderer (FE) | frontend | `frontend/src/app/(dashboard)/admin/workflows/tasks/components/task-form-renderer.tsx` | consumes `FormField[]`; `buildDynamicZodSchema` `lib/workflow-utils.ts` |
| Admin-Studio designer (FE) | frontend | `.../designer/components/{workflow-canvas,form-schema-builder,condition-builder}.tsx` | speaks the step/transition/condition + FormField model |
| i18n (AR/EN, RTL) | frontend | `lib/i18n.ts`, `lib/i18n/messages.ts`, `components/providers/locale-provider.tsx` | `useLocale()`/`useT()`; `<html dir>` set server-side |
| Action target: start workflow | `internal/workflow` | — | `POST /api/v1/workflows/instances` → `EngineService.StartInstance` `engine_service.go:95` |
| Action target: integration | `internal/integration` | — | **publish a domain event** → `IntegrationConsumer` fans out `integration_consumer.go:48` (never touch its config DB) |
| Action target: notification | `internal/notification` | — | **publish a domain event** → `NotificationConsumer` rule engine `notification_consumer.go:57` |
| Action target: DR runbook step | `internal/dr/runbookstudio` | — | `POST /api/v1/dr/studio/runs/{runID}/tasks/{action}` → `Service.ActOnTask` `service.go:698` |
| Action target: any service API | gateway | — | HTTP + per-tenant system token (pattern `delivery_service.go:202`) + `X-Tenant-ID` header |
| Service wiring reference | `cmd/license-service/main.go` | — | bootstrap→migrate→jwt→repos/svcs→mount Auth+Tenant→relay→consumers→leader loops→`svc.Run` |

---

## 3 · Workflow & Forms Engine — completion (`internal/workflow`, new `internal/forms`)

### 3.1 D-9 execution seam (freeze + extract) — WP-1
The swap boundary already half-exists. Make it explicit so FSM↔BPMN can change later without touching the API/FRs:
- **Keep** `executor.StepExecutor` + `ExecutorRegistry` + `ErrParked`/`ExecutionResult{Output,Parked}` as the **per-step contract** (registry.go:13-67). Every engine drives steps through this and honors park/resume.
- **Register `parallel_gateway`** in `cmd/workflow-engine/main.go` (currently implemented but unwired → runtime failure today).
- **Extract** the traversal logic now hard-wired in `service/engine_service.go:168-320` behind a new interface:
  ```go
  // internal/workflow/engine/orchestrator.go
  type Orchestrator interface {
      Start(ctx context.Context, def *model.WorkflowDefinition, trigger TriggerData) (*model.WorkflowInstance, error)
      Advance(ctx context.Context, instanceID string) error                 // run until park/end
      Signal(ctx context.Context, instanceID, stepID string, payload map[string]any) error // resume a parked step
  }
  ```
  The current in-house traversal becomes `engine.FSMOrchestrator` implementing it. The HTTP API, DTOs, events, and the executor registry stay identical. A future BPMN core = a second `Orchestrator` impl + a `BPMN-XML → []StepDefinition` compiler; BPMN never leaks into the API.

### 3.2 Forms engine (`internal/forms`) — WP-3
New package; the canonical form-definition model the human-task step and the FE renderer consume. **Bilingual, validated, conditional** — grounded in what the FE already renders (Tier 1+2 field types).

```go
// internal/forms/model.go
type LocalizedText struct{ AR, EN string }            // every author-facing string

type FieldType string // text|textarea|number|boolean|date|select|  multiselect|combobox|daterange|file|  email|url|phone|currency|radio|datetime|section
type FormField struct {
    Name        string
    Type        FieldType
    Label       LocalizedText
    Placeholder *LocalizedText
    Description *LocalizedText
    Required    bool
    Default     any
    Options     []FormOption          // {Value string; Label LocalizedText}
    Validation  []ValidationRule      // required|min|max|minLength|maxLength|pattern|email|url|uuid|cron|enum|requiredIf
    VisibleWhen []Condition           // reuse the WorkflowCondition operator set (eq/neq/gt/.../in/contains)
    RequiredWhen []Condition
    Dir         string                // auto|ltr|rtl  (LTR override for email/number/IBAN in an RTL form)
}
type ValidationRule struct { Kind string; Param any; When []Condition; Message LocalizedText }
type FormDefinition struct {
    ID, TenantID, Name string
    Version int
    Locales []string                  // ["ar","en"]
    DefaultLocale string
    Fields []FormField
    // + standard audit/version/stage columns (§3.3)
}
```
- **Validation runs on BOTH sides.** The FE compiles `Validation`/`VisibleWhen` to Zod (extend `buildDynamicZodSchema`); the backend re-validates on submit (never trust client) using the **same operator vocabulary** — bind `VisibleWhen`/`requiredIf` to the existing `expression.Evaluator` (one grammar, two evaluators). Hidden fields are excluded from validation so hidden-required fields don't block submit.
- **Backward compatible:** accept `Label` as a bare string (legacy seed) or `{ar,en}`. Keep the existing `model.FormField` (task.go:36) working; the human-task executor (`human_task.go buildFormSchema`) gains a path that loads a `forms.FormDefinition` by ref when the step config names one, else falls back to the inline legacy fields.
- **FR-XC-008 gate:** a CI/validation check fails a form definition missing an AR (or EN) label.

### 3.3 Versioning + environment promotion — WP-4
The seed versions by `(tenant,name)` and forks-on-edit, but has no stages, no immutability, no lineage. Add:
- New columns on `workflow_definitions` (real migration, §7): `definition_key UUID` (stable lineage id, constant across versions), `stage TEXT CHECK (stage IN ('dev','staging','prod'))`, `immutable BOOL`, `promoted_at TIMESTAMPTZ`, `promoted_by`.
- **Immutability:** once a version is promoted to staging/prod, `Update`/`Archive` on it return `ErrConflict` (409); editing forks a new **draft** version (the existing fork-on-edit path) under the same `definition_key`.
- **Promote action + state machine:** `POST /definitions/{id}/promote {to_stage}` advances dev→staging→prod (no skips), sets `immutable=true` at staging+, stamps `promoted_at/by`, emits `workflow.definition.promoted`. Promotion changes runtime behavior **with no redeploy** (definitions are JSONB loaded at runtime) — this is the FR-WORKFLOW-003 "config release" and its NFR-FSUIT-002 timed demo.
- Lineage queries: `GET /definitions/{key}/lineage` returns all versions+stages for a `definition_key`.

### 3.4 Approval chains + multi-level SLA/escalation — WP-5
- **Approval chain** = a new step type `approval_chain` (registered executor) whose `Config` declares an ordered or parallel list of approvers (user/role), a quorum (`all` | `any` | `n_of_m`), and per-step SLA. It parks (like human_task) and creates one `HumanTask` per pending approver; resumes when the quorum is met or any rejects (configurable). This fixes the seed limitation that parallel branches can't contain parking tasks.
- **Multi-level SLA/escalation policy** on the definition (not just per-task): tiered escalation (`[{after: PT4H, notify: role:lead}, {after: PT8H, notify: role:manager, action: reassign}]`), reminder cadence before breach, and **working-hours/business-calendar** awareness (a tenant calendar so "4h SLA" counts business hours). The scheduler SLA loop (scheduler_service.go:216) is extended to evaluate the tiered policy; escalations emit `workflow.task.escalated`.

### 3.5 Sandbox simulation (FR-WORKFLOW-006) — WP-6
`POST /definitions/{id}/simulate {trigger_data, variable_overrides}` runs the orchestrator in a **dry-run mode** that produces **zero side effects**:
- A `SimulationOrchestrator` (or a `dryRun` flag threaded through the `Orchestrator`) uses **mock executors**: service_task returns a synthetic 200 (no HTTP), event_task records "would publish" (no emit), human_task/approval auto-resolves with supplied mock decisions (no task rows), timer resolves instantly. Conditions/transitions evaluate for real (the `Evaluator` is already side-effect-free).
- Returns the executed step path, every gate/condition evaluation result, computed variables, and projected SLA timeline. Nothing is persisted (ephemeral in-memory instance); nothing hits Redis/Kafka/HTTP.

### 3.6 Production hardening — WP-7
- **Leader election** on the scheduler timer/SLA loops and the recovery service (`scheduler_service.go:72`, `recovery_service.go:56`) via `leadership.NewRedisElection` — start loops only in `OnAcquire` (today every replica runs them).
- **Cron-schedule trigger runtime:** the seed validates `TriggerConfig.Cron` but nothing fires it. Add a leader-singleton cron scheduler (reuse the shared `internal/cron` from WP-2, mirror `drillsched/scheduler.go:174`) that fires `schedule`-trigger definitions.
- **Per-action RBAC:** add `auth.RequirePermission` gates to the workflow routes (`workflow:read/write/admin`, `workflow:task` for claim/complete) — today only Auth+Tenant, so any tenant user can activate/promote/delete.
- **Migrate schema** from the self-managed `repository/schema.go` `SchemaSQL` to a real `migrations/workflow_db/` directory (§7) so workflow joins the central migrator + the apply-from-scratch idempotency test (the same class of bug we just fixed in cyber_db).

---

## 4 · Automation Engine (`internal/automation` + `cmd/automation-service`) — greenfield

### 4.1 Package layout (clone `internal/license` shape)
```
cmd/automation-service/main.go
internal/automation/
  config/        env (AUTO_*)
  model/         Automation, Trigger, Rule, Runbook, RunbookStep, Run, RunStep, ApprovalGate
  repository/    DBTX-receiver repos (pgxmock-tested)
  service/       AutomationService, RunbookOrchestrator, RuleEngine, ScheduleService
  trigger/       event / schedule / threshold / manual / webhook trigger sources
  action/        the 5 action executors (start_workflow, integration, notification, dr_runbook, http_call)
  handler/       chi routes (Auth+Tenant+RBAC)
  health/
migrations/automation_db/000001_init_schema.{up,down}.sql
```

### 4.2 main.go responsibilities (mirror `cmd/license-service/main.go`)
1. `appconfig.Load()` → `automationcfg.Load(base)`.
2. `bootstrap.Bootstrap(ctx, buildBootstrapConfig(...))` → `*Service`.
3. `database.RunMigrations(cfg.DBURL, "migrations/automation_db")`.
4. `auth.NewJWTManager(baseCfg.Auth)`.
5. Build repos + `AutomationService` + `RunbookOrchestrator` + `RuleEngine` + action executors (each action executor holds an HTTP client / `events.Producer` — no other engine's DB).
6. Mount `/api/v1/automation` under `SecurityHeaders → Auth(jwt) → Tenant → RequirePermission(...)`.
7. Start the **outbox Relay** (`outbox.NewRelay(...).Run`) if Kafka configured.
8. Start **trigger sources**: a multi-topic `events.Consumer` (event + threshold triggers) with an `IdempotencyGuard`; an inbound webhook route; a **leader-singleton cron `ScheduleService`** (`internal/cron` + `leadership.NewRedisElection`).
9. Start the **leader-singleton `RunbookOrchestrator` driver** (the gated-runbook FSM, mirroring `startFailoverDriver`).
10. `svc.Run(ctx)`.

### 4.3 Triggers (FR-AUTOMATION-001 — five types, exactly-once)
| Type | Mechanism | Reuse |
|---|---|---|
| event | subscribe `events.Topics.*`; match rule conditions | `events.Consumer.Subscribe` `consumer.go:125`; copy multi-topic loop `notification_consumer.go:57-70` |
| schedule | cron `NextAfter` claim-and-fire loop, leader-only | `internal/cron` (WP-2); mirror `drillsched/scheduler.go:174` |
| threshold | subscribe `AlertEvents`/`RiskEvents`/`DRAlerts`, match on `data.severity`/value | `drsource/routing.go:160` severity filters reusable |
| manual | `POST /api/v1/automation/{id}/invoke` (Auth+Tenant+RBAC) | `suiteapi.TenantID/UserID` |
| webhook | inbound `POST /api/v1/automation/webhooks/{token}` → build `events.Event` | mirror `integration/handler/webhook_handler.go:21` |

**Exactly-once:** every trigger occurrence carries a stable id; `IdempotencyGuard.IsProcessed(event.ID)` gates execution; DB-level unique `(tenant_id, source_event_id)` on the `automation_runs` table is the backstop (mirror `notification_service InsertWithDedup`).

### 4.4 Rule engine (FR-AUTOMATION-002)
- A `Rule{Priority int, When []Condition, Then ActionRef}` set per automation. **Reuse `internal/workflow/expression.Evaluator`** for `When` (same boolean DSL, same `{variables,trigger,...}` context shape). Evaluate matching rules in priority order; dedupe; on conflict higher priority wins and a conflict is logged. (`SHOULD` per SRS — implement fully but it's not the MUST core.)

### 4.5 Runbook orchestration + approval gates (FR-AUTOMATION-003) — the durable FSM
A runbook = an ordered list of steps; each step is an **action** or a **human approval gate**. The `RunbookOrchestrator` is a **persisted, leader-singleton driver** mirroring the DR gated-failover discipline (`internal/dr/failover` — claim with `FOR UPDATE SKIP LOCKED`, idempotent steps `UNIQUE(run_id,step)`, separate claim/advance transactions, restart-safe). See §6 for the FSM. Approval gates **park** the run until a human approves (a `HumanTask`-style record, reuse the pattern); gate timeout → escalate or abort per policy.

### 4.6 Action surface (FR-AUTOMATION-005) — orchestrate, don't rebuild
| Action | How (per FR-XC-004: API/event only) |
|---|---|
| start_workflow | `POST /api/v1/workflows/instances` with `X-Tenant-ID` + system token |
| integration | **publish** a domain event via `outbox.Write`/`Producer` → `IntegrationConsumer` fans out to matching tenant integrations (do **not** read integration config DB) |
| notification | **publish** a domain event → `NotificationConsumer` rule engine (no general create-notification REST exists) |
| dr_runbook | `POST /api/v1/dr/studio/runs/{runID}/tasks/{action}` → `ActOnTask` (Automation as `ActedBy`) |
| http_call | generic HTTP to any service behind the gateway with per-tenant system token + `X-Tenant-ID` |

Each action executor records its call + result in the run's execution log (§4.7) with the target's response, for audit (Cutover "immutable audit") and replay.

### 4.7 Execution log + replay (FR-AUTOMATION-004)
Every run writes an append-only `automation_run_steps` log: step index, action, **recorded inputs** (resolved config + the trigger payload), output/response, status, timestamps. `POST /runs/{id}/replay` re-executes a completed run **from its recorded inputs** (new run, `replay_of` lineage). A gap in the log (missing step record) marks the run `non_replayable` and alerts. Replay re-uses the idempotency guard so a replay doesn't double-fire side effects unintentionally (operator-confirmed replay overrides).

---

## 5 · Cross-cutting

- **Idempotency** (§2.3): `IdempotencyGuard` on every event/threshold trigger; `(tenant_id, source_event_id)` unique backstop.
- **Sandbox** (workflow §3.5): mock-executor dry-run; the only side-effect-free primitive in the seed is the `Evaluator`, which the simulator builds on.
- **Secrets:** automation http_call / webhook tokens use the same per-tenant credential approach as integration (`encryption.ConfigEncryptor` pattern) — never store plaintext tokens.
- **Audit (FR-XC-002):** state changes emit to the bus via outbox; no local audit table.

---

## 6 · Durable execution model (§ critical design decision)

Both engines run **persisted, restart-safe, idempotent** state machines driven by **leader-singleton** loops — never in-memory-only (a crash mid-run must resume, not lose state). This mirrors the proven DR failover driver.

**Automation run FSM:**
```
PENDING → RUNNING → (per step) ACTION_OK | AWAITING_APPROVAL → APPROVED → RUNNING → … → COMPLETED
                                                   │
                                          (timeout) ESCALATED → (policy) RUNNING | ABORTED
          RUNNING → FAILED (action error, ret/skip per policy)   ;  any → CANCELLED
```
Design rules (copy from `internal/dr/failover`):
- **Durable:** every transition persisted (`automation_runs` + `automation_run_steps`); the driver re-derives state from the DB on restart.
- **Resumable:** the leader driver claims runnable/awaiting runs with `FOR UPDATE SKIP LOCKED`; claim and advance in **separate transactions** (avoids the FK-lock deadlock the DR failback work documented).
- **Idempotent:** `UNIQUE(run_id, step_index)`; steps use Ensure-not-Create so a crash-restart never double-executes an action; the idempotency guard backs external effects.
- **Approval gate never auto-advances** — a partial index excludes `AWAITING_APPROVAL` from the driver's claim query (exactly as DR failback does for its cutback gate).

**Workflow orchestrator:** keep the existing park/resume model (§3.1) but add leader election to its timer/SLA/recovery loops (§3.7) so the same durability guarantees hold under horizontal scaling.

---

## 7 · Data model (full DDL, WP-1/WP-3 workflow; WP-8 automation)

Standard tenant table shape (id/tenant_id/…/created_at/updated_at, per-operation 4-policy RLS with `app.bypass_rls` backstop, verbatim `event_outbox` block) per the house convention (`migrations/dr_db/000001`, `platform_core/000002_rls`). Infra/cross-tenant tables read by leader loops (`automation_runs` claim path) follow the documented single system-query path.

**`migrations/workflow_db/`** (new — migrate `repository/schema.go` `SchemaSQL` verbatim into `000001_init_schema`, then `000002_forms_promotion` adds: `workflow_definitions` columns `definition_key, stage, immutable, promoted_at, promoted_by`; new tables `workflow_forms` (the §3.2 FormDefinition), `workflow_approval_chains`, `workflow_sla_policies`, tenant `workflow_calendars`). Keep all existing tables/indexes from `schema.go`.

**`migrations/automation_db/000001_init_schema`** — tables: `automations` (trigger config + enabled), `automation_rules` (priority, when, action ref), `automation_runbooks` + `automation_runbook_steps` (the step list), `automation_runs` (the FSM run; `source_event_id` UNIQUE per tenant; `replay_of` lineage), `automation_run_steps` (append-only execution log), `automation_approval_gates` + the verbatim `event_outbox` block.

Both register `CREATE DATABASE` in `deploy/docker/init-databases.sql` and the central migrator (§10).

---

## 8 · Events & outbox

- **Workflow:** `Topics.WorkflowEvents = "platform.workflow.events"` already exists. Tighten publishes to same-tx `outbox.Write` (FR-WORKFLOW-005). New types: `com.clario360.platform.workflow.definition.promoted`, `.form.validated`, `.task.escalated`.
- **Automation:** add `Topics.AutomationEvents = "platform.automation.events"` — 3 edits to `internal/events/topics.go` (struct field + literal + `AllTopics()`); default partitions/retention. Types: `com.clario360.platform.automation.{run.started,run.step.completed,run.awaiting_approval,run.completed,run.failed,rule.matched}`.
- **In-tx outbox vs direct publish:** all run/instance state changes go through `outbox.Write` in the same tx. High-volume nothing here (no telemetry stream like DR progress).
- **Bidirectional:** Automation **consumes** the bus (its triggers) and **produces** action events; Workflow **consumes** triggers and **produces** lifecycle events. BOSALAH/audit/notification consumers already subscribe to `platform.*.events`.

---

## 9 · API surface

**Workflow additions** (under existing `/api/v1/workflows`, now gated by `RequirePermission`):
| Method · Path | Permission | Purpose |
|---|---|---|
| POST /definitions/{id}/promote | workflow:admin | promote dev→staging→prod (config release) |
| GET /definitions/{key}/lineage | workflow:read | all versions+stages for a lineage |
| POST /definitions/{id}/simulate | workflow:write | side-effect-free dry-run |
| POST/GET/PUT /forms, GET /forms/{id} | workflow:write/read | form definitions |

**Automation** (`/api/v1/automation`, Auth+Tenant+RBAC):
| Method · Path | Permission | Purpose |
|---|---|---|
| POST/GET/PUT/DELETE /automations | automation:write/read | CRUD automations + triggers + rules |
| POST /automations/{id}/invoke | automation:write | manual trigger |
| POST /webhooks/{token} | (token) | inbound webhook trigger (no JWT; token-auth) |
| GET /runs, GET /runs/{id} | automation:read | run history + execution log |
| POST /runs/{id}/approve, /reject | automation:approve | approval gate decision |
| POST /runs/{id}/replay | automation:write | replay from recorded inputs |
| POST /runbooks, GET /runbooks/{id} | automation:write/read | runbook definitions |

Entitlement: both are platform/core capabilities — recommended key **`suite.platform`** (or ungated-core, matching the existing workflow route). If gated, seed in `license_db/000002_seed_plans` for both seeded plans.

---

## 10 · Platform integration checklist (clone the license-service rollout)
1. Register `workflow_db` (already exists logically — formalize) and `automation_db` in `cmd/migrator/main.go` (`allDatabases` + `--workflow-db-url`/`--automation-db-url` flags); add `CREATE DATABASE` to `deploy/docker/init-databases.sql`; Helm `WORKFLOW_DB_URL`/`AUTOMATION_DB_URL` secrets.
2. Gateway: routes `/api/v1/workflows` (exists) + `/api/v1/automation` in `internal/gateway/config/routes.go` `DefaultRoutes`; backends in `DefaultServices` (`GW_SVC_URL_WORKFLOW`/`GW_SVC_URL_AUTOMATION`).
3. (Optional) entitlement seed `suite.platform` in `license_db/000002`.
4. pm2 `ecosystem.local.js` entries; Helm chart clone for `automation-service` (workflow-engine chart exists).
5. Prometheus scrape configs; Vault policy if secrets used.

---

## 11 · Observability — the SLO board is real
Per-instance Prometheus registry (`svc.Metrics.Registry()`):
- Workflow: `workflow_instances_active`, `workflow_step_duration_seconds`, `workflow_task_sla_breaches_total`, `workflow_definition_promotions_total`.
- Automation: `automation_runs_total{status}`, `automation_run_duration_seconds`, `automation_trigger_total{type}`, `automation_approval_wait_seconds`, `automation_action_total{action,result}`, `automation_replay_total`.
Recording/alert rules in `deploy/monitoring`; Grafana board; events → BOSALAH exec dashboards.

---

## 12 · Agent work-packages (build in order)

| WP | Title | Depends | Deliverables | Acceptance |
|---|---|---|---|---|
| WP-0 | Shared `internal/cron` | — | extract `drillsched/cron.go` → `internal/cron`; repoint drillsched | build+tests; drillsched tests still green |
| WP-1 | Workflow D-9 seam + parallel_gateway + RBAC | — | `engine.Orchestrator` extracted; register parallel_gateway; `RequirePermission` on routes | unit: orchestrator drives existing flows identically; parallel_gateway runs; 403 without perm |
| WP-2 | Workflow → real migrations | — | `migrations/workflow_db/000001` (from `schema.go`) + migrator/init-db registration + apply-from-scratch idempotency test | `TestWorkflowMigrationsApplyCleanly` passes |
| WP-3 | Forms engine `internal/forms` | WP-2 | bilingual FormField model + validation + conditional visibility + backend re-validation bound to `expression.Evaluator`; human_task loads form-by-ref | unit: validation pass/fail, conditional hide excludes from validation, AR-missing fails; integration: form round-trip |
| WP-4 | Versioning + promotion | WP-2 | lineage/stage/immutable columns + promote FSM + lineage API | integration: immutable-on-promote (409), dev→staging→prod, config-release-no-redeploy timed demo |
| WP-5 | Approval chains + tiered SLA/escalation + calendar | WP-1 | `approval_chain` executor (parking, quorum) + definition SLA policy + working-hours | unit: quorum all/any/n_of_m, tiered escalation fires, business-hours math |
| WP-6 | Sandbox simulation | WP-1 | dry-run orchestrator + mock executors + `/simulate` | integration: simulate fires ZERO side effects (assert no HTTP/event/task/timer), returns path+gates |
| WP-7 | Workflow loop leader-election + cron-trigger runtime + same-tx outbox | WP-0,WP-1 | election on scheduler/SLA/recovery; cron schedule trigger fires; publishes via same-tx `outbox.Write` | integration: only leader runs loops; scheduled def fires; event survives broker-down |
| WP-8 | Automation data model + repo | WP-2 | `migrations/automation_db/000001` (+RLS+outbox) + DBTX repos (pgxmock) | migration idempotency test; repo unit tests; RLS isolation integration test |
| WP-9 | Automation triggers (5 types) + idempotency | WP-0,WP-8 | event/schedule/threshold/manual/webhook sources; `IdempotencyGuard` + unique backstop | integration: each trigger fires exactly once; dup suppressed |
| WP-10 | Automation rule engine | WP-8 | priority-ordered eval reusing `expression.Evaluator`; conflict-resolution+log | unit: priority order, dedupe, higher-priority-wins |
| WP-11 | Runbook orchestrator (gated FSM) + approval gates | WP-8 | leader-singleton driver (claim/advance separate tx, idempotent steps, gate never auto-advances) | integration: gate pauses until approve; timeout escalates/aborts; restart resumes |
| WP-12 | Action surface (5 targets) | WP-9,WP-11 | start_workflow/integration/notification/dr_runbook/http_call executors via API/event | integration: each action invokes its target + audited (testcontainers + httptest) |
| WP-13 | Execution log + replay; platform rollout; SLO board | WP-11,WP-12 | append-only log; `/replay`; gateway+migrator+pm2+Helm+Prometheus; metrics | integration: replay from recorded inputs; gap→non-replayable; service boots behind gateway |

**Parallelism:** `{WP-0}` and `{WP-1→WP-2}` start immediately; forms `{WP-3}` and versioning `{WP-4}` parallel after WP-2; automation `{WP-8→WP-9/WP-10→WP-11→WP-12→WP-13}` runs as its own track after WP-0/WP-2. "Done" per WP = `GOWORK=off go build ./...` + `go vet` + gofmt-clean + the listed tests pass under `-race` (and `-tags=integration` where noted).

---

## 13 · Forward seams (do not build now)
- **Admin-Studio frontend completion:** extend `task-form-renderer.tsx` + `buildDynamicZodSchema` to the new field types/validation/conditional/bilingual; add the designer editors. (Backend contract is this doc.)
- **Business+ consumers:** Watheeq/EHKAM/MahamaTech author forms/processes and automation rules against these engines — the "config not code" payoff.
- **Marketplace (D-8):** automation runbooks + workflow templates as distributable, signed artifacts.
- **BPMN (D-9):** a second `Orchestrator` impl + BPMN compiler behind the frozen seam, if the spike chooses it.

---

## 14 · Risks & open decisions
1. **D-7 — RESOLVED → Go** (this doc). No longer blocking.
2. **D-9 — workflow foundation (build-own FSM vs BPMN core)** still open (Sprint-2 spike). Mitigated by the frozen `Orchestrator`/`StepExecutor` seam (§3.1) — the spike can't force a rewrite.
3. **Forms FRs underspecified** — the SRS has no `FR-FORM-*` (no field-type/validation/conditional catalog). This doc *defines* them (§3.2), grounded in what the FE already renders; treat as our spec, get PM sign-off on the field-type/validation set.
4. **Workflow schema migration** — moving from self-managed `schema.go` to `migrations/workflow_db` must preserve every existing table/index byte-for-byte (WP-2) so running tenants are unaffected; verify with a schema-diff before/after.
5. **Action coupling** — Automation reaching other engines by event (integration/notification) vs HTTP (workflow/DR) is deliberate (FR-XC-004); a future in-process embed is possible only for same-process composition, never a cross-service DB read.

---

## 15 · Design-review resolutions (self-review, 13 Jun 2026)
Three lenses — reuse-correctness, spec-completeness, architecture-soundness:
1. **Reuse-correctness:** confirmed every action target is reached via the documented API/event entry point (not a DB read) — integration/notification via event fan-out (their consumers own config), workflow/DR via HTTP. The cron parser is extracted to `internal/cron` (WP-0) rather than duplicated, fixing the package-private limitation. The expression DSL is reused verbatim for both workflow conditions and automation rules — one grammar.
2. **Spec-completeness:** all six workflow FRs and all five automation FRs have a WP + a measurable acceptance test (§1.3, §12). The two `SHOULD` automation FRs (rules, full action surface) are still fully built. The forms gap (no `FR-FORM-*`) is closed by an explicit, FE-grounded schema (§3.2) flagged for sign-off (§14.3).
3. **Architecture-soundness:** both engines use the proven durable/leader-singleton/idempotent FSM pattern from DR failover (§6) rather than the seed's no-leader loops (a real production gap we close in WP-7). The D-9 seam is named and frozen so the BPMN spike is non-destructive. Schema moves into the central migrator + apply-from-scratch test, closing the same bug class we just fixed in cyber_db.
4. **Confirmed sound (not changed):** the seed's step+transition model, outbox-backed publishing, and park/resume executor contract are kept as-is and extended — no rewrite.

**Footer:** Cross-refs — SRS Core Engines v0.2 §4.1/§4.3; ADR-001 v0.2 Addendum A; deck S19–S21; companion `DESIGN_DataStream_DR.md` (the pattern source for the durable FSM, outbox, leader-singleton, and migration conventions).
