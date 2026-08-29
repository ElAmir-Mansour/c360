UPDATE legal_request_delivery_confirmation
SET status = CASE
        WHEN status = 'achieved' THEN 'requested'
        ELSE status
    END,
    auto_close_at = COALESCE(auto_close_at, now() + interval '24 hours');

DROP INDEX IF EXISTS idx_legal_request_delivery_confirmation_open_unique;
DROP INDEX IF EXISTS idx_legal_request_delivery_confirmation_autoclose;

ALTER TABLE legal_request_delivery_confirmation
    DROP CONSTRAINT IF EXISTS legal_request_delivery_confirmation_status_check;

ALTER TABLE legal_request_delivery_confirmation
    ALTER COLUMN auto_close_at SET NOT NULL;

ALTER TABLE legal_request_delivery_confirmation
    ADD CONSTRAINT legal_request_delivery_confirmation_status_check
    CHECK (status IN ('requested', 'confirmed', 'denied', 'expired'));

CREATE UNIQUE INDEX idx_legal_request_delivery_confirmation_open_unique
    ON legal_request_delivery_confirmation (tenant_id, legal_request_id)
    WHERE status = 'requested';

CREATE INDEX idx_legal_request_delivery_confirmation_autoclose
    ON legal_request_delivery_confirmation (tenant_id, auto_close_at)
    WHERE status = 'requested';
