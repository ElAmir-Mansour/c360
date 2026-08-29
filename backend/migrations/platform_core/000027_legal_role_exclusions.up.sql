-- Legal System Role Matrix (Watheeq / lex) — Static Separation of Duties (SSD),
-- design v2 §4.2 / changelog #7. A mutually-exclusive-role table so a single user
-- cannot simultaneously hold conflicting legal roles for the same org entity.
-- The seeded conflict pairs (filled in by the LegalAffairsRoleSeeder, kept in
-- lock-step with auth.LegalAffairsRoleDefs) are:
--   {legal-officer        ⊥ legal-cases-manager}      drafter vs. its own approver
--   {legal-advisor        ⊥ legal-contracts-manager}  recommender vs. final sign-off
--   {any-operational role ⊥ legal-auditor}            no operator may also audit
--
-- The role-assignment path (IAM) calls the seeder's CheckRoleExclusion guard with
-- the rows of this table; assignment-time enforcement rejects a grant that would
-- pair a conflicting role with one the user already holds for the same entity.
-- Additive + idempotent: ON CONFLICT upsert in the seeder; this DDL is guarded by
-- IF NOT EXISTS so re-applying is a no-op.

CREATE TABLE IF NOT EXISTS legal_role_exclusions (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    -- role_slug_a / role_slug_b are stored normalized (a < b) by the seeder so
    -- the constraint is symmetric: one row covers both assignment directions.
    role_slug_a VARCHAR(100) NOT NULL,
    role_slug_b VARCHAR(100) NOT NULL,
    reason      TEXT         NOT NULL DEFAULT '',
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_legal_role_exclusions UNIQUE (tenant_id, role_slug_a, role_slug_b),
    CONSTRAINT ck_legal_role_exclusions_distinct CHECK (role_slug_a <> role_slug_b),
    CONSTRAINT ck_legal_role_exclusions_ordered CHECK (role_slug_a < role_slug_b)
);

CREATE INDEX IF NOT EXISTS idx_legal_role_exclusions_tenant
    ON legal_role_exclusions (tenant_id);

COMMENT ON TABLE legal_role_exclusions IS
    'Static Separation of Duties (SSD) mutually-exclusive legal role pairs (Legal_Role_Matrix_Design.md v2 §4.2). A user may not hold both role_slug_a and role_slug_b for the same org entity.';
COMMENT ON COLUMN legal_role_exclusions.role_slug_a IS 'Lower (a < b) of the conflicting pair, normalized so the unique key is symmetric.';
COMMENT ON COLUMN legal_role_exclusions.role_slug_b IS 'Higher (a < b) of the conflicting pair.';
COMMENT ON COLUMN legal_role_exclusions.reason IS 'Human-readable SoD justification surfaced when an assignment is rejected.';
