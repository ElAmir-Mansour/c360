-- =============================================================================
-- ClarioDR demo seed — dr_db (DEV ONLY, idempotent)
--
-- Populates a minimal-but-realistic DR posture for the "Apex Bank Holdings"
-- tenant so the /dr console pages render content instead of empty states:
--   /dr, /dr/recover, /dr/readiness, /dr/runbooks, /dr/topology, /dr/prove.
--
-- Tenant:  aaaaaaaa-0000-0000-0000-000000000001  (Apex Bank Holdings == clario-dev)
-- Operator (initiated_by/approved_by/created_by): aaaaaaaa-0000-0000-0000-aaaaaaaaaaaa
--
-- Idempotent: every INSERT carries a fixed UUID/key and an ON CONFLICT DO
-- NOTHING (or DO UPDATE where a refresh is wanted). Safe to re-run.
--
-- Run:
--   docker exec -i clario360-postgres psql -U clario -d dr_db \
--     < backend/migrations/dr_db/seeds/dr_demo.dev.sql
--
-- WORM/immutability note: recovery_point rows are inserted fully-formed
-- (validated, legal-hold) in a single INSERT — the immutability trigger forbids
-- UPDATE/DELETE of sealed fields, never INSERT. The dr_attestation_ledger chain
-- is built fresh (genesis-first) with hashes computed exactly as the Go verifier
-- recomputes them, so /dr/prove ledger verify returns intact=true. No existing
-- hash-chained / WORM data is mutated.
-- =============================================================================

BEGIN;

-- Bypass RLS for the whole seeding transaction (the documented dr_db backstop).
SET LOCAL app.bypass_rls = 'on';

-- -----------------------------------------------------------------------------
-- Stable identifiers
-- -----------------------------------------------------------------------------
\set tenant      '''aaaaaaaa-0000-0000-0000-000000000001'''
\set operator    '''aaaaaaaa-0000-0000-0000-aaaaaaaaaaaa'''

-- protected sites
\set site_db     '''d10a0001-0000-0000-0000-000000000001'''
\set site_pay    '''d10a0001-0000-0000-0000-000000000002'''
\set site_docs   '''d10a0001-0000-0000-0000-000000000003'''

-- consistency group
\set grp         '''d10c0001-0000-0000-0000-000000000001'''

-- replication streams
\set str_db      '''d1570001-0000-0000-0000-000000000001'''
\set str_pay     '''d1570001-0000-0000-0000-000000000002'''
\set str_docs    '''d1570001-0000-0000-0000-000000000003'''

-- recovery points
\set rp_old      '''d12c0001-0000-0000-0000-000000000001'''
\set rp_new      '''d12c0001-0000-0000-0000-000000000002'''

-- failover runs
\set run_drill   '''d1f00001-0000-0000-0000-000000000001'''
\set run_real    '''d1f00001-0000-0000-0000-000000000002'''

-- topology nodes
\set node_db     '''d1700de0-0000-0000-0000-000000000001'''
\set node_pay    '''d1700de0-0000-0000-0000-000000000002'''
\set node_docs   '''d1700de0-0000-0000-0000-000000000003'''
\set node_tgt    '''d1700de0-0000-0000-0000-000000000004'''

-- registry runbook
\set rbk         '''d1bb0001-0000-0000-0000-000000000001'''

-- studio runbook
\set st_rbk      '''d157bb01-0000-0000-0000-000000000001'''

-- =============================================================================
-- 1. Protected sites (the workloads under DR protection)
-- =============================================================================
INSERT INTO protected_site (id, tenant_id, name, kind, primary_endpoint, rto_objective_seconds, rpo_objective_seconds)
VALUES
  (:site_db,   :tenant, 'Core Banking Ledger DB', 'database', 'pg://core-banking.apexbank.internal:5432/ledger', 900,  60),
  (:site_pay,  :tenant, 'Payments Gateway VM',    'vm',       'vm://payments-gw-01.apexbank.internal',           600,  120),
  (:site_docs, :tenant, 'Customer Documents Vault','fileset', 'nfs://docvault.apexbank.internal/customers',       1800, 300)
ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- 2. Consistency group + members (must fail over together, in boot order)
-- =============================================================================
INSERT INTO consistency_group (id, tenant_id, name)
VALUES (:grp, :tenant, 'Core Banking Platform')
ON CONFLICT (id) DO NOTHING;

