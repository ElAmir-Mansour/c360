-- =============================================================================
-- CAP-117 — Upload FINAL version (review-desk ceremony)
-- =============================================================================
-- Records WHEN the approved final contract version was uploaded through the
-- review-desk final-version ceremony. The version supersession itself rides the
-- existing contract_versions / contracts.current_version model (the newest
-- version IS the current/active one; prior versions are superseded by ordering),
-- so this migration adds only the single timestamp the ceremony stamps onto the
-- contract. NULL = no final version has been uploaded yet.
-- =============================================================================
ALTER TABLE contracts
    ADD COLUMN IF NOT EXISTS final_uploaded_at TIMESTAMPTZ NULL;
