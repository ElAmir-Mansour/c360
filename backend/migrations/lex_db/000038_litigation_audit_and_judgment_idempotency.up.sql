-- Round 2 — Litigation depth: append-only audit trail + judgment study
-- idempotency/concurrency-safety + C-2 duration facts (WS2/WS3/WS4, C-2).
--
-- Promoted from _staging/ as 000038 (000037_case_hold_history was the prior
-- highest committed lex_db migration). Sorts after the Phase-3 litigation schema
-- (000027) and the reporting fact store (000034). First of the Round-2 batch
-- (000038 litigation, 000039 spine SLA audit, 000040 case depth, 000041
-- consultation SLA, 000042 investigation SLA/facts, 000043 calendar/catalog
-- audit+lock_version, 000044 settlements depth).
--
-- Conventions mirror 000027 / 000028 (legal_investigation_audit_log):
--   * tenant_id FIRST; ENABLE + FORCE RLS with tenant_isolation + tenant_insert
--     policies ONLY (no UPDATE/DELETE policy) => append-only / immutable trail.
--   * gen_random_uuid(), actor_user_id, before/after JSONB, created_at.
--   * everything IF NOT EXISTS / idempotent so re-runs are safe.

-- =============================================================================
-- legal_litigation_audit_log — append-only governance audit trail for the
-- pleading / judgment / defendant litigation transitions (WS2/WS3/WS4).
--
-- One table covers all three sub-domains keyed by (subject_type, subject_id):
--   subject_type IN ('legal_pleading','legal_judgment','legal_defendant_case').
-- before/after capture the mutated state; reason carries the actor-supplied
-- justification (objection reason, rejection note, ...). Immutable: no
-- UPDATE/DELETE policy, so the trail is tamper-evident at the DB layer.
-- =============================================================================
CREATE TABLE IF NOT EXISTS legal_litigation_audit_log (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID        NOT NULL,
    subject_type  TEXT        NOT NULL CHECK (subject_type IN (
        'legal_pleading', 'legal_judgment', 'legal_defendant_case'
    )),
    subject_id    UUID        NOT NULL,
    case_id       UUID,
    action        TEXT        NOT NULL,
    from_status   TEXT,
    to_status     TEXT,
    reason        TEXT,
    before        JSONB       NOT NULL DEFAULT '{}'::jsonb,
    after         JSONB       NOT NULL DEFAULT '{}'::jsonb,
    detail        JSONB       NOT NULL DEFAULT '{}'::jsonb,
    actor_user_id UUID        NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_legal_litigation_audit_log_subject
    ON legal_litigation_audit_log (tenant_id, subject_type, subject_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_legal_litigation_audit_log_case
    ON legal_litigation_audit_log (tenant_id, case_id, created_at ASC)
    WHERE case_id IS NOT NULL;

ALTER TABLE legal_litigation_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_litigation_audit_log FORCE ROW LEVEL SECURITY;

-- Append-only: tenant isolation for reads + insert-only writes. No UPDATE/DELETE
-- policies so the litigation governance trail is immutable.
CREATE POLICY tenant_isolation ON legal_litigation_audit_log
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON legal_litigation_audit_log
    FOR INSERT
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- =============================================================================
-- legal_judgments.studied_at concurrency guard + objection-obligation
-- exactly-once index (WS2/WS3/WS4 StudyJudgment idempotency).
--
-- A real judgment_id link column on legal_obligations replaces the previous
-- JSONB-only (metadata->>'judgment_id') association so a PARTIAL-UNIQUE index can
-- guarantee at most ONE live objection-deadline obligation per judgment. Combined
-- with the service-side `FOR UPDATE` + `studied_at IS NOT NULL` reject, this makes
-- StudyJudgment idempotent and removes the duplicate-reminder-storm risk.
-- =============================================================================
ALTER TABLE legal_obligations
    ADD COLUMN IF NOT EXISTS judgment_id UUID REFERENCES legal_judgments(id) ON DELETE CASCADE;

-- Backfill the link column from the legacy metadata->>'judgment_id' association so
-- existing objection obligations participate in the uniqueness guarantee.
UPDATE legal_obligations o
SET judgment_id = (o.metadata->>'judgment_id')::uuid
WHERE o.judgment_id IS NULL
  AND o.metadata ? 'judgment_id'
  AND (o.metadata->>'judgment_id') ~ '^[0-9a-fA-F-]{36}$'
  AND EXISTS (SELECT 1 FROM legal_judgments j WHERE j.id = (o.metadata->>'judgment_id')::uuid);

-- At most one LIVE objection obligation per judgment. Partial on (judgment_id) so
-- only objection obligations (which carry the link) are constrained, and only
-- while not soft-deleted. A second StudyJudgment that races past the row lock
-- still cannot create a duplicate — the insert hits this index and 23505s, which
-- the service maps to the idempotent already-studied conflict.
CREATE UNIQUE INDEX IF NOT EXISTS uq_legal_obligations_judgment_live
    ON legal_obligations (judgment_id)
    WHERE judgment_id IS NOT NULL AND deleted_at IS NULL;

-- =============================================================================
-- lex_duration_facts kind CHECK widening (C-2): admit the three new litigation
-- duration-fact kinds emitted by this unit. The fact store is keyed by
-- (tenant_id, kind, subject_id) so each remains idempotent.
--   * pleading_filing          — pleading.created -> pleading.filed turnaround
--   * defendant_first_response — notification_date -> response approved turnaround
--   * judgment_study           — judgment.created -> judgment.studied turnaround
-- The kind column is plain TEXT today (no CHECK in 000034); this block only adds
-- a CHECK if one is present, otherwise is a harmless no-op. Idempotent.
-- =============================================================================
DO $$
DECLARE
    conname_found TEXT;
BEGIN
    SELECT conname INTO conname_found
    FROM pg_constraint
    WHERE conrelid = 'lex_duration_facts'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%kind%IN%';
    IF conname_found IS NOT NULL THEN
        EXECUTE 'ALTER TABLE lex_duration_facts DROP CONSTRAINT ' || quote_ident(conname_found);
        -- Keep the canonical 000034 constraint name so the later sibling migration
        -- (000042_investigation_sla_audit_facts) catches + supersedes this CHECK with
        -- the FULL kind union (otherwise two competing CHECKs would AND together and
        -- reject every new kind). The union here already admits the litigation kinds.
        EXECUTE $chk$
            ALTER TABLE lex_duration_facts
            ADD CONSTRAINT lex_duration_facts_kind_check
            CHECK (kind IN (
                'case_resolution', 'contract_review', 'consultation_answer',
                'request_processing', 'pleading_filing', 'defendant_first_response',
                'judgment_study'
            ))
        $chk$;
    END IF;
END $$;
