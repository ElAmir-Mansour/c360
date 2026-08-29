-- Reverse 000005.

-- --- #10 ----------------------------------------------------------------------
DROP INDEX IF EXISTS idx_delivery_deferred;
ALTER TABLE notification_delivery_log DROP COLUMN IF EXISTS deliver_after;

-- --- #6 -----------------------------------------------------------------------
DROP INDEX IF EXISTS idx_delivery_retry_due;
ALTER TABLE notification_delivery_log DROP COLUMN IF EXISTS max_retries;

-- Restore the original status CHECK (without 'retrying').
ALTER TABLE notification_delivery_log DROP CONSTRAINT IF EXISTS notification_delivery_log_status_check;
ALTER TABLE notification_delivery_log
    ADD CONSTRAINT notification_delivery_log_status_check
    CHECK (status IN ('pending', 'delivered', 'failed', 'skipped'));

-- --- #3 -----------------------------------------------------------------------
DROP INDEX IF EXISTS idx_delivery_tenant_status;
ALTER TABLE notification_delivery_log DROP COLUMN IF EXISTS tenant_id;

-- --- #9: restore the legacy dedup key (without type) --------------------------
DROP INDEX IF EXISTS idx_notif_dedup;
CREATE UNIQUE INDEX idx_notif_dedup
    ON notifications (tenant_id, user_id, source_event_id)
    WHERE source_event_id IS NOT NULL;
