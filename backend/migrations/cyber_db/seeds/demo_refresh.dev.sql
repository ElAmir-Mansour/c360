-- =============================================================================
-- demo_refresh.dev.sql  —  DEV-ONLY DEMO DATA REFRESH for cyber_db
-- =============================================================================
-- PURPOSE
--   "Push to 100": make the Clario360 Cyber demo look FULL + CURRENT for the
--   test tenant "Apex Bank Holdings" (admin@apexbank.demo).
--   The frontend is UI-complete; pages looked sparse because seed timestamps
--   were ~80-90 days stale (24h / 7d / 30d charts empty) and a couple of recent
--   windows were thin.
--
-- THIS IS NOT AN AUTO-RUN MIGRATION.
--   It lives under migrations/cyber_db/seeds/ on purpose so the migrator
--   (which only picks up NNNNNN_*.up.sql in migrations/cyber_db/) never runs it.
--   Run manually:
--     docker exec -i clario360-postgres psql -U clario -d cyber_db \
--        < backend/migrations/cyber_db/seeds/demo_refresh.dev.sql
--
-- WHAT IT DOES
--   1) TIMESTAMP REFRESH (per-subsystem uniform delta):
--      cyber_db was seeded by several independent seeders at different times,
--      so a SINGLE global delta is wrong (alerts/threats/vulns are already at
--      ~now; security_events/dspm/cti/ueba_alerts/vciso are ~80-90d stale).
--      For each independently-seeded SERIES we compute ONE uniform delta
--          delta = now() - max(<that series' newest timestamp>)
--      and shift EVERY time column in that series by the SAME delta. This
--      preserves intra-series relative spacing + cross-table ordering and keeps
--      future-dated rows (renewals, SLA due, review-due) in the relative future.
--      Series already at ~now are intentionally NOT shifted.
--
--   2) LONG-TAIL SEED: tops up the few recent windows that stayed thin after
--      the shift (ueba_alerts recent spread).
--
-- SAFETY  (tables explicitly SKIPPED — never touched):
--   * dspm_remediation_history     -> hash-chain (entry_hash / prev_hash). WORM.
--   * remediation_audit_trail      -> audit trail (WORM-style). not a chart series.
--   * vciso_llm_audit_log          -> LLM audit log (WORM-style).
--   These are skipped to avoid breaking hash chains / immutability. Their
--   created_at therefore stays in March; this is intentional and acceptable
--   because they are not surfaced as recent-window trend/list charts.
--
-- IDEMPOTENCY
--   The shifts are keyed to each series' own current MAX, so re-running after a
--   day or two simply re-aligns the newest row back to now() (delta shrinks).
--   The ueba_alerts top-up is guarded so it won't duplicate on re-run.
--
-- TARGET TENANT: Apex Bank Holdings = aaaaaaaa-0000-0000-0000-000000000001
-- =============================================================================

\set TENANT '''aaaaaaaa-0000-0000-0000-000000000001'''

-- Partitioned event tables span May-Jul after the shift; ensure partitions exist.
-- (security_events originally had only _02/_03/_04; dspm_access_audit had _03.._06)
CREATE TABLE IF NOT EXISTS security_events_2026_05 PARTITION OF security_events
  FOR VALUES FROM ('2026-05-01 00:00:00+00') TO ('2026-06-01 00:00:00+00');
CREATE TABLE IF NOT EXISTS security_events_2026_06 PARTITION OF security_events
  FOR VALUES FROM ('2026-06-01 00:00:00+00') TO ('2026-07-01 00:00:00+00');
CREATE TABLE IF NOT EXISTS security_events_2026_07 PARTITION OF security_events
  FOR VALUES FROM ('2026-07-01 00:00:00+00') TO ('2026-08-01 00:00:00+00');
CREATE TABLE IF NOT EXISTS dspm_access_audit_2026_07 PARTITION OF dspm_access_audit
  FOR VALUES FROM ('2026-07-01 00:00:00+00') TO ('2026-08-01 00:00:00+00');

BEGIN;

