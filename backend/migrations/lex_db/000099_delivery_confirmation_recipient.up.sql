-- Persist the actor who is allowed to confirm or deny a delivered legal request.
-- Existing confirmations predate explicit recipient ownership, so their owning
-- request's requester is the only safe backfill.
ALTER TABLE legal_request_delivery_confirmation
    ADD COLUMN IF NOT EXISTS recipient_user_id UUID;

UPDATE legal_request_delivery_confirmation dc
SET recipient_user_id = lr.requester_user_id
FROM legal_requests lr
WHERE lr.tenant_id = dc.tenant_id
  AND lr.id = dc.legal_request_id
  AND dc.recipient_user_id IS NULL;

ALTER TABLE legal_request_delivery_confirmation
    ALTER COLUMN recipient_user_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_delivery_confirmation_recipient_open
    ON legal_request_delivery_confirmation (tenant_id, recipient_user_id, status)
    WHERE status = 'requested';
