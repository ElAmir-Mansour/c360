DROP INDEX IF EXISTS idx_delivery_confirmation_recipient_open;

ALTER TABLE legal_request_delivery_confirmation
    DROP COLUMN IF EXISTS recipient_user_id;