-- =============================================================================
-- CLUSTER A — SOC core / asset / ctem / detection (seed max ~2026-03-27 07:49)
-- delta keyed off ctem_findings (representative newest of this seed batch).
-- Tables: alert_comments, asset_activity, asset_relationships, assets,
--         ctem_assessments, ctem_findings, ctem_remediation_groups,
--         detection_rules, exposure_score_snapshots, scan_history,
--         threat_indicators, dspm_classification_history, risk_score_history(date).
-- NOTE: alerts / alert_timeline / threats / vulnerabilities / remediation_actions
--       are ALREADY at ~now and are deliberately excluded.
-- =============================================================================
DO $$
DECLARE
  v_tenant uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  d interval;
BEGIN
  SELECT now() - max(created_at) INTO d FROM ctem_findings WHERE tenant_id = v_tenant;
  IF d IS NULL OR d <= interval '1 day' THEN
    RAISE NOTICE 'Cluster A: already current (delta=%), skipping', d;
  ELSE
    RAISE NOTICE 'Cluster A delta = %', d;

    UPDATE alert_comments SET created_at = created_at + d, updated_at = updated_at + d
      WHERE tenant_id = v_tenant;

    UPDATE asset_activity SET created_at = created_at + d
      WHERE tenant_id = v_tenant;

    UPDATE asset_relationships SET created_at = created_at + d
      WHERE tenant_id = v_tenant;

    UPDATE assets SET
        created_at    = created_at + d,
        updated_at    = updated_at + d,
        discovered_at = discovered_at + d,
        last_seen_at  = last_seen_at + d,
        deleted_at    = CASE WHEN deleted_at IS NULL THEN NULL ELSE deleted_at + d END
      WHERE tenant_id = v_tenant;

    UPDATE ctem_assessments SET
        created_at   = created_at + d,
        updated_at   = updated_at + d,
        started_at   = CASE WHEN started_at   IS NULL THEN NULL ELSE started_at + d END,
        completed_at = CASE WHEN completed_at IS NULL THEN NULL ELSE completed_at + d END,
        deleted_at   = CASE WHEN deleted_at   IS NULL THEN NULL ELSE deleted_at + d END
      WHERE tenant_id = v_tenant;

    UPDATE ctem_findings SET
        created_at        = created_at + d,
        updated_at        = updated_at + d,
        status_changed_at = CASE WHEN status_changed_at IS NULL THEN NULL ELSE status_changed_at + d END,
        validated_at      = CASE WHEN validated_at      IS NULL THEN NULL ELSE validated_at + d END
      WHERE tenant_id = v_tenant;

    UPDATE ctem_remediation_groups SET
        created_at   = created_at + d,
        updated_at   = updated_at + d,
        started_at   = CASE WHEN started_at   IS NULL THEN NULL ELSE started_at + d END,
        completed_at = CASE WHEN completed_at IS NULL THEN NULL ELSE completed_at + d END,
        target_date  = CASE WHEN target_date  IS NULL THEN NULL ELSE (target_date + d)::date END
      WHERE tenant_id = v_tenant;

    UPDATE detection_rules SET
        created_at         = created_at + d,
        updated_at         = updated_at + d,
        last_triggered_at  = CASE WHEN last_triggered_at IS NULL THEN NULL ELSE last_triggered_at + d END,
        deleted_at         = CASE WHEN deleted_at        IS NULL THEN NULL ELSE deleted_at + d END
      WHERE tenant_id = v_tenant;

    UPDATE exposure_score_snapshots SET created_at = created_at + d
      WHERE tenant_id = v_tenant;

    UPDATE scan_history SET
        created_at   = created_at + d,
        started_at   = CASE WHEN started_at   IS NULL THEN NULL ELSE started_at + d END,
        completed_at = CASE WHEN completed_at IS NULL THEN NULL ELSE completed_at + d END
      WHERE tenant_id = v_tenant;

    UPDATE threat_indicators SET
        created_at    = created_at + d,
        updated_at    = updated_at + d,
        first_seen_at = CASE WHEN first_seen_at IS NULL THEN NULL ELSE first_seen_at + d END,
        last_seen_at  = CASE WHEN last_seen_at  IS NULL THEN NULL ELSE last_seen_at + d END,
        expires_at    = CASE WHEN expires_at    IS NULL THEN NULL ELSE expires_at + d END
      WHERE tenant_id = v_tenant;

    UPDATE dspm_classification_history SET created_at = created_at + d
      WHERE tenant_id = v_tenant;

    -- risk_score_history: only shift the STALE March batch; recent daily rows
    -- (already at ~now) are left in place.
    UPDATE risk_score_history SET
        calculated_at = calculated_at + d,
        calculated_on = (calculated_on + d)::date
      WHERE tenant_id = v_tenant AND calculated_at < (now() - interval '40 days');
  END IF;
