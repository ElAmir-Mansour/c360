-- =============================================================================
-- Clario 360 — extra init beyond deploy/docker/init-databases.sql
-- -----------------------------------------------------------------------------
-- The bare `clario360` database is created by the Postgres entrypoint itself
-- (POSTGRES_DB=clario360 in docker-compose.clario360.yml). audit-service and
-- workflow-engine connect to it (cfg.Database default name = clario360), and
-- workflow-engine migrates its workflow tables INTO it. The repo's
-- 01-init-databases.sql does NOT touch `clario360`, so we only need to add the
-- crypto extensions the workflow migrations rely on.
-- Runs once, on a FRESH postgres volume only.
-- =============================================================================
\c clario360;
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