INSERT INTO consistency_group_member (group_id, site_id, boot_order)
VALUES
  (:grp, :site_db,   10),   -- DB boots first
  (:grp, :site_pay,  20),   -- then payments
  (:grp, :site_docs, 30)    -- then docs
ON CONFLICT (group_id, site_id) DO NOTHING;

-- =============================================================================
-- 3. Replication streams (one per site). Two healthy/streaming, one degraded
--    to make the posture roll-up visibly non-trivial.
-- =============================================================================
INSERT INTO replication_stream (id, tenant_id, site_id, status, applied_seq, source_lsn, applied_at, last_error)
VALUES
  (:str_db,   :tenant, :site_db,   'streaming', 184523, '0/3A9F1C40', now() - interval '35 seconds',  NULL),
  (:str_pay,  :tenant, :site_pay,  'streaming', 90211,  '0/1F22B0A8', now() - interval '70 seconds',  NULL),
  (:str_docs, :tenant, :site_docs, 'degraded',  41277,  '0/0C7711F0', now() - interval '6 minutes',   'apply lag elevated: target IO saturated')
ON CONFLICT (id) DO UPDATE
  SET status = EXCLUDED.status,
      applied_seq = EXCLUDED.applied_seq,
      source_lsn = EXCLUDED.source_lsn,
      applied_at = EXCLUDED.applied_at,
      last_error = EXCLUDED.last_error,
      updated_at = now();

-- =============================================================================
-- 4. Recovery targets + network mapping (recovery-site boot plan)
-- =============================================================================
INSERT INTO recovery_target (tenant_id, group_id, site_id, boot_order, recovery_endpoint, health_probe)
VALUES
  (:tenant, :grp, :site_db,   10, 'pg://dr-core-banking.apexbank.dr:5432/ledger',
     '{"type":"sql","target":"select 1","expected":"1","timeout":30,"retries":5}'::jsonb),
  (:tenant, :grp, :site_pay,  20, 'vm://dr-payments-gw-01.apexbank.dr',
     '{"type":"http","target":"/healthz","expected":"200","timeout":15,"retries":4}'::jsonb),
  (:tenant, :grp, :site_docs, 30, 'nfs://dr-docvault.apexbank.dr/customers',
     '{"type":"tcp","target":":2049","expected":"open","timeout":10,"retries":3}'::jsonb)
ON CONFLICT (group_id, site_id) DO NOTHING;

INSERT INTO network_mapping (id, tenant_id, group_id, profile, primary_cidr, recovery_cidr)
VALUES
  ('d1ce0001-0000-0000-0000-000000000001', :tenant, :grp, 'production', '10.20.0.0/16', '10.120.0.0/16'),
  ('d1ce0001-0000-0000-0000-000000000002', :tenant, :grp, 'isolated',   '10.20.0.0/16', '10.250.0.0/16')
ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- 5. Recovery points (immutable, WORM-sealed). Inserted fully-formed: validated,
--    on legal hold, retention in the future. Latest is the one the readiness
--    check pins.
-- =============================================================================
INSERT INTO recovery_point (id, tenant_id, group_id, marker_lsn, rpo_seconds, object_keys, content_hash, validation_ratio, is_validated, legal_hold, sealed_at, retention_until)
VALUES
  (:rp_old, :tenant, :grp, '0/3A8800F0', 58,
     '{"core-banking":"worm/apex/rp/old/db.seg","payments":"worm/apex/rp/old/pay.seg","docs":"worm/apex/rp/old/docs.seg"}'::jsonb,
     'a1b2c3d4e5f60718293a4b5c6d7e8f90112233445566778899aabbccddeeff00',
     0.9994, true, true, now() - interval '6 hours', now() + interval '90 days'),
  (:rp_new, :tenant, :grp, '0/3A9F0010', 41,
     '{"core-banking":"worm/apex/rp/new/db.seg","payments":"worm/apex/rp/new/pay.seg","docs":"worm/apex/rp/new/docs.seg"}'::jsonb,
     'ff00eeddccbbaa998877665544332211009f8e7d6c5b4a39281706f5e4d3c2b1',
     0.9998, true, true, now() - interval '12 minutes', now() + interval '90 days')
ON CONFLICT (id) DO NOTHING;

