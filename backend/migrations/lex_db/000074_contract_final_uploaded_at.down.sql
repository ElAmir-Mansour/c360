-- Reverse CAP-117 final-version timestamp column.
ALTER TABLE contracts
    DROP COLUMN IF EXISTS final_uploaded_at;
