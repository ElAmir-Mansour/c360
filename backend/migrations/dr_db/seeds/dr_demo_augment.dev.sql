-- =============================================================================
-- ClarioDR demo seed — AUGMENTATION — dr_db (DEV ONLY, idempotent)
--
-- Companion to dr_demo.dev.sql. The base seed populates the core DR posture
-- (sites, group, streams, recovery points, failover runs, drills, topology,
-- runbooks, attestation ledger). This file fills the LONG TAIL: the list/detail/
-- chart surfaces that were still EMPTY or THIN for the "Apex Bank Holdings"
-- tenant so the /dr console has content on every page and side panel:
--
--   /dr/insights   -> predictions + per-stream samples + ransomware signals
--   /dr/rehearse   -> game-day scenarios + scored runs + step results
--   /dr/recover    -> IaC snapshots + resources, boot-plan tiers, consistency barriers
--   /dr (panels)   -> failback runs, agents, storage volumes/snapshots,
--                     workload captures, self-DR assessment + artifacts, BYOK keys
--
-- Tenant:   aaaaaaaa-0000-0000-0000-000000000001  (Apex Bank Holdings == clario-dev)
-- Operator: aaaaaaaa-0000-0000-0000-aaaaaaaaaaaa
-- Reuses the stable site/group/stream/recovery-point IDs from dr_demo.dev.sql.
--
-- TIMESTAMP POLICY: every time column is written relative to now() (now() -
-- interval / now() + interval), so the data lands at "recent" whenever the seed
-- runs and future-dated items (KEK rotation horizon, retain_until) stay in the
-- relative future. There is NO uniform-delta shift here: the base seed already
-- writes relative-to-now and (verified) its newest rows land at ~now, so a shift
-- would be a no-op. Re-run this file any time to refresh to current.
--
-- WORM / HASH-CHAIN SAFETY: this file does NOT touch any hash-chained / WORM /
-- immutable substrate. Specifically it AVOIDS:
--   * dr_attestation_ledger / dr_attestation_checkpoint  (entry_hash/prev_hash chain)
--   * dr_kek_custody_log                                 (seq/prev_hash/entry_hash chain)
--   * recovery_point sealed fields                       (immutability trigger)
-- BYOK is seeded via dr_tenant_kek (the plain key inventory the /byok/keys list
-- reads) only; the chained custody log is left to the application's rotate path.
--
-- Idempotent: every INSERT carries a fixed UUID/key with ON CONFLICT DO NOTHING
-- (or DO UPDATE where a timestamp refresh is wanted). Safe to re-run.
--
-- Run:
--   docker exec -i clario360-postgres psql -U clario -d dr_db \
--     < backend/migrations/dr_db/seeds/dr_demo_augment.dev.sql
-- =============================================================================

BEGIN;

-- Bypass RLS for the whole seeding transaction (the documented dr_db backstop).
SET LOCAL app.bypass_rls = 'on';

-- -----------------------------------------------------------------------------
-- Stable identifiers (mirroring dr_demo.dev.sql)
-- -----------------------------------------------------------------------------
\set tenant      '''aaaaaaaa-0000-0000-0000-000000000001'''
\set operator    '''aaaaaaaa-0000-0000-0000-aaaaaaaaaaaa'''

\set site_db     '''d10a0001-0000-0000-0000-000000000001'''
\set site_pay    '''d10a0001-0000-0000-0000-000000000002'''
\set site_docs   '''d10a0001-0000-0000-0000-000000000003'''

\set grp         '''d10c0001-0000-0000-0000-000000000001'''

\set str_db      '''d1570001-0000-0000-0000-000000000001'''
\set str_pay     '''d1570001-0000-0000-0000-000000000002'''
\set str_docs    '''d1570001-0000-0000-0000-000000000003'''

\set rp_old      '''d12c0001-0000-0000-0000-000000000001'''
\set rp_new      '''d12c0001-0000-0000-0000-000000000002'''

\set run_drill   '''d1f00001-0000-0000-0000-000000000001'''
\set run_real    '''d1f00001-0000-0000-0000-000000000002'''

-- =============================================================================
-- 1. PREDICTIONS — /dr/insights forecast cards + per-stream forecast.
--    One prediction row per stream (UNIQUE tenant,stream). docs is heading toward
--    a breach (positive lag slope, finite horizon); db/pay are healthy (flat/neg).
-- =============================================================================
INSERT INTO dr_predictions (id, tenant_id, stream_id, group_label, rpo_objective_seconds,
    smoothed_lag_seconds, lag_trend_slope, throughput_trend_slope,
    predicted_breach_seconds, breach_forecast, throughput_collapse, sample_count,
    forecast_at, updated_at)
VALUES
  ('d12d0001-0000-0000-0000-000000000001', :tenant, :str_db,  'Core Banking Platform', 60,
     22.0, -0.04, 1200.0, NULL, false, false, 48, now() - interval '40 seconds', now() - interval '40 seconds'),
  ('d12d0001-0000-0000-0000-000000000002', :tenant, :str_pay, 'Core Banking Platform', 120,
     54.0,  0.01, 320.0, NULL, false, false, 48, now() - interval '55 seconds', now() - interval '55 seconds'),
  ('d12d0001-0000-0000-0000-000000000003', :tenant, :str_docs,'Core Banking Platform', 300,
     268.0, 0.42, -8400.0, 76.0, true, true, 48, now() - interval '30 seconds', now() - interval '30 seconds')