-- Clean-room scan verdicts for the recovery points. These are seeded as 'clean'
-- so the leader-singleton clean-room auto-scan loop (15s tick) treats both points
-- as already validated and does NOT re-scan them. Without this, the loop tries to
-- read the WORM chunks referenced by object_keys (which do not exist in dev
-- MinIO), records 'error' verdicts on every tick, and appends error verdicts to
-- the attestation ledger — breaking the ledger verify chain. The promotion gate
-- reads the newest 'clean' verdict per recovery point, so this is also the
-- demo-ready promotable state.
INSERT INTO dr_cleanroom_scan (id, tenant_id, recovery_point_id, group_id, verdict, scanner, chunks_scanned, bytes_scanned, detail, findings, started_at, finished_at)
VALUES
  ('d1c1ea00-0000-0000-0000-000000000001', :tenant, :rp_old, :grp, 'clean', 'signature', 3, 4194304, 'clean-room scan passed', '[]'::jsonb, now() - interval '6 hours',   now() - interval '6 hours'   + interval '40 seconds'),
  ('d1c1ea00-0000-0000-0000-000000000002', :tenant, :rp_new, :grp, 'clean', 'signature', 3, 4194304, 'clean-room scan passed', '[]'::jsonb, now() - interval '12 minutes', now() - interval '12 minutes' + interval '35 seconds')
ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- 6. Failover runs: one COMPLETED drill (non-disruptive) + one COMPLETED real
--    failover. Both with steps + a sealed attestation row, so /dr activity and
--    /dr/prove have content.
-- =============================================================================
INSERT INTO failover_run (id, tenant_id, group_id, mode, status, recovery_point_id, rto_objective_seconds, initiated_by, approved_by, initiated_at, completed_at, rto_actual_seconds)
VALUES
  (:run_drill, :tenant, :grp, 'drill', 'COMPLETED', :rp_old, 900, :operator, :operator,
     now() - interval '5 days',  now() - interval '5 days'  + interval '11 minutes', 660),
  (:run_real,  :tenant, :grp, 'real',  'COMPLETED', :rp_new, 900, :operator, :operator,
     now() - interval '2 days',  now() - interval '2 days'  + interval '13 minutes', 780)
ON CONFLICT (id) DO UPDATE
  SET status = EXCLUDED.status,
      completed_at = EXCLUDED.completed_at,
      rto_actual_seconds = EXCLUDED.rto_actual_seconds,
      updated_at = now();

INSERT INTO failover_step (run_id, step, status, detail, started_at, finished_at)
VALUES
  (:run_drill, 'quiesce',          'passed', '{"note":"source quiesced (drill, isolated profile)"}'::jsonb, now() - interval '5 days', now() - interval '5 days' + interval '1 minute'),
  (:run_drill, 'gate1',            'passed', '{"gate":"replication caught up"}'::jsonb,                       now() - interval '5 days' + interval '1 minute', now() - interval '5 days' + interval '2 minutes'),
  (:run_drill, 'gate2',            'passed', '{"gate":"human approval","approver":"admin@clario.dev"}'::jsonb, now() - interval '5 days' + interval '2 minutes', now() - interval '5 days' + interval '3 minutes'),
  (:run_drill, 'boot:core-banking','passed', '{"endpoint":"pg://dr-core-banking.apexbank.dr:5432/ledger"}'::jsonb, now() - interval '5 days' + interval '3 minutes', now() - interval '5 days' + interval '6 minutes'),
  (:run_drill, 'boot:payments',    'passed', '{"endpoint":"vm://dr-payments-gw-01.apexbank.dr"}'::jsonb,      now() - interval '5 days' + interval '6 minutes', now() - interval '5 days' + interval '8 minutes'),
  (:run_drill, 'gate4',            'passed', '{"gate":"attested","validation_ratio":0.9994}'::jsonb,          now() - interval '5 days' + interval '8 minutes', now() - interval '5 days' + interval '11 minutes'),

  (:run_real, 'quiesce',           'passed', '{"note":"source quiesced (real failover)"}'::jsonb,            now() - interval '2 days', now() - interval '2 days' + interval '1 minute'),
  (:run_real, 'gate1',             'passed', '{"gate":"replication caught up"}'::jsonb,                       now() - interval '2 days' + interval '1 minute', now() - interval '2 days' + interval '2 minutes'),
  (:run_real, 'gate2',             'passed', '{"gate":"human approval","approver":"admin@clario.dev"}'::jsonb, now() - interval '2 days' + interval '2 minutes', now() - interval '2 days' + interval '3 minutes'),
  (:run_real, 'boot:core-banking', 'passed', '{"endpoint":"pg://dr-core-banking.apexbank.dr:5432/ledger"}'::jsonb, now() - interval '2 days' + interval '3 minutes', now() - interval '2 days' + interval '7 minutes'),
  (:run_real, 'boot:payments',     'passed', '{"endpoint":"vm://dr-payments-gw-01.apexbank.dr"}'::jsonb,      now() - interval '2 days' + interval '7 minutes', now() - interval '2 days' + interval '9 minutes'),
  (:run_real, 'boot:docs',         'passed', '{"endpoint":"nfs://dr-docvault.apexbank.dr/customers"}'::jsonb, now() - interval '2 days' + interval '9 minutes', now() - interval '2 days' + interval '11 minutes'),
  (:run_real, 'gate4',             'passed', '{"gate":"attested","validation_ratio":0.9998}'::jsonb,          now() - interval '2 days' + interval '11 minutes', now() - interval '2 days' + interval '13 minutes')
