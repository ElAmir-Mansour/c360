-- Register the two governed LLM model slugs used by ClarioLex hybrid analysis:
--   * lex-clause-extractor-llm    (LLM-enriched clause/entity/finding extraction)
--   * lex-obligation-extractor-llm (LLM-enriched obligation extraction)
--
-- These are registered for EVERY tenant (per the platform rule that seeded
-- governance models are available to all tenants), so AI governance can resolve
-- and audit each call per-tenant. SAFE BY DEFAULT: the enricher itself is gated
-- behind the LEX_LLM_ENRICHMENT_ENABLED service flag (default false). Until that
-- flag is enabled, the deterministic analyzer runs and these models receive no
-- predictions. Per-tenant quota/entitlement remains the governance authority at
-- request time; metadata marks these as requiring the explicit lex LLM flag.

DO $$
DECLARE
  v_rec   RECORD;
  v_actor UUID := 'aaaaaaaa-0000-0000-0000-aaaaaaaaaaaa';  -- system actor
BEGIN
  FOR v_rec IN SELECT id FROM tenants LOOP
    PERFORM set_config('app.current_tenant_id', v_rec.id::text, true);

    -- ── Models ──────────────────────────────────────────────────────────

    INSERT INTO ai_models (tenant_id, name, slug, description, model_type, suite, owner_team, risk_tier, status, tags, metadata, created_by)
    VALUES
      (v_rec.id, 'Contract Clause Extractor (LLM)',   'lex-clause-extractor-llm',     'Governed tool-use LLM clause/entity/finding extractor that enriches the deterministic baseline.', 'llm_agentic', 'lex', 'legal-operations', 'high', 'active', ARRAY['lex','clause','extractor','llm','hybrid'],     '{"used_by":"contract_analyzer_hybrid","requires_flag":"LEX_LLM_ENRICHMENT_ENABLED","default_enabled":false}'::jsonb, v_actor),
      (v_rec.id, 'Contract Obligation Extractor (LLM)','lex-obligation-extractor-llm', 'Governed tool-use LLM obligation extractor that enriches the deterministic obligation baseline.',  'llm_agentic', 'lex', 'legal-operations', 'high', 'active', ARRAY['lex','obligation','extractor','llm','hybrid'], '{"used_by":"obligation_extractor_hybrid","requires_flag":"LEX_LLM_ENRICHMENT_ENABLED","default_enabled":false}'::jsonb, v_actor)
    ON CONFLICT (tenant_id, slug) WHERE deleted_at IS NULL DO NOTHING;

    -- ── Production Versions ─────────────────────────────────────────────

    INSERT INTO ai_model_versions (tenant_id, model_id, version_number, status, description, artifact_type, artifact_config, artifact_hash, explainability_type, training_metrics, created_by, promoted_to_production_at, promoted_by)
    SELECT v_rec.id, m.id, 1, 'production', 'Initial governed LLM version (claude-opus-4-8, tool-use)',
           v.artifact_type, v.artifact_config, v.artifact_hash, v.explainability_type,
           '{}'::jsonb, v_actor, NOW(), v_actor
    FROM (VALUES
      ('lex-clause-extractor-llm',     'template_config', '{"model":"claude-opus-4-8","extraction":"tool_use","tool":"emit_clause_analysis","hybrid":true,"sampling_params":false}'::jsonb, 'seed-clause-llm-v1',     'reasoning_trace'),
      ('lex-obligation-extractor-llm', 'template_config', '{"model":"claude-opus-4-8","extraction":"tool_use","tool":"emit_obligations","hybrid":true,"sampling_params":false}'::jsonb,    'seed-obligation-llm-v1', 'reasoning_trace')
    ) AS v(slug, artifact_type, artifact_config, artifact_hash, explainability_type)
    JOIN ai_models m ON m.tenant_id = v_rec.id AND m.slug = v.slug AND m.deleted_at IS NULL
    WHERE NOT EXISTS (
      SELECT 1 FROM ai_model_versions mv WHERE mv.model_id = m.id AND mv.version_number = 1
    );

  END LOOP;
END $$;
