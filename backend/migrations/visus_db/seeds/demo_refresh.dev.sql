-- =============================================================================
-- Clario360 VISUS demo refresh — visus_db (DEV ONLY, idempotent)
--
-- Goal: make the Visus suite look FULL + CURRENT for the demo tenant so the
-- list/detail/chart pages render rich content instead of sparse/empty states:
--   /visus            (executive/home aggregates)
--   /visus/dashboards (dashboard list + detail with widgets)
--   /visus/reports    (report list + detail with generated snapshots)
--   /visus/kpis       (kpi list + history trends)
--   /visus/alerts     (alert feed + distribution charts)
--
-- Tenant:  aaaaaaaa-0000-0000-0000-000000000001  (Apex Bank Holdings == clario-dev)
-- Author/owner (created_by / generated_by / recipients):
--   bbbbbbbb-0000-0000-0000-000000000001  (admin@apexbank.demo)
--
-- -----------------------------------------------------------------------------
-- TIMESTAMP REFRESH — DELIBERATELY OMITTED FOR visus_db
-- -----------------------------------------------------------------------------
-- visus_db is NOT stale. A live snapshot scheduler in the running visus-service
-- continuously writes current rows: at authoring time the newest
-- visus_kpi_snapshots.created_at was ~11 min old and visus_executive_alerts
-- .last_seen_at was ~4 s old, with healthy 24h/7d/30d windows
-- (237 / 422 / 663 snapshots; 159 / 197 / 254 alerts in 24h/7d/30d). KPI trend
-- history is deep (40-133 points/KPI) and alerts span every category/severity/
-- suite. A uniform forward time-shift here would (a) be a no-op for "currency"
-- and (b) actively corrupt/duplicate against the live writer. So this seed does
-- NOT shift any timestamps; it only fills the THIN long tail: dashboards and
-- report definitions/snapshots (2 dashboards -> 7, 3 reports -> 9).
--
-- WORM/immutability note: visus_db has NO hash-chained / WORM / immutable
-- tables. visus_report_snapshots is append-only by usage but not enforced
-- immutable; we insert fully-formed rows with ON CONFLICT DO NOTHING. Nothing
-- here mutates an audit/ledger/inclusion-proof chain.
--
-- Idempotent: every INSERT carries a fixed UUID and ON CONFLICT DO NOTHING
-- (DO UPDATE only for the report-definition currency fields). Safe to re-run.
-- created_at columns on new rows are intentionally back-dated a few months so
-- they read as established assets; updated_at/last_generated_at/next_run_at land
-- in the recent past / near future so "freshness" badges look current.
--
-- Run:
--   docker exec -i clario360-postgres psql -U clario -d visus_db \
--     < backend/migrations/visus_db/seeds/demo_refresh.dev.sql
-- =============================================================================

BEGIN;

-- clario is a BYPASSRLS superuser in dev, so RLS does not block these inserts;
-- the API filters by tenant_id (the value we insert), so rows are visible.

-- -----------------------------------------------------------------------------
-- Stable identifiers
-- -----------------------------------------------------------------------------
\set tenant '''aaaaaaaa-0000-0000-0000-000000000001'''
\set owner  '''bbbbbbbb-0000-0000-0000-000000000001'''

-- Existing real KPI definition ids for this tenant (referenced by widgets).
-- NOTE: psql \set captures the rest of the line, so NO trailing comments here.
-- These expand to a SQL string literal whose CONTENT is a JSON-quoted UUID,
-- so string concatenation like '{"kpi_id":'||:kpi_dq||'}' yields a SQL string
-- containing valid JSON: {"kpi_id":"b6c02ae4-..."}. The outer ''' ... ''' pair
-- is the SQL single-quote; the inner " ... " is the JSON double-quote.
\set kpi_sec_risk      '''"56545fb8-cf38-4619-a85e-4732786ef385"'''
\set kpi_mttr          '''"de0df086-34c1-4c87-899c-df1ea7952302"'''
\set kpi_mttd          '''"ea2d2668-da2a-4c47-83bd-eed2adab0bfd"'''
\set kpi_mitre         '''"1586bbe1-d8e3-4248-8f46-fa2efa0962d9"'''
\set kpi_open_crit     '''"f12b9beb-48ba-468d-84e3-454641fb3075"'''
\set kpi_ioc           '''"e78efeaf-8bfa-45de-92d4-5e8f56cbec40"'''
\set kpi_cti           '''"0e260f9b-c7e4-499d-a416-d95db562a0ac"'''
\set kpi_dq            '''"b6c02ae4-601b-42ee-b116-634ac72a62f3"'''
\set kpi_dark          '''"9459008d-b891-4524-8e91-94fbb0003b70"'''
\set kpi_contra        '''"c4fadb8f-c86e-4908-99ab-56f76807f3c0"'''
\set kpi_pipe          '''"929f8646-b94b-49bb-b44e-42db6765c384"'''
\set kpi_gov           '''"30b65cb4-f542-4bc7-b63d-2f1dc0bb0be1"'''
\set kpi_overdue       '''"820185f9-b5b7-4b55-a24f-bca6960b63e0"'''
\set kpi_expiring      '''"3d684eda-98eb-4171-9c5f-3f4dee2ca6f8"'''
\set kpi_highrisk      '''"76a3692b-71a0-4dba-91c0-cd94edb7d263"'''