ON CONFLICT (run_id, step) DO NOTHING;

INSERT INTO attestation (tenant_id, run_id, rto_objective_seconds, rto_actual_seconds, rpo_seconds, validation_ratio, report_object_key, content_hash)
VALUES
  (:tenant, :run_drill, 900, 660, 58, 0.9994, 'worm/apex/attest/drill-2026.json', 'c0ffee0011223344556677889900aabbccddeeff00112233445566778899aabb'),
  (:tenant, :run_real,  900, 780, 41, 0.9998, 'worm/apex/attest/real-2026.json',  'deadbeef00112233445566778899aabbccddeeff00112233445566778899aabb')
ON CONFLICT (run_id) DO NOTHING;

-- =============================================================================
-- 7. Drill schedule + drill results (the /dr/rehearse + /dr drill activity)
-- =============================================================================
INSERT INTO dr_drill_schedule (id, tenant_id, group_id, name, cron_expr, profile, rto_objective_seconds, enabled, next_run)
VALUES
  ('d1d50001-0000-0000-0000-000000000001', :tenant, :grp, 'Quarterly Core Banking DR Drill',
     '0 2 1 */3 *', 'isolated', 900, true, now() + interval '20 days')
ON CONFLICT (id) DO NOTHING;

INSERT INTO dr_drill_result (id, tenant_id, group_id, schedule_id, run_id, passed, rto_achieved_seconds, rpo_achieved_seconds, rto_objective_seconds, recovery_point_id, validation_ratio, validation_outcome, steps, asset_fingerprint, observed_at)
VALUES
  ('d1d50002-0000-0000-0000-000000000001', :tenant, :grp, 'd1d50001-0000-0000-0000-000000000001',
     'drill-2026-q1', true, 720, 62, 900, :rp_old, 0.9990, 'health green; all probes passed',
     '[{"key":"quiesce","title":"Quiesce source","status":"passed","duration_ms":60000},{"key":"gate1","title":"Replication catch-up","status":"passed","duration_ms":60000},{"key":"boot:core-banking","title":"Boot Core Banking DB","status":"passed","duration_ms":180000},{"key":"gate4","title":"Attest","status":"passed","duration_ms":120000}]'::jsonb,
     '{"members":{"d10a0001-0000-0000-0000-000000000001":10,"d10a0001-0000-0000-0000-000000000002":20,"d10a0001-0000-0000-0000-000000000003":30},"topology_edges":["d10a0001-0000-0000-0000-000000000001->d10a0001-0000-0000-0000-000000000002","d10a0001-0000-0000-0000-000000000002->d10a0001-0000-0000-0000-000000000003"]}'::jsonb,
     now() - interval '95 days'),
  ('d1d50002-0000-0000-0000-000000000002', :tenant, :grp, 'd1d50001-0000-0000-0000-000000000001',
     'drill-2026-q2', true, 660, 58, 900, :rp_old, 0.9994, 'health green; payments boot 40s faster than prior',
     '[{"key":"quiesce","title":"Quiesce source","status":"passed","duration_ms":60000},{"key":"gate1","title":"Replication catch-up","status":"passed","duration_ms":60000},{"key":"boot:core-banking","title":"Boot Core Banking DB","status":"passed","duration_ms":180000},{"key":"boot:payments","title":"Boot Payments GW","status":"passed","duration_ms":120000},{"key":"gate4","title":"Attest","status":"passed","duration_ms":180000}]'::jsonb,
     '{"members":{"d10a0001-0000-0000-0000-000000000001":10,"d10a0001-0000-0000-0000-000000000002":20,"d10a0001-0000-0000-0000-000000000003":30},"topology_edges":["d10a0001-0000-0000-0000-000000000001->d10a0001-0000-0000-0000-000000000002","d10a0001-0000-0000-0000-000000000002->d10a0001-0000-0000-0000-000000000003"]}'::jsonb,
     now() - interval '5 days')
