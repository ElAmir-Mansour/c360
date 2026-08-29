-- =============================================================================
-- GOVERNANCE / PDPL (Phase 5 moat) — FIELD-LEVEL PAYLOAD ENCRYPTION AT REST.
--
-- Sensitive approval content (PII, confidential legal/settlement figures,
-- approval justifications) is now encrypted at rest INSIDE the existing sensitive
-- JSONB columns — workflow_instances.variables, workflow_instances.step_outputs,
-- workflow_step_executions.{input_data,output_data}, and workflow_tasks.form_data.
-- The engine holds plaintext in memory; the repository envelopes the values of
-- CLASSIFIED keys before persisting them as a self-describing "enc:v1:<base64>"
-- string (AES-256-GCM, per-value random nonce), reusing the platform field crypto
-- (internal/lex/crypto — no new cipher), and decrypts transparently on read.
--
-- CLASSIFICATION rides the EXISTING JSONB, so NO new columns/tables are needed and
-- NO data is migrated:
--   * a definition variable is classified via variables->'<name>'->>'sensitivity'
--     (VariableDef.Sensitivity), and
--   * a human-task form field is classified via a "sensitivity" tag on the field
--     inside steps (FormField.Sensitivity).
-- Values lacking the "enc:v1:" prefix are LEGACY PLAINTEXT and read unchanged, so
-- every existing row keeps working. Encryption is OPT-IN
-- (WF_PAYLOAD_ENCRYPTION_MODE=software) — with it off the columns stay plaintext
-- exactly as before.
--
-- The ONE physical change here is a purely OPTIONAL governance/PDPL PARTIAL index
-- that makes "list the definitions that classify any sensitive field" cheap (a
-- data-map / privacy-inventory query), plus documentary COMMENTs recording the
-- at-rest envelope convention on the affected columns. The index predicate matches
-- only definitions whose variables/steps JSONB text mentions the additive
-- "sensitivity" key, so it stays tiny and costs nothing for the common
-- no-classification case.
--
-- Additive, reversible, idempotent (CREATE INDEX IF NOT EXISTS; COMMENT is
-- idempotent; the down file drops only what this adds). workflow_definitions is
-- FORCE-RLS (migration 000008); the migration role must have BYPASSRLS to
-- (re)create the index, exactly as for the analytics/mining/boundary index
-- migrations. This index only speeds an operator/privacy listing; it does not
-- relax tenant isolation (queries still run tenant-scoped via repository/rls.go).
--
-- Kept in sync with repository/schema.go SchemaSQL (the same statements were added
-- there so embedding suites get the same shape).
-- =============================================================================

-- Governance/PDPL listing of definitions that classify at least one sensitive
-- field. The predicate matches only definitions whose variables OR steps JSONB
-- serialization contains the additive "sensitivity" key, restricting the index to
-- classification-carrying definitions (tiny) with no cost on the common path.
CREATE INDEX IF NOT EXISTS idx_workflow_definitions_sensitivity
    ON workflow_definitions (tenant_id, status)
    WHERE variables::text LIKE '%"sensitivity"%'
       OR steps::text LIKE '%"sensitivity"%';

-- Document the at-rest envelope convention on the affected JSONB columns. Purely
-- informational; changes no data and no behavior.
COMMENT ON COLUMN workflow_instances.variables IS
    'Instance variables (JSONB). Classified values may be stored as an "enc:v1:<base64>" AES-256-GCM envelope at rest; values without that prefix are plaintext. See internal/workflow/payloadcrypto.';
COMMENT ON COLUMN workflow_instances.step_outputs IS
    'Per-step outputs (JSONB). Classified values may be stored as an "enc:v1:<base64>" AES-256-GCM envelope at rest; values without that prefix are plaintext. See internal/workflow/payloadcrypto.';
