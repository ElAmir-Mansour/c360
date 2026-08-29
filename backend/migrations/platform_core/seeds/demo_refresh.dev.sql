-- =============================================================================
-- Clario360 platform_core demo refresh — platform_core (DEV ONLY, idempotent)
--
-- This is a DEV SEED, not an auto-run migration. It is NOT numbered into the
-- migration chain and is never applied by the central migrator. Run it by hand
-- against the dev Postgres only.
--
-- Goal: make the ADMIN surfaces (served by iam-service, which hardcodes the
-- platform_core DSN) look FULL + CURRENT for the demo tenant:
--   /  + dashboard bell        (notifications: 24h / 30d windows + unread badge)
--   /admin/ai-governance       (models, benchmark suites/runs, inference
--                               servers, compute cost models, drift)
--
-- Tenant:  aaaaaaaa-0000-0000-0000-000000000001  (Apex Bank Holdings == clario-dev)
-- Owner/created_by:
--   bbbbbbbb-0000-0000-0000-000000000001  (admin@apexbank.demo)
--
-- -----------------------------------------------------------------------------
-- WORM / hash-chain SAFETY — audit is SKIPPED ENTIRELY
-- -----------------------------------------------------------------------------
-- platform_core contains audit_logs (partitioned) with entry_hash / prev_hash
-- style chaining. Per the task contract this seed does NOT touch any audit_*
-- table, event_outbox, or any hash-chained/WORM table. It only writes
-- notifications and the ai_governance management tables, none of which are
-- immutable/append-only-chained.
--
-- -----------------------------------------------------------------------------
-- TIMESTAMP REFRESH (notifications only)
-- -----------------------------------------------------------------------------
-- The notifications table holds 5000 demo rows for this tenant spread across a
-- ~3.5-day window that ENDED at 2026-03-04 (110+ days stale at authoring time),
-- so every 24h/30d notification chart and the unread bell read empty. We
-- compute ONE uniform delta = (now() - max(created_at)) over THIS tenant's
-- notifications and shift created_at + read_at forward by that SAME delta. A
-- uniform shift preserves the relative spacing of the 5000 rows and their
-- read/unread mix, so the newest rows land at ~now and the series fills the
-- recent 24h/30d windows. The shift is idempotent in effect: re-running brings
-- the (already-current) newest back to ~now with a near-zero additional delta.
--
-- The ai_governance time-series that a live background writer keeps current
-- (ai_prediction_logs, ai_drift_reports, ai_shadow_comparisons — newest rows
-- were seconds/minutes old at authoring time) are DELIBERATELY NOT shifted:
-- they are already current and shifting would corrupt them against the live
-- writer. We only fill the THIN, STALE management tables below.
--
-- Idempotent: notification shift is guarded to a no-op once newest ~= now;
-- every INSERT carries a fixed UUID + ON CONFLICT DO NOTHING / DO UPDATE.
--
-- Run:
--   docker exec -i clario360-postgres psql -U clario -d platform_core \
--     < backend/migrations/platform_core/seeds/demo_refresh.dev.sql
-- =============================================================================

BEGIN;

\set tenant '''aaaaaaaa-0000-0000-0000-000000000001'''
\set owner  '''bbbbbbbb-0000-0000-0000-000000000001'''

-- -----------------------------------------------------------------------------
-- 1) NOTIFICATIONS — uniform forward shift so newest lands at ~now.
--    Guarded: only shift when the newest row is more than 1 hour stale, so
--    re-running this seed is a near no-op (idempotent in effect).
-- -----------------------------------------------------------------------------
DO $$
DECLARE
    v_tenant  uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
    v_max     timestamptz;
    v_delta   interval;
BEGIN
    SELECT max(created_at) INTO v_max
    FROM notifications
    WHERE tenant_id = v_tenant;

    IF v_max IS NULL THEN
        RAISE NOTICE 'notifications: no rows for tenant; skipping shift';
        RETURN;
    END IF;

    v_delta := now() - v_max;

    IF v_delta < interval '1 hour' THEN
        RAISE NOTICE 'notifications: newest already current (delta=%); skipping', v_delta;
        RETURN;
    END IF;

    UPDATE notifications
    SET created_at = created_at + v_delta,
        read_at    = CASE WHEN read_at IS NOT NULL THEN read_at + v_delta ELSE NULL END
    WHERE tenant_id = v_tenant;

    RAISE NOTICE 'notifications: shifted % rows by %',
        (SELECT count(*) FROM notifications WHERE tenant_id = v_tenant), v_delta;
END $$;