ON CONFLICT (run_id) DO NOTHING;

-- =============================================================================
-- 8. Replication topology (nodes + edges) — /dr/topology
-- =============================================================================
INSERT INTO dr_topology_node (id, tenant_id, group_id, site_id, role)
VALUES
  (:node_db,   :tenant, :grp, :site_db,   'source'),
  (:node_pay,  :tenant, :grp, :site_pay,  'source'),
  (:node_docs, :tenant, :grp, :site_docs, 'source')
ON CONFLICT (group_id, site_id) DO NOTHING;

-- A single DR target node: reuse the DB site to satisfy the (group, site) unique
-- + FK, but mark it as the 'target' role. (Topology models source->target
-- replication edges; the recovery executor uses recovery_target for boot.)
-- We add target edges from each source to the DB-as-target node only when the
-- (group, site) target row does not collide — so we model target reachability
-- via edge health on the source nodes themselves.
INSERT INTO dr_topology_edge (id, tenant_id, group_id, from_node_id, to_node_id, stream_id, mode, priority, health, lag_seconds, applied_seq, last_progress_at)
VALUES
  ('d170ed00-0000-0000-0000-000000000001', :tenant, :grp, :node_db,  :node_pay,  'd1570001-0000-0000-0000-000000000001', 'async', 1, 'healthy',   35,  184523, now() - interval '35 seconds'),
  ('d170ed00-0000-0000-0000-000000000002', :tenant, :grp, :node_pay, :node_docs, 'd1570001-0000-0000-0000-000000000002', 'async', 2, 'degraded',  360, 41277,  now() - interval '6 minutes')
ON CONFLICT (group_id, from_node_id, to_node_id) DO NOTHING;

-- =============================================================================
-- 9. Recovery runbook (registry, group-scoped) + its version — /dr/recover,
--    /dr/readiness, group detail.
-- =============================================================================
INSERT INTO dr_recovery_runbook (id, tenant_id, group_id, current_version, template_id)
VALUES (:rbk, :tenant, :grp, 1, 'dr.standard.v1')
ON CONFLICT (group_id) DO UPDATE SET current_version = EXCLUDED.current_version, updated_at = now();

