-- Remove the governed LLM model slugs registered for ClarioLex hybrid analysis.
-- Versions are removed first (FK), then the models, for every tenant.

DO $$
DECLARE
  v_rec RECORD;
BEGIN
  FOR v_rec IN SELECT id FROM tenants LOOP
    PERFORM set_config('app.current_tenant_id', v_rec.id::text, true);

    DELETE FROM ai_model_versions mv
    USING ai_models m
    WHERE mv.model_id = m.id
      AND m.tenant_id = v_rec.id
      AND m.slug IN ('lex-clause-extractor-llm', 'lex-obligation-extractor-llm');

    DELETE FROM ai_models
    WHERE tenant_id = v_rec.id
      AND slug IN ('lex-clause-extractor-llm', 'lex-obligation-extractor-llm');

  END LOOP;
END $$;
