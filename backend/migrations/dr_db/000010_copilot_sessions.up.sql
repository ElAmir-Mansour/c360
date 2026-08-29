-- =============================================================================
-- ClarioDR capability #5 — AI Recovery Copilot session/message audit log
-- (DESIGN_DataStream_DR.md, copilot capability).
--
-- The copilot answers operator questions over real DR state and proposes
-- actions behind the EXISTING approval gates (it NEVER auto-approves a
-- failover). Every conversation turn — the operator's question, each tool the
-- LLM invoked over real DR state, and the assistant's grounded answer — is
-- persisted here as an immutable-by-convention audit log so an investigator can
-- later reconstruct exactly what the copilot was asked, what real data it read,
-- and what action plan it proposed.
--
-- Both tables are tenant-scoped and carry the same RLS clone as the rest of
-- dr_db (migrations/dr_db/000001_init_schema.up.sql): request-path queries
-- filter by tenant AND run under SET LOCAL app.current_tenant_id, with RLS as
-- the backstop; the app.bypass_rls escape hatch is reserved for background
-- loops (the session-pruning loop) exactly as elsewhere in dr_db.
-- =============================================================================

-- A copilot conversation: one operator, one tenant, an append-only message log.
CREATE TABLE IF NOT EXISTS dr_copilot_session (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    user_id UUID NOT NULL,                       -- operator who opened the session
    title TEXT NOT NULL DEFAULT 'DR Copilot session',
    provider TEXT NOT NULL DEFAULT '',           -- resolved LLM provider name
    model TEXT NOT NULL DEFAULT '',              -- resolved LLM model id
    message_count INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dr_copilot_session_tenant
    ON dr_copilot_session (tenant_id, updated_at DESC);

-- One turn in a copilot conversation. role: user | assistant | tool.
--   - user      rows carry the operator's verbatim question in content.
--   - assistant rows carry the grounded answer; tool_calls records, for the
--               audit trail, every tool the LLM invoked on that turn.
--   - tool      rows carry one tool's JSON result (content) so the exact real
--               DR state the answer was grounded on is preserved.
CREATE TABLE IF NOT EXISTS dr_copilot_message (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES dr_copilot_session(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL,
    seq INT NOT NULL,                            -- monotonic order within session
    role TEXT NOT NULL CHECK (role IN ('user','assistant','tool')),
    content TEXT NOT NULL DEFAULT '',
    tool_name TEXT,                              -- set on tool rows
    tool_call_id TEXT,                           -- correlates tool result <-> call
    tool_calls JSONB NOT NULL DEFAULT '[]'::jsonb, -- assistant: tools it asked for
    proposed_action JSONB,                       -- non-null when a plan was proposed
    latency_ms INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (session_id, seq)
);

CREATE INDEX IF NOT EXISTS idx_dr_copilot_message_session
    ON dr_copilot_message (session_id, seq);

CREATE INDEX IF NOT EXISTS idx_dr_copilot_message_tenant
    ON dr_copilot_message (tenant_id, created_at DESC);

-- --- Row level security (clone of dr_db RLS convention) ---------------------

ALTER TABLE dr_copilot_session ENABLE ROW LEVEL SECURITY;
ALTER TABLE dr_copilot_session FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON dr_copilot_session;
DROP POLICY IF EXISTS tenant_insert ON dr_copilot_session;
DROP POLICY IF EXISTS tenant_update ON dr_copilot_session;
DROP POLICY IF EXISTS tenant_delete ON dr_copilot_session;
CREATE POLICY tenant_isolation ON dr_copilot_session
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_insert ON dr_copilot_session
    FOR INSERT
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_update ON dr_copilot_session
    FOR UPDATE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid))
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_delete ON dr_copilot_session
    FOR DELETE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

ALTER TABLE dr_copilot_message ENABLE ROW LEVEL SECURITY;
ALTER TABLE dr_copilot_message FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON dr_copilot_message;
DROP POLICY IF EXISTS tenant_insert ON dr_copilot_message;
DROP POLICY IF EXISTS tenant_update ON dr_copilot_message;
DROP POLICY IF EXISTS tenant_delete ON dr_copilot_message;
CREATE POLICY tenant_isolation ON dr_copilot_message
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_insert ON dr_copilot_message
    FOR INSERT
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_update ON dr_copilot_message
    FOR UPDATE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid))
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_delete ON dr_copilot_message
    FOR DELETE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
