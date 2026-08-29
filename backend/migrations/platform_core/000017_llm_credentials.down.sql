-- Reverse STAGE 1 LLM credential store.
DROP TABLE IF EXISTS llm_tenant_credentials;

-- Do NOT drop siem.index_metadata or the siem schema: they are shared/idempotent
-- and another co-located component may rely on them. An empty schema is harmless.
