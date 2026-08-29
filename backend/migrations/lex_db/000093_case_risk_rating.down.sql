-- Roll back the graded litigation-case risk rating (Al Othaim PRD 8.2). Drops
-- the partial index and the eight additive columns; the binary strength
-- assessment is untouched.

DROP INDEX IF EXISTS idx_legal_cases_risk_rating;

ALTER TABLE legal_cases
    DROP COLUMN IF EXISTS risk_rating,
    DROP COLUMN IF EXISTS risk_likelihood,
    DROP COLUMN IF EXISTS risk_impact,
    DROP COLUMN IF EXISTS risk_exposure_value,
    DROP COLUMN IF EXISTS risk_exposure_currency,
    DROP COLUMN IF EXISTS risk_rationale,
    DROP COLUMN IF EXISTS risk_assessed_by,
    DROP COLUMN IF EXISTS risk_assessed_at;
