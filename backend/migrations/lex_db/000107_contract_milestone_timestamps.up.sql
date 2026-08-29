-- Preserve the time component entered for contract milestones. PostgreSQL's
-- DATE columns silently discarded it even though the API models these values as
-- RFC3339 timestamps.
ALTER TABLE contracts
    ALTER COLUMN effective_date TYPE TIMESTAMPTZ USING effective_date::timestamp AT TIME ZONE 'UTC',
    ALTER COLUMN expiry_date TYPE TIMESTAMPTZ USING expiry_date::timestamp AT TIME ZONE 'UTC',
    ALTER COLUMN renewal_date TYPE TIMESTAMPTZ USING renewal_date::timestamp AT TIME ZONE 'UTC',
    ALTER COLUMN signed_date TYPE TIMESTAMPTZ USING signed_date::timestamp AT TIME ZONE 'UTC';