-- -----------------------------------------------------------------------------
-- 2) AI GOVERNANCE — inference servers (thin: 2 rows, stale created_at).
--    Add 2 more healthy servers and refresh updated_at to recent.
--    Backend types mirror the existing rows (vllm_gpu / onnx_cpu) + a
--    triton_gpu and a llamacpp_cpu so the list shows backend variety.
-- -----------------------------------------------------------------------------
INSERT INTO ai_inference_servers
    (id, tenant_id, name, backend_type, base_url, health_endpoint, model_name,
     quantization, status, cpu_cores, memory_mb, gpu_type, gpu_count,
     max_concurrent, stream_capable, metadata, created_at, updated_at)
VALUES
    ('a1100001-0000-4000-8000-000000000001', :tenant,
     'Riyadh GPU LLM Inference', 'vllm_gpu', 'http://llm-riyadh.internal:8000',
     '/health', 'vciso-llm-prod', 'awq-int4', 'healthy',
     16, 65536, 'A100-40GB', 2, 8, true,
     '{"region":"me-central-1","tier":"production"}'::jsonb,
     now() - interval '64 days', now() - interval '6 minutes'),
    ('a1100001-0000-4000-8000-000000000002', :tenant,
     'Riyadh Triton Ensemble', 'triton_gpu', 'http://triton-riyadh.internal:8001',
     '/v2/health/ready', 'predictive-cyber-ensemble', 'fp16', 'healthy',
     12, 49152, 'L4-24GB', 1, 6, true,
     '{"region":"me-central-1","tier":"staging"}'::jsonb,
     now() - interval '41 days', now() - interval '3 minutes')
ON CONFLICT (id) DO UPDATE
    SET status = EXCLUDED.status,
        updated_at = EXCLUDED.updated_at;

-- Refresh the two PRE-EXISTING servers' updated_at so they look freshly checked.
UPDATE ai_inference_servers
SET updated_at = now() - interval '8 minutes'
WHERE tenant_id = :tenant
  AND id IN ('d84484c0-aaa9-5065-b679-81187974be2d',
             '883db830-e29f-5e75-b947-06874c3f0819');

-- -----------------------------------------------------------------------------
-- 3) AI GOVERNANCE — compute cost models (thin: 2 rows). Add 3 more so the
--    cost comparison view has a healthy spread of instance types/prices.
-- -----------------------------------------------------------------------------
INSERT INTO ai_compute_cost_models
    (id, tenant_id, name, backend_type, instance_type, hourly_cost_usd,
     cpu_cores, memory_gb, gpu_type, gpu_count, max_tokens_per_second, notes,
     created_at)
VALUES
    ('a1200001-0000-4000-8000-000000000001', :tenant, 'A100 vLLM (prod)',
     'vllm_gpu', 'gpu.a100.2x', 7.20, 16, 64, 'A100-40GB', 2, 4200,
     'Production LLM serving, AWQ int4', now() - interval '60 days'),
    ('a1200001-0000-4000-8000-000000000002', :tenant, 'L4 Triton (staging)',
     'triton_gpu', 'gpu.l4.1x', 1.35, 12, 48, 'L4-24GB', 1, 1900,
     'Ensemble predictive scoring', now() - interval '45 days'),
    ('a1200001-0000-4000-8000-000000000003', :tenant, 'CPU ONNX (batch)',
     'onnx_cpu', 'cpu.c6i.4xlarge', 0.68, 16, 32, NULL, 0, 620,
     'Off-peak batch scoring, no GPU', now() - interval '30 days')
ON CONFLICT (id) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 4) AI GOVERNANCE — benchmark suites (thin: 2 rows, ~88d stale). Add 2 more
--    and refresh updated_at so the suite list reads current.
-- -----------------------------------------------------------------------------
INSERT INTO ai_benchmark_suites
    (id, tenant_id, name, description, model_slug, prompt_dataset, dataset_size,
     warmup_count, iteration_count, concurrency, timeout_seconds, stream_enabled,
     max_retries, created_by, created_at, updated_at)
VALUES
    ('a1300001-0000-4000-8000-000000000001', :tenant,
     'Contract Clause Extraction Benchmark',
     'Latency + quality benchmark for the Lex contract clause extractor LLM.',
     'lex-clause-extractor',
     '[{"prompt":"Extract all indemnification clauses"},{"prompt":"List termination triggers"}]'::jsonb,
     2, 5, 100, 2, 60, true, 3, :owner,
     now() - interval '21 days', now() - interval '2 days'),
    ('a1300001-0000-4000-8000-000000000002', :tenant,
     'Meeting Minutes Summarization Benchmark',
     'Throughput + ROUGE/BLEU benchmark for the Acta minutes generator.',
     'acta-minutes-generator',
     '[{"prompt":"Summarize Q2 board meeting"},{"prompt":"Extract action items"}]'::jsonb,
     2, 5, 120, 1, 90, true, 3, :owner,
     now() - interval '14 days', now() - interval '1 day')
