-- =============================================================================
-- WatheeqTech Reference Library — per-access AUDIT log
-- (WatheeqTech_Library_Design.md §4 security/gov hardening).
--
-- Every download of a corpus PDF and every Second-Brain /ask or /search proxy
-- writes ONE durable, queryable audit row here: who (tenant_id + user_id +
-- user_email), what (document_id + action), when (created_at), from where
-- (client_ip + user_agent), and the terminal outcome + bytes served. This is the
-- lex-side, byte-source-independent audit trail: it covers the mounted-volume
-- path (which has no file_access_log) AND the Second-Brain LLM-cost surface,
-- complementing (not duplicating) file-service's own file_access_log on the
-- Option-A file-service byte path.
--
-- The write is best-effort and NON-BLOCKING in the request path — an audit-write
-- failure logs a warning but never fails the download/ask. The table is global
-- (the catalog it references is global) but DOES carry the reader's tenant_id +
-- user_id so access is attributable per tenant. There is no cross-DB FK to the
-- catalog by design (matches the catalog's own no-FK posture); document_id is an
-- opaque UUID and is NULL for /ask and /search (which are not per-document).
-- =============================================================================

CREATE TABLE IF NOT EXISTS reference_library_access_log (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id  UUID,                              -- catalog row id (NULL for ask/search)
    action       TEXT        NOT NULL,              -- download | ask | search
    tenant_id    UUID,                              -- reader's tenant (attribution)
    user_id      UUID,                              -- reader's user id
    user_email   TEXT        NOT NULL DEFAULT '',
    client_ip    TEXT        NOT NULL DEFAULT '',
    user_agent   TEXT        NOT NULL DEFAULT '',
    byte_source  TEXT        NOT NULL DEFAULT '',   -- volume | file-service | '' (ask/search)
    outcome      TEXT        NOT NULL DEFAULT 'ok',  -- ok | not_modified | not_found | error | ...
    bytes_served BIGINT      NOT NULL DEFAULT 0,
    -- For ask/search: a SHA-256 of the (normalized) question/query so the audit is
    -- attributable and de-dupable WITHOUT persisting potentially sensitive free
    -- text; the first chars of the query are kept for operator triage only.
    query_hash   TEXT        NOT NULL DEFAULT '',
    query_sample TEXT        NOT NULL DEFAULT '',
    status_code  INT         NOT NULL DEFAULT 0,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Newest-first audit browse, and per-document / per-tenant access history.
CREATE INDEX IF NOT EXISTS idx_reference_library_access_log_created
    ON reference_library_access_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reference_library_access_log_document
    ON reference_library_access_log (document_id, created_at DESC)
    WHERE document_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_reference_library_access_log_tenant
    ON reference_library_access_log (tenant_id, created_at DESC);

-- RLS defensive posture mirrors the catalog: enable, keep a permissive read
-- policy (app-layer SQL is the real control on the owner/superuser lex pool), and
-- expose NO tenant write policy — rows are written only by the owner/service
-- connection in the request path.
ALTER TABLE reference_library_access_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS reference_library_access_log_read ON reference_library_access_log;
CREATE POLICY reference_library_access_log_read ON reference_library_access_log FOR SELECT USING (true);
