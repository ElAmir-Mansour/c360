# ClarioWatheeq Onboarding + License Race — Definitive Fix Design (PROPOSED / GENERIC)

> **Provenance:** Pasted by the product owner on 2026-06-30 as the target end-state for a full SaaS onboarding/licensing re-architecture. Per its own source note it was generated WITHOUT access to the Clario360 codebase — it is a generic, idealized SaaS reference architecture inferred from the filename/context, **not** grounded in the real schema or services.
>
> **Status:** This is the PROPOSED end-state. It MUST be reconciled against the actual stack before implementation. The grounded, Clario360-accurate plan lives in `Onboarding_License_SaaS_Rearchitecture_PLAN.md`. Known mismatches to resolve during grounding: (1) there is no payment/checkout/webhook flow today (self-serve provisions a trial); (2) licensing lives in the license-service / `license_db` (`tenant_licenses` + `plan_entitlements` + `entitlement_overrides`), not `platform_core.licenses`; (3) the single-writer race fix + gateway entitlement cache-bust were already shipped (see `Onboarding_License_Race_Definitive_Fix_Design.md`).

---

## 1. Executive Decision

ClarioWatheeq should move to an **idempotent onboarding-intent model** with a strict license activation state machine, database-backed concurrency controls, and versioned entitlement snapshots.

The target design is:

1. **One onboarding intent per unique tenant/product/owner/license request.** Duplicate submissions must resume the same intent, not create a second tenant, subscription, license, owner, or seat.
2. **License activation is transactional and resumable.** A crash after tenant creation must not restart onboarding from scratch.
3. **Seat assignment is protected by row-level locking and unique active-seat indexes.** The database, not the UI, must prevent over-assignment.
4. **Entitlements are produced as versioned snapshots after license activation.** Session hydration must read a stable entitlement view, not a partially provisioned license row.
5. **External side effects use an outbox.** Welcome emails, CRM sync, webhooks, analytics, and notifications must fire only after the authoritative transaction commits.
6. **The frontend must treat `PROVISIONING`, `PENDING_PAYMENT`, and `FAILED_RETRYABLE` as first-class states.** Users should see a resumable setup screen, not a broken dashboard or misleading 403.
7. **Payment/webhook ordering must not matter.** Webhooks can arrive before, during, or after browser onboarding and still converge to the same active license.
8. **Every transition must be auditable.** License changes are commercial/security events and must be traceable.

The core product invariant is simple:

> A user may enter a licensed suite only when the tenant has an active license for that suite, the user has an active seat or included access grant, and the session has hydrated an active entitlement snapshot.

---

## 2. Problem Definition

The license race exists when onboarding and licensing are not treated as one deterministic workflow. Common triggers include:

| Race source | Typical symptom | Required fix |
|---|---|---|
| User double-clicks submit or refreshes checkout callback | Duplicate onboarding rows, duplicate tenants, duplicate welcome emails | Idempotency key + onboarding-intent fingerprint |
| Multiple tabs complete onboarding | Same owner gets multiple memberships or seats | Unique membership/seat indexes + resume existing intent |
| Payment webhook arrives before tenant creation finishes | Paid subscription exists but no tenant/license binding | Pending payment-event inbox bound to onboarding intent |
| Tenant is created, then license activation fails | User logs in but has no usable entitlement | Resumable state machine and status screen |
| First login happens before entitlements are built | Dashboard loads with missing modules or incorrect 403 | Session must expose onboarding/license state |
| Background worker retries after partial success | Duplicate side effects or plan transitions | Outbox idempotency + transition guards |
| Two users/admins assign the last available seat | Seat count exceeds limit | `SELECT ... FOR UPDATE` on license row + active-seat unique index |
| Plan upgrade/downgrade races with onboarding | Wrong entitlement set becomes active | Subscription transition versioning |
| Cache remains stale after activation | User remains blocked after license is active | Versioned entitlement snapshots + cache invalidation event |

The current class of issue should not be solved by adding sleeps, optimistic UI delays, or frontend-only guards. The fix belongs at the workflow, database, idempotency, and entitlement-resolution layers.

---

## 3. Non-Negotiable Invariants

### 3.1 Tenant and onboarding invariants

1. A normalized tenant slug can map to only one active tenant.
2. A normalized owner email can have only one active owner membership per tenant.
3. An onboarding intent must be resumable from its last durable state.
4. Retrying the same onboarding request must return the same intent and current status.
5. A failed retryable intent must never require manual database cleanup for ordinary transient errors.