INSERT INTO dr_recovery_runbook_version (id, runbook_id, tenant_id, group_id, version, template_id, steps, asset_snapshot, content_hash, diff, trigger)
VALUES
  ('d1bb0002-0000-0000-0000-000000000001', :rbk, :tenant, :grp, 1, 'dr.standard.v1',
     '[
        {"key":"pin_recovery_point","order":1,"kind":"pin_recovery_point","title":"Pin latest validated recovery point","description":"Select the most recent validated, legal-held recovery point as the recovery source.","params":{"recovery_point_marker":"0/3A9F0010"}},
        {"key":"quiesce","order":2,"kind":"quiesce","title":"Quiesce source workloads","description":"Stop source I/O to reach a consistency barrier."},
        {"key":"gate1","order":3,"kind":"health_gate","gate":"gate1","title":"Gate 1: replication caught up","description":"Verify all streams are within RPO objective."},
        {"key":"approval","order":4,"kind":"approval","gate":"gate2","title":"Gate 2: operator approval","description":"Require dr:failover approval before booting at the recovery site.","params":{"permission":"dr:failover"}},
        {"key":"boot_member:core-banking","order":5,"kind":"boot_member","title":"Boot Core Banking Ledger DB","description":"Boot the database at the recovery site (boot order 10).","params":{"site_id":"d10a0001-0000-0000-0000-000000000001","endpoint":"pg://dr-core-banking.apexbank.dr:5432/ledger"}},
        {"key":"boot_member:payments","order":6,"kind":"boot_member","title":"Boot Payments Gateway VM","description":"Boot the payments gateway (boot order 20).","params":{"site_id":"d10a0001-0000-0000-0000-000000000002","endpoint":"vm://dr-payments-gw-01.apexbank.dr"}},
        {"key":"boot_member:docs","order":7,"kind":"boot_member","title":"Boot Customer Documents Vault","description":"Boot the document fileset (boot order 30).","params":{"site_id":"d10a0001-0000-0000-0000-000000000003","endpoint":"nfs://dr-docvault.apexbank.dr/customers"}},
        {"key":"health_gate","order":8,"kind":"health_gate","gate":"gate3","title":"Gate 3: health probes green","description":"Block until every member health probe passes or the deadline trips."},
        {"key":"attest","order":9,"kind":"attest","gate":"gate4","title":"Gate 4: seal attestation","description":"Seal the RTO/RPO/validation attestation to WORM and append to the ledger."}
      ]'::jsonb,
     '{
        "group_id":"d10c0001-0000-0000-0000-000000000001",
        "group_name":"Core Banking Platform",
        "rto_objective_seconds":1800,
        "rpo_objective_seconds":60,
        "network_profile":"production",
        "members":[
          {"site_id":"d10a0001-0000-0000-0000-000000000001","site_name":"Core Banking Ledger DB","site_kind":"database","primary_endpoint":"pg://core-banking.apexbank.internal:5432/ledger","boot_order":10,"network_profile":"production","primary_cidr":"10.20.0.0/16","recovery_cidr":"10.120.0.0/16"},
          {"site_id":"d10a0001-0000-0000-0000-000000000002","site_name":"Payments Gateway VM","site_kind":"vm","primary_endpoint":"vm://payments-gw-01.apexbank.internal","boot_order":20,"network_profile":"production","primary_cidr":"10.20.0.0/16","recovery_cidr":"10.120.0.0/16"},
          {"site_id":"d10a0001-0000-0000-0000-000000000003","site_name":"Customer Documents Vault","site_kind":"fileset","primary_endpoint":"nfs://docvault.apexbank.internal/customers","boot_order":30,"network_profile":"production","primary_cidr":"10.20.0.0/16","recovery_cidr":"10.120.0.0/16"}
        ],
        "recovery_point":{"id":"d12c0001-0000-0000-0000-000000000002","marker_lsn":"0/3A9F0010","rpo_seconds":41,"validation_ratio":0.9998,"is_validated":true,"legal_hold":true,"sealed_at":"2026-06-22T00:00:00Z"},
        "captured_at":"2026-06-22T00:00:00Z"
      }'::jsonb,
     '7f1c3b9a2d4e5f60718293a4b5c6d7e8f90112233445566778899aabbccddeef0',
     NULL, 'manual')
ON CONFLICT (runbook_id, version) DO NOTHING;

-- =============================================================================
-- 10. Studio runbook (the authorable DAG behind /dr/runbooks/<id>)
-- =============================================================================
INSERT INTO dr_studio_runbook (id, tenant_id, group_id, name, description, status, source_runbook, created_by)
VALUES
  (:st_rbk, :tenant, :grp, 'Core Banking Failover Playbook',
     'Operator-authored failover playbook for the Core Banking Platform group.',
     'published', 'registry', :operator)
ON CONFLICT (id) DO NOTHING;

