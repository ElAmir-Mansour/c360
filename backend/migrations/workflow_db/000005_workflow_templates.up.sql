-- =============================================================================
-- WS-1 — Data-driven workflow template catalog (Workflow_Module_Design §1.3).
--
-- Until now the template library was 5 templates hard-coded in Go
-- (internal/workflow/service/template_service.buildTemplates()). This migration
-- introduces a generic, engine-owned catalog table so templates become DATA, not
-- code — the legal pack (and any future Cyber/Acta pack) ships as versioned seed
-- rows loaded into this table rather than a code change + rebuild + redeploy.
--
-- Decision D-WF-2 (storage): one GENERIC workflow_db.workflow_templates table
-- (engine-owned, reusable by every suite), NOT a lex-only lex_db table. A row
-- with tenant_id IS NULL is a GLOBAL template visible to every tenant; a non-null
-- tenant_id scopes a template to a single tenant's private catalog.
--
-- RLS NOTE: like the original workflow_* tables in 000001, the template
-- repository filters by tenant_id in SQL and is NOT RunWithTenant-aware (it must
-- read both the global tenant_id IS NULL rows and the caller's own rows in one
-- query). We therefore intentionally do NOT FORCE Row-Level Security on this
-- table — matching the 000001 convention. Every statement is idempotent.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- Workflow Templates (catalog)
-- ============================================================
CREATE TABLE IF NOT EXISTS workflow_templates (
    -- id is a stable, human-readable slug (e.g. "tmpl-legal-request-intake"), so
    -- the catalog can be referenced from seed data and the admin UI by a known
    -- key. It is the primary key (TEXT, not UUID) by design.
    id              TEXT        PRIMARY KEY,
    -- tenant_id NULL == a GLOBAL template available to every tenant; a non-null
    -- value scopes the template to one tenant's private catalog.
    tenant_id       UUID,
    -- bilingual display strings: {"ar": "...", "en": "..."}.
    name_i18n       JSONB       NOT NULL DEFAULT '{}',
    description_i18n JSONB      NOT NULL DEFAULT '{}',
    category        TEXT        NOT NULL DEFAULT '',
    -- tags: JSON array of free-form labels (e.g. ["legal","intake","ksa"]).
    tags            JSONB       NOT NULL DEFAULT '[]',
    icon            TEXT        NOT NULL DEFAULT '',
    -- definition_json: a full WorkflowDefinition blueprint (trigger_config +
    -- variables + steps + transitions) the seeder instantiates per tenant.
    definition_json JSONB       NOT NULL DEFAULT '{}',
    version         INT         NOT NULL DEFAULT 1,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A placeholder workflow_templates table (name/description columns, no i18n) may
-- already exist from the in-service bootstrap (repository.SchemaSQL) on an older
-- deployment. The CREATE above is a no-op there, so additively reconcile the
-- catalog columns. Idempotent: re-applies cleanly on a fresh table too.
ALTER TABLE workflow_templates ADD COLUMN IF NOT EXISTS tenant_id        UUID;
ALTER TABLE workflow_templates ADD COLUMN IF NOT EXISTS name_i18n        JSONB       NOT NULL DEFAULT '{}';
ALTER TABLE workflow_templates ADD COLUMN IF NOT EXISTS description_i18n JSONB       NOT NULL DEFAULT '{}';
ALTER TABLE workflow_templates ADD COLUMN IF NOT EXISTS tags             JSONB       NOT NULL DEFAULT '[]';
ALTER TABLE workflow_templates ADD COLUMN IF NOT EXISTS version          INT         NOT NULL DEFAULT 1;
ALTER TABLE workflow_templates ADD COLUMN IF NOT EXISTS updated_at       TIMESTAMPTZ NOT NULL DEFAULT now();
-- The legacy name/description columns (if present) are no longer written by the
-- repository; relax their NOT NULL so i18n-only upserts succeed. Guarded so the
-- migration also applies on a fresh table that never had these columns.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'workflow_templates' AND column_name = 'name'
    ) THEN
        ALTER TABLE workflow_templates ALTER COLUMN name DROP NOT NULL;
    END IF;
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'workflow_templates' AND column_name = 'description'
    ) THEN
        ALTER TABLE workflow_templates ALTER COLUMN description DROP NOT NULL;
    END IF;
END
$$;

-- Browse-by-category is the primary catalog access pattern in the admin UI.
CREATE INDEX IF NOT EXISTS idx_workflow_templates_category
    ON workflow_templates (category);

-- Resolve a tenant's visible catalog (its own rows + globals) quickly. A partial
-- index on the global rows keeps the common "list all globals" scan tight.
CREATE INDEX IF NOT EXISTS idx_workflow_templates_tenant
    ON workflow_templates (tenant_id);

CREATE INDEX IF NOT EXISTS idx_workflow_templates_global
    ON workflow_templates (category)
    WHERE tenant_id IS NULL;
