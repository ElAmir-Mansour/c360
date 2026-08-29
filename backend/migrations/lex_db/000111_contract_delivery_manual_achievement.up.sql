-- Contract requests remain open after delivery while a contracts operator
-- marks the legal work achieved and until the requester submits final delivery
-- notes and performs the final close.

ALTER TABLE legal_request_delivery_confirmation
    DROP CONSTRAINT IF EXISTS legal_request_delivery_confirmation_status_check;

ALTER TABLE legal_request_delivery_confirmation
    ADD CONSTRAINT legal_request_delivery_confirmation_status_check
    CHECK (status IN (
        'requested', 'confirmed', 'achieved', 'denied', 'expired'
    ));

ALTER TABLE legal_request_delivery_confirmation
    ALTER COLUMN auto_close_at DROP NOT NULL;

DROP INDEX IF EXISTS idx_legal_request_delivery_confirmation_open_unique;
CREATE UNIQUE INDEX idx_legal_request_delivery_confirmation_open_unique
    ON legal_request_delivery_confirmation (tenant_id, legal_request_id)
    WHERE status IN ('requested', 'achieved');

DROP INDEX IF EXISTS idx_legal_request_delivery_confirmation_autoclose;
CREATE INDEX idx_legal_request_delivery_confirmation_autoclose
    ON legal_request_delivery_confirmation (tenant_id, auto_close_at)
    WHERE status = 'requested' AND auto_close_at IS NOT NULL;
