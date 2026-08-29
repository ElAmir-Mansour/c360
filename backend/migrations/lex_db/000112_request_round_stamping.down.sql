-- Reverse 000112. Round grouping collapses back to a flat thread; no content is
-- lost, only the round each item belonged to.

DROP INDEX IF EXISTS idx_legal_request_attachments_round;
DROP INDEX IF EXISTS idx_legal_request_notes_round;

ALTER TABLE legal_request_attachments DROP CONSTRAINT IF EXISTS ck_legal_request_attachments_cycle;
ALTER TABLE legal_request_attachments DROP COLUMN IF EXISTS cycle;

ALTER TABLE legal_request_notes DROP CONSTRAINT IF EXISTS ck_legal_request_notes_cycle;
ALTER TABLE legal_request_notes DROP COLUMN IF EXISTS cycle;

ALTER TABLE legal_requests DROP CONSTRAINT IF EXISTS ck_legal_requests_cycle;
ALTER TABLE legal_requests DROP COLUMN IF EXISTS cycle;