END $$;

-- =============================================================================
-- CLUSTER B — security_events (partitioned; seed max ~2026-03-28 23:59)
-- delta keyed off the events' own newest timestamp.
-- =============================================================================
DO $$
DECLARE
  v_tenant uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  d interval;
BEGIN
  SELECT now() - max(timestamp) INTO d FROM security_events WHERE tenant_id = v_tenant;
  IF d IS NULL OR d <= interval '1 day' THEN
    RAISE NOTICE 'Cluster B (security_events): already current (delta=%), skipping', d;
  ELSE
    RAISE NOTICE 'Cluster B (security_events) delta = %', d;
    UPDATE security_events SET
        timestamp    = timestamp + d,
        processed_at = processed_at + d
      WHERE tenant_id = v_tenant;
  END IF;
END $$;

-- =============================================================================
-- CLUSTER C — DSPM bulk (seed max ~2026-03-27 12:21) incl. dspm_access_audit
-- (partitioned on created_at). delta keyed off dspm_data_assets.last_scanned_at.
-- Tables: dspm_data_assets, dspm_scans, dspm_remediations, dspm_identity_profiles,
--         dspm_ai_data_usage, dspm_access_mappings, dspm_compliance_posture,
--         dspm_financial_impact, dspm_access_audit, dspm_data_lineage,
--         dspm_data_policies, dspm_access_policies, dspm_risk_exceptions.
-- SKIPPED: dspm_remediation_history (hash-chain).
-- =============================================================================
DO $$
DECLARE
  v_tenant uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  d interval;
