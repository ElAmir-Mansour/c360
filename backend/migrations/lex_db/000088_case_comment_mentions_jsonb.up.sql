-- Widen legal_case_comments.mentions from UUID[] to JSONB (F11 runtime regression).
-- The case-comment code now reads/writes mentions as a JSONB array of strings
-- (user IDs or display handles), mirroring legal_matter_comments (000048) and the
-- clause-comment store. The column was still UUID[] (000045), so every case-comment
-- read AND write 500s on the jsonb<->uuid[] mismatch. This converts the existing
-- UUID[] values into a JSONB array of their text form, preserving any data.

-- The GIN index must be dropped before the column type changes (its opclass is
-- bound to the array type).
DROP INDEX IF EXISTS idx_legal_case_comments_mentions;

ALTER TABLE legal_case_comments
    ALTER COLUMN mentions DROP DEFAULT;

ALTER TABLE legal_case_comments
    ALTER COLUMN mentions TYPE jsonb USING to_jsonb(mentions::text[]);

ALTER TABLE legal_case_comments
    ALTER COLUMN mentions SET DEFAULT '[]'::jsonb;

-- Recreate the GIN index with the same partial predicate as 000045.
CREATE INDEX IF NOT EXISTS idx_legal_case_comments_mentions
    ON legal_case_comments USING GIN (mentions)
    WHERE deleted_at IS NULL;
