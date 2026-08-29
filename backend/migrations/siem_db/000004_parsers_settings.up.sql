-- SIEM-04 — parser catalogue and tenant SIEM settings.

CREATE TABLE IF NOT EXISTS siem.parsers (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID        NOT NULL,
  name            TEXT        NOT NULL
                  CHECK (name ~ '^[a-z0-9][a-z0-9-]{2,63}$'),
  source_type     TEXT        NOT NULL
                  CHECK (length(source_type) BETWEEN 2 AND 96),
  parser_version  TEXT        NOT NULL
                  CHECK (parser_version ~ '^[0-9]+(\.[0-9]+){0,2}([-+][A-Za-z0-9.-]+)?$'),
  status          TEXT        NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft','active','retired')),
  ecs_version     TEXT        NOT NULL DEFAULT '8.11',
  config          JSONB       NOT NULL DEFAULT '{}'::jsonb,
  fixtures        JSONB       NOT NULL DEFAULT '[]'::jsonb,
  sha256          CHAR(64)    NOT NULL
                  CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  created_by      UUID        NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  retired_at      TIMESTAMPTZ NULL,

  CONSTRAINT parsers_tenant_name_version_unique
    UNIQUE (tenant_id, name, parser_version),
  CONSTRAINT parsers_id_tenant_unique
    UNIQUE (id, tenant_id)
);

CREATE INDEX IF NOT EXISTS parsers_tenant_status_idx
  ON siem.parsers (tenant_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS parsers_source_type_idx
  ON siem.parsers (tenant_id, source_type);

DO $$
BEGIN
  ALTER TABLE siem.sources
    ADD CONSTRAINT sources_parser_fk
    FOREIGN KEY (parser_id)
    REFERENCES siem.parsers(id)
    ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS siem.settings (
  tenant_id          UUID        PRIMARY KEY,
  retention_days     INTEGER     NOT NULL DEFAULT 365
                    CHECK (retention_days BETWEEN 1 AND 3650),
  parser_ci_required BOOLEAN     NOT NULL DEFAULT true,
  hsm_required       BOOLEAN     NOT NULL DEFAULT false,
  warm_tier_days     INTEGER     NOT NULL DEFAULT 30
                    CHECK (warm_tier_days >= 0),
  cold_tier_enabled  BOOLEAN     NOT NULL DEFAULT true,
  updated_by         UUID        NULL,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT settings_warm_within_retention
    CHECK (warm_tier_days <= retention_days)
);
