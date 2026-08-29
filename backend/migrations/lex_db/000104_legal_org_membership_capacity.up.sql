-- Optional per-person capacity seam for legal workforce reporting.
-- NULL is the expected default and means no capacity source is configured.
ALTER TABLE legal_org_memberships
    ADD COLUMN IF NOT EXISTS capacity_units NUMERIC(4,2)
        CHECK (capacity_units IS NULL OR capacity_units BETWEEN 0 AND 1);