-- New dashboard ids (fixed for idempotency). No trailing comments (see note above).
\set dash_data    '''d1500001-0000-0000-0000-000000000001'''
\set dash_gov     '''d1500001-0000-0000-0000-000000000002'''
\set dash_legal   '''d1500001-0000-0000-0000-000000000003'''
\set dash_board   '''d1500001-0000-0000-0000-000000000004'''
\set dash_ops     '''d1500001-0000-0000-0000-000000000005'''

-- =============================================================================
-- 1) DASHBOARDS (long-tail). visibility=organization so they show for all users.
--    Unique key: (tenant_id, name, created_by) WHERE deleted_at IS NULL.
-- =============================================================================
INSERT INTO visus_dashboards
  (id, tenant_id, name, description, grid_columns, visibility, is_default,
   is_system, tags, metadata, created_by, created_at, updated_at)
VALUES
  (:dash_data, :tenant, 'Data Intelligence',
   'Data quality, dark-data exposure, contradictions, and pipeline reliability across the estate.',
   12, 'organization', false, false, ARRAY['data','quality','executive'],
   '{"layout":"grid","theme":"clario"}'::jsonb, :owner,
   now() - interval '74 days', now() - interval '2 days'),
  (:dash_gov, :tenant, 'Governance & Risk',
   'Committee governance posture, overdue action items, and enterprise risk indicators.',
   12, 'organization', false, false, ARRAY['governance','risk','board'],
   '{"layout":"grid","theme":"clario"}'::jsonb, :owner,
   now() - interval '70 days', now() - interval '1 days'),
  (:dash_legal, :tenant, 'Legal Operations',
   'Contract lifecycle, renewals, expiry exposure, and legal risk concentration.',
   12, 'organization', false, false, ARRAY['legal','contracts','executive'],
   '{"layout":"grid","theme":"clario"}'::jsonb, :owner,
   now() - interval '66 days', now() - interval '3 days'),
  (:dash_board, :tenant, 'Board Briefing',
   'Quarterly board-ready snapshot: top risks, compliance posture, and cross-suite KPIs.',
   12, 'organization', false, false, ARRAY['board','executive','quarterly'],
   '{"layout":"grid","theme":"clario","audience":"board"}'::jsonb, :owner,
   now() - interval '60 days', now() - interval '5 hours'),
  (:dash_ops, :tenant, 'Operational Health',
   'Live operational signals: detection latency, response performance, and alert backlog.',
   12, 'organization', false, false, ARRAY['operations','sre','live'],
   '{"layout":"grid","theme":"clario","refresh":"live"}'::jsonb, :owner,
   now() - interval '52 days', now() - interval '40 minutes')
ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- 2) WIDGETS for the new dashboards. Configs mirror the existing system
--    dashboards' shapes exactly (kpi_card/gauge/line/bar/pie/area/sparkline/
--    status_grid/table/alert_feed/heatmap/text). Constraints enforced:
--    pos_x 0-11, pos_w 1-12, pos_x+pos_w<=12, pos_h 1-8, pos_y>=0.
--    Fixed ids: w15<dash><nn>.
-- =============================================================================

-- ---- Data Intelligence (dash_data) ----
INSERT INTO visus_widgets
  (id, tenant_id, dashboard_id, title, subtitle, type, config, pos_x, pos_y, pos_w, pos_h, refresh_interval_seconds)
