-- BCM compliance-pack CATALOG reference tables (ClarioDR capability #18).
--
-- The pack/control catalog is code-of-record (internal/dr/bcm): a pack is a
-- recognised continuity/DR standard (ISO 22301, NCA/SAMA BCM, ...) decomposed
-- into discrete controls, each naming the evidence it requires and its
-- deterministic satisfaction rule. Migration 000027 records the OUTPUT of
-- running a pack (dr_bcm_assessment / dr_bcm_control_result); this migration adds
-- the reference projection of the catalog ITSELF so the available packs and their
-- controls are queryable/auditable in dr_db and FK-discoverable, without making
-- the catalog database-of-record.
--
-- These rows are SEEDED at service startup (seedBCMPacks) from the in-code
-- catalog with an idempotent upsert, so a catalog change converges the rows on
-- the next boot. The catalog is tenant-INDEPENDENT global data (every tenant sees
-- the same packs), so these tables carry NO tenant_id and NO row-level security —
-- they are a static lookup, like a units/codes table.

CREATE TABLE IF NOT EXISTS dr_bcm_pack (
    -- the stable catalog key ('iso22301', 'nca-sama-bcm', ...); the API/URL id.
    pack_key TEXT PRIMARY KEY,
    -- the standard citation an auditor expects on the report.
    standard TEXT NOT NULL,
    -- the catalog version evaluated, so an old assessment is explainable against
    -- the exact pack definition that produced it.
    version TEXT NOT NULL DEFAULT '',
    -- the issuing authority (e.g. 'ISO/TC 292', 'NCA', 'SAMA').
    authority TEXT NOT NULL DEFAULT '',
    -- human-facing pack title + description.
    title TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    -- denormalised control count for cheap listing.
    control_count INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS dr_bcm_pack_control (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- the parent pack; deleting a pack drops its controls.
    pack_key TEXT NOT NULL REFERENCES dr_bcm_pack(pack_key) ON DELETE CASCADE,
    -- the standard's control identifier ('BC-3', 'ISO22301-8.4.4', ...).
    control_code TEXT NOT NULL,
    -- human-facing control title + description an auditor reads.
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    -- the evidence kinds the control requires (JSONB string array) — the precise
    -- gap-analysis input ('control X needs drill evidence, none found').
    required_evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
    -- the fully-parameterised deterministic satisfaction rule (JSONB object:
    -- {kind, window_days, min_count, rto_objective_seconds, ...}).
    rule JSONB NOT NULL DEFAULT '{}'::jsonb,
    -- scoring weight (>=1) biasing the aggregate toward critical controls.
    weight INT NOT NULL DEFAULT 1,
    -- a mandatory control's failure fails the whole pack regardless of score.
    mandatory BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- a control appears once per pack.
    UNIQUE (pack_key, control_code)
);

CREATE INDEX IF NOT EXISTS idx_dr_bcm_pack_control_pack
    ON dr_bcm_pack_control (pack_key, control_code);
