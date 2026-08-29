-- Reverse 000022: drop the drill-scope marker substrates and the scorecard
-- observability column. The marker tables are drill-scope and transient (a
-- game-day revert clears each marker), so dropping them loses no durable state.
DROP TABLE IF EXISTS dr_drill_site_block;
DROP TABLE IF EXISTS dr_drill_lag_marker;

ALTER TABLE dr_gameday_step_result
    DROP COLUMN IF EXISTS observability;