VALUES
  ('d1500011-0000-0000-0000-000000000001', :tenant, :dash_data, 'Data Quality Score', NULL, 'kpi_card',
   ('{"kpi_id":'||:kpi_dq||',"show_trend":true,"show_target":true}')::jsonb, 0, 0, 3, 2, 60),
  ('d1500011-0000-0000-0000-000000000002', :tenant, :dash_data, 'Dark Data Assets', NULL, 'kpi_card',
   ('{"kpi_id":'||:kpi_dark||',"show_trend":true,"show_target":false}')::jsonb, 3, 0, 3, 2, 60),
  ('d1500011-0000-0000-0000-000000000003', :tenant, :dash_data, 'Open Contradictions', NULL, 'kpi_card',
   ('{"kpi_id":'||:kpi_contra||',"show_trend":true,"show_target":false}')::jsonb, 6, 0, 3, 2, 60),
  ('d1500011-0000-0000-0000-000000000004', :tenant, :dash_data, 'Pipeline Success Rate', NULL, 'gauge',
   ('{"kpi_id":'||:kpi_pipe||'}')::jsonb, 9, 0, 3, 2, 60),
  ('d1500011-0000-0000-0000-000000000005', :tenant, :dash_data, 'Data Quality Trend', NULL, 'line_chart',
   '{"suite":"data","x_axis":"date","y_axis":["score"],"data_path":"$.data.quality_trend","data_source":"/dashboard"}'::jsonb, 0, 2, 6, 3, 60),
  ('d1500011-0000-0000-0000-000000000006', :tenant, :dash_data, 'Pipeline Success Rate', NULL, 'area_chart',
   '{"suite":"data","x_axis":"date","y_axis":["success_rate"],"data_path":"$.data.pipeline_success_trend","data_source":"/dashboard"}'::jsonb, 6, 2, 6, 3, 60),
  ('d1500011-0000-0000-0000-000000000007', :tenant, :dash_data, 'Quality Snapshot', NULL, 'status_grid',
   ('{"items":[{"label":"Data Quality Score","kpi_id":'||:kpi_dq||'},{"label":"Open Contradictions","kpi_id":'||:kpi_contra||'},{"label":"Dark Data Assets","kpi_id":'||:kpi_dark||'},{"label":"Pipeline Success Rate","kpi_id":'||:kpi_pipe||'}]}')::jsonb, 0, 5, 6, 3, 60),
  ('d1500011-0000-0000-0000-000000000008', :tenant, :dash_data, 'Dark Data Trend', NULL, 'sparkline',
   ('{"kpi_id":'||:kpi_dark||',"points":30}')::jsonb, 6, 5, 6, 3, 60)
ON CONFLICT (id) DO NOTHING;

-- ---- Governance & Risk (dash_gov) ----
INSERT INTO visus_widgets
  (id, tenant_id, dashboard_id, title, subtitle, type, config, pos_x, pos_y, pos_w, pos_h, refresh_interval_seconds)
VALUES
  ('d1500012-0000-0000-0000-000000000001', :tenant, :dash_gov, 'Governance Compliance', NULL, 'gauge',
   ('{"kpi_id":'||:kpi_gov||'}')::jsonb, 0, 0, 4, 3, 60),
  ('d1500012-0000-0000-0000-000000000002', :tenant, :dash_gov, 'Overdue Action Items', NULL, 'kpi_card',
   ('{"kpi_id":'||:kpi_overdue||',"show_trend":true,"show_target":true}')::jsonb, 4, 0, 4, 2, 60),
  ('d1500012-0000-0000-0000-000000000003', :tenant, :dash_gov, 'CTI Risk Score', NULL, 'kpi_card',
   ('{"kpi_id":'||:kpi_cti||',"show_trend":true,"show_target":true}')::jsonb, 8, 0, 4, 2, 60),
  ('d1500012-0000-0000-0000-000000000004', :tenant, :dash_gov, 'Compliance By Committee', NULL, 'bar_chart',
   '{"suite":"acta","x_axis":"committee","y_axis":["score"],"data_path":"$.data.compliance_by_committee","data_source":"/dashboard"}'::jsonb, 0, 3, 6, 3, 60),
  ('d1500012-0000-0000-0000-000000000005', :tenant, :dash_gov, 'Risk Alerts By Severity', NULL, 'pie_chart',
   '{"suite":"acta","data_path":"$.data.alert_breakdown","label_path":"severity","value_path":"count","data_source":"/dashboard"}'::jsonb, 6, 3, 3, 3, 60),
  ('d1500012-0000-0000-0000-000000000006', :tenant, :dash_gov, 'Governance Posture', NULL, 'status_grid',
   ('{"items":[{"label":"Governance Compliance","kpi_id":'||:kpi_gov||'},{"label":"Overdue Action Items","kpi_id":'||:kpi_overdue||'},{"label":"CTI Risk Score","kpi_id":'||:kpi_cti||'}]}')::jsonb, 9, 3, 3, 3, 60),
  ('d1500012-0000-0000-0000-000000000007', :tenant, :dash_gov, 'Governance & Risk Alerts', NULL, 'alert_feed',
   '{"max_alerts":8,"alert_sources":["acta","cyber"],"severity_filter":["critical","high"]}'::jsonb, 0, 6, 12, 2, 60)
