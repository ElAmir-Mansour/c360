-- =============================================================================
-- Clario Migrate (Wave 5, H1): allow the "migration" notification category.
--
-- The notification consumer's migrate.* rules classify wave/cutover/rollback/gate
-- notifications under Category = "migration" (model.CategoryMigration). The
-- notifications.category CHECK constraint must accept it, otherwise the insert
-- fails. This is additive: every previously-allowed category still validates.
-- =============================================================================

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_category_check;

ALTER TABLE notifications
    ADD CONSTRAINT notifications_category_check
    CHECK (category IN ('security', 'data', 'governance', 'legal', 'system', 'workflow', 'migration'));
