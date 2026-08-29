-- =============================================================================
-- Watheeq (Lex) legal AI assistant — session + transcript audit log.
--
-- Backs the Legal Director dashboard's "My AI Agent" panel (LEX-LD-GAP-DESIGN
-- §G4) and mirrors the ClarioDR copilot's audit model: every turn a user takes
-- with the assistant is persisted — the question, one row per grounding-tool
-- invocation (which real legal data was read), and the grounded answer.
--
-- Scoping is (tenant_id, user_id), NOT tenant alone: an assistant transcript is
-- private working material, so a legal director never sees a colleague's
-- session even inside their own tenant. RLS enforces the tenant boundary at the
-- database; the user boundary is an explicit predicate on every read (RLS
-- cannot see the caller's user id, only app.current_tenant_id).
--
-- The whole surface is feature-flagged off by default (LEX_AI_ENABLED), so
-- these tables sit empty until product enables the assistant for a deployment.
-- =============================================================================

CREATE TABLE IF NOT EXISTS lex_ai_sessions (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID        NOT NULL,
    user_id       UUID        NOT NULL,
    title         TEXT        NOT NULL DEFAULT '' CHECK (length(title) <= 200),
    -- provider/model record WHICH model answered, so a transcript stays
    -- interpretable after the deployment's model pin moves on.
    provider      TEXT        NOT NULL DEFAULT '' CHECK (length(provider) <= 64),
    model         TEXT        NOT NULL DEFAULT '' CHECK (length(model) <= 128),
    message_count INTEGER     NOT NULL DEFAULT 0 CHECK (message_count >= 0),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Primary read path: one user's recent conversations, newest first (the chat
-- rail of the AI agent panel).
CREATE INDEX IF NOT EXISTS idx_lex_ai_sessions_tenant_user
    ON lex_ai_sessions (tenant_id, user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS lex_ai_messages (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id   UUID        NOT NULL REFERENCES lex_ai_sessions(id) ON DELETE CASCADE,
    tenant_id    UUID        NOT NULL,
    -- Denormalised from the session so a message row is self-scoping: the RLS
    -- policy and the per-user predicate both apply without a join.
    user_id      UUID        NOT NULL,
    seq          INTEGER     NOT NULL CHECK (seq >= 0),
    role         TEXT        NOT NULL CHECK (role IN ('user', 'assistant', 'tool')),
    content      TEXT        NOT NULL DEFAULT '',
    -- tool_name / tool_call_id are set on 'tool' rows only.
    tool_name    TEXT,
    tool_call_id TEXT,
    -- tool_calls records, on 'assistant' rows, the grounding tools the model
    -- invoked that turn: the audit trail of which legal data it actually read.
    tool_calls   JSONB       NOT NULL DEFAULT '[]'::jsonb,
    latency_ms   INTEGER     NOT NULL DEFAULT 0 CHECK (latency_ms >= 0),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Monotonic ordering within a session; also the backstop against a racing
    -- double-append writing two rows at the same position.
    CONSTRAINT uq_lex_ai_messages_seq UNIQUE (session_id, seq)
);

-- Transcript read path (ordered replay of one session).
CREATE INDEX IF NOT EXISTS idx_lex_ai_messages_tenant_session
    ON lex_ai_messages (tenant_id, session_id, seq ASC);

-- Row-Level Security (ENABLE + FORCE + 4 policies on app.current_tenant_id),
-- mirroring the lex_db template (000076 / 000077 / 000078).
ALTER TABLE lex_ai_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE lex_ai_sessions FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON lex_ai_sessions
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON lex_ai_sessions
    FOR INSERT WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_update ON lex_ai_sessions
    FOR UPDATE USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_delete ON lex_ai_sessions
    FOR DELETE USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

ALTER TABLE lex_ai_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE lex_ai_messages FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON lex_ai_messages
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON lex_ai_messages
    FOR INSERT WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
-- Deliberately no UPDATE policy: a transcript is an append-only audit record.
CREATE POLICY tenant_delete ON lex_ai_messages
    FOR DELETE USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