ON CONFLICT (id) DO NOTHING;

-- ---- Legal Operations (dash_legal) ----
INSERT INTO visus_widgets
  (id, tenant_id, dashboard_id, title, subtitle, type, config, pos_x, pos_y, pos_w, pos_h, refresh_interval_seconds)
VALUES
  ('d1500013-0000-0000-0000-000000000001', :tenant, :dash_legal, 'Contracts Expiring 30d', NULL, 'kpi_card',
   ('{"kpi_id":'||:kpi_expiring||',"show_trend":true,"show_target":false}')::jsonb, 0, 0, 4, 2, 60),
  ('d1500013-0000-0000-0000-000000000002', :tenant, :dash_legal, 'High Risk Contracts', NULL, 'kpi_card',
   ('{"kpi_id":'||:kpi_highrisk||',"show_trend":true,"show_target":false}')::jsonb, 4, 0, 4, 2, 60),
  ('d1500013-0000-0000-0000-000000000003', :tenant, :dash_legal, 'Legal Alerts By Severity', NULL, 'pie_chart',
   '{"suite":"lex","data_path":"$.data.alert_breakdown","label_path":"severity","value_path":"count","data_source":"/dashboard"}'::jsonb, 8, 0, 4, 4, 60),
  ('d1500013-0000-0000-0000-000000000004', :tenant, :dash_legal, 'Contracts Expiring Trend', NULL, 'line_chart',
   '{"suite":"lex","x_axis":"date","y_axis":["count"],"data_path":"$.data.expiry_trend","data_source":"/dashboard"}'::jsonb, 0, 2, 8, 3, 60),
  ('d1500013-0000-0000-0000-000000000005', :tenant, :dash_legal, 'Contract Expiry Timeline', NULL, 'table',
   '{"suite":"lex","columns":[{"key":"title","label":"Contract"},{"key":"expiry_date","label":"Expiry"},{"key":"risk_level","label":"Risk"}],"max_rows":8,"data_path":"$.data.expiring_contracts","data_source":"/dashboard"}'::jsonb, 0, 5, 8, 3, 60),
  ('d1500013-0000-0000-0000-000000000006', :tenant, :dash_legal, 'Legal Alert Feed', NULL, 'alert_feed',
   '{"max_alerts":8,"alert_sources":["lex"],"severity_filter":["critical","high","medium"]}'::jsonb, 8, 4, 4, 4, 60)
ON CONFLICT (id) DO NOTHING;

-- ---- Board Briefing (dash_board) ----
INSERT INTO visus_widgets
  (id, tenant_id, dashboard_id, title, subtitle, type, config, pos_x, pos_y, pos_w, pos_h, refresh_interval_seconds)
