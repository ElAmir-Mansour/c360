-- Feature 4 (drafting -> engine-backed human tasks).
--
-- AI drafting outputs (AID-* generative results) are not persisted by the
-- drafting engine: they are generated and returned to the caller. To make a
-- draft reviewable as a first-class workflow human task via the SHARED engine
-- (internal/workflow), the caller submits the draft for review under a stable,
-- client-supplied draft_id. This table persists the submitted draft content plus
-- the linkage to the engine-tracked HumanTask / WorkflowInstance and the
-- review lifecycle status.
--
-- The row is the lex-side projection of the review; the authoritative task state
-- lives in workflow_tasks (engine). review_status mirrors the task outcome and is
-- updated on task completion (approve/reject).

CREATE TABLE IF NOT EXISTS lex_draft_reviews (
    id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id            UUID        NOT NULL,
    -- draft_id is the stable, caller-supplied identifier for the AI draft being
    -- reviewed. One open review per (tenant, draft) is enforced below.
    draft_id             UUID        NOT NULL,
    -- title is a human-friendly label shown on the review task.
    title                TEXT        NOT NULL DEFAULT '',
    -- draft_kind records which AID-* artefact produced the content (e.g.
    -- "clause", "contract", "rewrite"); free-form, used for display/filtering.
    draft_kind           TEXT        NOT NULL DEFAULT '',
    -- content is the full draft payload carried into the task form data, stored
    -- here as the review's source of truth.
    content              JSONB       NOT NULL DEFAULT '{}'::jsonb,
    review_status        TEXT        NOT NULL DEFAULT 'pending'
        CHECK (review_status IN ('pending','approved','rejected','changes_requested','cancelled')),
    -- engine linkage.
    review_task_id       UUID,
    workflow_instance_id UUID,
    -- assignment snapshot (informational; the engine task is authoritative).
    assignee_id          UUID,
    assignee_role        TEXT,
    sla_deadline         TIMESTAMPTZ,
    -- review outcome.
    review_notes         TEXT        NOT NULL DEFAULT '',
    reviewed_by          UUID,
    reviewed_at          TIMESTAMPTZ,
    submitted_by         UUID,
    metadata             JSONB       NOT NULL DEFAULT '{}'::jsonb,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- At most one non-terminal (pending) review per draft per tenant; terminal
-- reviews (approved/rejected/changes_requested/cancelled) may coexist as history.
CREATE UNIQUE INDEX IF NOT EXISTS uq_lex_draft_reviews_open
    ON lex_draft_reviews (tenant_id, draft_id)
    WHERE review_status = 'pending';

CREATE INDEX IF NOT EXISTS idx_lex_draft_reviews_tenant
    ON lex_draft_reviews (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lex_draft_reviews_task
    ON lex_draft_reviews (review_task_id)
    WHERE review_task_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_lex_draft_reviews_instance
    ON lex_draft_reviews (workflow_instance_id)
    WHERE workflow_instance_id IS NOT NULL;

ALTER TABLE lex_draft_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE lex_draft_reviews FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON lex_draft_reviews
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON lex_draft_reviews
    FOR INSERT
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_update ON lex_draft_reviews
    FOR UPDATE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_delete ON lex_draft_reviews
    FOR DELETE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
