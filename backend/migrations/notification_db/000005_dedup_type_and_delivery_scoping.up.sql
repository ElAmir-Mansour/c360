-- =============================================================================
-- 000005: Dedup-by-type + delivery-log tenant scoping + retry / quiet-hours cols
--
-- Wave A (schema & data layer). Every change is additive and backward-compatible.
--   #9  Include the notification `type` in the dedup key so two distinct rules
--       firing on one source event (different types, same user) both survive;
--       only a genuine (event, user, type) redelivery collapses.
--   #3  Give notification_delivery_log its own tenant_id (backfilled from
--       notifications) so delivery logs can be tenant-scoped without a join.
--   #6  Retry scheduling: max_retries column + a partial index so a retry worker
--       can claim due rows efficiently (next_retry_at + attempt already exist).
--   #10 Quiet-hours deferral: deliver_after column + a partial index so a flusher
--       can release deferred emails once now() >= deliver_after.
-- =============================================================================

-- --- #9: dedup key now includes `type` ---------------------------------------
DROP INDEX IF EXISTS idx_notif_dedup;
CREATE UNIQUE INDEX idx_notif_dedup
    ON notifications (tenant_id, user_id, source_event_id, type)
    WHERE source_event_id IS NOT NULL;

-- --- #3: delivery-log tenant_id ----------------------------------------------
ALTER TABLE notification_delivery_log
    ADD COLUMN IF NOT EXISTS tenant_id UUID;

-- Backfill from the parent notification. notification_id is NOT NULL with an
-- ON DELETE CASCADE FK, so every delivery-log row maps to exactly one
-- notification and this backfill is complete. Left NULLABLE deliberately:
-- making it NOT NULL now would break inserts from any not-yet-upgraded binary
-- during a rolling deploy. A follow-up migration can SET NOT NULL once every
-- writer sets tenant_id.
UPDATE notification_delivery_log AS dl
    SET tenant_id = n.tenant_id
    FROM notifications AS n
    WHERE dl.notification_id = n.id
      AND dl.tenant_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_delivery_tenant_status
    ON notification_delivery_log (tenant_id, status, created_at);

-- --- Align status CHECK with the runtime schema (allow 'retrying') -----------
-- The runtime embedded schema (repository/schema.go) already permits 'retrying';
-- migration-path DBs (000001) did not. The retry worker (#6) needs it.
ALTER TABLE notification_delivery_log DROP CONSTRAINT IF EXISTS notification_delivery_log_status_check;
ALTER TABLE notification_delivery_log
    ADD CONSTRAINT notification_delivery_log_status_check
    CHECK (status IN ('pending', 'delivered', 'failed', 'skipped', 'retrying'));

-- --- #6: retry scheduling -----------------------------------------------------
ALTER TABLE notification_delivery_log
    ADD COLUMN IF NOT EXISTS max_retries INT NOT NULL DEFAULT 3;

CREATE INDEX IF NOT EXISTS idx_delivery_retry_due
    ON notification_delivery_log (status, next_retry_at)
    WHERE status IN ('failed', 'retrying');

-- --- #10: quiet-hours deferral ------------------------------------------------
ALTER TABLE notification_delivery_log
    ADD COLUMN IF NOT EXISTS deliver_after TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_delivery_deferred
    ON notification_delivery_log (status, deliver_after)
    WHERE status = 'pending';