ON CONFLICT (id) DO NOTHING;

-- Refresh PRE-EXISTING suites' updated_at.
UPDATE ai_benchmark_suites
SET updated_at = now() - interval '3 days'
WHERE tenant_id = :tenant
  AND id IN ('0bc3c088-4ae2-5762-9728-c7d953fea337',
             '13d4d4c6-bc04-55b7-9cc1-952d036cc265');

-- -----------------------------------------------------------------------------
-- 5) AI GOVERNANCE — benchmark runs (thin: 2 rows, ~88d stale). Seed a recent
--    spread of completed runs across the last 14 days for ALL four suites so
--    the runs list + latency/throughput charts have multiple recent buckets.
--    FKs: suite_id -> ai_benchmark_suites, server_id -> ai_inference_servers.
-- -----------------------------------------------------------------------------
INSERT INTO ai_benchmark_runs
    (id, tenant_id, suite_id, server_id, backend_type, model_name, quantization,
     status, stream_used, p50_latency_ms, p95_latency_ms, p99_latency_ms,
     avg_latency_ms, min_latency_ms, max_latency_ms, tokens_per_second,
     requests_per_second, total_tokens, total_requests, failed_requests,
     retried_requests, p50_ttft_ms, p95_ttft_ms, avg_ttft_ms, avg_perplexity,
     bleu_score, rouge_l_score, semantic_similarity, factual_accuracy,
     peak_cpu_percent, peak_memory_mb, avg_cpu_percent, avg_memory_mb,
     estimated_hourly_cost_usd, cost_per_1k_tokens_usd, started_at, completed_at,
     duration_seconds, raw_results, created_by, created_at)
SELECT
    ('a1400001-0000-4000-8000-0000000000' || lpad(g::text, 2, '0'))::uuid,
    :tenant,
    (ARRAY[
        '0bc3c088-4ae2-5762-9728-c7d953fea337'::uuid,
        '13d4d4c6-bc04-55b7-9cc1-952d036cc265'::uuid,
        'a1300001-0000-4000-8000-000000000001'::uuid,
        'a1300001-0000-4000-8000-000000000002'::uuid
    ])[1 + (g % 4)],
    (ARRAY[
        'd84484c0-aaa9-5065-b679-81187974be2d'::uuid,
        'a1100001-0000-4000-8000-000000000001'::uuid,
        'a1100001-0000-4000-8000-000000000002'::uuid
    ])[1 + (g % 3)],
    (ARRAY['vllm_gpu','vllm_gpu','triton_gpu'])[1 + (g % 3)],
    (ARRAY['vciso-llm-prod','lex-clause-extractor','acta-minutes-generator','predictive-cyber-ensemble'])[1 + (g % 4)],
    (ARRAY['awq-int4','fp16','int8'])[1 + (g % 3)],
    'completed', true,
    38 + (g % 7) * 4,                 -- p50
    95 + (g % 9) * 6,                 -- p95
    140 + (g % 9) * 9,                -- p99
    52 + (g % 7) * 4,                 -- avg
    21 + (g % 5),                     -- min
    260 + (g % 11) * 12,              -- max
    1850 + (g % 13) * 95,             -- tps
    14.0 + (g % 7),                   -- rps
    (120000 + (g % 17) * 7000)::bigint,
    100 + (g % 5) * 10,
    (g % 4),                          -- failed
    (g % 3),                          -- retried
    61 + (g % 6) * 5,                 -- p50 ttft
    130 + (g % 8) * 9,                -- p95 ttft
    78 + (g % 6) * 5,                 -- avg ttft
    3.1 + (g % 5) * 0.2,              -- perplexity
    0.42 + (g % 9) * 0.03,            -- bleu
    0.51 + (g % 9) * 0.03,            -- rouge-l
    0.83 + (g % 6) * 0.02,            -- semantic sim
    0.88 + (g % 5) * 0.02,            -- factual acc
    72.0 + (g % 9) * 2,               -- peak cpu
    14000 + (g % 11) * 800,           -- peak mem
    48.0 + (g % 7) * 2,               -- avg cpu
    9800 + (g % 11) * 600,            -- avg mem
    (ARRAY[7.20,1.35,7.20])[1 + (g % 3)],
    0.0011 + (g % 5) * 0.0003,
    now() - ((14 - (g % 14)) * interval '1 day') - interval '35 minutes',
    now() - ((14 - (g % 14)) * interval '1 day') - interval '8 minutes',
    1500 + (g % 9) * 120,
    '[]'::jsonb, :owner,
    now() - ((14 - (g % 14)) * interval '1 day') - interval '40 minutes'