BEGIN
  SELECT now() - max(last_scanned_at) INTO d FROM dspm_data_assets WHERE tenant_id = v_tenant;
  IF d IS NULL OR d <= interval '1 day' THEN
    RAISE NOTICE 'Cluster C (DSPM): already current (delta=%), skipping', d;
  ELSE
    RAISE NOTICE 'Cluster C (DSPM) delta = %', d;

    UPDATE dspm_data_assets SET
        created_at        = created_at + d,
        updated_at        = updated_at + d,
        last_scanned_at   = CASE WHEN last_scanned_at   IS NULL THEN NULL ELSE last_scanned_at + d END,
        last_access_review= CASE WHEN last_access_review IS NULL THEN NULL ELSE last_access_review + d END
      WHERE tenant_id = v_tenant;

    UPDATE dspm_scans SET
        created_at   = created_at + d,
        started_at   = CASE WHEN started_at   IS NULL THEN NULL ELSE started_at + d END,
        completed_at = CASE WHEN completed_at IS NULL THEN NULL ELSE completed_at + d END
      WHERE tenant_id = v_tenant;

    UPDATE dspm_remediations SET
        created_at   = created_at + d,
        updated_at   = updated_at + d,
        sla_due_at   = CASE WHEN sla_due_at   IS NULL THEN NULL ELSE sla_due_at + d END,
        completed_at = CASE WHEN completed_at IS NULL THEN NULL ELSE completed_at + d END
      WHERE tenant_id = v_tenant;

    UPDATE dspm_identity_profiles SET
        created_at       = created_at + d,
        updated_at       = updated_at + d,
        last_activity_at = CASE WHEN last_activity_at IS NULL THEN NULL ELSE last_activity_at + d END,
        last_review_at   = CASE WHEN last_review_at   IS NULL THEN NULL ELSE last_review_at + d END,
        next_review_due  = CASE WHEN next_review_due  IS NULL THEN NULL ELSE next_review_due + d END
      WHERE tenant_id = v_tenant;

    UPDATE dspm_ai_data_usage SET
        created_at        = created_at + d,
        updated_at        = updated_at + d,
        first_detected_at = CASE WHEN first_detected_at IS NULL THEN NULL ELSE first_detected_at + d END,
        last_detected_at  = CASE WHEN last_detected_at  IS NULL THEN NULL ELSE last_detected_at + d END
      WHERE tenant_id = v_tenant;

    UPDATE dspm_access_mappings SET
        created_at       = created_at + d,
        updated_at       = updated_at + d,
        discovered_at    = CASE WHEN discovered_at    IS NULL THEN NULL ELSE discovered_at + d END,
        last_used_at     = CASE WHEN last_used_at     IS NULL THEN NULL ELSE last_used_at + d END,
        last_verified_at = CASE WHEN last_verified_at IS NULL THEN NULL ELSE last_verified_at + d END,
        expires_at       = CASE WHEN expires_at       IS NULL THEN NULL ELSE expires_at + d END
      WHERE tenant_id = v_tenant;

    UPDATE dspm_compliance_posture SET
        created_at   = created_at + d,
        updated_at   = updated_at + d,
        evaluated_at = CASE WHEN evaluated_at IS NULL THEN NULL ELSE evaluated_at + d END
      WHERE tenant_id = v_tenant;

    UPDATE dspm_financial_impact SET
        created_at    = created_at + d,
        updated_at    = updated_at + d,
        calculated_at = CASE WHEN calculated_at IS NULL THEN NULL ELSE calculated_at + d END
      WHERE tenant_id = v_tenant;

    UPDATE dspm_data_lineage SET
        created_at       = created_at + d,
        updated_at       = updated_at + d,
        last_transfer_at = CASE WHEN last_transfer_at IS NULL THEN NULL ELSE last_transfer_at + d END
      WHERE tenant_id = v_tenant;

    UPDATE dspm_data_policies SET
        created_at        = created_at + d,
        updated_at        = updated_at + d,
        last_evaluated_at = CASE WHEN last_evaluated_at IS NULL THEN NULL ELSE last_evaluated_at + d END
      WHERE tenant_id = v_tenant;

    UPDATE dspm_access_policies SET created_at = created_at + d, updated_at = updated_at + d
      WHERE tenant_id = v_tenant;

    UPDATE dspm_risk_exceptions SET
        created_at       = created_at + d,
        updated_at       = updated_at + d,
        approved_at      = CASE WHEN approved_at      IS NULL THEN NULL ELSE approved_at + d END,
        last_reviewed_at = CASE WHEN last_reviewed_at IS NULL THEN NULL ELSE last_reviewed_at + d END,
        next_review_at   = CASE WHEN next_review_at   IS NULL THEN NULL ELSE next_review_at + d END,
        expires_at       = CASE WHEN expires_at       IS NULL THEN NULL ELSE expires_at + d END
      WHERE tenant_id = v_tenant;

    -- dspm_access_audit (partitioned on created_at): shift created_at + event_timestamp
    UPDATE dspm_access_audit SET
        created_at      = created_at + d,
        event_timestamp = event_timestamp + d
      WHERE tenant_id = v_tenant;
  END IF;
END $$;

-- =============================================================================
-- CLUSTER D — CTI threat activity (seed max ~2026-04-04 11:15)
-- delta keyed off cti_campaigns.created_at.
-- Tables: cti_threat_actors, cti_campaigns, cti_campaign_events,
--         cti_campaign_iocs, cti_brand_abuse_incidents, cti_threat_events.
-- NOTE: cti_geo/sector_threat_summary + cti_executive_snapshot are already at
--       ~now (recomputed live) and are excluded.
-- =============================================================================
DO $$
DECLARE
  v_tenant uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  d interval;