ON CONFLICT (tenant_id, stream_id) DO UPDATE
  SET smoothed_lag_seconds = EXCLUDED.smoothed_lag_seconds,
      lag_trend_slope = EXCLUDED.lag_trend_slope,
      throughput_trend_slope = EXCLUDED.throughput_trend_slope,
      predicted_breach_seconds = EXCLUDED.predicted_breach_seconds,
      breach_forecast = EXCLUDED.breach_forecast,
      throughput_collapse = EXCLUDED.throughput_collapse,
      sample_count = EXCLUDED.sample_count,
      forecast_at = EXCLUDED.forecast_at,
      updated_at = EXCLUDED.updated_at;

-- Rolling per-stream sample series (the /dr/insights + /streams/{id}/forecast
-- trend sparkline). 24 points per stream over the last ~2 hours, 5 min apart.
-- docs ramps lag upward (the breach forecast above); db/pay stay flat-ish.
INSERT INTO dr_replication_samples (id, tenant_id, stream_id, observed_at, lag_seconds, throughput_bps, applied_seq, created_at)
SELECT
  gen_random_uuid(),
  s.tenant_id,
  s.stream_id,
  now() - (g.n || ' minutes')::interval AS observed_at,
  s.base_lag + s.ramp * (24 - g.n / 5.0) + (random() * 4 - 2) AS lag_seconds,
  s.base_bps * (1.0 - s.collapse * (24 - g.n / 5.0) / 24.0) AS throughput_bps,
  s.base_seq + (24 - g.n / 5)::bigint * 120 AS applied_seq,
  now() - (g.n || ' minutes')::interval
FROM (VALUES
    (:tenant::uuid, :str_db::uuid,  20.0, 0.0,  9_500_000.0, 0.0,  184000::bigint),
    (:tenant::uuid, :str_pay::uuid, 52.0, 0.2,  4_200_000.0, 0.0,  90000::bigint),
    (:tenant::uuid, :str_docs::uuid, 90.0, 7.4, 6_800_000.0, 0.6,  41000::bigint)
  ) AS s(tenant_id, stream_id, base_lag, ramp, base_bps, collapse, base_seq)
CROSS JOIN generate_series(5, 120, 5) AS g(n)
ON CONFLICT (tenant_id, stream_id, observed_at) DO NOTHING;

-- =============================================================================
-- 2. RANSOMWARE EARLY-WARNING SIGNALS — /dr/insights ransomware panel + the
--    per-stream signals list. A realistic spread across kinds/severities/time.
--    The confirmed entropy spike on the docs stream curates the latest clean RP.
-- =============================================================================
INSERT INTO dr_ransomware_signals (id, tenant_id, stream_id, signal_kind, severity,
    observed, baseline, ratio, threshold, sample_seq, source_lsn,
    curated_recovery_point_id, detail, observed_at, created_at)
VALUES
  ('d1a50001-0000-0000-0000-000000000001', :tenant, :str_docs, 'entropy',      'confirmed', 7.94, 4.10, 1.94, 7.50, 41210, '0/0C76FA10', :rp_new,
     'High payload entropy sustained across 6 windows — bulk-encryption pattern; clean recovery point pinned (legal hold).', now() - interval '38 minutes', now() - interval '38 minutes'),
  ('d1a50001-0000-0000-0000-000000000002', :tenant, :str_docs, 'change_rate',  'confirmed', 8800.0, 920.0, 9.57, 5.00, 41205, '0/0C76E880', :rp_new,
     'Change-rate 9.6x baseline — mass file rewrite burst on the documents fileset.', now() - interval '37 minutes', now() - interval '37 minutes'),
  ('d1a50001-0000-0000-0000-000000000003', :tenant, :str_docs, 'delete_burst', 'warning',   612.0, 40.0, 15.3, 8.00, 41198, '0/0C76D210', NULL,
     'Delete burst (612 deletes in window) — flagged for review; below confirm threshold.', now() - interval '36 minutes', now() - interval '36 minutes'),
  ('d1a50001-0000-0000-0000-000000000004', :tenant, :str_pay, 'byte_rate',     'warning',   18_400_000.0, 4_200_000.0, 4.38, 4.00, 90180, '0/1F2210A0', NULL,
     'Byte-rate spike 4.4x baseline on payments stream — likely batch settlement, monitoring.', now() - interval '5 hours', now() - interval '5 hours'),
  ('d1a50001-0000-0000-0000-000000000005', :tenant, :str_db,  'entropy',       'warning',   6.20, 4.05, 1.53, 6.00, 184400, '0/3A9E9010', NULL,
     'Transient entropy bump on ledger stream — single window, auto-cleared.', now() - interval '2 days', now() - interval '2 days'),
  ('d1a50001-0000-0000-0000-000000000006', :tenant, :str_docs, 'change_rate', 'warning',   2100.0, 920.0, 2.28, 5.00, 40900, '0/0C740010', NULL,
     'Elevated change-rate during nightly ingest window — within expected batch profile.', now() - interval '4 days', now() - interval '4 days')
ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- 3. GAME-DAY — /dr/rehearse: a reusable scenario + two scored runs (one passed,
--    one with a missed step) + per-step scorecard rows.
-- =============================================================================
INSERT INTO dr_gameday_scenario (id, tenant_id, group_id, name, description, scope, steps, created_at, updated_at)
VALUES
  ('d16d0001-0000-0000-0000-000000000001', :tenant, :grp,
     'Core Banking Resilience Game Day',
     'Controlled, reversible fault injection against the Core Banking group: pause replication, induce lag, block a site — and assert the platform detects each within window.',
     'drill',
     '[
        {"action":"pause_stream","target":"d1570001-0000-0000-0000-000000000001","params":{},"expect":{"signal":"lag_alert","detect_within_ms":120000,"recover_within_ms":180000}},
        {"action":"induce_lag","target":"d1570001-0000-0000-0000-000000000003","params":{"lag_seconds":420},"expect":{"signal":"predicted_breach","detect_within_ms":180000,"recover_within_ms":300000}},
        {"action":"block_site","target":"d10a0001-0000-0000-0000-000000000002","params":{},"expect":{"signal":"topology_degraded","detect_within_ms":90000,"recover_within_ms":120000}}
      ]'::jsonb,
     now() - interval '40 days', now() - interval '8 days')