VALUES
  ('d1500014-0000-0000-0000-000000000001', :tenant, :dash_board, 'Security Risk Score', NULL, 'kpi_card',
   ('{"kpi_id":'||:kpi_sec_risk||',"show_trend":true,"show_target":true}')::jsonb, 0, 0, 3, 2, 60),
  ('d1500014-0000-0000-0000-000000000002', :tenant, :dash_board, 'Governance Compliance', NULL, 'kpi_card',
   ('{"kpi_id":'||:kpi_gov||',"show_trend":true,"show_target":true}')::jsonb, 3, 0, 3, 2, 60),
  ('d1500014-0000-0000-0000-000000000003', :tenant, :dash_board, 'Data Quality Score', NULL, 'kpi_card',
   ('{"kpi_id":'||:kpi_dq||',"show_trend":true,"show_target":true}')::jsonb, 6, 0, 3, 2, 60),
  ('d1500014-0000-0000-0000-000000000004', :tenant, :dash_board, 'Contracts Expiring 30d', NULL, 'kpi_card',
   ('{"kpi_id":'||:kpi_expiring||',"show_trend":true,"show_target":false}')::jsonb, 9, 0, 3, 2, 60),
  ('d1500014-0000-0000-0000-000000000005', :tenant, :dash_board, 'Enterprise Posture', NULL, 'status_grid',
   ('{"items":[{"label":"Security Risk Score","kpi_id":'||:kpi_sec_risk||'},{"label":"Governance Compliance","kpi_id":'||:kpi_gov||'},{"label":"Data Quality Score","kpi_id":'||:kpi_dq||'},{"label":"Open Critical Alerts","kpi_id":'||:kpi_open_crit||'}]}')::jsonb, 0, 2, 6, 3, 120),
  ('d1500014-0000-0000-0000-000000000006', :tenant, :dash_board, 'Top Risks', NULL, 'alert_feed',
   '{"max_alerts":6,"alert_sources":["cyber","data","acta","lex"],"severity_filter":["critical","high"]}'::jsonb, 6, 2, 6, 3, 120),
  ('d1500014-0000-0000-0000-000000000007', :tenant, :dash_board, 'Security Risk Trend', NULL, 'sparkline',
   ('{"kpi_id":'||:kpi_sec_risk||',"points":30}')::jsonb, 0, 5, 12, 2, 120),
  ('d1500014-0000-0000-0000-000000000008', :tenant, :dash_board, 'Board Notes', NULL, 'text',
   '{"content":"Board briefing snapshot. Posture aggregated across Cyber, Data, Acta, and Lex suites. Refreshed automatically."}'::jsonb, 0, 7, 12, 1, 300)
ON CONFLICT (id) DO NOTHING;

-- ---- Operational Health (dash_ops) ----
INSERT INTO visus_widgets
  (id, tenant_id, dashboard_id, title, subtitle, type, config, pos_x, pos_y, pos_w, pos_h, refresh_interval_seconds)
VALUES
  ('d1500015-0000-0000-0000-000000000001', :tenant, :dash_ops, 'Mean Time to Detect', NULL, 'kpi_card',
   ('{"kpi_id":'||:kpi_mttd||',"show_trend":true,"show_target":true}')::jsonb, 0, 0, 3, 2, 30),
  ('d1500015-0000-0000-0000-000000000002', :tenant, :dash_ops, 'Mean Time to Respond', NULL, 'kpi_card',
   ('{"kpi_id":'||:kpi_mttr||',"show_trend":true,"show_target":true}')::jsonb, 3, 0, 3, 2, 30),
  ('d1500015-0000-0000-0000-000000000003', :tenant, :dash_ops, 'Open Critical Alerts', NULL, 'kpi_card',
   ('{"kpi_id":'||:kpi_open_crit||',"show_trend":true,"show_target":false}')::jsonb, 6, 0, 3, 2, 30),
  ('d1500015-0000-0000-0000-000000000004', :tenant, :dash_ops, 'Indicators of Compromise', NULL, 'kpi_card',
   ('{"kpi_id":'||:kpi_ioc||',"show_trend":true,"show_target":false}')::jsonb, 9, 0, 3, 2, 30),
  ('d1500015-0000-0000-0000-000000000005', :tenant, :dash_ops, 'MTTR Trend', NULL, 'sparkline',
   ('{"kpi_id":'||:kpi_mttr||',"points":30}')::jsonb, 0, 2, 6, 2, 30),
  ('d1500015-0000-0000-0000-000000000006', :tenant, :dash_ops, 'MTTD Trend', NULL, 'sparkline',
   ('{"kpi_id":'||:kpi_mttd||',"points":30}')::jsonb, 6, 2, 6, 2, 30),
  ('d1500015-0000-0000-0000-000000000007', :tenant, :dash_ops, 'Threat Landscape', NULL, 'heatmap',
   '{"suite":"cyber","x_axis":"tactic","y_axis":"technique","data_path":"$.data.mitre_heatmap.cells","value_key":"value","data_source":"/dashboard"}'::jsonb, 0, 4, 8, 3, 60),
  ('d1500015-0000-0000-0000-000000000008', :tenant, :dash_ops, 'Operational Alert Feed', NULL, 'alert_feed',
   '{"max_alerts":10,"alert_sources":["cyber","data"],"severity_filter":["critical","high","medium"]}'::jsonb, 8, 4, 4, 3, 30)
ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- 3) REPORT DEFINITIONS (long-tail). Unique key: (tenant_id, name).
--    DO UPDATE keeps schedule/next_run_at/last_generated_at currency on re-run.
-- =============================================================================
\set rep_dataintel '''50f00001-0000-0000-0000-000000000001'''
\set rep_legal     '''50f00001-0000-0000-0000-000000000002'''
\set rep_board     '''50f00001-0000-0000-0000-000000000003'''
\set rep_compliance '''50f00001-0000-0000-0000-000000000004'''
\set rep_weeklysec '''50f00001-0000-0000-0000-000000000005'''
\set rep_annual    '''50f00001-0000-0000-0000-000000000006'''