### 3.2 License invariants

1. A tenant can have only one active or provisioning license per product code unless the product explicitly supports parallel licenses.
2. A license cannot become `ACTIVE` until its tenant exists.
3. A user cannot consume a seat unless the license is active or in an explicitly allowed provisioning grace state.
4. Active seat assignments cannot exceed `seat_limit`.
5. License status changes must be monotonic unless performed through an explicit transition, such as upgrade, downgrade, cancellation, or reactivation.

### 3.3 Entitlement invariants

1. Entitlements are derived from license state, plan configuration, feature flags, and tenant overrides.
2. The frontend should receive a resolved entitlement snapshot, not recompute licensing rules itself.
3. RBAC permissions do not create product entitlement. A user with `lex:*` must still be blocked if the tenant has no active Watheeq/Lex license.
4. Entitlement snapshots are immutable once activated. A new license/plan change creates a new snapshot version.
5. Session hydration must include both license state and authorization state.

### 3.4 Side-effect invariants

1. Emails, analytics, notifications, CRM sync, and third-party webhooks are emitted from an outbox after commit.
2. Every outbox event has a stable idempotency key.
3. A retry can resend a side effect only if the downstream idempotency key is the same.

---

## 4. Target Data Model

### 4.1 `onboarding_intents`

Authoritative record for a signup/setup attempt.

```sql
CREATE TYPE onboarding_status AS ENUM (
  'DRAFT', 'INTENT_RESERVED', 'PENDING_PAYMENT', 'PAYMENT_CONFIRMED',
  'TENANT_PROVISIONING', 'TENANT_CREATED', 'OWNER_PROVISIONING', 'OWNER_CREATED',
  'LICENSE_PROVISIONING', 'LICENSE_RESERVED', 'SEAT_ASSIGNED', 'ENTITLEMENTS_READY',
  'ACTIVE', 'FAILED_RETRYABLE', 'FAILED_FINAL', 'CANCELED'
);

CREATE TABLE platform_core.onboarding_intents (
  id UUID PRIMARY KEY,
  intent_key TEXT NOT NULL,
  idempotency_key_hash TEXT NOT NULL,
  product_code TEXT NOT NULL,
  requested_plan_code TEXT NOT NULL,
  normalized_tenant_slug TEXT NOT NULL,
  normalized_owner_email TEXT NOT NULL,
  tenant_id UUID NULL,
  owner_user_id UUID NULL,
  license_id UUID NULL,
  active_entitlement_snapshot_id UUID NULL,
  status onboarding_status NOT NULL DEFAULT 'DRAFT',
  status_reason TEXT NULL,
  retry_after TIMESTAMPTZ NULL,
  request_fingerprint JSONB NOT NULL,
  source_channel TEXT NOT NULL DEFAULT 'web_signup',
  payment_provider TEXT NULL,
  payment_customer_id TEXT NULL,
  payment_subscription_id TEXT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  locked_by TEXT NULL,
  locked_until TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  activated_at TIMESTAMPTZ NULL,
  canceled_at TIMESTAMPTZ NULL
);

CREATE UNIQUE INDEX uq_onboarding_intent_key ON platform_core.onboarding_intents(intent_key);
CREATE UNIQUE INDEX uq_onboarding_idempotency_key ON platform_core.onboarding_intents(idempotency_key_hash);
CREATE INDEX ix_onboarding_status_retry ON platform_core.onboarding_intents(status, retry_after)
  WHERE status IN ('FAILED_RETRYABLE', 'PENDING_PAYMENT', 'PAYMENT_CONFIRMED');
```

Recommended `intent_key`: `sha256(product_code|normalized_tenant_slug|normalized_owner_email|requested_plan_code|source_channel)`.

### 4.2 `licenses`, 4.3 `license_seat_assignments`, 4.4 `entitlement_snapshots`, 4.5 `payment_event_inbox`, 4.6 `outbox_events`