BEGIN
  SELECT now() - max(created_at) INTO d FROM cti_campaigns WHERE tenant_id = v_tenant;
  IF d IS NULL OR d <= interval '1 day' THEN
    RAISE NOTICE 'Cluster D (CTI): already current (delta=%), skipping', d;
  ELSE
    RAISE NOTICE 'Cluster D (CTI) delta = %', d;

    UPDATE cti_threat_actors SET
        created_at        = created_at + d,
        updated_at        = updated_at + d,
        first_observed_at = CASE WHEN first_observed_at IS NULL THEN NULL ELSE first_observed_at + d END,
        last_activity_at  = CASE WHEN last_activity_at  IS NULL THEN NULL ELSE last_activity_at + d END,
        deleted_at        = CASE WHEN deleted_at        IS NULL THEN NULL ELSE deleted_at + d END
      WHERE tenant_id = v_tenant;

    UPDATE cti_campaigns SET
        created_at    = created_at + d,
        updated_at    = updated_at + d,
        first_seen_at = CASE WHEN first_seen_at IS NULL THEN NULL ELSE first_seen_at + d END,
        last_seen_at  = CASE WHEN last_seen_at  IS NULL THEN NULL ELSE last_seen_at + d END,
        resolved_at   = CASE WHEN resolved_at   IS NULL THEN NULL ELSE resolved_at + d END,
        deleted_at    = CASE WHEN deleted_at    IS NULL THEN NULL ELSE deleted_at + d END
      WHERE tenant_id = v_tenant;

    UPDATE cti_campaign_events SET
        created_at = created_at + d,
        updated_at = updated_at + d,
        linked_at  = CASE WHEN linked_at IS NULL THEN NULL ELSE linked_at + d END
      WHERE tenant_id = v_tenant;

    UPDATE cti_campaign_iocs SET
        created_at    = created_at + d,
        updated_at    = updated_at + d,
        first_seen_at = CASE WHEN first_seen_at IS NULL THEN NULL ELSE first_seen_at + d END,
        last_seen_at  = CASE WHEN last_seen_at  IS NULL THEN NULL ELSE last_seen_at + d END
      WHERE tenant_id = v_tenant;

    UPDATE cti_brand_abuse_incidents SET
        created_at            = created_at + d,
        updated_at            = updated_at + d,
        first_detected_at     = CASE WHEN first_detected_at     IS NULL THEN NULL ELSE first_detected_at + d END,
        last_detected_at      = CASE WHEN last_detected_at      IS NULL THEN NULL ELSE last_detected_at + d END,
        takedown_requested_at = CASE WHEN takedown_requested_at IS NULL THEN NULL ELSE takedown_requested_at + d END,
        taken_down_at         = CASE WHEN taken_down_at         IS NULL THEN NULL ELSE taken_down_at + d END,
        deleted_at            = CASE WHEN deleted_at            IS NULL THEN NULL ELSE deleted_at + d END
      WHERE tenant_id = v_tenant;

    UPDATE cti_threat_events SET
        created_at    = created_at + d,
        updated_at    = updated_at + d,
        first_seen_at = CASE WHEN first_seen_at IS NULL THEN NULL ELSE first_seen_at + d END,
        last_seen_at  = CASE WHEN last_seen_at  IS NULL THEN NULL ELSE last_seen_at + d END,
        resolved_at   = CASE WHEN resolved_at   IS NULL THEN NULL ELSE resolved_at + d END,
        deleted_at    = CASE WHEN deleted_at    IS NULL THEN NULL ELSE deleted_at + d END
      WHERE tenant_id = v_tenant;
  END IF;
END $$;

-- =============================================================================
-- CLUSTER E — ueba_alerts (seed max ~2026-03-22 07:49)
-- delta keyed off ueba_alerts.created_at.
-- =============================================================================
DO $$
DECLARE
  v_tenant uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  d interval;
