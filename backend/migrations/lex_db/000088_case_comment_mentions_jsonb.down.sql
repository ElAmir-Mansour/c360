-- Reverse 000088: narrow legal_case_comments.mentions from JSONB back to UUID[].
-- Best-effort: JSONB array elements are cast back to UUID. Empty/null arrays map
-- to '{}'; non-UUID mention strings (display handles) would fail the ::uuid cast,
-- so this down step assumes uuid-shaped mention data (the original 000045 shape).

DROP INDEX IF EXISTS idx_legal_case_comments_mentions;

ALTER TABLE legal_case_comments
    ALTER COLUMN mentions DROP DEFAULT;

ALTER TABLE legal_case_comments
    ALTER COLUMN mentions TYPE uuid[] USING (
        CASE
            WHEN mentions IS NULL OR jsonb_typeof(mentions) <> 'array' THEN '{}'::uuid[]
            ELSE ARRAY(SELECT jsonb_array_elements_text(mentions))::uuid[]
        END
    );

ALTER TABLE legal_case_comments
    ALTER COLUMN mentions SET DEFAULT '{}';

-- Restore the original GIN index (same partial predicate as 000045).
CREATE INDEX IF NOT EXISTS idx_legal_case_comments_mentions
    ON legal_case_comments USING GIN (mentions)
    WHERE deleted_at IS NULL;
