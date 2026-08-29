-- Reverse the Execution-Rules engine (CAP-022..CAP-029). Drop children before
-- parents (outbox + audit + confirmations reference the state/confirmation rows
-- and the request spine). RLS policies drop with their tables.
DROP TABLE IF EXISTS legal_request_execution_audit_log;
DROP TABLE IF EXISTS legal_request_delivery_confirmation_outbox;
DROP TABLE IF EXISTS legal_request_delivery_confirmation;
DROP TABLE IF EXISTS legal_request_review_round;
DROP TABLE IF EXISTS legal_request_requirement_item;
DROP TABLE IF EXISTS legal_request_execution_state;
