-- =============================================================================
-- 000006: Retention support (scheduled batched cleanup) — #16.
--
-- Wave A implements the schema side only: a supporting index for time-ordered
-- deletes on notifications. The actual DELETEs are performed by the repository
-- methods DeleteOldNotifications / DeleteOldDeliveryLogs, scheduled later
-- (Wave C/E) following the DigestService.RunScheduler pattern. Partitioning was
-- intentionally avoided to keep this migration additive (no rewrite of the
-- existing tables).
--
-- Reference cleanup shape (batched to bound lock/WAL footprint), run by the
-- scheduler — NOT executed here:
--
--   DELETE FROM notifications
--   WHERE id IN (SELECT id FROM notifications
--                WHERE read_at IS NOT NULL AND created_at < $olderThan
--                ORDER BY created_at LIMIT $batchSize);
--
--   DELETE FROM notification_delivery_log
--   WHERE id IN (SELECT id FROM notification_delivery_log
--                WHERE created_at < $olderThan
--                ORDER BY created_at LIMIT $batchSize);
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_notif_created_at
    ON notifications (created_at);

-- notification_delivery_log(created_at) is already indexed by
-- idx_delivery_tenant_date (btree on created_at, migration 000003); no new
-- index is required there for time-ordered retention scans.
