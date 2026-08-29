-- =============================================================================
-- Contract review-desk completeness backfill + PRD §9.1 slot CHECK widening
-- =============================================================================
-- Two coupled fixes for the contract review desk (CAP-099/CAP-103):
--
--   1. Widen the slot CHECK constraints on lex_contract_attachment_requirements
--      and lex_contract_attachments to accept the Othaim PRD §9.1 slot set. The
--      service (ContractReviewDeskService.OpenIntake) seeds the five PRD slots
--      (foundation_document, purpose_of_contract, authorized_person_id,
--      power_of_attorney, addendum_prior_docs) on every intake, but 000031 only
--      allowed the four legacy slots — so the seed UpsertRequirement raised a
--      check_violation that aborted the intake transaction (latent seed defect).
--      Widen, never narrow: the four legacy slots are retained.
--
--   2. Backfill ALL historical contract_versions into lex_contract_attachments as
--      draft-slot rows. 000095 linked only the LATEST version per contract as the
--      live draft; the client asked for the previously-uploaded files (plural), so
--      every older version is inserted here as a SUPERSEDED draft row. This
--      preserves the single-live-slot invariant (idx_lex_contract_attachments_live_slot,
--      one non-superseded row per slot) because only superseded rows are added.
--
-- Idempotent (NOT EXISTS guards + IF EXISTS drops) and reversible (see .down.sql).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Widen the slot CHECK constraints to the PRD §9.1 + legacy union.
-- -----------------------------------------------------------------------------
ALTER TABLE lex_contract_attachment_requirements
    DROP CONSTRAINT IF EXISTS lex_contract_attachment_requirements_slot_check;
ALTER TABLE lex_contract_attachment_requirements
    ADD CONSTRAINT lex_contract_attachment_requirements_slot_check
    CHECK (slot IN (
        'foundation_document', 'purpose_of_contract', 'authorized_person_id',
        'power_of_attorney', 'addendum_prior_docs',
        'draft', 'quotation', 'commercial_registration', 'committee_decision'
    ));

ALTER TABLE lex_contract_attachments
    DROP CONSTRAINT IF EXISTS lex_contract_attachments_slot_check;
ALTER TABLE lex_contract_attachments
    ADD CONSTRAINT lex_contract_attachments_slot_check
    CHECK (slot IN (
        'foundation_document', 'purpose_of_contract', 'authorized_person_id',
        'power_of_attorney', 'addendum_prior_docs',
        'draft', 'quotation', 'commercial_registration', 'committee_decision'
    ));

-- -----------------------------------------------------------------------------
-- 2. Backfill every non-latest (superseded) contract version as a draft-slot row.
-- -----------------------------------------------------------------------------
WITH ranked_versions AS (
    SELECT
        v.tenant_id,
        v.contract_id,
        v.file_id,
        v.file_name,
        v.file_size_bytes,
        v.content_hash,
        v.version,
        v.uploaded_by,
        v.uploaded_at,
        ROW_NUMBER() OVER (
            PARTITION BY v.tenant_id, v.contract_id
            ORDER BY v.version DESC
        ) AS recency_rank
    FROM contract_versions v
)
INSERT INTO lex_contract_attachments (
    id,
    tenant_id,
    contract_id,
    slot,
    file_id,
    file_name,
    file_size_bytes,
    content_hash,
    version,
    superseded,
    notes,
    metadata,
    uploaded_by,
    created_at,
    updated_at
)
SELECT
    gen_random_uuid(),
    rv.tenant_id,
    rv.contract_id,
    'draft',
    rv.file_id,
    rv.file_name,
    rv.file_size_bytes,
    rv.content_hash,
    1,
    true,
    'Linked from a superseded contract version (history backfill)',
    jsonb_build_object(
        'source', 'contract_version_history_backfill',
        'contract_version', rv.version
    ),
    rv.uploaded_by,
    rv.uploaded_at,
    rv.uploaded_at
FROM ranked_versions rv
WHERE rv.recency_rank > 1
  AND NOT EXISTS (
      SELECT 1
      FROM lex_contract_attachments a
      WHERE a.tenant_id = rv.tenant_id
        AND a.contract_id = rv.contract_id
        AND a.slot = 'draft'
        AND a.deleted_at IS NULL
        AND (
            a.file_id = rv.file_id
            OR a.content_hash = rv.content_hash
            OR (
                a.metadata->>'source' = 'contract_version_history_backfill'
                AND (a.metadata->>'contract_version')::int = rv.version
            )
        )
  );
