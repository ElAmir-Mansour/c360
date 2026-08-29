-- =============================================================================
-- Pricing & Quoting Phase 2: the quotes store.
--
-- A quote is a SERVER-RECOMPUTED commercial record: it captures the exact
-- pricing_config version it was priced against (FK + denormalized version), the
-- Inputs snapshot, and the FULL four-tier computed output INCLUDING the internal
-- margin block. This table is INTERNAL — masking (dropping internal_cost /
-- gross_profit / realized_margin / markup) happens at the API and export layers
-- by DTO shape, never here, so an accepted quote is a permanent, reproducible
-- record (config version + inputs + margins).
--
-- A quote may PRECEDE a tenant/lead: tenant_id and lead_id are nullable and are
-- set once the quote is linked to a provisioned tenant or a CRM lead.
--
-- Governance: a quote whose selected tier is BELOW FLOOR cannot transition
-- draft -> sent/accepted unless a pricing:admin recorded a floor override
-- (floor_override_by/at); the transition handler re-checks this server-side.
--
-- Additive / reversible / idempotent: CREATE ... IF NOT EXISTS; the only
-- reference to an existing table is the FK to pricing_config (introduced in
-- 000009), so existing license-service tests cannot regress.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS quotes (
    id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    -- App-generated, sequential, human-facing identifier, e.g. Q-2026-000042.
    -- UNIQUE so two quotes can never share a number.
    quote_number      TEXT        NOT NULL UNIQUE,
    model             TEXT        NOT NULL CHECK (model IN ('per_user', 'per_core')),
    -- The exact pricing_config version this quote was priced against. The FK
    -- guarantees the version row survives as long as the quote references it;
    -- pricing_version is denormalized for fast display and immutability.
    pricing_config_id UUID        NOT NULL REFERENCES pricing_config(id),
    pricing_version   INT         NOT NULL,
    -- Commercial linkage (all nullable; a quote may precede a tenant/lead).
    tenant_id         UUID,
    lead_id           UUID,
    account_name      TEXT        NOT NULL DEFAULT '',
    -- Inputs snapshot: the exact Inputs struct the tiers were computed from, so
    -- the quote is reproducible by re-running the engine against pricing_config_id.
    inputs            JSONB       NOT NULL,
    -- Computed tiers: the full four-tier output INCLUDING the internal margin
    -- block. INTERNAL — exports mask margin at the API layer, not here.
    computed_tiers    JSONB       NOT NULL,
    selected_tier     TEXT        CHECK (selected_tier IN ('standard', 'growth', 'professional', 'customized')),
    status            TEXT        NOT NULL DEFAULT 'draft'
                      CHECK (status IN ('draft', 'sent', 'accepted', 'rejected', 'expired')),
    -- Governance: a below-floor quote can only reach 'sent'/'accepted' with an
    -- approval record.
    below_floor       BOOLEAN     NOT NULL DEFAULT FALSE,
    floor_override_by UUID,                              -- approver (IAM user) if below_floor was overridden
    floor_override_at TIMESTAMPTZ,
    valid_until       TIMESTAMPTZ,                       -- quote validity window
    created_by        UUID        NOT NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_quotes_status  ON quotes (status);
CREATE INDEX IF NOT EXISTS idx_quotes_tenant  ON quotes (tenant_id) WHERE tenant_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_quotes_model   ON quotes (model);
CREATE INDEX IF NOT EXISTS idx_quotes_created ON quotes (created_at DESC);

-- quote_seq backs the sequential per-year quote_number. The application reads
-- nextval() inside the insert transaction and formats Q-<year>-<padded seq>.
-- Using a sequence (not max(quote_number)+1) avoids a race under concurrent
-- inserts. It is app-managed and cheap; a fresh DB starts at 1.
CREATE SEQUENCE IF NOT EXISTS quote_number_seq START 1;
