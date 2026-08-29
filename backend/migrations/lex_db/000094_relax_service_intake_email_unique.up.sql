-- Relax the per-service intake_email uniqueness (Al Othaim PRD Service Catalog).
--
-- The PRD publishes SHARED departmental intake mailbox addresses across services:
-- case-legal@othaim.com is the intake email for five services and
-- contract-legal@othaim.com for two, with inbound email routed to the correct
-- service by classification. The original 000022 UNIQUE index on
-- (tenant_id, lower(intake_email)) forbade two services from advertising the same
-- bare intake address, which blocks that model. This drops the UNIQUE index and
-- replaces it with a plain (non-unique) lookup index, so several services can
-- share one bare intake address. The admin Service Catalog conflict detector
-- credits a service as email-wired when service.intake_email == mailbox.address,
-- so a single bare mailbox at the shared address serves all of its services.
--
-- Purely a constraint relaxation + index swap; no row data changes. Fully
-- reversible — the down migration recreates the original unique index verbatim.

DROP INDEX IF EXISTS idx_legal_service_catalog_intake_email_unique;

CREATE INDEX IF NOT EXISTS idx_legal_service_catalog_intake_email
    ON legal_service_catalog (tenant_id, lower(intake_email))
    WHERE intake_email IS NOT NULL;
