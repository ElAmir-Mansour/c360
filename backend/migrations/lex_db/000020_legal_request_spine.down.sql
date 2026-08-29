-- Reverse FK order: drop the child audit table before the parent spine.
DROP TABLE IF EXISTS legal_request_priority_changes;
DROP TABLE IF EXISTS legal_requests;
