-- =============================================================================
-- Consultations: GIN index on the tags array.
--
-- All other consultation read paths added in this change (SLA-risk filters, the
-- /stats rollup, advisor-workload) reuse columns + indexes that already exist
-- (sla_* columns and idx_legal_consultations_sla_open from 000041; the advisor
-- index idx_legal_consultations_advisor from 000029). The ONLY unindexed access
-- pattern is the tag set:
--   * the existing `tag` list filter ($1 = ANY(tags)), and
--   * the new GET /consultations/tags distinct-tag scan (unnest(tags)).
-- A GIN index on tags makes the containment/ANY predicate index-backed and keeps
-- the distinct-tag autocomplete cheap as consultation volume grows.
--
-- Additive + idempotent (IF NOT EXISTS); no column or data changes.
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_legal_consultations_tags
    ON legal_consultations USING GIN (tags)
    WHERE deleted_at IS NULL;