ON CONFLICT (tenant_id, name) DO NOTHING;

INSERT INTO dr_gameday_run (id, tenant_id, scenario_id, group_id, scope, status,
    steps_total, steps_passed, score, all_faults_reverted, safety_verdict,
    initiated_by, initiated_at, started_at, completed_at, updated_at)
VALUES
  ('d16d0002-0000-0000-0000-000000000001', :tenant, 'd16d0001-0000-0000-0000-000000000001', :grp, 'drill', 'passed',
     3, 3, 1.0000, true, 'allowed', :operator,
     now() - interval '30 days', now() - interval '30 days' + interval '20 seconds', now() - interval '30 days' + interval '9 minutes', now() - interval '30 days' + interval '9 minutes'),
  ('d16d0002-0000-0000-0000-000000000002', :tenant, 'd16d0001-0000-0000-0000-000000000001', :grp, 'drill', 'failed',
     3, 2, 0.6667, true, 'allowed', :operator,
     now() - interval '8 days', now() - interval '8 days' + interval '18 seconds', now() - interval '8 days' + interval '11 minutes', now() - interval '8 days' + interval '11 minutes')
ON CONFLICT (id) DO UPDATE
  SET status = EXCLUDED.status,
      steps_passed = EXCLUDED.steps_passed,
      score = EXCLUDED.score,
      completed_at = EXCLUDED.completed_at,
      updated_at = EXCLUDED.updated_at;

INSERT INTO dr_gameday_step_result (id, tenant_id, run_id, step_index, action, target,
    expected_signal, detect_within_ms, recover_within_ms, signal_observed, observed_signal,
    detection_latency_ms, recovery_latency_ms, fault_reverted, passed, detail,
    started_at, finished_at, observability)
VALUES
  -- passed run: all three observed within window
  ('d16d0003-0000-0000-0000-000000000001', :tenant, 'd16d0002-0000-0000-0000-000000000001', 0, 'pause_stream', 'd1570001-0000-0000-0000-000000000001',
     'lag_alert', 120000, 180000, true, 'lag_alert', 38000, 41000, true, true, 'Lag alert fired 38s after pause; cleared 41s after resume.',
     now() - interval '30 days' + interval '1 minute', now() - interval '30 days' + interval '3 minutes', 'system_observable'),
  ('d16d0003-0000-0000-0000-000000000002', :tenant, 'd16d0002-0000-0000-0000-000000000001', 1, 'induce_lag', 'd1570001-0000-0000-0000-000000000003',
     'predicted_breach', 180000, 300000, true, 'predicted_breach', 96000, 210000, true, true, 'Forecaster flipped breach_forecast 96s after injected lag; recovered after marker cleared.',
     now() - interval '30 days' + interval '3 minutes', now() - interval '30 days' + interval '7 minutes', 'system_observable'),
  ('d16d0003-0000-0000-0000-000000000003', :tenant, 'd16d0002-0000-0000-0000-000000000001', 2, 'block_site', 'd10a0001-0000-0000-0000-000000000002',
     'topology_degraded', 90000, 120000, true, 'topology_degraded', 22000, 35000, true, true, 'Topology edge flipped to unhealthy 22s after block; restored on revert.',
     now() - interval '30 days' + interval '7 minutes', now() - interval '30 days' + interval '9 minutes', 'system_observable'),
  -- failed run: lag detection missed window
  ('d16d0003-0000-0000-0000-000000000004', :tenant, 'd16d0002-0000-0000-0000-000000000002', 0, 'pause_stream', 'd1570001-0000-0000-0000-000000000001',
     'lag_alert', 120000, 180000, true, 'lag_alert', 44000, 47000, true, true, 'Lag alert within window.',
     now() - interval '8 days' + interval '1 minute', now() - interval '8 days' + interval '3 minutes', 'system_observable'),
  ('d16d0003-0000-0000-0000-000000000005', :tenant, 'd16d0002-0000-0000-0000-000000000002', 1, 'induce_lag', 'd1570001-0000-0000-0000-000000000003',
     'predicted_breach', 180000, 300000, false, '', NULL, NULL, true, false, 'MISS: forecaster did not flip breach_forecast within 180s (docs stream throughput already degraded, masking the injected lag). Resilience gap logged.',
     now() - interval '8 days' + interval '3 minutes', now() - interval '8 days' + interval '8 minutes', 'system_observable'),
  ('d16d0003-0000-0000-0000-000000000006', :tenant, 'd16d0002-0000-0000-0000-000000000002', 2, 'block_site', 'd10a0001-0000-0000-0000-000000000002',
     'topology_degraded', 90000, 120000, true, 'topology_degraded', 29000, 40000, true, true, 'Topology degraded detected within window.',
     now() - interval '8 days' + interval '8 minutes', now() - interval '8 days' + interval '11 minutes', 'system_observable')
ON CONFLICT (run_id, step_index) DO NOTHING;

