-- Reverse of 000018_payload_encryption.up.sql. Drops ONLY the optional
-- governance/PDPL index and clears the documentary COMMENTs this migration added.
-- Field-level payload encryption lives entirely in the existing JSONB columns
-- (classification via the additive "sensitivity" key; ciphertext via the
-- "enc:v1:" envelope), so there is nothing else to reverse — no tables/columns
-- were added and no data was migrated. Encrypted rows remain readable by the
-- application (the codec decrypts by prefix regardless of this index/comment).
DROP INDEX IF EXISTS idx_workflow_definitions_sensitivity;
COMMENT ON COLUMN workflow_instances.variables IS NULL;
COMMENT ON COLUMN workflow_instances.step_outputs IS NULL;