BEGIN
  SELECT now() - max(created_at) INTO d FROM ueba_alerts WHERE tenant_id = v_tenant;
  IF d IS NULL OR d <= interval '1 day' THEN
    RAISE NOTICE 'Cluster E (ueba_alerts): already current (delta=%), skipping', d;
  ELSE
    RAISE NOTICE 'Cluster E (ueba_alerts) delta = %', d;
    UPDATE ueba_alerts SET
        created_at               = created_at + d,
        updated_at               = updated_at + d,
        resolved_at              = CASE WHEN resolved_at IS NULL THEN NULL ELSE resolved_at + d END,
        correlation_window_start = CASE WHEN correlation_window_start IS NULL THEN NULL ELSE correlation_window_start + d END,
        correlation_window_end   = CASE WHEN correlation_window_end   IS NULL THEN NULL ELSE correlation_window_end + d END
      WHERE tenant_id = v_tenant;
  END IF;
END $$;

-- =============================================================================
-- CLUSTER F — ueba_access_events March bulk (partitioned on created_at)
-- Only the stale March bulk (created_at < 2026-04-01) is shifted forward so it
-- joins the recent window; the already-current Apr/May/Jun spread is untouched.
-- delta keyed off the bulk's own max.
-- ueba_profiles risk timestamps refreshed to keep "active" profiles current.
-- =============================================================================
DO $$
DECLARE
  v_tenant uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  d interval;
  bulk_cut timestamptz := '2026-04-01 00:00:00+00';
BEGIN
  SELECT now() - max(created_at) INTO d
    FROM ueba_access_events
    WHERE tenant_id = v_tenant AND created_at < bulk_cut;
  IF d IS NULL OR d <= interval '1 day' THEN
    RAISE NOTICE 'Cluster F (ueba_access_events bulk): nothing stale (delta=%), skipping', d;
  ELSE
    RAISE NOTICE 'Cluster F (ueba_access_events bulk) delta = %', d;
    UPDATE ueba_access_events SET
        created_at      = created_at + d,
        event_timestamp = event_timestamp + d
      WHERE tenant_id = v_tenant AND created_at < bulk_cut;
  END IF;

  -- Keep ueba_profiles "warm": nudge last_seen/risk decay to recent if stale.
  UPDATE ueba_profiles SET
      last_seen_at     = GREATEST(COALESCE(last_seen_at, now()), now() - (random() * interval '6 hours')),
      risk_last_updated= GREATEST(COALESCE(risk_last_updated, now()), now() - (random() * interval '12 hours')),
      updated_at       = now()
    WHERE tenant_id = v_tenant
      AND COALESCE(last_seen_at, 'epoch'::timestamptz) < now() - interval '7 days';
END $$;

-- =============================================================================
-- CLUSTER G — vCISO governance (seed max ~2026-03-27 12:24)
-- delta keyed off vciso_risks.created_at.
-- Shifts the whole governance corpus so review dates, assessments, control
-- tests, evidence collection, vendor assessments etc. read as recent/relative-
-- future. vciso_briefings / vciso_predictions / vciso_conversations are already
-- at ~now / May and are excluded from the bulk shift (handled individually).
-- SKIPPED: vciso_llm_audit_log (WORM-style audit).
-- =============================================================================
DO $$
DECLARE
  v_tenant uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  d interval;
