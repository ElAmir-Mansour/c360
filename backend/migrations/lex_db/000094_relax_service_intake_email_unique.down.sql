-- Roll back the intake_email uniqueness relaxation: drop the non-unique lookup
-- index and restore the original UNIQUE index exactly as defined in 000022. NOTE:
-- this fails if the catalogue currently holds two active services that share a
-- bare intake_email (the shared-mailbox rows the up migration enables); those must
-- be de-duplicated before rolling back.

DROP INDEX IF EXISTS idx_legal_service_catalog_intake_email;

CREATE UNIQUE INDEX IF NOT EXISTS idx_legal_service_catalog_intake_email_unique
    ON legal_service_catalog (tenant_id, lower(intake_email))
    WHERE intake_email IS NOT NULL AND deleted_at IS NULL;