-- =============================================================================
-- 4. IaC SNAPSHOTS — /dr/recover IaC reconstitution surface. Two versions of the
--    estate (drift between them) + a handful of resources forming a small DAG.
-- =============================================================================
INSERT INTO dr_iac_snapshot (id, tenant_id, group_id, name, source_kind, version, content_hash, resource_count, metadata, created_at)
VALUES
  ('d11ac001-0000-0000-0000-000000000001', :tenant, :grp, 'apex-core-prod', 'terraform_state', 1,
     '11ac11ac0001a1b2c3d4e5f60718293a4b5c6d7e8f90112233445566778899aab', 5,
     '{"terraform_version":"1.7.5","lineage":"apex-core-prod","backend":"s3"}'::jsonb, now() - interval '21 days'),
  ('d11ac001-0000-0000-0000-000000000002', :tenant, :grp, 'apex-core-prod', 'terraform_state', 2,
     '22bd22bd0002b2c3d4e5f60718293a4b5c6d7e8f90112233445566778899aabbc', 6,
     '{"terraform_version":"1.7.5","lineage":"apex-core-prod","backend":"s3"}'::jsonb, now() - interval '3 days')
ON CONFLICT (tenant_id, name, version) DO NOTHING;

INSERT INTO dr_iac_resource (id, tenant_id, snapshot_id, provider, type, name, address, attributes, depends_on, resource_hash, created_at)
VALUES
  -- v2 (current) estate resources, forming a small reconstitution DAG
  ('d11ac1e0-0000-0000-0000-000000000001', :tenant, 'd11ac001-0000-0000-0000-000000000002', 'aws', 'aws_vpc', 'core', 'aws_vpc.core',
     '{"cidr_block":"10.20.0.0/16","enable_dns_hostnames":true}'::jsonb, '[]'::jsonb,
     'a1f0000000000000000000000000000000000000000000000000000000000001', now() - interval '3 days'),
  ('d11ac1e0-0000-0000-0000-000000000002', :tenant, 'd11ac001-0000-0000-0000-000000000002', 'aws', 'aws_subnet', 'core_db', 'aws_subnet.core_db',
     '{"cidr_block":"10.20.1.0/24","availability_zone":"me-south-1a"}'::jsonb, '["aws_vpc.core"]'::jsonb,
     'a1f0000000000000000000000000000000000000000000000000000000000002', now() - interval '3 days'),
  ('d11ac1e0-0000-0000-0000-000000000003', :tenant, 'd11ac001-0000-0000-0000-000000000002', 'aws', 'aws_db_instance', 'ledger', 'aws_db_instance.ledger',
     '{"engine":"postgres","instance_class":"db.r6g.2xlarge","multi_az":true,"allocated_storage":2048}'::jsonb, '["aws_subnet.core_db"]'::jsonb,
     'a1f0000000000000000000000000000000000000000000000000000000000003', now() - interval '3 days'),
  ('d11ac1e0-0000-0000-0000-000000000004', :tenant, 'd11ac001-0000-0000-0000-000000000002', 'aws', 'aws_instance', 'payments_gw', 'aws_instance.payments_gw',
     '{"instance_type":"m6i.xlarge","ami":"ami-0apexpay","subnet":"aws_subnet.core_db"}'::jsonb, '["aws_db_instance.ledger"]'::jsonb,
     'a1f0000000000000000000000000000000000000000000000000000000000004', now() - interval '3 days'),
  ('d11ac1e0-0000-0000-0000-000000000005', :tenant, 'd11ac001-0000-0000-0000-000000000002', 'aws', 'aws_efs_file_system', 'docvault', 'aws_efs_file_system.docvault',
     '{"performance_mode":"generalPurpose","encrypted":true,"throughput_mode":"elastic"}'::jsonb, '["aws_vpc.core"]'::jsonb,
     'a1f0000000000000000000000000000000000000000000000000000000000005', now() - interval '3 days'),
  ('d11ac1e0-0000-0000-0000-000000000006', :tenant, 'd11ac001-0000-0000-0000-000000000002', 'aws', 'aws_lb', 'payments', 'aws_lb.payments',
     '{"load_balancer_type":"application","internal":true}'::jsonb, '["aws_instance.payments_gw"]'::jsonb,
     'a1f0000000000000000000000000000000000000000000000000000000000006', now() - interval '3 days')
ON CONFLICT (snapshot_id, provider, type, name) DO NOTHING;

-- =============================================================================
-- 5. BOOT GRAPH — /dr/recover boot-plan tiers. Services + depends_on edges (so
--    the planner computes >1 tier) + one completed boot run with per-service
--    status rows.
-- =============================================================================
INSERT INTO dr_boot_service (id, tenant_id, group_id, name, kind, probe_kind, probe_target, probe_expect_status, boot_timeout_seconds, health_retries, boot_action, site_id, created_at, updated_at)
VALUES
  ('d1b00001-0000-0000-0000-000000000001', :tenant, :grp, 'core-banking-db', 'database', 'tcp',  'dr-core-banking.apexbank.dr:5432', 0,   120, 5, 'dr.boot.database', :site_db,   now() - interval '21 days', now() - interval '21 days'),
  ('d1b00001-0000-0000-0000-000000000002', :tenant, :grp, 'cache',           'cache',    'tcp',  'dr-cache-01.apexbank.dr:6379',    0,   60,  4, 'dr.boot.cache',    NULL,       now() - interval '21 days', now() - interval '21 days'),
  ('d1b00001-0000-0000-0000-000000000003', :tenant, :grp, 'payments-gw',     'vm',       'http', 'http://dr-payments-gw-01.apexbank.dr/healthz', 200, 90, 4, 'dr.boot.vm',  :site_pay,  now() - interval '21 days', now() - interval '21 days'),
  ('d1b00001-0000-0000-0000-000000000004', :tenant, :grp, 'docvault',        'fileset',  'tcp',  'dr-docvault.apexbank.dr:2049',    0,   90,  3, 'dr.boot.fileset',  :site_docs, now() - interval '21 days', now() - interval '21 days'),
  ('d1b00001-0000-0000-0000-000000000005', :tenant, :grp, 'api-edge',        'vm',       'http', 'http://dr-api-edge.apexbank.dr/healthz', 200, 60, 4, 'dr.boot.vm',     NULL,       now() - interval '21 days', now() - interval '21 days')
