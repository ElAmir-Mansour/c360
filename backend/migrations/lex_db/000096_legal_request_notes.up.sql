-- Internal collaboration notes on a legal request (Al Othaim PRD, request detail
-- right rail). Mirrors legal_matter_comments (000048) but scoped to the request
-- spine (legal_requests). These are free-form internal notes distinct from the
-- lifecycle-tied fields (approval decision notes, delivery/return reasons): the
-- request detail composer previously rendered as an HONEST disabled preview
-- because no persistence endpoint existed. This table is that store.
--
-- Mentions are stored as a JSONB array of strings (user IDs or display handles)
-- so the frontend can render @mentions without a fixed UUID shape, exactly like
-- legal_matter_comments. Author identity is denormalized (author_id +
-- author_name) so a note thread renders without an extra user lookup.

CREATE TABLE IF NOT EXISTS legal_request_notes (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID        NOT NULL,
    request_id  UUID        NOT NULL REFERENCES legal_requests(id) ON DELETE CASCADE,
    author_id   UUID        NOT NULL,
    author_name TEXT        NOT NULL DEFAULT '',
    body        TEXT        NOT NULL,
    mentions    JSONB       NOT NULL DEFAULT '[]'::jsonb,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_legal_request_notes_request
    ON legal_request_notes (tenant_id, request_id, created_at ASC)
    WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_legal_request_notes_mentions
    ON legal_request_notes USING GIN (mentions)
    WHERE deleted_at IS NULL;

ALTER TABLE legal_request_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_request_notes FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON legal_request_notes
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON legal_request_notes
    FOR INSERT WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_update ON legal_request_notes
    FOR UPDATE USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_delete ON legal_request_notes
    FOR DELETE USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