BEGIN
  SELECT now() - max(created_at) INTO d FROM vciso_risks WHERE tenant_id = v_tenant;
  IF d IS NULL OR d <= interval '1 day' THEN
    RAISE NOTICE 'Cluster G (vCISO): already current (delta=%), skipping', d;
  ELSE
    RAISE NOTICE 'Cluster G (vCISO) delta = %', d;

    UPDATE vciso_risks SET created_at = created_at + d, updated_at = updated_at + d
      WHERE tenant_id = v_tenant;

    UPDATE vciso_maturity_assessments SET
        created_at  = created_at + d, updated_at = updated_at + d,
        assessed_at = CASE WHEN assessed_at IS NULL THEN NULL ELSE assessed_at + d END
      WHERE tenant_id = v_tenant;

    UPDATE vciso_control_tests SET created_at = created_at + d, updated_at = updated_at + d
      WHERE tenant_id = v_tenant;

    UPDATE vciso_control_ownership SET
        created_at = created_at + d, updated_at = updated_at + d,
        last_reviewed_at = CASE WHEN last_reviewed_at IS NULL THEN NULL ELSE last_reviewed_at + d END
      WHERE tenant_id = v_tenant;

    UPDATE vciso_control_dependencies SET created_at = created_at + d, updated_at = updated_at + d
      WHERE tenant_id = v_tenant;

    UPDATE vciso_evidence SET
        created_at       = created_at + d, updated_at = updated_at + d,
        collected_at     = CASE WHEN collected_at     IS NULL THEN NULL ELSE collected_at + d END,
        last_verified_at = CASE WHEN last_verified_at IS NULL THEN NULL ELSE last_verified_at + d END,
        expires_at       = CASE WHEN expires_at       IS NULL THEN NULL ELSE expires_at + d END
      WHERE tenant_id = v_tenant;

    UPDATE vciso_iam_findings SET
        created_at    = created_at + d, updated_at = updated_at + d,
        discovered_at = CASE WHEN discovered_at IS NULL THEN NULL ELSE discovered_at + d END,
        resolved_at   = CASE WHEN resolved_at   IS NULL THEN NULL ELSE resolved_at + d END
      WHERE tenant_id = v_tenant;

    UPDATE vciso_questionnaires SET
        created_at   = created_at + d, updated_at = updated_at + d,
        completed_at = CASE WHEN completed_at IS NULL THEN NULL ELSE completed_at + d END
      WHERE tenant_id = v_tenant;

    UPDATE vciso_approvals SET
        created_at = created_at + d, updated_at = updated_at + d,
        decided_at = CASE WHEN decided_at IS NULL THEN NULL ELSE decided_at + d END
      WHERE tenant_id = v_tenant;

    UPDATE vciso_benchmarks SET created_at = created_at + d, updated_at = updated_at + d
      WHERE tenant_id = v_tenant;

    UPDATE vciso_budget_items SET created_at = created_at + d, updated_at = updated_at + d
      WHERE tenant_id = v_tenant;

    UPDATE vciso_awareness_programs SET created_at = created_at + d, updated_at = updated_at + d
      WHERE tenant_id = v_tenant;

    UPDATE vciso_vendors SET
        created_at = created_at + d, updated_at = updated_at + d,
        last_assessment_date = CASE WHEN last_assessment_date IS NULL THEN NULL ELSE last_assessment_date + d END
      WHERE tenant_id = v_tenant;

    UPDATE vciso_policies SET
        created_at       = created_at + d, updated_at = updated_at + d,
        approved_at      = CASE WHEN approved_at      IS NULL THEN NULL ELSE approved_at + d END,
        last_reviewed_at = CASE WHEN last_reviewed_at IS NULL THEN NULL ELSE last_reviewed_at + d END
      WHERE tenant_id = v_tenant;

    UPDATE vciso_policy_exceptions SET created_at = created_at + d, updated_at = updated_at + d
      WHERE tenant_id = v_tenant;

    UPDATE vciso_obligations SET created_at = created_at + d, updated_at = updated_at + d
      WHERE tenant_id = v_tenant;

    UPDATE vciso_playbooks SET
        created_at     = created_at + d, updated_at = updated_at + d,
        last_tested_at = CASE WHEN last_tested_at IS NULL THEN NULL ELSE last_tested_at + d END
      WHERE tenant_id = v_tenant;

    UPDATE vciso_escalation_rules SET
        created_at        = created_at + d, updated_at = updated_at + d,
        last_triggered_at = CASE WHEN last_triggered_at IS NULL THEN NULL ELSE last_triggered_at + d END
      WHERE tenant_id = v_tenant;

    UPDATE vciso_integrations SET
        created_at   = created_at + d, updated_at = updated_at + d,
        last_sync_at = CASE WHEN last_sync_at IS NULL THEN NULL ELSE last_sync_at + d END
      WHERE tenant_id = v_tenant;
  END IF;
END $$;

