ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_category_check;

ALTER TABLE notifications
    ADD CONSTRAINT notifications_category_check
    CHECK (category IN ('security', 'data', 'governance', 'legal', 'system', 'workflow'));