ON CONFLICT (id) DO NOTHING;

-- depends_on edges -> tiers: tier0 {db,cache}; tier1 {payments-gw,docvault}; tier2 {api-edge}
INSERT INTO dr_boot_dependency (id, tenant_id, group_id, service_id, depends_on_id, created_at)
VALUES
  ('d1b0de00-0000-0000-0000-000000000001', :tenant, :grp, 'd1b00001-0000-0000-0000-000000000003', 'd1b00001-0000-0000-0000-000000000001', now() - interval '21 days'), -- payments-gw -> db
  ('d1b0de00-0000-0000-0000-000000000002', :tenant, :grp, 'd1b00001-0000-0000-0000-000000000003', 'd1b00001-0000-0000-0000-000000000002', now() - interval '21 days'), -- payments-gw -> cache
  ('d1b0de00-0000-0000-0000-000000000003', :tenant, :grp, 'd1b00001-0000-0000-0000-000000000004', 'd1b00001-0000-0000-0000-000000000001', now() - interval '21 days'), -- docvault -> db
  ('d1b0de00-0000-0000-0000-000000000004', :tenant, :grp, 'd1b00001-0000-0000-0000-000000000005', 'd1b00001-0000-0000-0000-000000000003', now() - interval '21 days'), -- api-edge -> payments-gw
  ('d1b0de00-0000-0000-0000-000000000005', :tenant, :grp, 'd1b00001-0000-0000-0000-000000000005', 'd1b00001-0000-0000-0000-000000000004', now() - interval '21 days')  -- api-edge -> docvault
ON CONFLICT (service_id, depends_on_id) DO NOTHING;

-- one completed isolated-boot run + per-service status (the boot-run drill-in view)
INSERT INTO dr_boot_run (id, tenant_id, group_id, status, policy, total_tiers, tiers_booted, initiated_by, started_at, completed_at)
VALUES
  ('d1b09000-0000-0000-0000-000000000001', :tenant, :grp, 'completed', 'halt', 3, 3, :operator,
     now() - interval '5 days', now() - interval '5 days' + interval '7 minutes')
ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, tiers_booted = EXCLUDED.tiers_booted, completed_at = EXCLUDED.completed_at;

INSERT INTO dr_boot_service_status (id, run_id, service_id, service_name, tier, status, attempts, booted_at, healthy_at, updated_at)
VALUES
  ('d1b05a00-0000-0000-0000-000000000001', 'd1b09000-0000-0000-0000-000000000001', 'd1b00001-0000-0000-0000-000000000001', 'core-banking-db', 0, 'healthy', 1, now() - interval '5 days' + interval '1 minute', now() - interval '5 days' + interval '2 minutes', now() - interval '5 days' + interval '2 minutes'),
  ('d1b05a00-0000-0000-0000-000000000002', 'd1b09000-0000-0000-0000-000000000001', 'd1b00001-0000-0000-0000-000000000002', 'cache',           0, 'healthy', 1, now() - interval '5 days' + interval '1 minute', now() - interval '5 days' + interval '90 seconds', now() - interval '5 days' + interval '90 seconds'),
  ('d1b05a00-0000-0000-0000-000000000003', 'd1b09000-0000-0000-0000-000000000001', 'd1b00001-0000-0000-0000-000000000003', 'payments-gw',     1, 'healthy', 1, now() - interval '5 days' + interval '3 minutes', now() - interval '5 days' + interval '4 minutes', now() - interval '5 days' + interval '4 minutes'),
  ('d1b05a00-0000-0000-0000-000000000004', 'd1b09000-0000-0000-0000-000000000001', 'd1b00001-0000-0000-0000-000000000004', 'docvault',        1, 'healthy', 2, now() - interval '5 days' + interval '3 minutes', now() - interval '5 days' + interval '5 minutes', now() - interval '5 days' + interval '5 minutes'),
  ('d1b05a00-0000-0000-0000-000000000005', 'd1b09000-0000-0000-0000-000000000001', 'd1b00001-0000-0000-0000-000000000005', 'api-edge',        2, 'healthy', 1, now() - interval '5 days' + interval '6 minutes', now() - interval '5 days' + interval '7 minutes', now() - interval '5 days' + interval '7 minutes')
ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- 6. CONSISTENCY BARRIERS — /dr/recover app-consistent-point history.
-- =============================================================================
INSERT INTO dr_consistency_barrier (id, tenant_id, group_id, recovery_point_id, consistency_level, provider,
    barrier_lsn, success, quiesced, thawed, detail, error, requested_by,
    quiesce_started_at, quiesce_finished_at, thaw_started_at, thaw_finished_at, created_at)
