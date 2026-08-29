-- =============================================================================
-- DEV SEED — acta_db demo refresh ("push to 100")
-- =============================================================================
-- PURPOSE
--   Make the /acta/* demo (meetings, committees, action-items, compliance) look
--   FULL + CURRENT for the demo tenant "Apex Bank Holdings".
--
-- NOT AN AUTO-RUN MIGRATION. This file lives under migrations/<db>/seeds/ and is
-- intentionally NOT picked up by the golang-migrate runner (it is not numbered
-- 0000NN_*.up.sql). Run it manually:
--
--     docker exec -i clario360-postgres psql -U clario -d acta_db \
--       < backend/migrations/acta_db/seeds/demo_refresh.dev.sql
--
-- TARGET TENANT
--   Apex Bank Holdings = aaaaaaaa-0000-0000-0000-000000000001  (demo logs in as
--   admin@clario.dev / admin@apexbank.demo, user bbbbbbbb-0000-0000-0000-000000000001).
--
-- WHY THIS WAS NEEDED
--   The rich acta demo dataset (12 meetings / 25 action-items / 4 committees) was
--   seeded ONLY under tenant 11111111-1111-1111-1111-111111111111 (Apex Governance
--   Board) by internal/acta/seed.go. The demo logs into Apex Bank Holdings, which
--   had 1 committee and ZERO meetings/action-items -> "No meetings found" / "No
--   action items". This seed builds a full Apex Bank dataset and anchors every
--   timestamp relative to now() so 24h/30d/recent/upcoming/calendar/trend views
--   all populate.
--
-- IDEMPOTENT
--   All seeded rows use the 'acac...' UUID namespace and are DELETEd before
--   re-insert, so this file can be re-run safely. The pre-existing Board committee
--   (6c12196d-...) is repaired in place (its charter held a pasted Next.js error).
--
-- SAFETY
--   acta_db holds NO hash-chained / WORM / immutable tables. meeting_minutes is
--   versioned but mutable (no entry_hash/prev_hash chain). Nothing here is
--   skipped for WORM reasons. (audit_db / *_ledger / siem cold / dr attestation
--   live in other databases and are untouched.)
--
-- All FKs + CHECK constraints + enum values are preserved. The clario role is
-- superuser + BYPASSRLS so RLS FORCE policies do not block these writes.
-- =============================================================================

\set tenant '''aaaaaaaa-0000-0000-0000-000000000001'''
\set admin  '''bbbbbbbb-0000-0000-0000-000000000001'''

BEGIN;

-- -----------------------------------------------------------------------------
-- (0) OPTIONAL UNIFORM TIMESTAMP-SHIFT (kept for re-use if data goes stale)
-- -----------------------------------------------------------------------------
-- This seed inserts now()-relative rows, so a shift is NOT required on first run.
-- If the demo dataset ages and the newest series row falls behind now(), run the
-- block below: it computes ONE uniform delta from the newest meeting in this
-- tenant and shifts ALL time-series columns by that SAME delta, preserving
-- relative spacing, cross-table ordering, and future-dated (scheduled) items.
--
-- DO $$
-- DECLARE
--   t uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
--   delta interval;
-- BEGIN
--   SELECT now() - max(scheduled_at) INTO delta
--     FROM meetings WHERE tenant_id = t AND deleted_at IS NULL;
--   IF delta IS NULL OR delta <= interval '0' THEN RETURN; END IF;
--
--   UPDATE committees SET created_at=created_at+delta, updated_at=updated_at+delta,
--          established_date = established_date + (delta)::interval::date - CURRENT_DATE + CURRENT_DATE
--    WHERE tenant_id=t;  -- (dates: see note below)
--   UPDATE committee_members SET joined_at=joined_at+delta,
--          left_at = CASE WHEN left_at IS NULL THEN NULL ELSE left_at+delta END,
--          created_at=created_at+delta, updated_at=updated_at+delta WHERE tenant_id=t;
--   UPDATE meetings SET scheduled_at=scheduled_at+delta, scheduled_end_at=scheduled_end_at+delta,
--          actual_start_at=actual_start_at+delta, actual_end_at=actual_end_at+delta,
--          created_at=created_at+delta, updated_at=updated_at+delta WHERE tenant_id=t;
--   UPDATE meeting_attendance SET confirmed_at=confirmed_at+delta, checked_in_at=checked_in_at+delta,
--          checked_out_at=checked_out_at+delta, created_at=created_at+delta, updated_at=updated_at+delta
--    WHERE tenant_id=t;
--   UPDATE agenda_items SET created_at=created_at+delta, updated_at=updated_at+delta WHERE tenant_id=t;
--   UPDATE meeting_minutes SET submitted_for_review_at=submitted_for_review_at+delta,
--          approved_at=approved_at+delta, published_at=published_at+delta,
--          created_at=created_at+delta, updated_at=updated_at+delta WHERE tenant_id=t;
--   UPDATE action_items SET due_date=due_date+delta, original_due_date=original_due_date+delta,
--          completed_at=completed_at+delta, reviewed_at=reviewed_at+delta,
--          created_at=created_at+delta, updated_at=updated_at+delta WHERE tenant_id=t;
--   UPDATE compliance_checks SET period_start=period_start+delta, period_end=period_end+delta,
--          checked_at=checked_at+delta, created_at=created_at+delta WHERE tenant_id=t;
--   -- NOTE: for DATE columns use (col + (delta::text)::interval)::date in practice.
-- END $$;

-- -----------------------------------------------------------------------------
-- (1) CLEANUP — remove prior runs of this seed (acac namespace) for idempotency
-- -----------------------------------------------------------------------------
-- Child rows first (FKs). attendance/agenda/minutes cascade on meeting delete,
-- but action_items reference meetings without cascade, so clear them explicitly.
DELETE FROM action_items      WHERE tenant_id = :tenant AND id::text LIKE 'acac%';
DELETE FROM meeting_minutes   WHERE tenant_id = :tenant AND id::text LIKE 'acac%';
DELETE FROM agenda_items      WHERE tenant_id = :tenant AND id::text LIKE 'acac%';
DELETE FROM meeting_attendance WHERE tenant_id = :tenant AND id::text LIKE 'acac%';
DELETE FROM meetings          WHERE tenant_id = :tenant AND id::text LIKE 'acac%';
DELETE FROM committee_members WHERE tenant_id = :tenant AND id::text LIKE 'acac%';
DELETE FROM committees        WHERE tenant_id = :tenant AND id::text LIKE 'acac%';
DELETE FROM compliance_checks WHERE tenant_id = :tenant AND id::text LIKE 'acac%';

-- -----------------------------------------------------------------------------
-- (2) REPAIR existing Board committee (charter held a pasted runtime error)
-- -----------------------------------------------------------------------------
UPDATE committees
   SET charter = 'The Board of Directors provides strategic direction, approves major decisions, and oversees executive performance and fiduciary duties of Apex Bank Holdings.',
       description = 'Primary board governance body overseeing enterprise strategy, capital, and fiduciary decisions.',
       quorum_percentage = 60,
       quorum_type = 'percentage',
       quorum_fixed_count = NULL,
       meeting_frequency = 'quarterly',
       tags = ARRAY['board','governance'],
       updated_at = now()
 WHERE tenant_id = :tenant
   AND id = '6c12196d-b5c8-4f88-9da1-67f85d99487c';

-- =============================================================================
-- (3) COMMITTEES — add Audit, Risk, Compensation (Board already exists, repaired)
-- =============================================================================
-- Board committee id (pre-existing): 6c12196d-b5c8-4f88-9da1-67f85d99487c
-- New committees in the acac namespace:
--   Audit        acac0000-0000-0000-0000-000000002002
--   Risk         acac0000-0000-0000-0000-000000002003
--   Compensation acac0000-0000-0000-0000-000000002004
INSERT INTO committees (id, tenant_id, name, type, description, chair_user_id,
    vice_chair_user_id, secretary_user_id, meeting_frequency, quorum_percentage,
    quorum_type, charter, established_date, status, tags, metadata, created_by,
    created_at, updated_at)
VALUES
 ('acac0000-0000-0000-0000-000000002002', :tenant, 'Audit Committee', 'audit',
  'Oversight committee for audit, internal control, and external assurance matters.',
  'acac0000-0000-0000-0000-000000001004', 'acac0000-0000-0000-0000-000000001005',
  'acac0000-0000-0000-0000-000000001006', 'monthly', 51, 'percentage',
  'The audit committee reviews financial reporting, assurance activity, and control remediation.',
  (now() - interval '400 days')::date, 'active', ARRAY['audit','assurance'], '{}'::jsonb,
  'acac0000-0000-0000-0000-000000001004', now() - interval '400 days', now() - interval '20 days'),
 ('acac0000-0000-0000-0000-000000002003', :tenant, 'Risk Committee', 'risk',
  'Committee overseeing enterprise risk, resilience, and regulatory exposure.',
  'acac0000-0000-0000-0000-000000001007', 'acac0000-0000-0000-0000-000000001008',
  'acac0000-0000-0000-0000-000000001009', 'monthly', 51, 'percentage',
  'The risk committee reviews the risk register, key exposures, resilience, and treatment plans.',
  (now() - interval '380 days')::date, 'active', ARRAY['risk','resilience'], '{}'::jsonb,
  'acac0000-0000-0000-0000-000000001007', now() - interval '380 days', now() - interval '18 days'),
 ('acac0000-0000-0000-0000-000000002004', :tenant, 'Compensation Committee', 'compensation',
  'Committee reviewing executive compensation and incentives.',
  'acac0000-0000-0000-0000-000000001002', 'acac0000-0000-0000-0000-000000001003',
  'acac0000-0000-0000-0000-000000001010', 'quarterly', 51, 'percentage',
  'The compensation committee reviews remuneration policy and executive performance incentives.',
  (now() - interval '360 days')::date, 'active', ARRAY['compensation','people'], '{}'::jsonb,
  'acac0000-0000-0000-0000-000000001002', now() - interval '360 days', now() - interval '15 days');

-- =============================================================================
-- (4) COMMITTEE MEMBERS
-- =============================================================================
-- Demo users (apexbank.demo). The real logged-in admin (bbbbbbbb-...0001 /
-- "Admin Dev") is added to the Board so the demo user sees their own items.
INSERT INTO committee_members (id, tenant_id, committee_id, user_id, user_name, user_email, role, joined_at, active, created_at, updated_at)
VALUES
 -- Board of Directors (pre-existing committee) — keep existing Admin Dev secretary row, add a full board
 ('acac0000-0001-0000-0000-000000000001', :tenant, '6c12196d-b5c8-4f88-9da1-67f85d99487c', 'acac0000-0000-0000-0000-000000001001', 'Amina Okafor',   'amina.okafor@apexbank.demo',   'chair',      now() - interval '400 days', true, now() - interval '400 days', now() - interval '400 days'),
 ('acac0000-0001-0000-0000-000000000002', :tenant, '6c12196d-b5c8-4f88-9da1-67f85d99487c', 'acac0000-0000-0000-0000-000000001002', 'Daniel Mensah',  'daniel.mensah@apexbank.demo',  'vice_chair', now() - interval '400 days', true, now() - interval '400 days', now() - interval '400 days'),
 ('acac0000-0001-0000-0000-000000000003', :tenant, '6c12196d-b5c8-4f88-9da1-67f85d99487c', 'acac0000-0000-0000-0000-000000001003', 'Grace Nwosu',    'grace.nwosu@apexbank.demo',    'member',     now() - interval '400 days', true, now() - interval '400 days', now() - interval '400 days'),
 ('acac0000-0001-0000-0000-000000000004', :tenant, '6c12196d-b5c8-4f88-9da1-67f85d99487c', 'acac0000-0000-0000-0000-000000001004', 'Ibrahim Bello',  'ibrahim.bello@apexbank.demo',  'member',     now() - interval '400 days', true, now() - interval '400 days', now() - interval '400 days'),
 ('acac0000-0001-0000-0000-000000000005', :tenant, '6c12196d-b5c8-4f88-9da1-67f85d99487c', 'acac0000-0000-0000-0000-000000001005', 'Lara Adeyemi',   'lara.adeyemi@apexbank.demo',   'member',     now() - interval '400 days', true, now() - interval '400 days', now() - interval '400 days'),
 ('acac0000-0001-0000-0000-000000000006', :tenant, '6c12196d-b5c8-4f88-9da1-67f85d99487c', 'acac0000-0000-0000-0000-000000001006', 'Musa Sule',      'musa.sule@apexbank.demo',      'member',     now() - interval '400 days', true, now() - interval '400 days', now() - interval '400 days'),
 ('acac0000-0001-0000-0000-000000000007', :tenant, '6c12196d-b5c8-4f88-9da1-67f85d99487c', 'acac0000-0000-0000-0000-000000001007', 'Nadia Yusuf',    'nadia.yusuf@apexbank.demo',    'member',     now() - interval '400 days', true, now() - interval '400 days', now() - interval '400 days'),
 ('acac0000-0001-0000-0000-000000000008', :tenant, '6c12196d-b5c8-4f88-9da1-67f85d99487c', 'acac0000-0000-0000-0000-000000001008', 'Oliver Dike',    'oliver.dike@apexbank.demo',    'member',     now() - interval '400 days', true, now() - interval '400 days', now() - interval '400 days'),
 -- NOTE: the real logged-in admin (bbbbbbbb-...0001 / Admin Dev) is ALREADY a Board
 -- member (pre-existing 'secretary' row), so we do not re-add them here (unique
 -- active-membership constraint). They participate via the existing row + Board attendance.
 -- Audit Committee
 ('acac0000-0002-0000-0000-000000000001', :tenant, 'acac0000-0000-0000-0000-000000002002', 'acac0000-0000-0000-0000-000000001004', 'Ibrahim Bello',  'ibrahim.bello@apexbank.demo',  'chair',      now() - interval '400 days', true, now() - interval '400 days', now() - interval '400 days'),
 ('acac0000-0002-0000-0000-000000000002', :tenant, 'acac0000-0000-0000-0000-000000002002', 'acac0000-0000-0000-0000-000000001005', 'Lara Adeyemi',   'lara.adeyemi@apexbank.demo',   'vice_chair', now() - interval '400 days', true, now() - interval '400 days', now() - interval '400 days'),
 ('acac0000-0002-0000-0000-000000000003', :tenant, 'acac0000-0000-0000-0000-000000002002', 'acac0000-0000-0000-0000-000000001006', 'Musa Sule',      'musa.sule@apexbank.demo',      'secretary',  now() - interval '400 days', true, now() - interval '400 days', now() - interval '400 days'),
 ('acac0000-0002-0000-0000-000000000004', :tenant, 'acac0000-0000-0000-0000-000000002002', 'acac0000-0000-0000-0000-000000001007', 'Nadia Yusuf',    'nadia.yusuf@apexbank.demo',    'member',     now() - interval '400 days', true, now() - interval '400 days', now() - interval '400 days'),
 ('acac0000-0002-0000-0000-000000000005', :tenant, 'acac0000-0000-0000-0000-000000002002', 'acac0000-0000-0000-0000-000000001008', 'Oliver Dike',    'oliver.dike@apexbank.demo',    'member',     now() - interval '400 days', true, now() - interval '400 days', now() - interval '400 days'),
 -- Risk Committee
 ('acac0000-0003-0000-0000-000000000001', :tenant, 'acac0000-0000-0000-0000-000000002003', 'acac0000-0000-0000-0000-000000001007', 'Nadia Yusuf',    'nadia.yusuf@apexbank.demo',    'chair',      now() - interval '380 days', true, now() - interval '380 days', now() - interval '380 days'),
 ('acac0000-0003-0000-0000-000000000002', :tenant, 'acac0000-0000-0000-0000-000000002003', 'acac0000-0000-0000-0000-000000001008', 'Oliver Dike',    'oliver.dike@apexbank.demo',    'vice_chair', now() - interval '380 days', true, now() - interval '380 days', now() - interval '380 days'),
 ('acac0000-0003-0000-0000-000000000003', :tenant, 'acac0000-0000-0000-0000-000000002003', 'acac0000-0000-0000-0000-000000001009', 'Priya Raman',    'priya.raman@apexbank.demo',    'secretary',  now() - interval '380 days', true, now() - interval '380 days', now() - interval '380 days'),
 ('acac0000-0003-0000-0000-000000000004', :tenant, 'acac0000-0000-0000-0000-000000002003', 'acac0000-0000-0000-0000-000000001010', 'Quentin Udeh',   'quentin.udeh@apexbank.demo',   'member',     now() - interval '380 days', true, now() - interval '380 days', now() - interval '380 days'),
 ('acac0000-0003-0000-0000-000000000005', :tenant, 'acac0000-0000-0000-0000-000000002003', 'acac0000-0000-0000-0000-000000001011', 'Ruth Ekanem',    'ruth.ekanem@apexbank.demo',    'member',     now() - interval '380 days', true, now() - interval '380 days', now() - interval '380 days'),
 ('acac0000-0003-0000-0000-000000000006', :tenant, 'acac0000-0000-0000-0000-000000002003', 'acac0000-0000-0000-0000-000000001012', 'Samuel Balogun', 'samuel.balogun@apexbank.demo', 'member',     now() - interval '380 days', true, now() - interval '380 days', now() - interval '380 days'),
 -- Compensation Committee
 ('acac0000-0004-0000-0000-000000000001', :tenant, 'acac0000-0000-0000-0000-000000002004', 'acac0000-0000-0000-0000-000000001002', 'Daniel Mensah',  'daniel.mensah@apexbank.demo',  'chair',      now() - interval '360 days', true, now() - interval '360 days', now() - interval '360 days'),
 ('acac0000-0004-0000-0000-000000000002', :tenant, 'acac0000-0000-0000-0000-000000002004', 'acac0000-0000-0000-0000-000000001003', 'Grace Nwosu',    'grace.nwosu@apexbank.demo',    'vice_chair', now() - interval '360 days', true, now() - interval '360 days', now() - interval '360 days'),
 ('acac0000-0004-0000-0000-000000000003', :tenant, 'acac0000-0000-0000-0000-000000002004', 'acac0000-0000-0000-0000-000000001010', 'Quentin Udeh',   'quentin.udeh@apexbank.demo',   'secretary',  now() - interval '360 days', true, now() - interval '360 days', now() - interval '360 days'),
 ('acac0000-0004-0000-0000-000000000004', :tenant, 'acac0000-0000-0000-0000-000000002004', 'acac0000-0000-0000-0000-000000001011', 'Ruth Ekanem',    'ruth.ekanem@apexbank.demo',    'member',     now() - interval '360 days', true, now() - interval '360 days', now() - interval '360 days');

-- =============================================================================
-- (5) MEETINGS — spread across recent past (completed), now (in_progress), and
--     near future (scheduled). All scheduled_at anchored to now() so the 30d
--     "recent", "upcoming", calendar (current month), and 12-month trend charts
--     all populate. quorum_required uses fixed counts within committee size.
-- =============================================================================
-- Board id = 6c12196d-... ; Audit = ...2002 ; Risk = ...2003 ; Comp = ...2004
INSERT INTO meetings (id, tenant_id, committee_id, committee_name, title, description,
    meeting_number, scheduled_at, scheduled_end_at, actual_start_at, actual_end_at,
    duration_minutes, location, location_type, status, quorum_required, attendee_count,
    present_count, quorum_met, has_minutes, minutes_status, tags, metadata, created_by,
    created_at, updated_at)
VALUES
 -- ---- BOARD (quarterly), 9 members, quorum 6 ----
 ('acac0000-0000-0000-0000-000000003001', :tenant, '6c12196d-b5c8-4f88-9da1-67f85d99487c', 'Board of Directors', 'Board Q3 2025 Meeting',  'Quarterly board strategy and oversight session.',
  1, now() - interval '270 days', now() - interval '270 days' + interval '120 min', now() - interval '270 days' + interval '5 min', now() - interval '270 days' + interval '125 min',
  120, 'Riyadh HQ Boardroom', 'physical', 'completed', 6, 9, 8, true, true, 'published', ARRAY['seed','board'], '{}'::jsonb, 'acac0000-0000-0000-0000-000000001001', now() - interval '284 days', now() - interval '268 days'),
 ('acac0000-0000-0000-0000-000000003002', :tenant, '6c12196d-b5c8-4f88-9da1-67f85d99487c', 'Board of Directors', 'Board Q4 2025 Meeting',  'Year-end board review and governance approvals.',
  2, now() - interval '180 days', now() - interval '180 days' + interval '135 min', now() - interval '180 days' + interval '5 min', now() - interval '180 days' + interval '140 min',
  135, 'Riyadh HQ Boardroom', 'physical', 'completed', 6, 9, 7, true, true, 'published', ARRAY['seed','board'], '{}'::jsonb, 'acac0000-0000-0000-0000-000000001001', now() - interval '194 days', now() - interval '178 days'),
 ('acac0000-0000-0000-0000-000000003003', :tenant, '6c12196d-b5c8-4f88-9da1-67f85d99487c', 'Board of Directors', 'Board Q1 2026 Meeting',  'First-quarter board strategy session.',
  3, now() - interval '90 days', now() - interval '90 days' + interval '120 min', now() - interval '90 days' + interval '5 min', now() - interval '90 days' + interval '128 min',
  120, 'Riyadh HQ Boardroom', 'physical', 'completed', 6, 9, 9, true, true, 'approved', ARRAY['seed','board'], '{}'::jsonb, 'acac0000-0000-0000-0000-000000001001', now() - interval '104 days', now() - interval '88 days'),
 ('acac0000-0000-0000-0000-000000003004', :tenant, '6c12196d-b5c8-4f88-9da1-67f85d99487c', 'Board of Directors', 'Board Q2 2026 Meeting',  'Quarterly board oversight and capital review.',
  4, now() - interval '12 days', now() - interval '12 days' + interval '120 min', now() - interval '12 days' + interval '4 min', now() - interval '12 days' + interval '124 min',
  120, 'Riyadh HQ Boardroom', 'hybrid', 'completed', 6, 9, 8, true, true, 'review', ARRAY['seed','board'], '{}'::jsonb, 'acac0000-0000-0000-0000-000000001001', now() - interval '26 days', now() - interval '11 days'),
 ('acac0000-0000-0000-0000-000000003005', :tenant, '6c12196d-b5c8-4f88-9da1-67f85d99487c', 'Board of Directors', 'Board Q3 2026 Meeting',  'Scheduled quarterly board session for Q3 strategic matters.',
  5, now() + interval '21 days', now() + interval '21 days' + interval '120 min', NULL, NULL,
  120, 'Riyadh HQ Boardroom', 'hybrid', 'scheduled', 6, 9, 0, NULL, false, NULL, ARRAY['seed','board'], '{}'::jsonb, 'acac0000-0000-0000-0000-000000001001', now() - interval '7 days', now() - interval '7 days'),
 -- ---- AUDIT (monthly), 5 members, quorum 3 ----
 ('acac0000-0000-0000-0000-000000003011', :tenant, 'acac0000-0000-0000-0000-000000002002', 'Audit Committee', 'Audit March 2026 Meeting',   'Monthly audit committee review.',
  1, now() - interval '100 days', now() - interval '100 days' + interval '90 min', now() - interval '100 days' + interval '3 min', now() - interval '100 days' + interval '92 min',
  90, 'Finance Conference Room', 'physical', 'completed', 3, 5, 5, true, true, 'published', ARRAY['seed','audit'], '{}'::jsonb, 'acac0000-0000-0000-0000-000000001004', now() - interval '114 days', now() - interval '98 days'),
 ('acac0000-0000-0000-0000-000000003012', :tenant, 'acac0000-0000-0000-0000-000000002002', 'Audit Committee', 'Audit April 2026 Meeting',   'Monthly audit committee review.',
  2, now() - interval '70 days', now() - interval '70 days' + interval '90 min', now() - interval '70 days' + interval '3 min', now() - interval '70 days' + interval '90 min',
  90, 'Finance Conference Room', 'physical', 'completed', 3, 5, 4, true, true, 'published', ARRAY['seed','audit'], '{}'::jsonb, 'acac0000-0000-0000-0000-000000001004', now() - interval '84 days', now() - interval '68 days'),
 ('acac0000-0000-0000-0000-000000003013', :tenant, 'acac0000-0000-0000-0000-000000002002', 'Audit Committee', 'Audit May 2026 Meeting',     'Monthly audit committee review.',
  3, now() - interval '40 days', now() - interval '40 days' + interval '90 min', now() - interval '40 days' + interval '3 min', now() - interval '40 days' + interval '95 min',
  90, 'Finance Conference Room', 'physical', 'completed', 3, 5, 5, true, true, 'approved', ARRAY['seed','audit'], '{}'::jsonb, 'acac0000-0000-0000-0000-000000001004', now() - interval '54 days', now() - interval '38 days'),
 ('acac0000-0000-0000-0000-000000003014', :tenant, 'acac0000-0000-0000-0000-000000002002', 'Audit Committee', 'Audit June 2026 Meeting',    'Monthly audit committee review (in session).',
  4, now() - interval '2 hours', now() + interval '30 min', now() - interval '2 hours' + interval '2 min', NULL,
  90, 'Finance Conference Room', 'virtual', 'in_progress', 3, 5, 4, NULL, false, NULL, ARRAY['seed','audit'], '{}'::jsonb, 'acac0000-0000-0000-0000-000000001004', now() - interval '14 days', now() - interval '2 hours'),
 ('acac0000-0000-0000-0000-000000003015', :tenant, 'acac0000-0000-0000-0000-000000002002', 'Audit Committee', 'Audit July 2026 Meeting',    'Scheduled monthly audit committee review.',
  5, now() + interval '9 days', now() + interval '9 days' + interval '90 min', NULL, NULL,
  90, 'Finance Conference Room', 'physical', 'scheduled', 3, 5, 0, NULL, false, NULL, ARRAY['seed','audit'], '{}'::jsonb, 'acac0000-0000-0000-0000-000000001004', now() - interval '5 days', now() - interval '5 days'),
 -- ---- RISK (monthly), 6 members, quorum 4 ----
 ('acac0000-0000-0000-0000-000000003021', :tenant, 'acac0000-0000-0000-0000-000000002003', 'Risk Committee', 'Risk March 2026 Meeting',     'Monthly enterprise risk review.',
  1, now() - interval '95 days', now() - interval '95 days' + interval '105 min', now() - interval '95 days' + interval '4 min', now() - interval '95 days' + interval '108 min',
  105, 'Risk War Room', 'physical', 'completed', 4, 6, 6, true, true, 'published', ARRAY['seed','risk'], '{}'::jsonb, 'acac0000-0000-0000-0000-000000001007', now() - interval '109 days', now() - interval '93 days'),
 ('acac0000-0000-0000-0000-000000003022', :tenant, 'acac0000-0000-0000-0000-000000002003', 'Risk Committee', 'Risk April 2026 Meeting',     'Monthly enterprise risk review.',
  2, now() - interval '64 days', now() - interval '64 days' + interval '105 min', now() - interval '64 days' + interval '4 min', now() - interval '64 days' + interval '105 min',
  105, 'Risk War Room', 'physical', 'completed', 4, 6, 5, true, true, 'approved', ARRAY['seed','risk'], '{}'::jsonb, 'acac0000-0000-0000-0000-000000001007', now() - interval '78 days', now() - interval '62 days'),
 ('acac0000-0000-0000-0000-000000003023', :tenant, 'acac0000-0000-0000-0000-000000002003', 'Risk Committee', 'Risk May 2026 Meeting',       'Monthly enterprise risk review.',
  3, now() - interval '34 days', now() - interval '34 days' + interval '105 min', now() - interval '34 days' + interval '4 min', now() - interval '34 days' + interval '110 min',
  105, 'Risk War Room', 'physical', 'completed', 4, 6, 6, true, true, 'draft', ARRAY['seed','risk'], '{}'::jsonb, 'acac0000-0000-0000-0000-000000001007', now() - interval '48 days', now() - interval '32 days'),
 ('acac0000-0000-0000-0000-000000003024', :tenant, 'acac0000-0000-0000-0000-000000002003', 'Risk Committee', 'Risk June 2026 Meeting',      'Scheduled monthly enterprise risk review.',
  4, now() + interval '4 days', now() + interval '4 days' + interval '105 min', NULL, NULL,
  105, 'Risk War Room', 'physical', 'scheduled', 4, 6, 0, NULL, false, NULL, ARRAY['seed','risk'], '{}'::jsonb, 'acac0000-0000-0000-0000-000000001007', now() - interval '3 days', now() - interval '3 days'),
 -- ---- COMPENSATION (quarterly), 4 members, quorum 3 ----
 ('acac0000-0000-0000-0000-000000003031', :tenant, 'acac0000-0000-0000-0000-000000002004', 'Compensation Committee', 'Compensation Q1 2026 Meeting', 'Quarterly remuneration policy review.',
  1, now() - interval '85 days', now() - interval '85 days' + interval '75 min', now() - interval '85 days' + interval '3 min', now() - interval '85 days' + interval '78 min',
  75, 'Executive Suite', 'physical', 'completed', 3, 4, 4, true, true, 'published', ARRAY['seed','compensation'], '{}'::jsonb, 'acac0000-0000-0000-0000-000000001002', now() - interval '99 days', now() - interval '83 days'),
 ('acac0000-0000-0000-0000-000000003032', :tenant, 'acac0000-0000-0000-0000-000000002004', 'Compensation Committee', 'Compensation Q2 2026 Meeting', 'Scheduled quarterly remuneration review.',
  2, now() + interval '14 days', now() + interval '14 days' + interval '75 min', NULL, NULL,
  75, 'Executive Suite', 'physical', 'scheduled', 3, 4, 0, NULL, false, NULL, ARRAY['seed','compensation'], '{}'::jsonb, 'acac0000-0000-0000-0000-000000001002', now() - interval '6 days', now() - interval '6 days');

-- =============================================================================
-- (6) MEETING ATTENDANCE — one row per committee member per meeting.
--     Generated from committee membership; status reflects meeting state.
-- =============================================================================
INSERT INTO meeting_attendance (id, tenant_id, meeting_id, user_id, user_name, user_email,
    member_role, status, confirmed_at, checked_in_at, checked_out_at, created_at, updated_at)
SELECT
    ('acad' || substr(md5(m.id::text || cm.user_id::text), 1, 4) || '-0000-0000-0000-' || substr(md5(m.id::text || cm.user_id::text), 5, 12))::uuid,
    :tenant, m.id, cm.user_id, cm.user_name, cm.user_email, cm.role,
    CASE
      WHEN m.status = 'completed' THEN
        CASE WHEN (('x'||substr(md5(m.id::text||cm.user_id::text),1,2))::bit(8)::int % 10) = 0 THEN 'absent'
             WHEN (('x'||substr(md5(m.id::text||cm.user_id::text),1,2))::bit(8)::int % 17) = 0 THEN 'excused'
             ELSE 'present' END
      WHEN m.status = 'in_progress' THEN
        CASE WHEN (('x'||substr(md5(m.id::text||cm.user_id::text),1,2))::bit(8)::int % 6) = 0 THEN 'invited' ELSE 'present' END
      WHEN cm.role = 'chair' THEN 'confirmed'
      ELSE CASE WHEN (('x'||substr(md5(m.id::text||cm.user_id::text),1,2))::bit(8)::int % 3) = 0 THEN 'confirmed' ELSE 'invited' END
    END AS status,
    CASE WHEN m.status IN ('completed','in_progress') OR cm.role='chair' THEN m.created_at ELSE NULL END,
    CASE WHEN m.status IN ('completed','in_progress') THEN m.scheduled_at + interval '2 min' ELSE NULL END,
    CASE WHEN m.status = 'completed' THEN m.actual_end_at ELSE NULL END,
    m.created_at, m.updated_at
FROM meetings m
JOIN committee_members cm
  ON cm.committee_id = m.committee_id AND cm.tenant_id = m.tenant_id AND cm.active = true
WHERE m.tenant_id = :tenant AND m.id::text LIKE 'acac%';

-- =============================================================================
-- (7) AGENDA ITEMS — 3-4 per completed/in-progress meeting, some with votes.
-- =============================================================================
INSERT INTO agenda_items (id, tenant_id, meeting_id, title, description, item_number,
    presenter_user_id, presenter_name, duration_minutes, order_index, status, notes,
    requires_vote, vote_type, votes_for, votes_against, votes_abstained, vote_result,
    category, created_at, updated_at)
VALUES
 -- Board Q3 2025
 ('acac0000-0000-0000-0000-000000004001', :tenant, 'acac0000-0000-0000-0000-000000003001', 'Review prior board resolutions', 'Governance discussion item: review prior board resolutions', '1', 'acac0000-0000-0000-0000-000000001001', 'Amina Okafor', 20, 0, 'discussed', 'Reviewed in detail; no open items.', false, NULL, NULL, NULL, NULL, NULL, 'regular', now() - interval '270 days', now() - interval '268 days'),
 ('acac0000-0000-0000-0000-000000004002', :tenant, 'acac0000-0000-0000-0000-000000003001', 'Approve capital allocation framework', 'Governance discussion item: capital allocation', '2', 'acac0000-0000-0000-0000-000000001002', 'Daniel Mensah', 20, 1, 'approved', 'Framework approved unanimously.', true, 'unanimous', 8, 0, 0, 'approved', 'decision', now() - interval '270 days', now() - interval '268 days'),
 ('acac0000-0000-0000-0000-000000004003', :tenant, 'acac0000-0000-0000-0000-000000003001', 'CEO performance update', 'Governance discussion item: CEO performance', '3', 'acac0000-0000-0000-0000-000000001003', 'Grace Nwosu', 20, 2, 'for_noting', 'Noted by the board.', false, NULL, NULL, NULL, NULL, NULL, 'information', now() - interval '270 days', now() - interval '268 days'),
 -- Board Q4 2025
 ('acac0000-0000-0000-0000-000000004004', :tenant, 'acac0000-0000-0000-0000-000000003002', 'Approve 2026 operating plan', 'Governance discussion item: 2026 operating plan', '1', 'acac0000-0000-0000-0000-000000001001', 'Amina Okafor', 20, 0, 'approved', 'Operating plan approved.', true, 'majority', 7, 1, 0, 'approved', 'decision', now() - interval '180 days', now() - interval '178 days'),
 ('acac0000-0000-0000-0000-000000004005', :tenant, 'acac0000-0000-0000-0000-000000003002', 'Review cyber resilience posture', 'Governance discussion item: cyber resilience', '2', 'acac0000-0000-0000-0000-000000001007', 'Nadia Yusuf', 20, 1, 'discussed', 'Posture reviewed; action assigned.', false, NULL, NULL, NULL, NULL, NULL, 'discussion', now() - interval '180 days', now() - interval '178 days'),
 ('acac0000-0000-0000-0000-000000004006', :tenant, 'acac0000-0000-0000-0000-000000003002', 'Board diversity policy draft', 'Governance discussion item: diversity policy', '3', 'acac0000-0000-0000-0000-000000001002', 'Daniel Mensah', 20, 2, 'deferred', 'Deferred for legal review.', true, 'majority', 3, 3, 1, 'deferred', 'decision', now() - interval '180 days', now() - interval '178 days'),
 -- Board Q1 2026
 ('acac0000-0000-0000-0000-000000004007', :tenant, 'acac0000-0000-0000-0000-000000003003', 'Confirm succession planning review', 'Governance discussion item: succession planning', '1', 'acac0000-0000-0000-0000-000000001003', 'Grace Nwosu', 20, 0, 'approved', 'Succession plan confirmed.', true, 'two_thirds', 8, 1, 0, 'approved', 'decision', now() - interval '90 days', now() - interval '88 days'),
 ('acac0000-0000-0000-0000-000000004008', :tenant, 'acac0000-0000-0000-0000-000000003003', 'Strategic investment update', 'Governance discussion item: strategic investments', '2', 'acac0000-0000-0000-0000-000000001001', 'Amina Okafor', 20, 1, 'discussed', 'Pipeline reviewed.', false, NULL, NULL, NULL, NULL, NULL, 'regular', now() - interval '90 days', now() - interval '88 days'),
 -- Board Q2 2026 (recent)
 ('acac0000-0000-0000-0000-000000004009', :tenant, 'acac0000-0000-0000-0000-000000003004', 'Half-year financial review', 'Governance discussion item: H1 financials', '1', 'acac0000-0000-0000-0000-000000001004', 'Ibrahim Bello', 20, 0, 'discussed', 'H1 results reviewed.', false, NULL, NULL, NULL, NULL, NULL, 'regular', now() - interval '12 days', now() - interval '11 days'),
 ('acac0000-0000-0000-0000-000000004010', :tenant, 'acac0000-0000-0000-0000-000000003004', 'Approve dividend recommendation', 'Governance discussion item: dividend', '2', 'acac0000-0000-0000-0000-000000001002', 'Daniel Mensah', 20, 1, 'approved', 'Dividend recommendation approved.', true, 'majority', 8, 0, 0, 'approved', 'decision', now() - interval '12 days', now() - interval '11 days'),
 -- Audit March 2026
 ('acac0000-0000-0000-0000-000000004021', :tenant, 'acac0000-0000-0000-0000-000000003011', 'Review external audit findings', 'Governance discussion item: external audit findings', '1', 'acac0000-0000-0000-0000-000000001004', 'Ibrahim Bello', 20, 0, 'discussed', 'Findings reviewed; remediation tracked.', false, NULL, NULL, NULL, NULL, NULL, 'regular', now() - interval '100 days', now() - interval '98 days'),
 ('acac0000-0000-0000-0000-000000004022', :tenant, 'acac0000-0000-0000-0000-000000003011', 'Approve remediation timeline', 'Governance discussion item: remediation timeline', '2', 'acac0000-0000-0000-0000-000000001005', 'Lara Adeyemi', 20, 1, 'approved', 'Timeline approved.', true, 'majority', 4, 0, 1, 'approved', 'decision', now() - interval '100 days', now() - interval '98 days'),
 ('acac0000-0000-0000-0000-000000004023', :tenant, 'acac0000-0000-0000-0000-000000003011', 'Internal audit update', 'Governance discussion item: internal audit', '3', 'acac0000-0000-0000-0000-000000001006', 'Musa Sule', 20, 2, 'for_noting', 'Update noted.', false, NULL, NULL, NULL, NULL, NULL, 'information', now() - interval '100 days', now() - interval '98 days'),
 -- Audit April 2026
 ('acac0000-0000-0000-0000-000000004024', :tenant, 'acac0000-0000-0000-0000-000000003012', 'Review control exceptions', 'Governance discussion item: control exceptions', '1', 'acac0000-0000-0000-0000-000000001004', 'Ibrahim Bello', 20, 0, 'discussed', 'Exceptions reviewed.', false, NULL, NULL, NULL, NULL, NULL, 'regular', now() - interval '70 days', now() - interval '68 days'),
 ('acac0000-0000-0000-0000-000000004025', :tenant, 'acac0000-0000-0000-0000-000000003012', 'Financial statement close readiness', 'Governance discussion item: close readiness', '2', 'acac0000-0000-0000-0000-000000001005', 'Lara Adeyemi', 20, 1, 'discussed', 'Close readiness confirmed.', false, NULL, NULL, NULL, NULL, NULL, 'regular', now() - interval '70 days', now() - interval '68 days'),
 -- Audit May 2026
 ('acac0000-0000-0000-0000-000000004026', :tenant, 'acac0000-0000-0000-0000-000000003013', 'Approve internal controls attestation', 'Governance discussion item: controls attestation', '1', 'acac0000-0000-0000-0000-000000001004', 'Ibrahim Bello', 20, 0, 'approved', 'Attestation approved.', true, 'unanimous', 5, 0, 0, 'approved', 'decision', now() - interval '40 days', now() - interval '38 days'),
 ('acac0000-0000-0000-0000-000000004027', :tenant, 'acac0000-0000-0000-0000-000000003013', 'Vendor audit coverage plan', 'Governance discussion item: vendor audit coverage', '2', 'acac0000-0000-0000-0000-000000001006', 'Musa Sule', 20, 1, 'discussed', 'Coverage plan reviewed.', false, NULL, NULL, NULL, NULL, NULL, 'regular', now() - interval '40 days', now() - interval '38 days'),
 -- Audit June 2026 (in progress)
 ('acac0000-0000-0000-0000-000000004028', :tenant, 'acac0000-0000-0000-0000-000000003014', 'Quarterly assurance report', 'Governance discussion item: assurance report', '1', 'acac0000-0000-0000-0000-000000001004', 'Ibrahim Bello', 20, 0, 'pending', 'In session.', false, NULL, NULL, NULL, NULL, NULL, 'regular', now() - interval '14 days', now() - interval '2 hours'),
 -- Risk March 2026
 ('acac0000-0000-0000-0000-000000004041', :tenant, 'acac0000-0000-0000-0000-000000003021', 'Risk appetite refresh', 'Governance discussion item: risk appetite', '1', 'acac0000-0000-0000-0000-000000001007', 'Nadia Yusuf', 20, 0, 'approved', 'Appetite statement refreshed.', true, 'majority', 6, 0, 0, 'approved', 'decision', now() - interval '95 days', now() - interval '93 days'),
 ('acac0000-0000-0000-0000-000000004042', :tenant, 'acac0000-0000-0000-0000-000000003021', 'Update risk register', 'Governance discussion item: risk register', '2', 'acac0000-0000-0000-0000-000000001008', 'Oliver Dike', 20, 1, 'discussed', 'Register updated.', false, NULL, NULL, NULL, NULL, NULL, 'regular', now() - interval '95 days', now() - interval '93 days'),
 ('acac0000-0000-0000-0000-000000004043', :tenant, 'acac0000-0000-0000-0000-000000003021', 'Third-party concentration review', 'Governance discussion item: third-party concentration', '3', 'acac0000-0000-0000-0000-000000001009', 'Priya Raman', 20, 2, 'for_noting', 'Concentration risk noted.', false, NULL, NULL, NULL, NULL, NULL, 'information', now() - interval '95 days', now() - interval '93 days'),
 -- Risk April 2026
 ('acac0000-0000-0000-0000-000000004044', :tenant, 'acac0000-0000-0000-0000-000000003022', 'Business continuity scenario', 'Governance discussion item: BC scenario', '1', 'acac0000-0000-0000-0000-000000001007', 'Nadia Yusuf', 20, 0, 'discussed', 'Scenario tested.', false, NULL, NULL, NULL, NULL, NULL, 'discussion', now() - interval '64 days', now() - interval '62 days'),
 ('acac0000-0000-0000-0000-000000004045', :tenant, 'acac0000-0000-0000-0000-000000003022', 'Operational loss report', 'Governance discussion item: operational loss', '2', 'acac0000-0000-0000-0000-000000001008', 'Oliver Dike', 20, 1, 'for_noting', 'Losses within tolerance.', false, NULL, NULL, NULL, NULL, NULL, 'information', now() - interval '64 days', now() - interval '62 days'),
 -- Risk May 2026
 ('acac0000-0000-0000-0000-000000004046', :tenant, 'acac0000-0000-0000-0000-000000003023', 'Stress testing outcomes', 'Governance discussion item: stress testing', '1', 'acac0000-0000-0000-0000-000000001007', 'Nadia Yusuf', 20, 0, 'discussed', 'Outcomes within thresholds.', false, NULL, NULL, NULL, NULL, NULL, 'regular', now() - interval '34 days', now() - interval '32 days'),
 ('acac0000-0000-0000-0000-000000004047', :tenant, 'acac0000-0000-0000-0000-000000003023', 'Liquidity risk triggers', 'Governance discussion item: liquidity triggers', '2', 'acac0000-0000-0000-0000-000000001009', 'Priya Raman', 20, 1, 'approved', 'Triggers updated.', true, 'majority', 5, 1, 0, 'approved', 'decision', now() - interval '34 days', now() - interval '32 days'),
 -- Compensation Q1 2026
 ('acac0000-0000-0000-0000-000000004061', :tenant, 'acac0000-0000-0000-0000-000000003031', 'Executive remuneration review', 'Governance discussion item: executive remuneration', '1', 'acac0000-0000-0000-0000-000000001002', 'Daniel Mensah', 20, 0, 'approved', 'Remuneration policy approved.', true, 'majority', 4, 0, 0, 'approved', 'decision', now() - interval '85 days', now() - interval '83 days'),
 ('acac0000-0000-0000-0000-000000004062', :tenant, 'acac0000-0000-0000-0000-000000003031', 'Long-term incentive plan update', 'Governance discussion item: LTIP update', '2', 'acac0000-0000-0000-0000-000000001003', 'Grace Nwosu', 20, 1, 'discussed', 'LTIP reviewed.', false, NULL, NULL, NULL, NULL, NULL, 'regular', now() - interval '85 days', now() - interval '83 days');

-- =============================================================================
-- (8) MEETING MINUTES — for completed meetings flagged has_minutes=true.
-- =============================================================================
INSERT INTO meeting_minutes (id, tenant_id, meeting_id, content, ai_summary, status,
    submitted_for_review_at, submitted_by, approved_by, approved_at, published_at,
    version, ai_action_items, ai_generated, created_by, created_at, updated_at)
SELECT
    ('acae' || substr(md5(m.id::text),1,4) || '-0000-0000-0000-' || substr(md5(m.id::text),5,12))::uuid,
    :tenant, m.id,
    '# Minutes of ' || m.title || E'\n\nThe committee reviewed its standing agenda, resolved matters before it, and recorded follow-up actions.',
    m.title || ' met on ' || to_char(m.scheduled_at, 'FMMonth DD, YYYY') || ' to review governance matters and assign follow-up actions.',
    m.minutes_status,
    CASE WHEN m.minutes_status IN ('review','approved','published') THEN m.scheduled_at + interval '2 days' ELSE NULL END,
    CASE WHEN m.minutes_status IN ('review','approved','published') THEN m.created_by ELSE NULL END,
    CASE WHEN m.minutes_status IN ('approved','published') THEN m.created_by ELSE NULL END,
    CASE WHEN m.minutes_status IN ('approved','published') THEN m.scheduled_at + interval '4 days' ELSE NULL END,
    CASE WHEN m.minutes_status = 'published' THEN m.scheduled_at + interval '5 days' ELSE NULL END,
    1, '[]'::jsonb,
    (m.minutes_status = 'published'),
    m.created_by, m.scheduled_at + interval '2 days', m.scheduled_at + interval '3 days'
FROM meetings m
WHERE m.tenant_id = :tenant AND m.id::text LIKE 'acac%' AND m.has_minutes = true;

-- =============================================================================
-- (9) ACTION ITEMS — open/in_progress/overdue/completed spread. due_date straddles
--     CURRENT_DATE so the overdue widget AND upcoming-due lists both populate.
-- =============================================================================
INSERT INTO action_items (id, tenant_id, meeting_id, agenda_item_id, committee_id, title,
    description, priority, assigned_to, assignee_name, assigned_by, due_date, original_due_date,
    status, completed_at, completion_notes, tags, metadata, created_by, created_at, updated_at)
VALUES
 -- COMPLETED (past due dates, completed before due)
 ('acac0000-0000-0000-0000-000000005001', :tenant, 'acac0000-0000-0000-0000-000000003001', 'acac0000-0000-0000-0000-000000004002', '6c12196d-b5c8-4f88-9da1-67f85d99487c', 'Finalize capital allocation analysis', 'Follow-up action arising from committee deliberations.', 'high',     'acac0000-0000-0000-0000-000000001002', 'Daniel Mensah',  'acac0000-0000-0000-0000-000000001001', (now() - interval '250 days')::date, (now() - interval '250 days')::date, 'completed', now() - interval '252 days', 'Closed with committee-reviewed evidence.', ARRAY['seed'], '{}'::jsonb, 'acac0000-0000-0000-0000-000000001001', now() - interval '270 days', now() - interval '252 days'),
 ('acac0000-0000-0000-0000-000000005002', :tenant, 'acac0000-0000-0000-0000-000000003002', 'acac0000-0000-0000-0000-000000004004', '6c12196d-b5c8-4f88-9da1-67f85d99487c', 'Publish 2026 operating plan memo', 'Follow-up action arising from committee deliberations.', 'medium',   'acac0000-0000-0000-0000-000000001003', 'Grace Nwosu',    'acac0000-0000-0000-0000-000000001001', (now() - interval '160 days')::date, (now() - interval '160 days')::date, 'completed', now() - interval '162 days', 'Closed with committee-reviewed evidence.', ARRAY['seed'], '{}'::jsonb, 'acac0000-0000-0000-0000-000000001001', now() - interval '180 days', now() - interval '162 days'),
 ('acac0000-0000-0000-0000-000000005003', :tenant, 'acac0000-0000-0000-0000-000000003011', 'acac0000-0000-0000-0000-000000004022', 'acac0000-0000-0000-0000-000000002002', 'Review vendor security audit', 'Follow-up action arising from committee deliberations.', 'high',     'acac0000-0000-0000-0000-000000001005', 'Lara Adeyemi',   'acac0000-0000-0000-0000-000000001004', (now() - interval '80 days')::date, (now() - interval '80 days')::date, 'completed', now() - interval '82 days', 'Closed with committee-reviewed evidence.', ARRAY['seed'], '{}'::jsonb, 'acac0000-0000-0000-0000-000000001004', now() - interval '100 days', now() - interval '82 days'),
 ('acac0000-0000-0000-0000-000000005004', :tenant, 'acac0000-0000-0000-0000-000000003021', 'acac0000-0000-0000-0000-000000004041', 'acac0000-0000-0000-0000-000000002003', 'Update risk register', 'Follow-up action arising from committee deliberations.', 'medium',   'acac0000-0000-0000-0000-000000001008', 'Oliver Dike',    'acac0000-0000-0000-0000-000000001007', (now() - interval '75 days')::date, (now() - interval '75 days')::date, 'completed', now() - interval '77 days', 'Closed with committee-reviewed evidence.', ARRAY['seed'], '{}'::jsonb, 'acac0000-0000-0000-0000-000000001007', now() - interval '95 days', now() - interval '77 days'),
 ('acac0000-0000-0000-0000-000000005005', :tenant, 'acac0000-0000-0000-0000-000000003031', 'acac0000-0000-0000-0000-000000004061', 'acac0000-0000-0000-0000-000000002004', 'Validate executive pay benchmarks', 'Follow-up action arising from committee deliberations.', 'high',     'acac0000-0000-0000-0000-000000001003', 'Grace Nwosu',    'acac0000-0000-0000-0000-000000001002', (now() - interval '65 days')::date, (now() - interval '65 days')::date, 'completed', now() - interval '67 days', 'Closed with committee-reviewed evidence.', ARRAY['seed'], '{}'::jsonb, 'acac0000-0000-0000-0000-000000001002', now() - interval '85 days', now() - interval '67 days'),
 ('acac0000-0000-0000-0000-000000005006', :tenant, 'acac0000-0000-0000-0000-000000003012', 'acac0000-0000-0000-0000-000000004024', 'acac0000-0000-0000-0000-000000002002', 'Complete cyber insurance benchmark', 'Follow-up action arising from committee deliberations.', 'medium',   'acac0000-0000-0000-0000-000000001006', 'Musa Sule',      'acac0000-0000-0000-0000-000000001004', (now() - interval '45 days')::date, (now() - interval '45 days')::date, 'completed', now() - interval '47 days', 'Closed with committee-reviewed evidence.', ARRAY['seed'], '{}'::jsonb, 'acac0000-0000-0000-0000-000000001004', now() - interval '70 days', now() - interval '47 days'),
 -- OVERDUE (due_date < CURRENT_DATE, still open)
 ('acac0000-0000-0000-0000-000000005011', :tenant, 'acac0000-0000-0000-0000-000000003013', 'acac0000-0000-0000-0000-000000004026', 'acac0000-0000-0000-0000-000000002002', 'Track remediation on control exceptions', 'Follow-up action arising from committee deliberations.', 'critical', 'acac0000-0000-0000-0000-000000001005', 'Lara Adeyemi',   'acac0000-0000-0000-0000-000000001004', (now() - interval '15 days')::date, (now() - interval '15 days')::date, 'overdue', NULL, NULL, ARRAY['seed'], '{}'::jsonb, 'acac0000-0000-0000-0000-000000001004', now() - interval '40 days', now() - interval '15 days'),
 ('acac0000-0000-0000-0000-000000005012', :tenant, 'acac0000-0000-0000-0000-000000003023', 'acac0000-0000-0000-0000-000000004046', 'acac0000-0000-0000-0000-000000002003', 'Compile stress testing action log', 'Follow-up action arising from committee deliberations.', 'high',     'acac0000-0000-0000-0000-000000001009', 'Priya Raman',    'acac0000-0000-0000-0000-000000001007', (now() - interval '10 days')::date, (now() - interval '10 days')::date, 'overdue', NULL, NULL, ARRAY['seed'], '{}'::jsonb, 'acac0000-0000-0000-0000-000000001007', now() - interval '34 days', now() - interval '10 days'),
 ('acac0000-0000-0000-0000-000000005013', :tenant, 'acac0000-0000-0000-0000-000000003022', 'acac0000-0000-0000-0000-000000004044', 'acac0000-0000-0000-0000-000000002003', 'Refresh incident response contacts', 'Follow-up action arising from committee deliberations.', 'medium',   'acac0000-0000-0000-0000-000000001010', 'Quentin Udeh',   'acac0000-0000-0000-0000-000000001007', (now() - interval '5 days')::date, (now() - interval '5 days')::date, 'overdue', NULL, NULL, ARRAY['seed'], '{}'::jsonb, 'acac0000-0000-0000-0000-000000001007', now() - interval '64 days', now() - interval '5 days'),
 -- IN PROGRESS (future due dates, started)
 ('acac0000-0000-0000-0000-000000005021', :tenant, 'acac0000-0000-0000-0000-000000003004', 'acac0000-0000-0000-0000-000000004009', '6c12196d-b5c8-4f88-9da1-67f85d99487c', 'Prepare H2 budget proposal', 'Follow-up action arising from committee deliberations.', 'high',     :admin,                                  'Admin Dev',      'acac0000-0000-0000-0000-000000001001', (now() + interval '12 days')::date, (now() + interval '12 days')::date, 'in_progress', NULL, NULL, ARRAY['seed'], '{}'::jsonb, 'acac0000-0000-0000-0000-000000001001', now() - interval '12 days', now() - interval '3 days'),
 ('acac0000-0000-0000-0000-000000005022', :tenant, 'acac0000-0000-0000-0000-000000003013', 'acac0000-0000-0000-0000-000000004027', 'acac0000-0000-0000-0000-000000002002', 'Document vendor due diligence findings', 'Follow-up action arising from committee deliberations.', 'medium',   'acac0000-0000-0000-0000-000000001006', 'Musa Sule',      'acac0000-0000-0000-0000-000000001004', (now() + interval '8 days')::date, (now() + interval '8 days')::date, 'in_progress', NULL, NULL, ARRAY['seed'], '{}'::jsonb, 'acac0000-0000-0000-0000-000000001004', now() - interval '40 days', now() - interval '2 days'),
 ('acac0000-0000-0000-0000-000000005023', :tenant, 'acac0000-0000-0000-0000-000000003023', 'acac0000-0000-0000-0000-000000004047', 'acac0000-0000-0000-0000-000000002003', 'Update liquidity trigger thresholds', 'Follow-up action arising from committee deliberations.', 'high',     'acac0000-0000-0000-0000-000000001009', 'Priya Raman',    'acac0000-0000-0000-0000-000000001007', (now() + interval '6 days')::date, (now() + interval '6 days')::date, 'in_progress', NULL, NULL, ARRAY['seed'], '{}'::jsonb, 'acac0000-0000-0000-0000-000000001007', now() - interval '34 days', now() - interval '1 days'),
 -- PENDING (future due dates, not started)
 ('acac0000-0000-0000-0000-000000005031', :tenant, 'acac0000-0000-0000-0000-000000003004', 'acac0000-0000-0000-0000-000000004010', '6c12196d-b5c8-4f88-9da1-67f85d99487c', 'Draft board diversity policy', 'Follow-up action arising from committee deliberations.', 'medium',   'acac0000-0000-0000-0000-000000001002', 'Daniel Mensah',  'acac0000-0000-0000-0000-000000001001', (now() + interval '20 days')::date, (now() + interval '20 days')::date, 'pending', NULL, NULL, ARRAY['seed'], '{}'::jsonb, 'acac0000-0000-0000-0000-000000001001', now() - interval '12 days', now() - interval '11 days'),
 ('acac0000-0000-0000-0000-000000005032', :tenant, 'acac0000-0000-0000-0000-000000003013', 'acac0000-0000-0000-0000-000000004026', 'acac0000-0000-0000-0000-000000002002', 'Publish internal controls memo', 'Follow-up action arising from committee deliberations.', 'low',      'acac0000-0000-0000-0000-000000001007', 'Nadia Yusuf',    'acac0000-0000-0000-0000-000000001004', (now() + interval '18 days')::date, (now() + interval '18 days')::date, 'pending', NULL, NULL, ARRAY['seed'], '{}'::jsonb, 'acac0000-0000-0000-0000-000000001004', now() - interval '40 days', now() - interval '38 days'),
 ('acac0000-0000-0000-0000-000000005033', :tenant, 'acac0000-0000-0000-0000-000000003023', 'acac0000-0000-0000-0000-000000004046', 'acac0000-0000-0000-0000-000000002003', 'Prepare board education calendar', 'Follow-up action arising from committee deliberations.', 'low',      'acac0000-0000-0000-0000-000000001008', 'Oliver Dike',    'acac0000-0000-0000-0000-000000001007', (now() + interval '25 days')::date, (now() + interval '25 days')::date, 'pending', NULL, NULL, ARRAY['seed'], '{}'::jsonb, 'acac0000-0000-0000-0000-000000001007', now() - interval '34 days', now() - interval '32 days'),
 ('acac0000-0000-0000-0000-000000005034', :tenant, 'acac0000-0000-0000-0000-000000003031', 'acac0000-0000-0000-0000-000000004062', 'acac0000-0000-0000-0000-000000002004', 'Refresh conduct risk heatmap', 'Follow-up action arising from committee deliberations.', 'medium',   'acac0000-0000-0000-0000-000000001010', 'Quentin Udeh',   'acac0000-0000-0000-0000-000000001002', (now() + interval '15 days')::date, (now() + interval '15 days')::date, 'pending', NULL, NULL, ARRAY['seed'], '{}'::jsonb, 'acac0000-0000-0000-0000-000000001002', now() - interval '85 days', now() - interval '83 days'),
 ('acac0000-0000-0000-0000-000000005035', :tenant, 'acac0000-0000-0000-0000-000000003012', 'acac0000-0000-0000-0000-000000004025', 'acac0000-0000-0000-0000-000000002002', 'Confirm policy exception register', 'Follow-up action arising from committee deliberations.', 'medium',   :admin,                                  'Admin Dev',      'acac0000-0000-0000-0000-000000001004', (now() + interval '10 days')::date, (now() + interval '10 days')::date, 'pending', NULL, NULL, ARRAY['seed'], '{}'::jsonb, 'acac0000-0000-0000-0000-000000001004', now() - interval '70 days', now() - interval '68 days');

-- =============================================================================
-- (10) DENORMALIZED COUNTS — refresh agenda_item_count / action_item_count on
--      meetings (the Go seeder calls UpdateMeeting*Count; we do it inline).
-- =============================================================================
UPDATE meetings m SET agenda_item_count = COALESCE(a.cnt, 0)
  FROM (SELECT meeting_id, count(*) cnt FROM agenda_items WHERE tenant_id = :tenant GROUP BY meeting_id) a
 WHERE a.meeting_id = m.id AND m.tenant_id = :tenant AND m.id::text LIKE 'acac%';
UPDATE meetings m SET action_item_count = COALESCE(ai.cnt, 0)
  FROM (SELECT meeting_id, count(*) cnt FROM action_items WHERE tenant_id = :tenant GROUP BY meeting_id) ai
 WHERE ai.meeting_id = m.id AND m.tenant_id = :tenant AND m.id::text LIKE 'acac%';

-- =============================================================================
-- (11) COMPLIANCE CHECKS — top up with a current spread (existing 30 rows are
--      already current; add a few more in the acac namespace covering recent
--      periods so per-committee compliance widgets show buckets).
-- =============================================================================
INSERT INTO compliance_checks (id, tenant_id, committee_id, check_type, check_name, status,
    severity, description, finding, recommendation, evidence, period_start, period_end,
    checked_at, checked_by, created_at)
VALUES
 ('acac0000-0000-0000-0000-000000006001', :tenant, '6c12196d-b5c8-4f88-9da1-67f85d99487c', 'meeting_frequency', 'Board meeting cadence', 'compliant', 'medium', 'Board met per its quarterly charter cadence.', NULL, NULL, '{}'::jsonb, (now() - interval '90 days')::date, (now())::date, now() - interval '1 days', 'system', now() - interval '1 days'),
 ('acac0000-0000-0000-0000-000000006002', :tenant, '6c12196d-b5c8-4f88-9da1-67f85d99487c', 'quorum_compliance', 'Board quorum adherence', 'compliant', 'high', 'All completed board meetings met required quorum.', NULL, NULL, '{}'::jsonb, (now() - interval '180 days')::date, (now())::date, now() - interval '1 days', 'system', now() - interval '1 days'),
 ('acac0000-0000-0000-0000-000000006003', :tenant, 'acac0000-0000-0000-0000-000000002002', 'minutes_completion', 'Audit minutes completion', 'warning', 'medium', 'One audit meeting minutes pending approval.', 'May 2026 minutes in approved (not published) state.', 'Publish approved minutes within 5 business days.', '{}'::jsonb, (now() - interval '120 days')::date, (now())::date, now() - interval '2 days', 'system', now() - interval '2 days'),
 ('acac0000-0000-0000-0000-000000006004', :tenant, 'acac0000-0000-0000-0000-000000002002', 'action_item_tracking', 'Audit action tracking', 'non_compliant', 'high', 'Open overdue action item on control exceptions.', 'Remediation tracking item is overdue.', 'Escalate to committee chair for closure.', '{}'::jsonb, (now() - interval '60 days')::date, (now())::date, now() - interval '2 days', 'system', now() - interval '2 days'),
 ('acac0000-0000-0000-0000-000000006005', :tenant, 'acac0000-0000-0000-0000-000000002003', 'attendance_rate', 'Risk attendance rate', 'compliant', 'low', 'Risk committee attendance above 80% threshold.', NULL, NULL, '{}'::jsonb, (now() - interval '120 days')::date, (now())::date, now() - interval '3 days', 'system', now() - interval '3 days'),
 ('acac0000-0000-0000-0000-000000006006', :tenant, 'acac0000-0000-0000-0000-000000002003', 'action_item_tracking', 'Risk action tracking', 'warning', 'medium', 'Stress testing action log overdue.', 'One overdue risk action item.', 'Assign interim owner and set revised due date.', '{}'::jsonb, (now() - interval '60 days')::date, (now())::date, now() - interval '3 days', 'system', now() - interval '3 days'),
 ('acac0000-0000-0000-0000-000000006007', :tenant, 'acac0000-0000-0000-0000-000000002004', 'charter_review', 'Compensation charter review', 'compliant', 'low', 'Charter reviewed within annual cycle.', NULL, NULL, '{}'::jsonb, (now() - interval '365 days')::date, (now())::date, now() - interval '4 days', 'system', now() - interval '4 days'),
 ('acac0000-0000-0000-0000-000000006008', :tenant, '6c12196d-b5c8-4f88-9da1-67f85d99487c', 'conflict_of_interest', 'Board COI declarations', 'compliant', 'medium', 'All directors filed conflict-of-interest declarations.', NULL, NULL, '{}'::jsonb, (now() - interval '180 days')::date, (now())::date, now() - interval '5 days', 'system', now() - interval '5 days');

COMMIT;

-- =============================================================================
-- VERIFY (run separately; not part of the transaction)
-- =============================================================================
-- \set tenant '''aaaaaaaa-0000-0000-0000-000000000001'''
-- SELECT 'committees' t, count(*) FROM committees WHERE tenant_id=:tenant AND deleted_at IS NULL
-- UNION ALL SELECT 'committee_members', count(*) FROM committee_members WHERE tenant_id=:tenant AND active
-- UNION ALL SELECT 'meetings', count(*) FROM meetings WHERE tenant_id=:tenant AND deleted_at IS NULL
-- UNION ALL SELECT 'meetings_upcoming', count(*) FROM meetings WHERE tenant_id=:tenant AND status IN ('draft','scheduled','postponed') AND scheduled_at>=now()
-- UNION ALL SELECT 'meetings_recent_30d', count(*) FROM meetings WHERE tenant_id=:tenant AND scheduled_at>=now()-interval '30 days'
-- UNION ALL SELECT 'attendance', count(*) FROM meeting_attendance WHERE tenant_id=:tenant
-- UNION ALL SELECT 'agenda_items', count(*) FROM agenda_items WHERE tenant_id=:tenant
-- UNION ALL SELECT 'minutes', count(*) FROM meeting_minutes WHERE tenant_id=:tenant
-- UNION ALL SELECT 'action_items', count(*) FROM action_items WHERE tenant_id=:tenant
-- UNION ALL SELECT 'action_overdue', count(*) FROM action_items WHERE tenant_id=:tenant AND status IN ('pending','in_progress','overdue') AND due_date<CURRENT_DATE
-- UNION ALL SELECT 'compliance_checks', count(*) FROM compliance_checks WHERE tenant_id=:tenant;
