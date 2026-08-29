-- =============================================================================
-- Licensing & Billing service schema (Solution Architecture E2E, slide 18).
--
-- Entitlement model: a plan grants entitlement keys (suite / app / module /
-- seat counters). A NULL limit_value grants the key without a quota; a
-- positive limit_value is a metered quota; a zero limit_value revokes the key
-- (used by per-tenant overrides). Per-tenant overrides take precedence over
-- the plan row for the same key.
--
-- license_plans is a global catalog (no tenant scoping). Tenant-scoped tables
-- carry tenant_id; the service is queried by the gateway across tenants, so
-- like the event outbox these infrastructure tables are not RLS-forced —
-- no tenant-facing API reads them directly.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS license_plans (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    key         TEXT        NOT NULL UNIQUE,
    name        TEXT        NOT NULL,
    description TEXT        NOT NULL DEFAULT '',
    -- Offline-activated plans are imported from a signed license file and
    -- are not assignable through the plan catalog API.
    source      TEXT        NOT NULL DEFAULT 'catalog'
                CHECK (source IN ('catalog', 'offline')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS plan_entitlements (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_id     UUID        NOT NULL REFERENCES license_plans(id) ON DELETE CASCADE,
    key         TEXT        NOT NULL,
    -- NULL = granted without quota; >0 = metered quota; 0 = explicitly revoked.
    limit_value BIGINT      CHECK (limit_value IS NULL OR limit_value >= 0),
    UNIQUE (plan_id, key)
);

CREATE TABLE IF NOT EXISTS tenant_licenses (
    id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id          UUID        NOT NULL UNIQUE,
    plan_id            UUID        NOT NULL REFERENCES license_plans(id),
    status             TEXT        NOT NULL DEFAULT 'active'
                       CHECK (status IN ('active', 'suspended')),
    seats              BIGINT      NOT NULL DEFAULT 0 CHECK (seats >= 0),
    starts_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at         TIMESTAMPTZ NOT NULL,
    grace_days         INT         NOT NULL DEFAULT 14 CHECK (grace_days >= 0),
    -- Set when the license was activated from a signed offline file; the
    -- license file ID makes re-activation idempotent.
    offline_license_id UUID        UNIQUE,
    metadata           JSONB       NOT NULL DEFAULT '{}'::jsonb,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tenant_licenses_expiry
    ON tenant_licenses (expires_at)
    WHERE status = 'active';

CREATE TABLE IF NOT EXISTS entitlement_overrides (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID        NOT NULL,
    key         TEXT        NOT NULL,
    -- Same semantics as plan_entitlements.limit_value; 0 revokes the key.
    limit_value BIGINT      CHECK (limit_value IS NULL OR limit_value >= 0),
    reason      TEXT        NOT NULL DEFAULT '',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, key)
);

CREATE TABLE IF NOT EXISTS usage_counters (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID        NOT NULL,
    key          TEXT        NOT NULL,
    -- First day of the UTC calendar month the counter covers.
    period_start DATE        NOT NULL,
    used         BIGINT      NOT NULL DEFAULT 0 CHECK (used >= 0),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, key, period_start)
);

CREATE INDEX IF NOT EXISTS idx_usage_counters_tenant_period
    ON usage_counters (tenant_id, period_start);

-- Transactional event outbox: license events (assigned, suspended, limit
-- reached, …) are staged in the same transaction as the state change.
-- Definition mirrors migrations/platform_core/000015_event_outbox.up.sql.
CREATE TABLE IF NOT EXISTS event_outbox (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id        UUID        NOT NULL UNIQUE,
    tenant_id       UUID        NOT NULL,
    topic           TEXT        NOT NULL,
    event_type      TEXT        NOT NULL,
    payload         JSONB       NOT NULL,
    status          TEXT        NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'publishing', 'published', 'failed')),
    attempts        INT         NOT NULL DEFAULT 0,
    last_error      TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    claimed_at      TIMESTAMPTZ,
    published_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_event_outbox_claim
    ON event_outbox (next_attempt_at, created_at)
    WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_event_outbox_stuck
    ON event_outbox (claimed_at)
    WHERE status = 'publishing';

CREATE INDEX IF NOT EXISTS idx_event_outbox_purge
    ON event_outbox (published_at)
    WHERE status = 'published';

CREATE INDEX IF NOT EXISTS idx_event_outbox_failed
    ON event_outbox (tenant_id, created_at)
    WHERE status = 'failed';