INSERT INTO visus_report_definitions
  (id, tenant_id, name, description, report_type, sections, period, schedule,
   next_run_at, recipients, auto_send, last_generated_at, total_generated,
   created_by, created_at, updated_at)
VALUES
  (:rep_dataintel, :tenant, 'Data Intelligence Report',
   'Monthly data-quality, dark-data, and pipeline reliability review.',
   'data_intelligence', ARRAY['data_intelligence','kpi_summary'], '30d', '0 8 1 * *',
   date_trunc('month', now()) + interval '1 month 8 hours',
   ARRAY[:owner]::uuid[], true, now() - interval '6 days', 4,
   :owner, now() - interval '120 days', now() - interval '6 days'),
  (:rep_legal, :tenant, 'Legal Operations Report',
   'Monthly contract lifecycle, renewals, and legal-risk concentration summary.',
   'legal', ARRAY['legal','kpi_summary'], '30d', '0 8 1 * *',
   date_trunc('month', now()) + interval '1 month 8 hours',
   ARRAY[:owner]::uuid[], false, now() - interval '9 days', 3,
   :owner, now() - interval '110 days', now() - interval '9 days'),
  (:rep_board, :tenant, 'Board Briefing Pack',
   'Quarterly board-ready cross-suite posture pack with narrative.',
   'executive_summary', ARRAY['security_posture','data_intelligence','governance','legal','kpi_summary'],
   'quarterly', '0 8 1 1,4,7,10 *',
   date_trunc('quarter', now()) + interval '3 months 8 hours',
   ARRAY[:owner]::uuid[], true, now() - interval '21 days', 2,
   :owner, now() - interval '150 days', now() - interval '21 days'),
  (:rep_compliance, :tenant, 'Compliance Posture Report',
   'Bi-weekly governance and compliance posture for the audit committee.',
   'governance', ARRAY['governance','kpi_summary'], '14d', '0 8 * * 1',
   date_trunc('week', now()) + interval '7 days 8 hours',
   ARRAY[:owner]::uuid[], false, now() - interval '3 days', 7,
   :owner, now() - interval '95 days', now() - interval '3 days'),
  (:rep_weeklysec, :tenant, 'Weekly Threat Briefing',
   'Weekly cyber threat landscape, detection latency, and response performance.',
   'security_posture', ARRAY['security_posture','kpi_summary'], '7d', '0 8 * * 1',
   date_trunc('week', now()) + interval '7 days 8 hours',
   ARRAY[:owner]::uuid[], true, now() - interval '1 days', 11,
   :owner, now() - interval '88 days', now() - interval '1 days'),
  (:rep_annual, :tenant, 'Annual Executive Review',
   'Annual cross-suite executive review of risk, compliance, data, and legal posture.',
   'executive_summary', ARRAY['security_posture','data_intelligence','governance','legal','kpi_summary'],
   'annual', '0 8 1 1 *',
   date_trunc('year', now()) + interval '1 year 8 hours',
   ARRAY[:owner]::uuid[], false, now() - interval '40 days', 1,
   :owner, now() - interval '160 days', now() - interval '40 days')
ON CONFLICT (id) DO UPDATE SET
  schedule          = EXCLUDED.schedule,
  next_run_at       = EXCLUDED.next_run_at,
  last_generated_at = EXCLUDED.last_generated_at,
  total_generated   = EXCLUDED.total_generated,
  updated_at        = EXCLUDED.updated_at;

-- =============================================================================
-- 4) REPORT SNAPSHOTS so each new report's detail page resolves with a recent
--    "last generated" run + a couple of prior runs for the history list.
--    Unique key: (tenant_id, report_id, period_start, period_end).
--    report_data/narrative mirror the existing snapshot shape.
-- =============================================================================
INSERT INTO visus_report_snapshots
  (id, tenant_id, report_id, report_data, narrative, file_format,
   period_start, period_end, sections_included, generation_time_ms,
   generated_by, generated_at)
