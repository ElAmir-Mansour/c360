-- =============================================================================
-- Clario Recover — APPEND-ONLY AUDIT TRAIL & regulatory evidence (Prompt 10,
-- Wave 3, the "Prove" surface).
--
-- Every recovery/rehearsal action across all three sub-solutions (IT DR, Cloud
-- DR, Cyber Recovery) writes ONE immutable row here: who (actor), what (action),
-- when (occurred_at), and which application / runbook / event it acted on. The
-- evidence export (GET /api/recover/evidence/:eventId + CSV/PDF) reads this log
-- as the full timeline, joined with the RTO target (Application Metastore seam)
-- and the captured RTA / approvals / integrity-check results (the EXISTING dr/*
-- + cyber-recovery records) to produce a regulator-ready report.
--
-- APPEND-ONLY by construction. Like recover_readiness_snapshot (000039) this
-- table grants a FOR SELECT read policy and a FOR INSERT write policy and NO
-- UPDATE or DELETE policy, so under FORCE ROW LEVEL SECURITY every session
-- (owner included) is denied UPDATE and DELETE at the DATABASE layer. The
-- service layer (audit_store.go) exposes no update/delete code path either, so
-- immutability holds at both layers and is proven by test.
--
-- This table carries the dr_db RLS clone (see 000036_recover_activation): every
-- request-path query filters by tenant AND runs under SET LOCAL
-- app.current_tenant_id, with RLS as the backstop; app.bypass_rls is reserved
-- for any cross-tenant system path, exactly as elsewhere in dr_db.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- One immutable row per audited recovery/rehearsal action. event_id is the
-- recovery EVENT the action belongs to (a runbookstudio run id, a cyber-recovery
-- flow id, a drill id, …) so the evidence export can reconstruct one event's full
-- timeline; it is the correlation key the API path (:eventId) resolves against.
CREATE TABLE IF NOT EXISTS recover_audit_event (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    -- the recovery event this action belongs to (correlation key for evidence).
    event_id UUID NOT NULL,
    -- the sub-solution the action originated in: it_dr | cloud_dr | cyber_recovery.
    sub_solution TEXT NOT NULL
        CHECK (sub_solution IN ('it_dr', 'cloud_dr', 'cyber_recovery')),
    -- a stable, machine-readable action verb (e.g. runbook.run.started,
    -- cyber.integrity.evaluated, cyber.return_to_production). Free-form within a
    -- bounded length so new actions never need a migration; the producers use a
    -- documented vocabulary (audit.go Action* constants).
    action TEXT NOT NULL
        CHECK (char_length(action) BETWEEN 1 AND 120),
    -- WHO: the authenticated actor. actor_id may be NULL for a system-driven
    -- action (e.g. a background timeout transition), in which case actor_email
    -- carries a system label; a human action carries both.
    actor_id UUID,
    actor_email TEXT NOT NULL DEFAULT '',
    -- WHICH application / runbook the action acted on (soft references — no
    -- cross-table FK, preserving the disjoint ownership of the dr/* + metastore
    -- tables). Either may be NULL when not applicable to the action.
    application_id UUID,
    runbook_id UUID,
    -- a short human-readable summary of the action for the timeline, plus the
    -- structured detail (verdict, rta, approver, …) the export renders verbatim.
    summary TEXT NOT NULL DEFAULT ''
        CHECK (char_length(summary) <= 1000),
    detail JSONB NOT NULL DEFAULT '{}'::jsonb,
    -- WHEN: the logical instant the action occurred (the producer's clock),
    -- distinct from the physical recorded_at insert time.
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The evidence read selects one event's rows oldest-first (the timeline); the
-- list read selects a tenant's distinct events newest-first. These two composite
-- indexes keep both single-tenant ranged scans (no N+1, no full-table sort).
CREATE INDEX IF NOT EXISTS idx_recover_audit_event_event
    ON recover_audit_event (tenant_id, event_id, occurred_at ASC, id ASC);
CREATE INDEX IF NOT EXISTS idx_recover_audit_event_recent
    ON recover_audit_event (tenant_id, occurred_at DESC);

-- --- Row level security (clone of the dr_db RLS convention) -----------------

ALTER TABLE recover_audit_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE recover_audit_event FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_select ON recover_audit_event;
DROP POLICY IF EXISTS tenant_insert ON recover_audit_event;
-- FOR SELECT (read) + FOR INSERT (append) policies ONLY. There is deliberately
-- no FOR UPDATE / FOR DELETE / FOR ALL policy: under FORCE RLS, an action with no
-- permitting policy is denied for every session (the table owner included), so
-- the audit log is append-only at the DATABASE layer — a recorded action can
-- never be altered or erased.
CREATE POLICY tenant_select ON recover_audit_event
    FOR SELECT
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_insert ON recover_audit_event
    FOR INSERT
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
