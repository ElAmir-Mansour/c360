-- #12 — External-hold history: a lightweight audit trail of the external-pending
-- (hold) changes recorded against legal_matters via the Case Timelines vertical.
--
-- Design choice (lightest viable): a dedicated append-only history table rather
-- than reusing the generic platform audit infra. The lex suite has no shared
-- in-DB audit table for matter timeline mutations (the timeline lives as ALTERed
-- columns on legal_matters, and the settlement audit log is settlement-scoped), so
-- a small purpose-built table keeps the read path a single tenant-scoped query and
-- avoids cross-service calls. Conventions mirror the neighbouring lex migrations:
--   * tenant_id FIRST; tenant-leading index.
--   * append-only (no soft-delete, no updated_at): a history row is immutable.
--   * gen_random_uuid(), created_by (actor), created_at.
--   * ENABLE + FORCE RLS; tenant_isolation + INSERT-only policies (immutable trail).

CREATE TABLE IF NOT EXISTS legal_case_hold_history (
    id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id  UUID        NOT NULL,
    matter_id  UUID        NOT NULL REFERENCES legal_matters(id) ON DELETE CASCADE,
    action     TEXT        NOT NULL CHECK (action IN ('set', 'cleared')),
    category   TEXT        CHECK (category IS NULL OR category IN ('court', 'government', 'department', 'expert')),
    reason     TEXT,
    created_by UUID        NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_legal_case_hold_history_matter
    ON legal_case_hold_history (tenant_id, matter_id, created_at DESC);

ALTER TABLE legal_case_hold_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_case_hold_history FORCE ROW LEVEL SECURITY;

-- Append-only: tenant isolation + INSERT only. No UPDATE/DELETE policy so the
-- hold-change history is immutable.
CREATE POLICY tenant_isolation ON legal_case_hold_history
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON legal_case_hold_history
    FOR INSERT
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