(See the original proposal for full DDL. Key shapes: `licenses` is the commercial container with `status` ENUM PROVISIONING/ACTIVE/SUSPENDED/EXPIRED/CANCELED/FAILED, `seat_limit/seats_reserved/seats_assigned`, `version`, a unique partial index `(tenant_id, product_code) WHERE status IN (PROVISIONING,ACTIVE,SUSPENDED)`, and check constraints keeping `seats_reserved+seats_assigned <= seat_limit`. `license_seat_assignments` has a unique active-seat index `(license_id, user_id) WHERE status IN (RESERVED,ACTIVE)`. `entitlement_snapshots` is immutable per version with a unique `(tenant_id, product_code) WHERE status='ACTIVE'`. `payment_event_inbox` dedupes on `(provider, provider_event_id)`. `outbox_events` dedupes on `idempotency_key`.)

---

## 5. State Machine

`DRAFT → INTENT_RESERVED → [PENDING_PAYMENT → PAYMENT_CONFIRMED →] TENANT_PROVISIONING → TENANT_CREATED → OWNER_PROVISIONING → OWNER_CREATED → LICENSE_PROVISIONING → LICENSE_RESERVED → SEAT_ASSIGNED → ENTITLEMENTS_READY → ACTIVE`, with `FAILED_RETRYABLE` (resumes from last durable state), `FAILED_FINAL`, and `CANCELED` terminals.

**Transition rule:** `load intent FOR UPDATE → validate current state → perform one durable step idempotently → write next state → write audit event → commit → publish only through outbox`. No transition may require the previous HTTP request to still be alive.

---

## 6–9. Backend Workflow, Activation, Seat Assignment, Payment/Webhook Ordering

- **Start onboarding:** `POST /api/v1/onboarding/intents` with `Idempotency-Key`; returns `{intent_id, status, next_action, status_url, resume_url}`. Creation resolves by idempotency key, then by intent fingerprint, else inserts.
- **Activation** is one logical resumable flow (split into short idempotent per-state transactions in production; external calls never inside the DB tx): upsert tenant → upsert owner + membership → create/reuse provisioning license → lock license `FOR UPDATE` → assign owner seat → build entitlement snapshot → activate license + snapshot → mark ACTIVE → enqueue outbox + audit.
- **Seat assignment:** `FOR UPDATE` on the license row, return existing active assignment if present, reject when `seats_reserved+seats_assigned >= seat_limit`, insert assignment, bump `seats_reserved` + `version`. Backstops: unique active-seat index, check constraint, serialization-failure retry.
- **Payment/webhook ordering:** verify signature → insert into `payment_event_inbox` (unique on provider+event id) → resolve intent (by checkout metadata / subscription / customer+email) → if no intent yet, hold `PENDING_BIND`; a reconciliation worker binds later. Webhooks never create tenant/license directly; activation resumes from intent state.

---

## 10. Entitlement Resolution

Session hydration returns a `SessionLicenseContext`: `{tenant_id, user_id, product_code, onboarding:{intent_id,status,resume_url}, license:{id,status,plan_code,period_end,seat_limit,seats_assigned}, entitlement_snapshot:{id,version,status,entitlements[],feature_limits}, access:{can_enter_product, denial_code, denial_message}}`.

Product gate: `license.status==ACTIVE && entitlement_snapshot.status==ACTIVE && entitlements.includes(product) && access.can_enter_product`. RBAC composes ON TOP — license grants product availability; role grants authority within the product. They stay separate concepts.

---

## 11. Frontend UX

- `/onboarding/status/:intentId` showing each backend state with the right CTA (Preparing / Awaiting payment / Creating workspace / Activating license / Assigning access / Workspace ready / Retry / Contact support / Start again).
- No broken dashboard: when session detects `LICENSE_PROVISIONING`/`ENTITLEMENT_PENDING`, redirect to the status page, not `/dashboard` or a 403.
- Duplicate submission: "Your workspace setup is already in progress. We resumed the existing setup instead of creating a duplicate."
- `/settings/billing/license` admin screen: plan/product, status/renewal, seats (limit/assigned/reserved/available), active snapshot version, provisioning timeline, last payment event, retry/reconcile action, audit link.

---

## 12. API Surface

Onboarding: `POST/GET /onboarding/intents[/{id}]`, `POST /{id}/resume`, `POST /{id}/cancel`. Licensing: `GET /tenants/{id}/license-context`, `GET /licenses[/{id}]`, `POST /licenses/{id}/seats/{assign,revoke}`, `POST /licenses/{id}/reconcile`. Entitlements: `GET /entitlements/me`, `GET /tenants/{id}/entitlements/active`, `POST /tenants/{id}/entitlements/rebuild`. Webhooks: `POST /billing/webhooks/{provider}` (idempotent, never creates duplicate onboarding objects).