VALUES
  -- Data Intelligence: latest + prior
  ('50f10001-0000-0000-0000-000000000001', :tenant, :rep_dataintel,
   '{"report":{"name":"Data Intelligence Report","period":"30d","report_type":"data_intelligence"},"sections":{"data_intelligence":{"available":true,"quality_score":92.3,"dark_data_assets":1808,"open_contradictions":16,"pipeline_success_rate":97.4},"kpi_summary":{"kpis":[{"name":"Data Quality Score","value":92.31,"status":"normal"},{"name":"Open Contradictions","value":16,"status":"warning"}]}}}'::jsonb,
   E'## Data Intelligence — last 30 days\n\nData quality held at 92.3%. Dark-data inventory totals 1,808 assets; 16 open contradictions are under review. Pipeline success rate is 97.4%.',
   'json', (now() - interval '6 days')::date - 30, (now() - interval '6 days')::date,
   ARRAY['data_intelligence','kpi_summary'], 2841, :owner, now() - interval '6 days'),
  ('50f10001-0000-0000-0000-000000000002', :tenant, :rep_dataintel,
   '{"report":{"name":"Data Intelligence Report","period":"30d","report_type":"data_intelligence"},"sections":{"data_intelligence":{"available":true,"quality_score":90.1,"dark_data_assets":1792,"open_contradictions":19,"pipeline_success_rate":96.1}}}'::jsonb,
   E'## Data Intelligence — prior period\n\nQuality 90.1%; 19 open contradictions; pipeline success 96.1%.',
   'json', (now() - interval '36 days')::date - 30, (now() - interval '36 days')::date,
   ARRAY['data_intelligence','kpi_summary'], 2960, :owner, now() - interval '36 days'),

  -- Legal Operations
  ('50f10001-0000-0000-0000-000000000003', :tenant, :rep_legal,
   '{"report":{"name":"Legal Operations Report","period":"30d","report_type":"legal"},"sections":{"legal":{"available":true,"active_contracts":214,"expiring_count":33,"high_risk_count":7,"pending_review":12},"kpi_summary":{"kpis":[{"name":"Contracts Expiring 30d","value":33,"status":"critical"}]}}}'::jsonb,
   E'## Legal Operations — last 30 days\n\n214 active contracts; 33 expiring within 30 days; 7 flagged high-risk; 12 pending legal review.',
   'json', (now() - interval '9 days')::date - 30, (now() - interval '9 days')::date,
   ARRAY['legal','kpi_summary'], 2477, :owner, now() - interval '9 days'),
  ('50f10001-0000-0000-0000-000000000004', :tenant, :rep_legal,
   '{"report":{"name":"Legal Operations Report","period":"30d","report_type":"legal"},"sections":{"legal":{"available":true,"active_contracts":208,"expiring_count":28,"high_risk_count":6,"pending_review":9}}}'::jsonb,
   E'## Legal Operations — prior period\n\n208 active contracts; 28 expiring; 6 high-risk.',
   'json', (now() - interval '39 days')::date - 30, (now() - interval '39 days')::date,
   ARRAY['legal','kpi_summary'], 2510, :owner, now() - interval '39 days'),

  -- Board Briefing Pack
  ('50f10001-0000-0000-0000-000000000005', :tenant, :rep_board,
   '{"report":{"name":"Board Briefing Pack","period":"quarterly","report_type":"executive_summary"},"sections":{"security_posture":{"available":true,"risk_score":74.4,"open_critical":333},"governance":{"available":true,"compliance_score":50,"overdue_count":9},"legal":{"available":true,"expiring_count":33},"data_intelligence":{"available":true,"quality_score":92.3}}}'::jsonb,
   E'## Board Briefing — quarter to date\n\nSecurity risk score 74.4 (warning). Governance compliance 50% with 9 overdue action items. 33 contracts expiring within 30 days. Data quality 92.3%.',
   'json', (now() - interval '21 days')::date - 90, (now() - interval '21 days')::date,
   ARRAY['security_posture','data_intelligence','governance','legal','kpi_summary'], 4218, :owner, now() - interval '21 days'),

  -- Compliance Posture (3 recent for a fuller history)
  ('50f10001-0000-0000-0000-000000000006', :tenant, :rep_compliance,
   '{"report":{"name":"Compliance Posture Report","period":"14d","report_type":"governance"},"sections":{"governance":{"available":true,"compliance_score":50,"overdue_count":9,"open_action_items":21,"meeting_count":4}}}'::jsonb,
   E'## Compliance Posture — last 14 days\n\nCompliance score 50%. 9 overdue action items, 21 open total across 4 committee meetings.',
   'json', (now() - interval '3 days')::date - 14, (now() - interval '3 days')::date,
   ARRAY['governance','kpi_summary'], 1980, :owner, now() - interval '3 days'),
  ('50f10001-0000-0000-0000-000000000007', :tenant, :rep_compliance,
   '{"report":{"name":"Compliance Posture Report","period":"14d","report_type":"governance"},"sections":{"governance":{"available":true,"compliance_score":48,"overdue_count":11,"open_action_items":24}}}'::jsonb,
   E'## Compliance Posture — prior period\n\nCompliance 48%; 11 overdue; 24 open action items.',
   'json', (now() - interval '17 days')::date - 14, (now() - interval '17 days')::date,
   ARRAY['governance','kpi_summary'], 2040, :owner, now() - interval '17 days'),

  -- Weekly Threat Briefing (3 recent weeks)
  ('50f10001-0000-0000-0000-000000000008', :tenant, :rep_weeklysec,
   '{"report":{"name":"Weekly Threat Briefing","period":"7d","report_type":"security_posture"},"sections":{"security_posture":{"available":true,"risk_score":74.4,"open_critical":333,"mttd_hours":2.1,"mttr_hours":5.6,"ioc_count":120}}}'::jsonb,
   E'## Weekly Threat Briefing — last 7 days\n\nRisk score 74.4. 333 open critical alerts. MTTD 2.1h, MTTR 5.6h. 120 active IOCs tracked.',
   'json', (now() - interval '1 days')::date - 7, (now() - interval '1 days')::date,
   ARRAY['security_posture','kpi_summary'], 3052, :owner, now() - interval '1 days'),
  ('50f10001-0000-0000-0000-000000000009', :tenant, :rep_weeklysec,
   '{"report":{"name":"Weekly Threat Briefing","period":"7d","report_type":"security_posture"},"sections":{"security_posture":{"available":true,"risk_score":71.2,"open_critical":318,"mttd_hours":2.4,"mttr_hours":6.1}}}'::jsonb,
   E'## Weekly Threat Briefing — prior week\n\nRisk score 71.2. 318 open critical. MTTD 2.4h, MTTR 6.1h.',
   'json', (now() - interval '8 days')::date - 7, (now() - interval '8 days')::date,
   ARRAY['security_posture','kpi_summary'], 3110, :owner, now() - interval '8 days'),
  ('50f10001-0000-0000-0000-00000000000a', :tenant, :rep_weeklysec,
   '{"report":{"name":"Weekly Threat Briefing","period":"7d","report_type":"security_posture"},"sections":{"security_posture":{"available":true,"risk_score":69.8,"open_critical":305,"mttd_hours":2.6,"mttr_hours":6.4}}}'::jsonb,
   E'## Weekly Threat Briefing — two weeks ago\n\nRisk score 69.8. 305 open critical. MTTD 2.6h, MTTR 6.4h.',
   'json', (now() - interval '15 days')::date - 7, (now() - interval '15 days')::date,
   ARRAY['security_posture','kpi_summary'], 3088, :owner, now() - interval '15 days'),

  -- Annual Executive Review
  ('50f10001-0000-0000-0000-00000000000b', :tenant, :rep_annual,
   '{"report":{"name":"Annual Executive Review","period":"annual","report_type":"executive_summary"},"sections":{"security_posture":{"available":true,"risk_score":74.4},"governance":{"available":true,"compliance_score":50},"data_intelligence":{"available":true,"quality_score":92.3},"legal":{"available":true,"active_contracts":214}}}'::jsonb,
   E'## Annual Executive Review\n\nYear-over-year posture: security risk 74.4, governance compliance 50%, data quality 92.3%, 214 active contracts under management.',
   'json', (now() - interval '40 days')::date - 365, (now() - interval '40 days')::date,
   ARRAY['security_posture','data_intelligence','governance','legal','kpi_summary'], 5402, :owner, now() - interval '40 days')
ON CONFLICT (tenant_id, report_id, period_start, period_end) DO NOTHING;

COMMIT;

-- =============================================================================
-- Post-conditions (expected after run, per Apex tenant):
--   visus_dashboards         : 2 -> 7
--   visus_widgets            : 18 -> 55  (+37 across 5 new dashboards)
--   visus_report_definitions : 3 -> 9
--   visus_report_snapshots   : 16 -> 28 (+12)
-- KPI definitions/snapshots and executive alerts are left untouched (already
-- current + dense via the live scheduler).
-- =============================================================================
