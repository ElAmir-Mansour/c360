-- =============================================================================
-- WatheeqTech Reference Library — Second-Brain answer FEEDBACK
-- (WatheeqTech_Library_Design.md §7 P2, answer-quality signal).
--
-- Captures a reader's thumbs up/down (plus an optional free-text comment and the
-- citations the answer was grounded on) for a Second-Brain /ask answer. This is
-- the durable quality signal that drives prompt/retrieval tuning: it records WHO
-- rated (tenant_id + user_id, for attribution and per-tenant slicing), WHAT they
-- asked (question), the rating, an optional comment, and the citations JSONB the
-- graded answer cited.
--
-- The write is best-effort and NON-BLOCKING on the request path (a feedback-write
-- failure logs a warning but never fails the POST, which returns 204). The table
-- is global (the corpus it grades is global) but DOES carry the rater's tenant_id
-- + user_id so feedback is attributable per tenant. There is NO cross-DB FK by
-- design (matches the catalog's own no-FK posture).
-- =============================================================================

CREATE TABLE IF NOT EXISTS reference_library_ask_feedback (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID,                               -- rater's tenant (attribution)
    user_id      UUID,                               -- rater's user id
    question     TEXT        NOT NULL DEFAULT '',    -- the graded question
    rating       TEXT        NOT NULL,               -- up | down
    comment      TEXT        NOT NULL DEFAULT '',    -- optional free-text note
    citations    JSONB       NOT NULL DEFAULT '[]',  -- citations the answer cited
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT reference_library_ask_feedback_rating_chk CHECK (rating IN ('up', 'down'))
);

-- Newest-first feedback browse, and per-tenant feedback history.
CREATE INDEX IF NOT EXISTS idx_reference_library_ask_feedback_created
    ON reference_library_ask_feedback (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reference_library_ask_feedback_tenant
    ON reference_library_ask_feedback (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reference_library_ask_feedback_rating
    ON reference_library_ask_feedback (rating);

-- RLS defensive posture mirrors the catalog + access log: enable, keep a
-- permissive read policy (app-layer SQL is the real control on the owner/superuser
-- lex pool), and expose NO tenant write policy — rows are written only by the
-- owner/service connection in the request path.
ALTER TABLE reference_library_ask_feedback ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS reference_library_ask_feedback_read ON reference_library_ask_feedback;
CREATE POLICY reference_library_ask_feedback_read ON reference_library_ask_feedback FOR SELECT USING (true);