INSERT INTO dr_studio_task (id, tenant_id, runbook_id, task_key, name, task_type, required, owner, team, instructions, planned_duration_seconds, automation_action, params)
VALUES
  ('d157ba01-0000-0000-0000-000000000001', :tenant, :st_rbk, 'declare_incident', 'Declare DR incident', 'comms', true, 'Duty Manager', 'BCM', 'Page the DR bridge and declare the incident.', 300, '', '{"recipients":["dr-bridge@apexbank.internal"]}'::jsonb),
  ('d157ba01-0000-0000-0000-000000000002', :tenant, :st_rbk, 'pin_rp', 'Pin recovery point', 'manual', true, 'DR Engineer', 'Platform', 'Pin the latest validated recovery point.', 120, '', '{}'::jsonb),
  ('d157ba01-0000-0000-0000-000000000003', :tenant, :st_rbk, 'approve_failover', 'Approve failover', 'approval_gate', true, 'CISO', 'Security', 'Sign off the failover (Gate 2).', 600, 'dr:failover', '{}'::jsonb),
  ('d157ba01-0000-0000-0000-000000000004', :tenant, :st_rbk, 'boot_db', 'Boot Core Banking DB', 'automated', true, '', 'Platform', 'Boot the database at the DR site.', 180, 'dr.boot.database', '{"site_id":"d10a0001-0000-0000-0000-000000000001"}'::jsonb),
  ('d157ba01-0000-0000-0000-000000000005', :tenant, :st_rbk, 'attest', 'Seal attestation', 'milestone', true, 'DR Engineer', 'Platform', 'Seal the attestation and notify auditors.', 120, '', '{}'::jsonb)
ON CONFLICT (runbook_id, task_key) DO NOTHING;

-- wire a simple linear DAG via predecessors (task_key order)
UPDATE dr_studio_task t SET predecessors = ARRAY[(SELECT id FROM dr_studio_task WHERE runbook_id = :st_rbk AND task_key = 'declare_incident')]
  WHERE t.runbook_id = :st_rbk AND t.task_key = 'pin_rp' AND cardinality(t.predecessors) = 0;
UPDATE dr_studio_task t SET predecessors = ARRAY[(SELECT id FROM dr_studio_task WHERE runbook_id = :st_rbk AND task_key = 'pin_rp')]
  WHERE t.runbook_id = :st_rbk AND t.task_key = 'approve_failover' AND cardinality(t.predecessors) = 0;
UPDATE dr_studio_task t SET predecessors = ARRAY[(SELECT id FROM dr_studio_task WHERE runbook_id = :st_rbk AND task_key = 'approve_failover')]
  WHERE t.runbook_id = :st_rbk AND t.task_key = 'boot_db' AND cardinality(t.predecessors) = 0;
UPDATE dr_studio_task t SET predecessors = ARRAY[(SELECT id FROM dr_studio_task WHERE runbook_id = :st_rbk AND task_key = 'boot_db')]
  WHERE t.runbook_id = :st_rbk AND t.task_key = 'attest' AND cardinality(t.predecessors) = 0;

-- =============================================================================
-- 11. Attestation ledger (hash-chained, genesis-first) — /dr/prove ledger.
--
--     The chain is built in SQL with hashes computed EXACTLY as the Go verifier
--     recomputes them:
--       payload_hash = sha256( jsonb-serialized payload bytes )           (hex)
--       entry_hash   = sha256( seq | type | subject | payload_hash | prev ) (hex)
--     where "|" is the ASCII unit separator chr(31), and the genesis prev_hash
--     is 64 zeros. The verifier reads the jsonb payload back as Postgres
--     serializes it (sorted keys, ": "/", " spacing); we therefore hash
--     payload::text so the stored hash matches the verifier's recompute.
--
--     Built only when the tenant chain is empty, so re-running is a no-op and we
--     never fork an existing chain.
-- =============================================================================
DO $ledger$
DECLARE
  v_tenant      uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  v_sep         text := chr(31);
  v_genesis     text := repeat('0', 64);
  v_prev        text;
  v_seq         bigint;
  v_payload     jsonb;
  v_subject     text;
  v_type        text;
  v_payload_h   text;
  v_entry_h     text;
  v_first_seq   bigint;
  v_last_seq    bigint;
  v_root        text;
  -- the chain definition: ordered (type, subject, payload) tuples for seq 1..4.
  v_entries     jsonb := jsonb_build_array(
    jsonb_build_object(
      'type','recovery_point_validation','subject','d12c0001-0000-0000-0000-000000000001',
      'payload', jsonb_build_object('content_hash','a1b2c3d4e5f60718293a4b5c6d7e8f90112233445566778899aabbccddeeff00','rpo_seconds',58,'validation_ratio',0.9994,'verdict','valid')),
    jsonb_build_object(
      'type','drill_attestation','subject','d1f00001-0000-0000-0000-000000000001',
      'payload', jsonb_build_object('mode','drill','rto_actual_seconds',660,'rto_objective_seconds',900,'rpo_seconds',58,'validation_ratio',0.9994,'verdict','pass')),
    jsonb_build_object(
      'type','recovery_point_validation','subject','d12c0001-0000-0000-0000-000000000002',
      'payload', jsonb_build_object('content_hash','ff00eeddccbbaa998877665544332211009f8e7d6c5b4a39281706f5e4d3c2b1','rpo_seconds',41,'validation_ratio',0.9998,'verdict','valid')),
    jsonb_build_object(
      'type','failover_attestation','subject','d1f00001-0000-0000-0000-000000000002',
      'payload', jsonb_build_object('mode','real','rto_actual_seconds',780,'rto_objective_seconds',900,'rpo_seconds',41,'validation_ratio',0.9998,'verdict','pass'))
  );
  v_item        jsonb;
