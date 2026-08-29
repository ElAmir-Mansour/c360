-- =============================================================================
-- Arabic-aware document full-text search (Othaim PRD 14.1).
--
-- The 000032 migration built legal_documents.search_vector with the 'english'
-- text-search config. 'english' stems English but never normalizes Arabic:
-- tashkeel/harakat (U+064B..U+065F, U+0670), tatweel (U+0640), and the
-- alef / teh-marbuta / alef-maqsura variants defeat matching (عَقْد vs عقد,
-- ة vs ه, ى vs ي). This migration switches the index to the 'simple' config
-- (tokenize + lowercase, no language stemming — correct for Arabic, which needs
-- a root dictionary we do not ship) and applies a genuinely-IMMUTABLE Arabic
-- normalizer symmetrically at index time here and at query time in
-- document_search_repo.go.
--
-- This is a pure FTS index rebuild — fully reversible (see .down.sql), no WORM /
-- object-lock / DR go-live semantics. Rebuilding the GENERATED STORED column
-- takes an ACCESS EXCLUSIVE lock and rewrites legal_documents; fine for the
-- legal corpus, but for very large tenants a plain column + trigger backfill
-- would be the batched alternative.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- lex_search_normalize — fold Arabic orthographic variation for FTS.
--   * translate(): strip tatweel (ـ) and fold alef variants (ٱ أ إ آ → ا),
--     alef-maqsura (ى → ي) and teh-marbuta (ة → ه) to a canonical form.
--   * regexp_replace(): strip the combining tashkeel/harakat range (ً..ٟ,
--     U+064B..U+065F) plus the superscript alef (ٰ, U+0670, included in the range).
--   * lower(): fold Latin case so English continues to match.
-- Built only from PG builtins (translate/regexp_replace/lower) → truly IMMUTABLE
-- and PARALLEL SAFE, so it is legal inside a GENERATED column. (Single-arg
-- unaccent() is only STABLE and is deliberately NOT used here — it would make the
-- generation expression invalid.)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION lex_search_normalize(txt text)
    RETURNS text
    LANGUAGE sql
    IMMUTABLE
    PARALLEL SAFE
AS $$
    SELECT lower(
        regexp_replace(
            translate(coalesce(txt, ''), 'ـٱأإآىة', 'اااايه'),
            '[ً-ٰٟ]', '', 'g'
        )
    )
$$;

-- -----------------------------------------------------------------------------
-- Rebuild the generated search_vector. PostgreSQL cannot ALTER a generation
-- expression in place, so drop the dependent index + column and re-add them.
-- to_tsvector(regconfig-literal, immutable-fn(text)) is itself immutable, so the
-- GENERATED column validates.
-- -----------------------------------------------------------------------------
DROP INDEX IF EXISTS idx_legal_documents_search_vector;

ALTER TABLE legal_documents
    DROP COLUMN IF EXISTS search_vector;

ALTER TABLE legal_documents
    ADD COLUMN search_vector tsvector
    GENERATED ALWAYS AS (
        setweight(to_tsvector('simple', lex_search_normalize(coalesce(title, ''))), 'A') ||
        setweight(to_tsvector('simple', lex_search_normalize(coalesce(description, ''))), 'B') ||
        setweight(to_tsvector('simple', lex_search_normalize(coalesce(extracted_text, ''))), 'C')
    ) STORED;

CREATE INDEX IF NOT EXISTS idx_legal_documents_search_vector
    ON legal_documents USING GIN (search_vector);