VALUES
  ('d1cb0001-0000-0000-0000-000000000001', :tenant, :grp, :rp_new, 'application', 'script',
     '0/3A9F0010', true, true, true, 'pg_backup_start/stop quiesce; all members frozen then thawed cleanly.', '', :operator,
     now() - interval '12 minutes', now() - interval '12 minutes' + interval '4 seconds', now() - interval '12 minutes' + interval '6 seconds', now() - interval '12 minutes' + interval '9 seconds', now() - interval '12 minutes'),
  ('d1cb0001-0000-0000-0000-000000000002', :tenant, :grp, :rp_old, 'application', 'script',
     '0/3A8800F0', true, true, true, 'Scheduled app-consistent barrier; ledger + payments quiesced.', '', :operator,
     now() - interval '6 hours', now() - interval '6 hours' + interval '5 seconds', now() - interval '6 hours' + interval '7 seconds', now() - interval '6 hours' + interval '11 seconds', now() - interval '6 hours'),
  ('d1cb0001-0000-0000-0000-000000000003', :tenant, :grp, NULL, 'crash', 'none',
     '0/3A700000', false, true, false, 'Crash-consistent attempt; thaw skipped after quiesce timeout on docvault.', 'quiesce ack timeout on docvault (10s)', :operator,
     now() - interval '2 days', now() - interval '2 days' + interval '10 seconds', NULL, NULL, now() - interval '2 days')
ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- 7. FAILBACK RUNS — /dr failback panel. One COMPLETED cutback (follows the real
--    failover) + steps.
-- =============================================================================
INSERT INTO dr_failback_run (id, tenant_id, group_id, failover_run_id, from_site, to_site, reverse_stream_id, status,
    delta_bytes_remaining, delta_seq_remaining, converge_threshold_bytes, source_lsn, applied_lsn,
    last_converged_at, cutover_window_open, initiated_by, approved_by, approved_at, new_direction,
    initiated_at, completed_at, updated_at)
VALUES
  ('d1fb0001-0000-0000-0000-000000000001', :tenant, :grp, :run_real, :site_db, :site_db, 'reverse-d1570001-01', 'COMPLETED',
     0, 0, 1048576, '0/3AB10000', '0/3AB10000',
     now() - interval '20 hours', false, :operator, :operator, now() - interval '21 hours', 'recovery_to_primary',
     now() - interval '23 hours', now() - interval '20 hours', now() - interval '20 hours')
ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, completed_at = EXCLUDED.completed_at, updated_at = EXCLUDED.updated_at;

INSERT INTO dr_failback_step (id, run_id, step, status, detail, started_at, finished_at)
VALUES
  ('d1fb05e0-0000-0000-0000-000000000001', 'd1fb0001-0000-0000-0000-000000000001', 'establish_reverse_stream', 'passed', '{"reverse_stream":"reverse-d1570001-01"}'::jsonb, now() - interval '23 hours', now() - interval '23 hours' + interval '3 minutes'),
  ('d1fb05e0-0000-0000-0000-000000000002', 'd1fb0001-0000-0000-0000-000000000001', 'reverse_sync',            'passed', '{"delta_bytes_start":214748364}'::jsonb,        now() - interval '23 hours' + interval '3 minutes', now() - interval '21 hours' - interval '20 minutes'),
  ('d1fb05e0-0000-0000-0000-000000000003', 'd1fb0001-0000-0000-0000-000000000001', 'delta_converged',         'passed', '{"delta_bytes_remaining":0}'::jsonb,             now() - interval '21 hours' - interval '20 minutes', now() - interval '21 hours' - interval '15 minutes'),
  ('d1fb05e0-0000-0000-0000-000000000004', 'd1fb0001-0000-0000-0000-000000000001', 'approve_cutback',         'passed', '{"approver":"admin@clario.dev"}'::jsonb,         now() - interval '21 hours', now() - interval '21 hours' + interval '1 minute'),
  ('d1fb05e0-0000-0000-0000-000000000005', 'd1fb0001-0000-0000-0000-000000000001', 'cutback',                 'passed', '{"new_direction":"recovery_to_primary"}'::jsonb, now() - interval '20 hours' - interval '5 minutes', now() - interval '20 hours')
ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- 8. AGENTS — /dr agents panel. Three enrolled agents (active/active/silent).
-- =============================================================================
INSERT INTO dr_agent (id, tenant_id, site_id, status, mtls_thumbprint, cert_serial,
    cert_issued_at, cert_expires_at, last_seen_at, created_at)
VALUES
  ('d1a90001-0000-0000-0000-000000000001', :tenant, :site_db, 'active',
     'AA:BB:CC:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11', '0x1a2b3c4d01',
     now() - interval '60 days', now() + interval '305 days', now() - interval '20 seconds', now() - interval '60 days'),
  ('d1a90001-0000-0000-0000-000000000002', :tenant, :site_pay, 'active',
     'BB:CC:DD:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22', '0x1a2b3c4d02',
     now() - interval '58 days', now() + interval '307 days', now() - interval '45 seconds', now() - interval '58 days'),
  ('d1a90001-0000-0000-0000-000000000003', :tenant, :site_docs, 'silent',
     'CC:DD:EE:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33', '0x1a2b3c4d03',
     now() - interval '55 days', now() + interval '310 days', now() - interval '9 minutes', now() - interval '55 days')
ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, last_seen_at = EXCLUDED.last_seen_at;

-- =============================================================================
-- 9. STORAGE OFFLOAD — /dr storage panel. Two volumes + snapshot chains.
-- =============================================================================
INSERT INTO dr_storage_volume (id, tenant_id, name, provider, array_endpoint, source_location, site_id,
    retention_max_snapshots, retention_max_age_seconds, created_at, updated_at)
VALUES
  ('d1570f00-0000-0000-0000-000000000001', :tenant, 'ledger-data', 'netapp_ontap', 'https://ontap-01.apexbank.internal', '/vol/ledger', :site_db,  14, 2592000, now() - interval '30 days', now() - interval '20 minutes'),
  ('d1570f00-0000-0000-0000-000000000002', :tenant, 'docvault-fs', 'nfs',          'nfs://docvault.apexbank.internal',   '/customers',  :site_docs, 7,  1209600, now() - interval '30 days', now() - interval '35 minutes')