BEGIN
  -- only build if this tenant has no ledger yet (never fork an existing chain)
  IF EXISTS (SELECT 1 FROM dr_attestation_ledger WHERE tenant_id = v_tenant) THEN
    RAISE NOTICE 'dr_attestation_ledger already populated for tenant %, skipping', v_tenant;
    RETURN;
  END IF;

  v_seq  := 1;
  v_prev := v_genesis;

  -- append seq 1..4 from the definition, chaining prev_hash forward.
  FOR v_item IN SELECT * FROM jsonb_array_elements(v_entries)
  LOOP
    v_type      := v_item->>'type';
    v_subject   := v_item->>'subject';
    v_payload   := v_item->'payload';
    v_payload_h := encode(digest(v_payload::text, 'sha256'), 'hex');
    v_entry_h   := encode(digest(
        v_seq::text || v_sep || v_type || v_sep || v_subject || v_sep || v_payload_h || v_sep || v_prev,
        'sha256'), 'hex');
    INSERT INTO dr_attestation_ledger (tenant_id, seq, entry_type, subject_id, payload, payload_hash, prev_hash, entry_hash)
    VALUES (v_tenant, v_seq, v_type, v_subject, v_payload, v_payload_h, v_prev, v_entry_h);
    v_prev := v_entry_h;
    v_seq  := v_seq + 1;
  END LOOP;

  -- anchor a checkpoint covering seq 1..4 (Merkle root modeled as sha256 over the
  -- concatenated entry hashes, hex). Stamp anchored_root on the covered entries,
  -- record the checkpoint row, then append an anchor_checkpoint ledger entry.
  v_first_seq := 1;
  v_last_seq  := v_seq - 1;  -- 4
  SELECT encode(digest(string_agg(entry_hash, '' ORDER BY seq), 'sha256'), 'hex')
    INTO v_root
    FROM dr_attestation_ledger
   WHERE tenant_id = v_tenant AND seq BETWEEN v_first_seq AND v_last_seq;

  UPDATE dr_attestation_ledger
     SET anchored_root = v_root
   WHERE tenant_id = v_tenant AND seq BETWEEN v_first_seq AND v_last_seq;

  INSERT INTO dr_attestation_checkpoint (tenant_id, from_seq, to_seq, merkle_root, entry_count, worm_object_key, worm_version_id)
  VALUES (v_tenant, v_first_seq, v_last_seq, v_root, (v_last_seq - v_first_seq + 1),
          'worm/apex/ledger/checkpoint-0001.json', 'v-apex-ckpt-0001');

  -- seq 5: anchor_checkpoint entry (records that 1..4 were sealed to WORM)
  v_type      := 'anchor_checkpoint';
  v_subject   := v_root;
  v_payload   := jsonb_build_object('from_seq',v_first_seq,'to_seq',v_last_seq,'merkle_root',v_root,'worm_object_key','worm/apex/ledger/checkpoint-0001.json');
  v_payload_h := encode(digest(v_payload::text, 'sha256'), 'hex');
  v_entry_h   := encode(digest(
      v_seq::text || v_sep || v_type || v_sep || v_subject || v_sep || v_payload_h || v_sep || v_prev,
      'sha256'), 'hex');
  INSERT INTO dr_attestation_ledger (tenant_id, seq, entry_type, subject_id, payload, payload_hash, prev_hash, entry_hash)
  VALUES (v_tenant, v_seq, v_type, v_subject, v_payload, v_payload_h, v_prev, v_entry_h);
END;
$ledger$;

COMMIT;
