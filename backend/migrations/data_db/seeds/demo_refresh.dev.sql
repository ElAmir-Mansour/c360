-- =============================================================================
-- DEV DEMO SEED — data_db ("push to 100" refresh for Apex Bank Holdings)
-- =============================================================================
-- PURPOSE
--   Make the Data suite (/data/*) demo look FULL + CURRENT for the test tenant
--   "Apex Bank Holdings" (admin@apexbank.demo). Two operations:
--     PART 1  Timestamp refresh  — shift the STALE list/detail series (~Mar/Apr
--             2026) forward by one uniform delta so list pages + secondary KPI
--             deltas land at "now", preserving relative spacing + cross-table
--             ordering and keeping future-dated items (next_run_at / next_sync_at)
--             relatively in the future.
--     PART 2  Long-tail seed     — fill the Pipeline Trend (30d) / Success Rate /
--             Recent Runs feeders that were gappy (only ~7 populated days, with
--             today showing 0% success), plus a handful of fresh sources +
--             contradictions so the 24h/48h delta KPIs are non-zero.
--
-- THIS IS A DEV SEED. It is NOT an auto-run migration (no schema_migrations row).
-- Run manually:
--   docker exec -i clario360-postgres psql -U clario -d data_db \
--     < backend/migrations/data_db/seeds/demo_refresh.dev.sql
--
-- IDEMPOTENCY
--   * PART 1 only shifts when the data is actually stale (anchor older than
--     7 days). Re-running once data is current is a no-op.
--   * PART 2 inserts are keyed on deterministic uuid_generate_v5 ids with
--     ON CONFLICT DO NOTHING / DO UPDATE, so re-running does not duplicate.
--
-- SAFETY / WHAT IS DELIBERATELY NOT TOUCHED
--   * No hash-chained / WORM / immutable tables exist in data_db. (audit_db,
--     *_ledger, siem cold/WORM, dr attestation hash chains live in OTHER DBs and
--     are out of scope here.) analytics_audit_log in this DB is an ordinary
--     mutable activity log (no entry_hash/prev_hash), so it is safe to shift.
--   * Series 1 (already-fresh chart feeders: pipeline_runs, quality_results) is
--     NOT bulk-shifted in PART 1 — shifting it would push current data into the
--     future. pipeline_run_logs.created_at IS realigned to its parent run because
--     it was stale (Mar) while its parent runs are current.
--   * FKs + enum/check constraints are preserved.
--
-- TENANT
\set apex_tenant '''aaaaaaaa-0000-0000-0000-000000000001'''
\set steward     '''bbbbbbbb-0000-0000-0000-000000000001'''
\set seed_ns     '''d47a0000-0000-5000-a000-000000000001'''
-- =============================================================================

BEGIN;

-- Make uuid_generate_v5 available (deterministic ids for idempotent inserts).
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- -----------------------------------------------------------------------------
-- PART 1 — UNIFORM TIMESTAMP SHIFT (stale list/detail "Series 2")
-- -----------------------------------------------------------------------------
-- Anchor = newest primary event in the stale series (data_models.created_at).
-- delta  = now() - anchor. Applied identically to every timestamp column of the
-- stale tables so relative spacing + cross-table ordering is preserved and the
-- newest rows land at ~now. Guarded: only runs if anchor is older than 7 days.
DO $$
DECLARE
    v_tenant uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
    v_anchor timestamptz;
    v_delta  interval;
BEGIN
    SELECT max(created_at) INTO v_anchor
    FROM data_models
    WHERE tenant_id = v_tenant AND deleted_at IS NULL;

    IF v_anchor IS NULL THEN
        RAISE NOTICE 'PART 1 skipped: no data_models anchor row.';
        RETURN;
    END IF;

    IF v_anchor > now() - interval '7 days' THEN
        RAISE NOTICE 'PART 1 skipped: data already current (anchor=%).', v_anchor;
        RETURN;
    END IF;

    v_delta := now() - v_anchor;
    RAISE NOTICE 'PART 1: shifting stale series by delta=% (anchor=%).', v_delta, v_anchor;

    -- data_sources
    UPDATE data_sources SET
        last_synced_at       = last_synced_at       + v_delta,
        created_at           = created_at           + v_delta,
        updated_at           = updated_at           + v_delta,
        schema_discovered_at = schema_discovered_at + v_delta,
        next_sync_at         = next_sync_at         + v_delta,
        deleted_at           = deleted_at           + v_delta
    WHERE tenant_id = v_tenant;

    -- pipelines (last_run_at/next_run_at kept in correct relative position)
    UPDATE pipelines SET
        last_run_at = last_run_at + v_delta,
        next_run_at = next_run_at + v_delta,
        created_at  = created_at  + v_delta,
        updated_at  = updated_at  + v_delta,
        deleted_at  = deleted_at  + v_delta
    WHERE tenant_id = v_tenant;

    -- data_models
    UPDATE data_models SET
        created_at = created_at + v_delta,
        updated_at = updated_at + v_delta,
        deleted_at = deleted_at + v_delta
    WHERE tenant_id = v_tenant;

    -- quality_rules
    UPDATE quality_rules SET
        created_at  = created_at  + v_delta,
        updated_at  = updated_at  + v_delta,
        last_run_at = last_run_at + v_delta,
        deleted_at  = deleted_at  + v_delta
    WHERE tenant_id = v_tenant;

    -- data_quality_rules (legacy table; has rows? shift if present)
    UPDATE data_quality_rules SET
        created_at    = created_at    + v_delta,
        updated_at    = updated_at    + v_delta,
        last_check_at = last_check_at + v_delta
    WHERE tenant_id = v_tenant;

    -- contradictions (created_at also drives the ContradictionsDelta KPI)
    UPDATE contradictions SET
        resolved_at = resolved_at + v_delta,
        created_at  = created_at  + v_delta,
        updated_at  = updated_at  + v_delta
    WHERE tenant_id = v_tenant;

    -- contradiction_scans
    UPDATE contradiction_scans SET
        started_at   = started_at   + v_delta,
        completed_at = completed_at + v_delta,
        created_at   = created_at   + v_delta
    WHERE tenant_id = v_tenant;

    -- dark_data_assets
    UPDATE dark_data_assets SET
        last_accessed_at = last_accessed_at + v_delta,
        discovered_at    = discovered_at    + v_delta,
        created_at       = created_at       + v_delta,
        updated_at       = updated_at       + v_delta,
        last_modified_at = last_modified_at + v_delta,
        reviewed_at      = reviewed_at      + v_delta
    WHERE tenant_id = v_tenant;

    -- dark_data_scans
    UPDATE dark_data_scans SET
        started_at   = started_at   + v_delta,
        completed_at = completed_at + v_delta,
        created_at   = created_at   + v_delta
    WHERE tenant_id = v_tenant;

    -- data_catalogs
    UPDATE data_catalogs SET
        last_accessed_at = last_accessed_at + v_delta,
        created_at       = created_at       + v_delta,
        updated_at       = updated_at       + v_delta
    WHERE tenant_id = v_tenant;

    -- data_lineage_edges
    UPDATE data_lineage_edges SET
        created_at    = created_at    + v_delta,
        first_seen_at = first_seen_at + v_delta,
        last_seen_at  = last_seen_at  + v_delta,
        updated_at    = updated_at    + v_delta
    WHERE tenant_id = v_tenant;

    -- data_lineage (empty today, but shift for completeness if rows exist)
    UPDATE data_lineage SET
        created_at = created_at + v_delta
    WHERE tenant_id = v_tenant;

    -- saved_queries
    UPDATE saved_queries SET
        last_run_at = last_run_at + v_delta,
        created_at  = created_at  + v_delta,
        updated_at  = updated_at  + v_delta,
        deleted_at  = deleted_at  + v_delta
    WHERE tenant_id = v_tenant;

    -- sync_history
    UPDATE sync_history SET
        started_at   = started_at   + v_delta,
        completed_at = completed_at + v_delta,
        created_at   = created_at   + v_delta
    WHERE tenant_id = v_tenant;

    -- analytics_audit_log (ordinary mutable activity log — NOT hash-chained)
    UPDATE analytics_audit_log SET
        executed_at = executed_at + v_delta
    WHERE tenant_id = v_tenant;
END $$;

-- -----------------------------------------------------------------------------
-- PART 1b — Realign pipeline_run_logs.created_at to their (already-fresh) parent
-- run. Logs were stale (Mar) while their parent pipeline_runs are current, which
-- would render run logs as dated months before the run they describe.
-- -----------------------------------------------------------------------------
UPDATE pipeline_run_logs l SET
    created_at = LEAST(
        COALESCE(r.completed_at, now()),
        r.started_at + (('x' || substr(md5(l.id::text), 1, 6))::bit(24)::int % 600) * interval '1 second'
    )
FROM pipeline_runs r
WHERE l.run_id = r.id
  AND l.tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001'
  AND l.created_at < r.started_at;  -- only fix logs that pre-date their run

-- -----------------------------------------------------------------------------
-- PART 2 — LONG-TAIL SEED: dense, current pipeline_runs across the last 30 days
-- -----------------------------------------------------------------------------
-- Fills gap days (and today's all-failed cluster) with a realistic mix so:
--   * Pipeline Trend (30d)  has a bucket every day
--   * Pipeline Success Rate sits in a healthy ~92-95% band
--   * Recent Runs list is full + current
-- ~48 runs/day x 30 days, round-robin over existing active pipelines.
-- Deterministic ids via uuid_generate_v5 -> idempotent.
WITH active_pipes AS (
    SELECT id, row_number() OVER (ORDER BY id) - 1 AS rn,
           count(*) OVER () AS n
    FROM pipelines
    WHERE tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001'
      AND deleted_at IS NULL
      AND status = 'active'
),
grid AS (
    SELECT d AS day_idx, s AS slot
    FROM generate_series(0, 29) d          -- last 30 days
    CROSS JOIN generate_series(0, 47) s    -- 48 runs/day
),
runs AS (
    SELECT
        uuid_generate_v5(
            'd47a0000-0000-5000-a000-000000000001'::uuid,
            'demo-run-' || g.day_idx || '-' || g.slot
        ) AS run_id,
        ap.id AS pipeline_id,
        -- spread runs through each day; newest day = today
        (date_trunc('day', now()) - (g.day_idx * interval '1 day')
            + (g.slot * interval '29 minutes')
            + (((('x' || substr(md5(g.day_idx::text||g.slot::text),1,4))::bit(16)::int) % 60) * interval '1 second')
        ) AS started_at,
        -- status mix: ~92% completed, ~6% failed, ~2% running
        (((('x' || substr(md5('st'||g.day_idx::text||g.slot::text),1,4))::bit(16)::int) % 100)) AS roll,
        ((('x' || substr(md5('dur'||g.day_idx::text||g.slot::text),1,6))::bit(24)::int) % 540 + 60) AS dur_s,
        ((('x' || substr(md5('rec'||g.day_idx::text||g.slot::text),1,6))::bit(24)::int) % 480000 + 20000) AS recs
    FROM grid g
    JOIN active_pipes ap ON ap.rn = ((g.day_idx * 48 + g.slot) % ap.n)
)
INSERT INTO pipeline_runs (
    id, tenant_id, pipeline_id, status, started_at, completed_at,
    records_processed, records_failed, records_extracted, records_transformed,
    records_loaded, bytes_read, bytes_written, duration_ms,
    quality_gates_passed, quality_gates_failed, triggered_by, created_at,
    current_phase, error_phase, error_message
)
SELECT
    run_id,
    'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
    pipeline_id,
    CASE WHEN roll < 92 THEN 'completed'
         WHEN roll < 98 THEN 'failed'
         ELSE 'running' END AS status,
    started_at,
    CASE WHEN roll < 98 THEN started_at + (dur_s * interval '1 second') ELSE NULL END AS completed_at,
    CASE WHEN roll < 92 THEN recs ELSE (recs/3) END,
    CASE WHEN roll < 92 THEN (recs/500) WHEN roll < 98 THEN (recs/8) ELSE 0 END,
    recs, recs, CASE WHEN roll < 92 THEN recs ELSE 0 END,
    recs * 128, CASE WHEN roll < 92 THEN recs * 96 ELSE 0 END,
    CASE WHEN roll < 98 THEN dur_s * 1000 ELSE NULL END,
    CASE WHEN roll < 92 THEN 5 ELSE 3 END,
    CASE WHEN roll < 92 THEN 0 WHEN roll < 98 THEN 2 ELSE 0 END,
    (ARRAY['schedule','manual','api','event'])[1 + (dur_s % 4)],
    started_at,
    CASE WHEN roll >= 98 THEN 'transform' ELSE NULL END,
    CASE WHEN roll >= 92 AND roll < 98 THEN 'load' ELSE NULL END,
    CASE WHEN roll >= 92 AND roll < 98 THEN 'Demo: load step exceeded retry budget' ELSE NULL END
FROM runs
ON CONFLICT (id) DO UPDATE SET
    status       = EXCLUDED.status,
    started_at   = EXCLUDED.started_at,
    completed_at = EXCLUDED.completed_at,
    duration_ms  = EXCLUDED.duration_ms,
    created_at   = EXCLUDED.created_at;

-- A few run logs for the freshest seeded runs so detail pages have content.
INSERT INTO pipeline_run_logs (id, tenant_id, run_id, level, phase, message, created_at)
SELECT
    uuid_generate_v5('d47a0000-0000-5000-a000-000000000001'::uuid, 'demo-runlog-' || r.id::text || '-' || ph.lvl),
    'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
    r.id,
    ph.lvl,
    ph.phase,
    ph.msg,
    r.started_at + (ph.ord * interval '7 seconds')
FROM pipeline_runs r
CROSS JOIN (VALUES
    ('info','extract','Extract phase started', 0),
    ('info','transform','Applied 12 transforms, deduplicated batch', 1),
    ('info','load','Load committed to target', 2)
) AS ph(lvl, phase, msg, ord)
WHERE r.tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001'
  AND r.started_at >= now() - interval '2 days'
  AND r.id IN (
      SELECT id FROM pipeline_runs
      WHERE tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001'
        AND started_at >= now() - interval '2 days'
      ORDER BY started_at DESC
      LIMIT 40
  )
ON CONFLICT (id) DO NOTHING;

-- -----------------------------------------------------------------------------
-- PART 2b — Roll up per-pipeline run stats so list page counters look alive.
-- -----------------------------------------------------------------------------
UPDATE pipelines p SET
    total_runs              = agg.total,
    successful_runs         = agg.ok,
    failed_runs             = agg.bad,
    total_records_processed = agg.recs,
    avg_duration_ms         = agg.avgdur,
    last_run_at             = agg.last_at,
    last_run_status         = agg.last_status,
    last_run_id             = agg.last_id,
    updated_at              = now()
FROM (
    SELECT pr.pipeline_id,
           count(*)                                    AS total,
           count(*) FILTER (WHERE pr.status='completed') AS ok,
           count(*) FILTER (WHERE pr.status='failed')    AS bad,
           sum(pr.records_processed)                   AS recs,
           round(avg(pr.duration_ms))::bigint          AS avgdur,
           max(pr.started_at)                          AS last_at,
           (array_agg(pr.status     ORDER BY pr.started_at DESC))[1] AS last_status,
           (array_agg(pr.id         ORDER BY pr.started_at DESC))[1] AS last_id
    FROM pipeline_runs pr
    WHERE pr.tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001'
    GROUP BY pr.pipeline_id
) agg
WHERE p.id = agg.pipeline_id
  AND p.tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001';

-- -----------------------------------------------------------------------------
-- PART 2c — A few FRESH data_sources (last 24h) so the SourceCountDelta KPI
-- (created in last 1d) is positive, and the sources list shows recent activity.
-- -----------------------------------------------------------------------------
INSERT INTO data_sources (
    id, tenant_id, name, description, type, connection_config, encryption_key_id,
    status, schema_metadata, schema_discovered_at, last_synced_at, last_sync_status,
    last_sync_duration_ms, next_sync_at, sync_frequency, table_count, total_row_count,
    total_size_bytes, tags, metadata, created_by, created_at, updated_at
)
SELECT
    uuid_generate_v5('d47a0000-0000-5000-a000-000000000001'::uuid, 'demo-fresh-source-' || g),
    'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
    (ARRAY['Treasury Ledger Stream','Core Banking CDC Feed','Risk Datamart Sync','KYC Document Lake','Payments Clearing API'])[g],
    'Recently onboarded connector (demo refresh).',
    (ARRAY['stream','postgresql','clickhouse','s3','api'])[g],
    convert_to(jsonb_build_object('host', format('apex-fresh-%s.internal', g))::text, 'UTF8'),
    'demo-data-key',
    'active',
    jsonb_build_object('schemas', jsonb_build_array('public'), 'sample_tables', jsonb_build_array(format('tbl_%s', g))),
    now() - (g * interval '90 minutes'),
    now() - (g * interval '40 minutes'),
    'success',
    1800 + g*120,
    now() + (g * interval '3 hours'),
    '0 */2 * * *',
    6 + g, 180000 + g*9000, 67108864 + g*1048576,
    ARRAY['demo','fresh','gold'],
    jsonb_build_object('seed_key','demo_refresh','sequence',g),
    'bbbbbbbb-0000-0000-0000-000000000001'::uuid,
    now() - (g * interval '5 hours'),       -- all within last ~24h
    now() - (g * interval '40 minutes')
FROM generate_series(1,5) g
ON CONFLICT (id) DO UPDATE SET
    created_at = EXCLUDED.created_at,
    updated_at = EXCLUDED.updated_at,
    last_synced_at = EXCLUDED.last_synced_at,
    status = EXCLUDED.status,
    deleted_at = NULL;

-- -----------------------------------------------------------------------------
-- PART 2d — A few FRESH contradictions (last 24h) so the ContradictionsDelta KPI
-- is positive and the contradictions list shows recent detections.
-- -----------------------------------------------------------------------------
INSERT INTO contradictions (
    id, tenant_id, type, source_a, source_b, description, severity,
    confidence_score, status, created_at, updated_at, title, affected_records, metadata
)
SELECT
    uuid_generate_v5('d47a0000-0000-5000-a000-000000000001'::uuid, 'demo-fresh-contradiction-' || g),
    'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
    (ARRAY['logical','semantic','temporal','analytical','logical','semantic'])[g],
    jsonb_build_object('source','Core Banking', 'field','balance', 'value', 100000 + g*321),
    jsonb_build_object('source','Treasury Ledger', 'field','balance', 'value', 100000 + g*999),
    'Recently detected discrepancy between systems of record (demo refresh).',
    (ARRAY['high','critical','medium','high','low','medium'])[g],
    0.70 + (g * 0.04),
    (ARRAY['detected','investigating','detected','detected','investigating','detected'])[g],
    now() - (g * interval '3 hours'),       -- within last ~24h
    now() - (g * interval '3 hours'),
    format('Balance mismatch on account batch %s', lpad(g::text,3,'0')),
    50 + g*17,
    jsonb_build_object('seed_key','demo_refresh','sequence',g)
FROM generate_series(1,6) g
ON CONFLICT (id) DO UPDATE SET
    created_at = EXCLUDED.created_at,
    updated_at = EXCLUDED.updated_at,
    status = EXCLUDED.status,
    severity = EXCLUDED.severity;

COMMIT;

-- =============================================================================
-- VERIFY (run separately if desired)
--   select date_trunc('day',started_at)::date d, count(*),
--          count(*) filter (where status='completed') ok
--   from pipeline_runs
--   where tenant_id='aaaaaaaa-0000-0000-0000-000000000001'
--     and started_at >= now()-interval '30 days'
--   group by 1 order by 1;
-- =============================================================================