FROM generate_series(1, 24) AS g
ON CONFLICT (id) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 6) SSO / EXTERNAL IdP — demo tenant IdP connection (Othaim PRD 12.0, WTQ-INT-04).
--    Purpose: make "Sign in with SSO" SELECTABLE at /login for the Al-Othaim
--    demo tenant. Login discovery (GET /api/v1/auth/sso/discover?domain=…) keys
--    on email_domain; without a row it returns {provider:null} and the CTA never
--    renders. This seeds ONE enabled OIDC connection mapped to 'othaim.com'.
--
--    Placeholder endpoints: the button appears and /login/initiate builds a real
--    authorize redirect, but the callback token-exchange only completes once a
--    reachable demo/real IdP is wired. Override the endpoints at run time, e.g.:
--      psql ... -v demo_sso_issuer="https://keycloak.dev/realms/othaim" \
--               -v demo_sso_authorize="https://keycloak.dev/realms/othaim/protocol/openid-connect/auth" \
--               -v demo_sso_token="https://keycloak.dev/realms/othaim/protocol/openid-connect/token" \
--               -v demo_sso_jwks="https://keycloak.dev/realms/othaim/protocol/openid-connect/certs" \
--               -v demo_sso_domain="othaim.com"
--
--    RLS: idp_connections is FORCE ROW LEVEL SECURITY, so the INSERT ... WITH
--    CHECK (tenant_id = app.current_tenant_id) requires the GUC to be set. We
--    SET LOCAL it for this transaction (harmless: it is the last statement
--    before COMMIT). Idempotent via ON CONFLICT (tenant_id, provider) DO NOTHING.
-- -----------------------------------------------------------------------------
\if :{?demo_sso_issuer}    \else \set demo_sso_issuer    'https://sso.othaim.demo/realms/othaim' \endif
\if :{?demo_sso_authorize} \else \set demo_sso_authorize 'https://sso.othaim.demo/realms/othaim/protocol/openid-connect/auth' \endif
\if :{?demo_sso_token}     \else \set demo_sso_token     'https://sso.othaim.demo/realms/othaim/protocol/openid-connect/token' \endif
\if :{?demo_sso_jwks}      \else \set demo_sso_jwks      'https://sso.othaim.demo/realms/othaim/protocol/openid-connect/certs' \endif
\if :{?demo_sso_domain}    \else \set demo_sso_domain    'othaim.com' \endif

SET LOCAL app.current_tenant_id = :tenant;

INSERT INTO idp_connections (
    tenant_id, provider, display_name, kind, enabled,
    issuer, authorize_url, token_url, jwks_url,
    email_domain, scopes, default_role_slug, allow_jit_provisioning
)
SELECT
    :tenant, 'othaim-sso', 'Othaim Corporate SSO', 'oidc', true,
    :'demo_sso_issuer', :'demo_sso_authorize', :'demo_sso_token', :'demo_sso_jwks',
    :'demo_sso_domain', ARRAY['openid','profile','email'], 'viewer', true
WHERE EXISTS (SELECT 1 FROM tenants WHERE id = :tenant)
ON CONFLICT (tenant_id, provider) DO NOTHING;

COMMIT;

-- -----------------------------------------------------------------------------
-- Teardown (reversible — run manually to remove ONLY the demo SSO connection):
--   BEGIN;
--     SET LOCAL app.current_tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001';
--     DELETE FROM idp_connections
--      WHERE tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001'
--        AND provider  = 'othaim-sso';
--   COMMIT;
-- -----------------------------------------------------------------------------

-- =============================================================================
-- Post-conditions (informational — run manually to verify):
--   SELECT count(*) FILTER (WHERE created_at > now()-interval '24 hours') AS d1,
--          count(*) FILTER (WHERE created_at > now()-interval '30 days')  AS d30,
--          count(*) FILTER (WHERE read_at IS NULL)                        AS unread
--   FROM notifications WHERE tenant_id='aaaaaaaa-0000-0000-0000-000000000001';
--   SELECT count(*) FROM ai_inference_servers WHERE tenant_id='aaaaaaaa-...';   -- 4
--   SELECT count(*) FROM ai_compute_cost_models WHERE tenant_id='aaaaaaaa-...'; -- 5
--   SELECT count(*) FROM ai_benchmark_suites WHERE tenant_id='aaaaaaaa-...';    -- 4
--   SELECT count(*) FROM ai_benchmark_runs WHERE tenant_id='aaaaaaaa-...';      -- 26
-- =============================================================================