ON CONFLICT (id) DO NOTHING;

INSERT INTO dr_storage_snapshot (id, tenant_id, volume_id, parent_id, provider_handle, kind, state, manifest_hash,
    size_bytes, changed_bytes, file_count, replicated_target, created_at, ready_at, replicated_at, updated_at)
VALUES
  ('d15705a0-0000-0000-0000-000000000001', :tenant, 'd1570f00-0000-0000-0000-000000000001', NULL, 'ontap-snap-base-001', 'full', 'REPLICATED',
     '5a0fba5e0001a1b2c3d4e5f60718293a4b5c6d7e8f90112233445566778899aab', 214748364800, 214748364800, 18204, 'worm/apex/storage/ledger/base', now() - interval '7 days', now() - interval '7 days' + interval '6 minutes', now() - interval '7 days' + interval '40 minutes', now() - interval '7 days' + interval '40 minutes'),
  ('d15705a0-0000-0000-0000-000000000002', :tenant, 'd1570f00-0000-0000-0000-000000000001', 'd15705a0-0000-0000-0000-000000000001', 'ontap-snap-incr-002', 'incremental', 'REPLICATED',
     '5a0fba5e0002b2c3d4e5f60718293a4b5c6d7e8f90112233445566778899aabbc', 3221225472, 3221225472, 412, 'worm/apex/storage/ledger/incr-002', now() - interval '1 day', now() - interval '1 day' + interval '2 minutes', now() - interval '1 day' + interval '9 minutes', now() - interval '1 day' + interval '9 minutes'),
  ('d15705a0-0000-0000-0000-000000000003', :tenant, 'd1570f00-0000-0000-0000-000000000001', 'd15705a0-0000-0000-0000-000000000002', 'ontap-snap-incr-003', 'incremental', 'READY',
     '5a0fba5e0003c3d4e5f60718293a4b5c6d7e8f90112233445566778899aabbccd', 1610612736, 1610612736, 207, NULL, now() - interval '2 hours', now() - interval '2 hours' + interval '90 seconds', NULL, now() - interval '2 hours' + interval '90 seconds'),
  ('d15705a0-0000-0000-0000-000000000004', :tenant, 'd1570f00-0000-0000-0000-000000000002', NULL, 'nfs-snap-base-001', 'full', 'REPLICATED',
     '5a0fba5e0004d4e5f60718293a4b5c6d7e8f90112233445566778899aabbccdde', 96636764160, 96636764160, 240118, 'worm/apex/storage/docvault/base', now() - interval '5 days', now() - interval '5 days' + interval '11 minutes', now() - interval '5 days' + interval '55 minutes', now() - interval '5 days' + interval '55 minutes'),
  ('d15705a0-0000-0000-0000-000000000005', :tenant, 'd1570f00-0000-0000-0000-000000000002', 'd15705a0-0000-0000-0000-000000000004', 'nfs-snap-incr-002', 'incremental', 'READY',
     '5a0fba5e0005e5f60718293a4b5c6d7e8f90112233445566778899aabbccddeef', 5368709120, 5368709120, 1842, NULL, now() - interval '3 hours', now() - interval '3 hours' + interval '3 minutes', NULL, now() - interval '3 hours' + interval '3 minutes')
ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- 10. WORKLOAD CAPTURE — /dr workload-capture panel. Two sources + epoch chains.
-- =============================================================================
INSERT INTO dr_workload_capture_source (id, tenant_id, stream_id, name, source_kind, binding_kind,
    block_size_bytes, config, enabled, epoch_count, last_run_at, last_seq, created_at, updated_at)
VALUES
  ('d1ca9001-0000-0000-0000-000000000001', :tenant, :str_db,  'core-banking-vm',  'vm_disk',      'vsphere', 1048576, '{"vcenter":"vc-01.apexbank.internal","vm":"core-banking-01"}'::jsonb, true, 3, now() - interval '15 minutes', 184500, now() - interval '25 days', now() - interval '15 minutes'),
  ('d1ca9001-0000-0000-0000-000000000002', :tenant, :str_pay, 'payments-workload','k8s_workload', 'k8s',     524288,  '{"cluster":"apex-prod","namespace":"payments"}'::jsonb,              true, 2, now() - interval '40 minutes', 90150, now() - interval '20 days', now() - interval '40 minutes')
ON CONFLICT (id) DO NOTHING;

INSERT INTO dr_workload_capture_epoch (id, tenant_id, source_id, stream_id, epoch, epoch_kind, from_seq, to_seq,
    frame_count, changed_units, total_units, payload_bytes, content_hash, source_marker, set_summary, captured_at)