-- =============================================================================
-- LONG-TAIL SEED — ueba_alerts recent spread
-- After the Cluster E shift the newest ueba_alert lands at ~now, but the band is
-- only ~12 days wide. Top up a healthy spread of recent alerts across severities
-- so the UEBA alerts list + severity distribution chart show multiple buckets in
-- the last 7 days. Idempotent: tagged via detection_method and skipped if present.
-- =============================================================================
DO $$
DECLARE
  v_tenant uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  v_exists int;
  i int;
  v_profile uuid;
  v_sev text;
  v_score numeric;
  v_type text;
  v_ts timestamptz;
  sev_arr   text[] := ARRAY['critical','high','high','medium','medium','medium','low'];
  type_arr  text[] := ARRAY['anomalous_access','impossible_travel','data_exfiltration','privilege_escalation','off_hours_activity','mass_download','failed_auth_spike'];
BEGIN
  SELECT count(*) INTO v_exists FROM ueba_alerts
    WHERE tenant_id = v_tenant AND detection_method = 'demo_refresh_topup';
  IF v_exists > 0 THEN
    RAISE NOTICE 'ueba_alerts top-up already present (%), skipping', v_exists;
    RETURN;
  END IF;

  FOR i IN 1..60 LOOP
    SELECT id INTO v_profile FROM ueba_profiles
      WHERE tenant_id = v_tenant ORDER BY random() LIMIT 1;
    EXIT WHEN v_profile IS NULL;
    v_sev   := sev_arr[1 + (i % array_length(sev_arr,1))];
    v_type  := type_arr[1 + (i % array_length(type_arr,1))];
    v_score := CASE v_sev WHEN 'critical' THEN 85 + random()*15
                          WHEN 'high'     THEN 70 + random()*15
                          WHEN 'medium'   THEN 45 + random()*20
                          ELSE 20 + random()*20 END;
    -- spread across the last 7 days, weighted toward the last 24h
    v_ts := now() - (random() * interval '7 days');
    IF i % 3 = 0 THEN v_ts := now() - (random() * interval '24 hours'); END IF;

    INSERT INTO ueba_alerts (
      id, tenant_id, profile_id, alert_type, severity, risk_score,
      title, description, status, detection_method,
      correlation_window_start, correlation_window_end, created_at, updated_at
    ) VALUES (
      gen_random_uuid(), v_tenant, v_profile, v_type, v_sev, round(v_score,2),
      initcap(replace(v_type,'_',' '))||' detected',
      'Behavioral anomaly auto-flagged by UEBA engine for entity profile.',
      (ARRAY['open','open','open','investigating','resolved'])[1 + (i % 5)],
      'demo_refresh_topup',
      v_ts - interval '1 hour', v_ts, v_ts, v_ts
    );
  END LOOP;
  RAISE NOTICE 'ueba_alerts top-up inserted (60 recent rows)';
END $$;

COMMIT;

-- =============================================================================
-- POST-CHECKS (informational; safe to run read-only)
-- =============================================================================
\echo '--- recent-window sanity (tenant Apex Bank Holdings) ---'
SELECT 'alerts_24h'        AS metric, count(*) FROM alerts             WHERE tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' AND created_at      > now() - interval '24 hours'
UNION ALL SELECT 'security_events_24h', count(*) FROM security_events  WHERE tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' AND timestamp       > now() - interval '24 hours'
UNION ALL SELECT 'ueba_events_24h',     count(*) FROM ueba_access_events WHERE tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' AND event_timestamp > now() - interval '24 hours'
UNION ALL SELECT 'dspm_audit_24h',      count(*) FROM dspm_access_audit WHERE tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' AND event_timestamp > now() - interval '24 hours'
UNION ALL SELECT 'cti_events_7d',       count(*) FROM cti_threat_events WHERE tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' AND created_at      > now() - interval '7 days'
UNION ALL SELECT 'ueba_alerts_7d',      count(*) FROM ueba_alerts      WHERE tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' AND created_at      > now() - interval '7 days'
UNION ALL SELECT 'ctem_findings_30d',   count(*) FROM ctem_findings    WHERE tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' AND created_at      > now() - interval '30 days'
UNION ALL SELECT 'vciso_risks_30d',     count(*) FROM vciso_risks      WHERE tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' AND created_at      > now() - interval '30 days';
