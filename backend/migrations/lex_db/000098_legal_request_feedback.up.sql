-- Requester satisfaction for completed legal requests.
--
-- One append-only response is accepted per request. The request FK and tenant
-- key make the reporting join explicit, while service-layer ownership checks
-- ensure only the request's requester can submit after delivery/closure.

CREATE TABLE IF NOT EXISTS legal_request_feedback (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID        NOT NULL,
    request_id   UUID        NOT NULL REFERENCES legal_requests(id) ON DELETE CASCADE,
    rating       SMALLINT    NOT NULL CHECK (rating BETWEEN 1 AND 5),
    comment      TEXT        NOT NULL DEFAULT '' CHECK (length(comment) <= 2000),
    submitted_by UUID        NOT NULL,
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_legal_request_feedback_request UNIQUE (tenant_id, request_id)
);

CREATE INDEX IF NOT EXISTS idx_legal_request_feedback_tenant_submitted
    ON legal_request_feedback (tenant_id, submitted_at DESC);

ALTER TABLE legal_request_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_request_feedback FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON legal_request_feedback
    FOR SELECT
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE POLICY tenant_insert ON legal_request_feedback
    FOR INSERT
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- Deliberately no UPDATE or DELETE policy: satisfaction is an append-only,
-- audit-grade response rather than an editable operational field.
