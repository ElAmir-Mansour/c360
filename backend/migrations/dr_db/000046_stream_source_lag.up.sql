-- True source-to-target RPO lag.
--
-- Until now the RPO ledger stored only applied_at (the apply-side wall clock),
-- so the live RPO was computed as now() - applied_at. That understates the real
-- data-loss window a skeptical government reviewer cares about: the time between
-- when a change was COMMITTED at the source and when it became durable on the
-- recovery target. This column carries the source emit/commit timestamp
-- (core.Frame.EmittedAt) of the last contiguously applied frame so the monitor
-- can report the true end-to-end lag applied_at - source_committed_at.
--
-- It is nullable: rows checkpointed before this migration (and apply paths that
-- cannot supply a source timestamp) leave it NULL, and the monitor falls back to
-- the existing now() - applied_at value so nothing breaks.
ALTER TABLE replication_stream
    ADD COLUMN IF NOT EXISTS source_committed_at TIMESTAMPTZ;

COMMENT ON COLUMN replication_stream.source_committed_at IS
    'Source emit/commit wall clock (core.Frame.EmittedAt) of the last applied frame; '
    'true source-to-target RPO lag = applied_at - source_committed_at. NULL for legacy rows.';