---

## 13. Error Codes

`ONBOARDING_INTENT_NOT_FOUND`, `ONBOARDING_INTENT_ALREADY_ACTIVE`, `ONBOARDING_INTENT_CONFLICT`, `TENANT_SLUG_TAKEN`, `PAYMENT_PENDING`, `PAYMENT_EVENT_PENDING_BIND`, `LICENSE_PROVISIONING`, `NO_ACTIVE_LICENSE`, `LICENSE_SUSPENDED`, `SEAT_LIMIT_REACHED`, `ENTITLEMENT_PENDING`, `ENTITLEMENT_VERSION_STALE`.

---

## 14. Race/Fix Matrix

Parallel intent starts → one intent (fingerprint + unique idx). Webhook before intent → PENDING_BIND. Refresh during provisioning → status state in session. Worker crash → resume from last state. Two workers activate → intent `FOR UPDATE` + unique idx. Two admins last seat → license lock + check constraint. Plan upgrade race → license version + transition guard. Stale cache → snapshot version cache key. Email retry → outbox idempotency. Existing user invited → normalized email + membership upsert.

---

## 15–17. Observability, Audit, Security

- **Metrics:** intent started/reused/activated/failed, duration, activation/seat conflicts, seat-limit-reached, snapshot built/failed, payment pending-bind, outbox retry.
- **Logs** carry correlation id, intent id, tenant/owner/license ids, product/plan, provider event id.
- **Alerts:** stuck onboarding (>10m, not pending payment), failed-final spike, pending-bind spike, snapshot failure, seat conflict spike, outbox backlog.
- **Audit events:** intent created/reused, status changed, tenant/owner created, payment received/bound, license created/activated/suspended/canceled, seat assigned/revoked, snapshot created/activated, onboarding activated/failed.
- **Security:** don't trust client tenant_id; normalize+verify owner email; signed short-lived onboarding tokens; verify webhook signatures; process each provider event once; rate-limit by IP/email/domain/slug; bot protection; don't log secrets/PII; admin perms for reconcile; tenant isolation on every read.

---

## 18–24. Implementation Checklist, Tests, Migration, Flags, Runbook, Acceptance, Immediate Patch List

- **Phases:** DB foundation → services (`OnboardingIntentService`, `OnboardingActivationService`, `LicenseService` w/ row locking, `LicenseSeatService`, `EntitlementSnapshotService`, `PaymentEventInboxService`, `OutboxDispatcher`, audit writer) → APIs → session integration (license context + product-entry gate before RBAC) → frontend → ops.
- **Tests:** unit (intent key stability, idempotency, transition guards, seat capacity, snapshot builder), integration (100 parallel starts → 1 intent; 100 parallel activations → 1 of everything; webhook-before/after; crash/resume; outbox no-dup; cache invalidation; concurrent seats), E2E (trial/paid/refresh/duplicate-tab/existing-user/suspended/seat-limit/reconcile), property tests over random op sequences asserting the invariants.
- **Migration:** shadow mode (new tables + backfill + compare resolvers) → dual-read (prefer legacy, log mismatches) → cutover (snapshot resolver source of truth, enable product gate, intent v2) → cleanup (remove legacy paths/workarounds).
- **Feature flags:** `onboarding.intent_v2`, `onboarding.activation_worker_v2`, `license.row_locking_v2`, `license.entitlement_snapshot_v2`, `session.license_context_v2`, `frontend.onboarding_status_v2`, `frontend.license_gate_v2`, `billing.webhook_inbox_v2`, `outbox.onboarding_side_effects_v2`.
- **Runbook (stuck onboarding):** detect (not terminal, >10m, not pending payment), triage query, recovery (check payment/tenant/owner/license/snapshot, `POST /resume`, else `FAILED_FINAL`; never create a duplicate for the same intent key).
- **Acceptance:** duplicate onboarding/licenses impossible; seat over-assignment impossible; webhook ordering safe; partial failure recoverable; no broken first-login; entitlements stable+versioned; licensing+RBAC composed; outbox idempotent; audit complete; dashboards exist; migration reversible until cutover.
- **Immediate patch list (tactical, in order):** idempotency key + fingerprint → unique active license per tenant/product → `FOR UPDATE` seat assignment → active-seat unique index → onboarding status endpoint + page → payment webhook inbox → entitlement snapshot table + session exposure → outbox side effects → stuck-intent retry worker → concurrency tests.
