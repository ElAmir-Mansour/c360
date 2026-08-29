-- =============================================================================
-- WatheeqTech Reference Library — effective / as-of date
-- (WatheeqTech_Library_Design.md §3.2, currency signal).
--
-- Adds the document's issuance / last-amended EFFECTIVE date so the frontend can
-- render "as of {date}" and flag stale versions. It is distinct from the existing
-- free-text hijri_date and the gregorian_date issuance columns: effective_date is
-- the single, structured (DATE) as-of value the browse/detail UI reads directly.
-- NULL is expected for documents whose current version we cannot safely assert —
-- the frontend then shows "confirm current version" rather than a fabricated date.
--
-- The corresponding Hijri as-of string is carried in metadata.effective_hijri
-- (surfaced through the existing metadata JSONB, no schema change needed).
-- =============================================================================

ALTER TABLE reference_library_documents
    ADD COLUMN IF NOT EXISTS effective_date DATE;
