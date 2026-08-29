-- =============================================================================
-- Seed pricing_config version 1 (ACTIVE) from the spreadsheet's FORMULAS block
-- (Enterprise_Pricing_Calculator_2.xlsx). This is the exact JSON produced by
-- pricing/model.DefaultConfig(); the engine's golden-vector tests run against
-- the same values, so a fresh database has an active config that reproduces the
-- spreadsheet to < 0.01 SAR.
--
-- Idempotent: ON CONFLICT (version) DO NOTHING. A fresh DB gets exactly one
-- active version; a re-run is a no-op and never creates a second active row
-- (which the partial unique index would reject anyway).
-- =============================================================================

INSERT INTO pricing_config (version, status, payload, currency, notes, created_by)
VALUES (
    1,
    'active',
    '{"fx_usd_to_sar":3.75,"vat_rate":0.15,"markup_multiplier":1.3,"sales_discount_default":0,"annual_commit_discount":0.1,"annual_commit_min_months":12,"min_margin_floor":0.1,"tier_resource_factor":{"standard":1,"growth":1.15,"professional":1.35,"customized":1.6},"ai_cost_per_1m_tokens":3,"ai_allowance_millions":{"standard":2,"growth":5,"professional":10},"ai_dedicated_cost":500,"storage_hot_usd_per_gb":5,"storage_cold_usd_per_gb":1,"storage_volume_factor_saas":0.8,"storage_volume_factor_local":0.5,"deployment_setup_flat":500,"airgap_high_security_multiplier":1.4,"per_user":{"compute":4,"licensing":3,"support":2.5,"security":1.5,"overhead":2},"per_core":{"compute":20,"licensing":8,"support":6,"security":4,"overhead":2,"cost_per_vm":100},"volume_breakpoints":[{"min_units":0,"discount":0},{"min_units":25,"discount":0.05},{"min_units":100,"discount":0.1},{"min_units":250,"discount":0.15}]}'::jsonb,
    'SAR',
    'Seed v1 from Enterprise_Pricing_Calculator_2.xlsx FORMULAS block (per-user & per-core defaults).',
    ''
)
ON CONFLICT (version) DO NOTHING;