VALUES
  ('d1ca9e00-0000-0000-0000-000000000001', :tenant, 'd1ca9001-0000-0000-0000-000000000001', :str_db, 1, 'base',        1,      180000, 180000, 4096, 4096, 8800000000, 'ca9e0001a1b2c3d4e5f60718293a4b5c6d7e8f90112233445566778899aabbccd', '0/3A800000', '[{"set":"vmdk-0","blocks":4096}]'::jsonb, now() - interval '25 days'),
  ('d1ca9e00-0000-0000-0000-000000000002', :tenant, 'd1ca9001-0000-0000-0000-000000000001', :str_db, 2, 'incremental', 180001, 183000, 1200, 612,  4096, 312000000,  'ca9e0002b2c3d4e5f60718293a4b5c6d7e8f90112233445566778899aabbccdde', '0/3A9C0000', '[{"set":"vmdk-0","blocks":612}]'::jsonb,  now() - interval '6 hours'),
  ('d1ca9e00-0000-0000-0000-000000000003', :tenant, 'd1ca9001-0000-0000-0000-000000000001', :str_db, 3, 'incremental', 183001, 184500, 900,  214,  4096, 109000000,  'ca9e0003c3d4e5f60718293a4b5c6d7e8f90112233445566778899aabbccddeef', '0/3A9F0010', '[{"set":"vmdk-0","blocks":214}]'::jsonb,  now() - interval '15 minutes'),
  ('d1ca9e00-0000-0000-0000-000000000004', :tenant, 'd1ca9001-0000-0000-0000-000000000002', :str_pay, 1, 'base',       1,      88000,  88000, 2048, 2048, 4200000000, 'ca9e0004d4e5f60718293a4b5c6d7e8f90112233445566778899aabbccddeeff0', '0/1F000000', '[{"set":"pvc-payments","blocks":2048}]'::jsonb, now() - interval '20 days'),
  ('d1ca9e00-0000-0000-0000-000000000005', :tenant, 'd1ca9001-0000-0000-0000-000000000002', :str_pay, 2, 'incremental', 88001, 90150, 1100, 318,  2048, 162000000,  'ca9e0005e5f60718293a4b5c6d7e8f90112233445566778899aabbccddeeff011', '0/1F22B0A8', '[{"set":"pvc-payments","blocks":318}]'::jsonb, now() - interval '40 minutes')
ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- 11. SELF-DR — /dr selfdr panel. One assessment (ready) + control-plane backup
--     and offline restore bundle artifacts. (dr_kek_custody_log is hash-chained
--     and intentionally NOT touched.)
-- =============================================================================
INSERT INTO dr_selfdr_assessment (id, tenant_id, profile_id, verdict, critical, warning, info, findings, restore_plan, created_by, created_at)
VALUES
  ('d15e1f00-0000-0000-0000-000000000001', :tenant, 'standard.v1', 'ready', 0, 1, 4,
     '[
        {"severity":"info","control":"control_plane_backup","detail":"Latest control-plane backup is 3h old, within 6h objective."},
        {"severity":"info","control":"offline_bundle","detail":"Offline restore bundle present and verified (sha256 match)."},
        {"severity":"info","control":"worm_immutability","detail":"WORM bucket object-lock confirmed in COMPLIANCE mode."},
        {"severity":"warning","control":"second_region","detail":"Offline bundle replicated to a single secondary location; two recommended."},
        {"severity":"info","control":"ledger_chain","detail":"Attestation ledger verified intact."}
      ]'::jsonb,
     '{"steps":["restore_control_plane_backup","reattach_worm_bucket","replay_outbox","verify_ledger"],"estimated_rto_seconds":2700}'::jsonb,
     :operator, now() - interval '3 hours')
ON CONFLICT (id) DO NOTHING;

INSERT INTO dr_selfdr_artifact (id, tenant_id, kind, component_id, component_kind, object_key, uri, version_id, sha256, size_bytes,
    captured_at, retain_until, location_id, immutable, encrypted, evidence, created_by, created_at)
VALUES
  ('d15ea000-0000-0000-0000-000000000001', :tenant, 'control_plane_backup', 'dr-control-plane', 'postgres',
     'worm/apex/selfdr/cp-backup-20260622.tar.zst', 's3://dr-selfdr/apex/cp-backup-20260622.tar.zst', 'v-selfdr-cp-001',
     'cb000001a1b2c3d4e5f60718293a4b5c6d7e8f90112233445566778899aabbccd', 4831838208,
     now() - interval '3 hours', now() + interval '90 days', 'me-south-1', true, true,
     '{"pg_dump":"platform_core+dr_db","compression":"zstd-19"}'::jsonb, :operator, now() - interval '3 hours'),
  ('d15ea000-0000-0000-0000-000000000002', :tenant, 'offline_restore_bundle', 'dr-control-plane', 'bundle',
     'worm/apex/selfdr/offline-bundle-20260622.tar.zst', 's3://dr-selfdr/apex/offline-bundle-20260622.tar.zst', 'v-selfdr-ob-001',
     'ob000001b2c3d4e5f60718293a4b5c6d7e8f90112233445566778899aabbccdde', 1073741824,
     now() - interval '1 day', now() + interval '90 days', 'me-south-1', true, true,
     '{"contents":["binaries","migrations","keys-wrapped","runbooks"],"verified":true}'::jsonb, :operator, now() - interval '1 day')
ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- 12. BYOK KEYS — /dr/byok keys list (dr_tenant_kek). One active + one retired
--     version, modeling a prior rotation. NOTE: the dr_kek_custody_log hash chain
--     is intentionally NOT seeded here (it is WORM/hash-chained); the /byok/keys
--     list reads dr_tenant_kek only.
-- =============================================================================
INSERT INTO dr_tenant_kek (id, tenant_id, key_version, provider, reference, state, created_at, activated_at, retired_at, updated_at)
VALUES
  ('d1ce0e00-0000-0000-0000-000000000001', :tenant, 1, 'kms', 'arn:aws:kms:me-south-1:apex:key/dr-kek-v1', 'retired',
     now() - interval '180 days', now() - interval '180 days', now() - interval '30 days', now() - interval '30 days'),
  ('d1ce0e00-0000-0000-0000-000000000002', :tenant, 2, 'kms', 'arn:aws:kms:me-south-1:apex:key/dr-kek-v2', 'active',
     now() - interval '30 days', now() - interval '30 days', NULL, now() - interval '30 days')
ON CONFLICT (id) DO NOTHING;

COMMIT;
