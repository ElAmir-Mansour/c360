-- =============================================================================
-- Pricing & Quoting: versioned, governed pricing configuration.
--
-- PRICING is the natural sibling of LICENSING: the four commercial tiers
-- (standard/growth/professional/customized) map 1:1 to license_plans keys.
-- The ~40 rates that drive the server-authoritative pricing engine are governed
-- DATA, not code: each row is one IMMUTABLE version with an effective window and
-- created_by, so changing a rate = publishing a new version (audited via the
-- existing license event outbox), never a code change.
--
-- Platform-global (no tenant scoping) — this is platform pricing, a single
-- source of truth. Like the other licensing infrastructure tables it is not
-- RLS-forced; no tenant-facing API reads it directly.
--
-- Additive / reversible / idempotent: CREATE ... IF NOT EXISTS; no existing
-- table touched, so existing license-service tests cannot regress.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS pricing_config (
    id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Monotonic, app-assigned version = max(version)+1. UNIQUE so two publishes
    -- can never share a version number.
    version        INT         NOT NULL UNIQUE,
    status         TEXT        NOT NULL DEFAULT 'draft'
                   CHECK (status IN ('draft', 'active', 'archived')),
    -- The ~40 rates as a typed JSONB payload. The Go struct (PricingRates) is
    -- the typed contract and is range-validated on write, so JSONB is a
    -- serialization detail — adding a rate is a struct field + a new VERSION,
    -- never an ALTER TABLE.
    payload        JSONB       NOT NULL,
    currency       TEXT        NOT NULL DEFAULT 'SAR',
    effective_from TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- NULL = open-ended (the current active version); set when a version is
    -- archived by a newer publish.
    effective_to   TIMESTAMPTZ,
    notes          TEXT        NOT NULL DEFAULT '',
    -- IAM user id (JWT sub) that created the version; '' for the migration seed.
    created_by     TEXT        NOT NULL DEFAULT '',
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- At most ONE active version at a time — the invariant the engine relies on
-- when it loads "the active config" is enforced in the database, not just the app.
CREATE UNIQUE INDEX IF NOT EXISTS uq_pricing_config_single_active
    ON pricing_config ((status)) WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_pricing_config_effective
    ON pricing_config (effective_from, effective_to);
