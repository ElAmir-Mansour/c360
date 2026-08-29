-- Graded litigation-case risk rating (Al Othaim PRD 8.2).
--
-- Litigation cases previously carried only the binary strength assessment
-- (strong/weak). This adds a first-class, graded risk rating alongside it,
-- reusing the shared risk vocabulary (low/medium/high/critical — the `none`
-- band is intentionally NOT allowed: an assessed case is always low+, an
-- unassessed case is a NULL rating).
--
-- The rating can be recorded directly or derived from an optional likelihood ×
-- impact matrix (each factor on the 1–5 scale). An optional monetary exposure
-- figure, a free-text rationale, and the assessing actor/instant capture the
-- assessment provenance for the audit trail.
--
-- Purely additive + reversible: new nullable columns + one partial index. No
-- lifecycle, SLA, WORM or object-lock semantics change.

ALTER TABLE legal_cases
    ADD COLUMN IF NOT EXISTS risk_rating            TEXT
        CHECK (risk_rating IS NULL OR risk_rating IN ('low', 'medium', 'high', 'critical')),
    ADD COLUMN IF NOT EXISTS risk_likelihood        INT
        CHECK (risk_likelihood IS NULL OR (risk_likelihood BETWEEN 1 AND 5)),
    ADD COLUMN IF NOT EXISTS risk_impact            INT
        CHECK (risk_impact IS NULL OR (risk_impact BETWEEN 1 AND 5)),
    ADD COLUMN IF NOT EXISTS risk_exposure_value    NUMERIC
        CHECK (risk_exposure_value IS NULL OR risk_exposure_value >= 0),
    ADD COLUMN IF NOT EXISTS risk_exposure_currency TEXT,
    ADD COLUMN IF NOT EXISTS risk_rationale         TEXT,
    ADD COLUMN IF NOT EXISTS risk_assessed_by        UUID,
    ADD COLUMN IF NOT EXISTS risk_assessed_at        TIMESTAMPTZ;

-- Filter/report on the graded band (e.g. the case list `risk_rating=critical`
-- facet) within a tenant, skipping soft-deleted rows.
CREATE INDEX IF NOT EXISTS idx_legal_cases_risk_rating
    ON legal_cases (tenant_id, risk_rating)
    WHERE deleted_at IS NULL;
