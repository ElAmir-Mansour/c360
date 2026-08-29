-- =============================================================================
-- demo_refresh.dev.sql  --  LEX (lex_db) DEMO DATA REFRESH ("push to 100")
-- =============================================================================
-- PURPOSE
--   Make the Clario360 LEX demo look FULL + CURRENT for the demo tenant
--   "Apex Bank Holdings" (aaaaaaaa-0000-0000-0000-000000000001), which the demo
--   logs into as admin@apexbank.demo / admin@clario.dev.
--
--   Two problems this fixes:
--     1. EVERYTHING was created in the current calendar month, so the 12-month
--        "Monthly Contract Activity" trend chart (ContractRepository.MonthlyActivity,
--        keyed on date_trunc('month', created_at) / status_changed_at) only had a
--        single populated bucket. We fan the existing rows + new seed rows out
--        across the last ~12 months so every bucket has data.
--     2. The long tail (lists/detail/charts) was thin or empty for several
--        sections (legal holds, draft reviews, prompt templates, obligation
--        notification outbox, signatures). We seed a realistic spread so every
--        list page has a healthy page of rows and every detail page resolves.
--
--   It also HEALS the compliance score: the prior seed left 11 OPEN alerts, which
--   drove GetScore() = clamp(100 - open*10 + ...) down to ~2. We resolve most of
--   them and enable extra rules so the score reads a realistic ~80s.
--
-- THIS IS A DEV SEED. It is NOT an auto-run migration (lives under seeds/, not a
-- numbered migration). Run it manually:
--   docker exec -i clario360-postgres psql -U clario -d lex_db < demo_refresh.dev.sql
--
-- IDEMPOTENT: re-running is safe. New rows use deterministic UUIDs (md5-derived)
-- with ON CONFLICT DO NOTHING / DO UPDATE. The timestamp fan-out only touches the
-- ORIGINAL bunched rows (created_at still in the current month) so re-runs do not
-- keep shifting already-spread data.
--
-- SAFETY -- WORM / append-only / hash-evidence tables are NOT touched:
--   * lex_approval_policy_versions      (immutable version history; no UPDATE/DELETE policy)
--   * lex_approval_policy_audit_log     (append-only audit log)
--   * signature_custody_evidence        (legal custody/seal+evidence-hash WORM evidence)
--   These are skipped entirely (no INSERT, no timestamp shift). lex_db has NO
--   prev_hash/next_hash chained ledger tables; content_hash/evidence_hash columns
--   are per-record integrity hashes, not a chain.
--
-- All FKs + enum CHECK constraints are respected. The connecting role (clario) is
-- superuser w/ rolbypassrls, so FORCE RLS does not block these writes.
-- =============================================================================

\set ON_ERROR_STOP on
SET search_path = public;

BEGIN;

-- Demo tenant + a stable set of LEX users already present in the seeded data.
-- (owner_user_id / created_by values mirror the existing seeder's bbbbbbbb-* ids.)
DO $$
DECLARE
    t_id          uuid := 'aaaaaaaa-0000-0000-0000-000000000001';  -- Apex Bank Holdings
    u_admin       uuid := 'bbbbbbbb-0000-0000-0000-000000000001';  -- Ada Okafor (creator)
    u2            uuid := 'bbbbbbbb-0000-0000-0000-000000000002';  -- Musa Adebayo
    u3            uuid := 'bbbbbbbb-0000-0000-0000-000000000003';  -- Ifeoma Nwosu
    u4            uuid := 'bbbbbbbb-0000-0000-0000-000000000004';  -- Lara Bamidele
    u5            uuid := 'bbbbbbbb-0000-0000-0000-000000000005';  -- Tade Akinola
    u6            uuid := 'bbbbbbbb-0000-0000-0000-000000000006';  -- Chika Nwachukwu
BEGIN
    RAISE NOTICE 'LEX demo refresh starting for tenant %', t_id;
END $$;

-- =============================================================================
-- SECTION 1 -- TIMESTAMP FAN-OUT (fix the 12-month activity chart)
-- =============================================================================
-- The existing 20 contracts were all created this month. Re-distribute their
-- created_at / status_changed_at / updated_at deterministically across the last
-- 12 months (by a stable ordering on id) so MonthlyActivity has 12 buckets.
-- Guard: only touch rows whose created_at is still in the CURRENT month (the
-- original bunched state) -> idempotent.
WITH ordered AS (
    SELECT id,
           row_number() OVER (ORDER BY id) - 1 AS rn,
           count(*)     OVER ()                AS n
    FROM contracts
    WHERE tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001'
      AND deleted_at IS NULL
      AND date_trunc('month', created_at) = date_trunc('month', now())
)
UPDATE contracts c
SET created_at = (now()
        - ((o.rn % 12) * INTERVAL '1 month')          -- spread across 12 months
        - (((o.rn * 53) % 27) * INTERVAL '1 day')      -- jitter within the month
        - (((o.rn * 7)  % 11) * INTERVAL '1 hour')),
    status_changed_at = COALESCE(c.status_changed_at, now())
        - ((o.rn % 12) * INTERVAL '1 month')
        - (((o.rn * 53) % 27) * INTERVAL '1 day'),
    updated_at = now() - (((o.rn * 3) % 9) * INTERVAL '1 day')
FROM ordered o
WHERE c.id = o.id;

-- Keep a handful of contracts genuinely "active this month" so the current
-- bucket and the recent-activity widgets are not empty.
UPDATE contracts
SET created_at = now() - (INTERVAL '1 day' * (1 + (('x' || substr(md5(id::text),1,4))::bit(16)::int % 12))),
    status_changed_at = now() - (INTERVAL '1 day' * (1 + (('x' || substr(md5(id::text),1,4))::bit(16)::int % 10))),
    updated_at = now() - (INTERVAL '1 hour' * (1 + (('x' || substr(md5(id::text),1,4))::bit(16)::int % 40)))
WHERE tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001'
  AND deleted_at IS NULL
  AND status = 'active'
  AND id IN (
      SELECT id FROM contracts
      WHERE tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' AND status='active' AND deleted_at IS NULL
      ORDER BY id LIMIT 4
  );

-- Spread related child timestamps so detail pages + version history read fresh.
UPDATE contract_versions cv
SET uploaded_at = c.created_at + INTERVAL '2 hours'
FROM contracts c
WHERE cv.contract_id = c.id
  AND cv.tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001'
  AND cv.uploaded_at > c.created_at + INTERVAL '1 day';

UPDATE contract_clauses cc
SET created_at = c.created_at + INTERVAL '3 hours',
    updated_at = c.created_at + INTERVAL '4 hours',
    reviewed_at = CASE WHEN cc.reviewed_at IS NOT NULL THEN c.created_at + INTERVAL '1 day' ELSE NULL END
FROM contracts c
WHERE cc.contract_id = c.id
  AND cc.tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001'
  AND cc.created_at > c.created_at + INTERVAL '1 day';

UPDATE contract_analyses ca
SET analyzed_at = c.created_at + INTERVAL '5 hours',
    created_at  = c.created_at + INTERVAL '5 hours'
FROM contracts c
WHERE ca.contract_id = c.id
  AND ca.tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001'
  AND ca.created_at > c.created_at + INTERVAL '1 day';

-- last_analyzed_at on the contract should track the analysis.
UPDATE contracts c
SET last_analyzed_at = c.created_at + INTERVAL '5 hours'
WHERE c.tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001'
  AND c.last_analyzed_at IS NOT NULL
  AND c.last_analyzed_at > c.created_at + INTERVAL '1 day';

-- Spread existing compliance alerts across recent weeks (chart + recent list).
WITH a AS (
    SELECT id, row_number() OVER (ORDER BY id) - 1 AS rn
    FROM compliance_alerts
    WHERE tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001'
      AND date_trunc('month', created_at) = date_trunc('month', now())
)
UPDATE compliance_alerts ca
SET created_at = now() - ((a.rn % 20) * INTERVAL '4 days') - ((a.rn % 6) * INTERVAL '3 hours'),
    updated_at = now() - ((a.rn % 18) * INTERVAL '3 days')
FROM a WHERE ca.id = a.id;

-- =============================================================================
-- SECTION 2 -- HEAL COMPLIANCE SCORE
-- =============================================================================
-- Resolve most open alerts (leave ~3 open) so the score is healthy, and stamp
-- realistic resolved_at within the last few weeks.
WITH open_alerts AS (
    SELECT id, row_number() OVER (ORDER BY created_at DESC) AS rn
    FROM compliance_alerts
    WHERE tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001'
      AND status IN ('open','acknowledged','investigating')
)
UPDATE compliance_alerts ca
SET status = 'resolved',
    resolved_by = 'bbbbbbbb-0000-0000-0000-000000000001',
    resolved_at = now() - ((oa.rn % 14) * INTERVAL '2 days'),
    resolution_notes = 'Reviewed and remediated by Legal Ops during demo refresh.',
    updated_at = now() - ((oa.rn % 14) * INTERVAL '2 days')
FROM open_alerts oa
WHERE ca.id = oa.id
  AND oa.rn > 3;   -- keep the 3 most recent open

-- Enable a couple more compliance rules so RuleCoverage contributes to the score.
UPDATE compliance_rules
SET enabled = true, updated_at = now()
WHERE tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001'
  AND name IN ('Default expiry warning', 'High risk review gate', 'Data protection required');

COMMIT;

-- =============================================================================
-- SECTION 3 -- LONG-TAIL SEED (fill thin/empty lists across recent months)
-- =============================================================================
-- All inserted rows use deterministic UUIDs derived from a stable label so the
-- whole section is idempotent (ON CONFLICT DO NOTHING / DO UPDATE).

-- ---------------------------------------------------------------------------
-- 3a. CONTRACTS -- add 24 contracts spread across the last 12 months so every
--     activity bucket, type/status distribution, and the contracts list are full.
-- ---------------------------------------------------------------------------
INSERT INTO contracts (
    id, tenant_id, title, contract_number, type, description,
    party_a_name, party_a_entity, party_b_name, party_b_entity,
    total_value, currency, payment_terms,
    effective_date, expiry_date, renewal_date, auto_renew, renewal_notice_days, signed_date,
    status, status_changed_at, status_changed_by,
    owner_user_id, owner_name, legal_reviewer_id, legal_reviewer_name,
    risk_score, risk_level, analysis_status, last_analyzed_at,
    current_version, department, tags, metadata, created_by, created_at, updated_at
)
SELECT
    md5('lex.demo.contract.' || g.i)::uuid,
    'aaaaaaaa-0000-0000-0000-000000000001',
    (ARRAY[
      'Master Services Agreement','Mutual Non-Disclosure Agreement','Employment Contract',
      'Vendor Supply Agreement','Software License Agreement','Office Lease Agreement',
      'Strategic Partnership MOU','Legal Consulting Retainer','Procurement Framework Agreement',
      'Managed Services SLA','Data Processing Addendum','Outsourcing Agreement'
    ])[1 + (g.i % 12)] || ' #' || lpad(g.i::text,3,'0'),
    'LEX-DEMO-' || to_char(now() - (g.i * INTERVAL '14 days'),'YYYYMMDD') || '-' || lpad(g.i::text,4,'0'),
    (ARRAY['service_agreement','nda','employment','vendor','license','lease','partnership','consulting','procurement','sla','mou','amendment']) [1 + (g.i % 12)],
    'Demo contract seeded for Apex Bank Holdings legal operations.',
    'Apex Bank Holdings',
    'Apex Bank Holdings PJSC',
    (ARRAY[
      'Najd Cloud Services','Riyadh Legal Advisors','Gulf Talent Partners','Falcon Logistics',
      'Vision Software FZ','Tadawul Towers REIT','MENA FinTech Alliance','Saudi Counsel Group',
      'Procurement Hub KSA','Uptime Managed IT','Sahara Data Trust','Eastern Outsourcing Co'
    ])[1 + (g.i % 12)],
    (ARRAY[
      'Najd Cloud Services LLC','Riyadh Legal Advisors LLP','Gulf Talent Partners Co',
      'Falcon Logistics LLC','Vision Software FZ-LLC','Tadawul Towers REIT','MENA FinTech Alliance',
      'Saudi Counsel Group LLP','Procurement Hub KSA LLC','Uptime Managed IT LLC',
      'Sahara Data Trust','Eastern Outsourcing Co'
    ])[1 + (g.i % 12)],
    (50000 + (g.i * 37000) % 1500000)::decimal(18,2),
    'SAR',
    (ARRAY['Net 30','Net 45','Net 60','Milestone-based','Annual upfront'])[1 + (g.i % 5)],
    (now() - (g.i * INTERVAL '14 days'))::date,
    -- expiry: a healthy mix of past (expired), near-term (expiring soon), and future
    (now() - (g.i * INTERVAL '14 days') + (ARRAY[180,365,540,730,90,30,15])[1 + (g.i % 7)] * INTERVAL '1 day')::date,
    CASE WHEN g.i % 3 = 0
         THEN (now() - (g.i * INTERVAL '14 days') + (ARRAY[150,330,500])[1 + (g.i % 3)] * INTERVAL '1 day')::date
         ELSE NULL END,
    (g.i % 4 = 0),
    (ARRAY[30,60,90])[1 + (g.i % 3)],
    CASE WHEN (ARRAY['active','active','active','active','expired','renewed','negotiation','legal_review','pending_signature','terminated'])[1 + (g.i % 10)]
              IN ('active','expired','renewed','terminated')
         THEN (now() - (g.i * INTERVAL '14 days'))::date ELSE NULL END,
    (ARRAY['active','active','active','active','expired','renewed','negotiation','legal_review','pending_signature','terminated'])[1 + (g.i % 10)],
    now() - (g.i * INTERVAL '14 days') + INTERVAL '6 hours',
    'bbbbbbbb-0000-0000-0000-000000000001',
    (ARRAY['bbbbbbbb-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000002','bbbbbbbb-0000-0000-0000-000000000003','bbbbbbbb-0000-0000-0000-000000000004','bbbbbbbb-0000-0000-0000-000000000005','bbbbbbbb-0000-0000-0000-000000000006'])[1 + (g.i % 6)]::uuid,
    (ARRAY['Ada Okafor','Musa Adebayo','Ifeoma Nwosu','Lara Bamidele','Tade Akinola','Chika Nwachukwu'])[1 + (g.i % 6)],
    'bbbbbbbb-0000-0000-0000-000000000002',
    'Musa Adebayo',
    (ARRAY[12,28,45,62,78,90])[1 + (g.i % 6)]::decimal(5,2),
    (ARRAY['none','low','medium','high','critical','medium'])[1 + (g.i % 6)],
    'completed',
    now() - (g.i * INTERVAL '14 days') + INTERVAL '12 hours',
    1,
    (ARRAY['Procurement','Litigation','Corporate','Regulatory','HR','IT'])[1 + (g.i % 6)],
    jsonb_build_object('seed','demo_refresh','batch','contracts'),
    'bbbbbbbb-0000-0000-0000-000000000001',
    now() - (g.i * INTERVAL '14 days'),
    now() - (g.i * INTERVAL '14 days') + INTERVAL '1 day'
FROM generate_series(1,24) AS g(i)
ON CONFLICT (id) DO NOTHING;

-- One initial version per seeded contract (version history + document viewer).
INSERT INTO contract_versions (
    id, tenant_id, contract_id, version, file_id, file_name, file_size_bytes,
    content_hash, extracted_text, change_summary, uploaded_by, uploaded_at
)
SELECT
    md5('lex.demo.cversion.' || c.id)::uuid,
    c.tenant_id, c.id, 1,
    md5('lex.demo.file.' || c.id)::uuid,
    lower(replace(c.type,'_','-')) || '-' || substr(c.id::text,1,8) || '.txt',
    800 + (('x'||substr(md5(c.id::text),1,4))::bit(16)::int % 4000),
    encode(digest(c.id::text,'sha256'),'hex'),
    'This agreement is entered into between ' || c.party_a_name || ' and ' || c.party_b_name ||
       E'.\n\nTotal value: ' || c.currency || ' ' || c.total_value || E'.\nEffective: ' || c.effective_date || E'.\nExpiry: ' || c.expiry_date || E'.\n\nSection 1 Governing Law\nSection 2 Confidentiality\nSection 3 Termination',
    'Initial seeded contract document.',
    'bbbbbbbb-0000-0000-0000-000000000001',
    c.created_at + INTERVAL '2 hours'
FROM contracts c
WHERE c.tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001'
  AND c.metadata->>'seed' = 'demo_refresh'
ON CONFLICT (id) DO NOTHING;

-- A few clauses per seeded contract (clause-extraction + risk views).
INSERT INTO contract_clauses (
    id, tenant_id, contract_id, clause_type, title, content, section_reference,
    risk_level, risk_score, risk_keywords, analysis_summary, recommendations,
    review_status, extraction_confidence, created_at, updated_at
)
SELECT
    md5('lex.demo.clause.' || c.id || '.' || k.t)::uuid,
    c.tenant_id, c.id,
    k.t,
    initcap(replace(k.t,'_',' ')) || ' Clause',
    'Standard ' || replace(k.t,'_',' ') || ' provisions governing the relationship between the parties.',
    'Section ' || (1 + (('x'||substr(md5(c.id::text||k.t),1,4))::bit(16)::int % 12)),
    (ARRAY['none','low','medium','high'])[1 + (('x'||substr(md5(c.id::text||k.t),1,2))::bit(8)::int % 4)],
    (('x'||substr(md5(c.id::text||k.t),1,2))::bit(8)::int % 90)::decimal(5,2),
    ARRAY['liability','indemnity']::text[],
    'Automated clause analysis completed.',
    ARRAY['Review against playbook standard']::text[],
    (ARRAY['pending','reviewed','flagged','accepted'])[1 + (('x'||substr(md5(c.id::text||k.t),3,2))::bit(8)::int % 4)],
    0.85,
    c.created_at + INTERVAL '3 hours',
    c.created_at + INTERVAL '4 hours'
FROM contracts c
CROSS JOIN (VALUES ('confidentiality'),('termination'),('payment_terms'),('limitation_of_liability'),('governing_law')) AS k(t)
WHERE c.tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001'
  AND c.metadata->>'seed' = 'demo_refresh'
ON CONFLICT (id) DO NOTHING;

-- One analysis per seeded contract.
INSERT INTO contract_analyses (
    id, tenant_id, contract_id, contract_version, overall_risk, risk_score,
    clause_count, high_risk_clause_count, missing_clauses, recommendations,
    analysis_duration_ms, analyzed_by, analyzed_at, created_at
)
SELECT
    md5('lex.demo.analysis.' || c.id)::uuid,
    c.tenant_id, c.id, 1, c.risk_level, c.risk_score,
    5, (('x'||substr(md5(c.id::text),1,2))::bit(8)::int % 3),
    ARRAY['force_majeure']::text[],
    ARRAY['Add data protection clause','Tighten liability cap']::text[],
    1200 + (('x'||substr(md5(c.id::text),1,3))::bit(12)::int % 3000),
    'system',
    c.created_at + INTERVAL '5 hours',
    c.created_at + INTERVAL '5 hours'
FROM contracts c
WHERE c.tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001'
  AND c.metadata->>'seed' = 'demo_refresh'
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3b. LEGAL MATTERS -- add 14 matters spread across recent months.
-- ---------------------------------------------------------------------------
INSERT INTO legal_matters (
    id, tenant_id, matter_number, title, description, type, status, priority,
    owner_user_id, owner_name, requester_user_id, requester_name, department,
    opened_at, due_date, closed_at, tags, metadata, created_by, created_at, updated_at
)
SELECT
    md5('lex.demo.matter.' || g.i)::uuid,
    'aaaaaaaa-0000-0000-0000-000000000001',
    'MAT-LEX-2026-' || lpad((100 + g.i)::text,3,'0'),
    (ARRAY[
      'Vendor dispute resolution','Regulatory filing - PDPL','Employment grievance review',
      'M&A due diligence support','IP infringement assessment','Lease renegotiation',
      'Compliance audit response','Board resolution drafting','Litigation discovery',
      'Contract breach claim','Data subject access request','Antitrust advisory'
    ])[1 + (g.i % 12)] || ' #' || g.i,
    'Demo legal matter seeded for Apex Bank Holdings.',
    (ARRAY['contract','regulatory','employment','advisory','litigation','dispute','general'])[1 + (g.i % 7)],
    (ARRAY['intake','open','in_review','waiting_on_business','on_hold','closed'])[1 + (g.i % 6)],
    (ARRAY['critical','high','medium','low'])[1 + (g.i % 4)],
    (ARRAY['bbbbbbbb-0000-0000-0000-000000000003','bbbbbbbb-0000-0000-0000-000000000004','bbbbbbbb-0000-0000-0000-000000000005'])[1 + (g.i % 3)]::uuid,
    (ARRAY['Ifeoma Nwosu','Lara Bamidele','Tade Akinola'])[1 + (g.i % 3)],
    'bbbbbbbb-0000-0000-0000-000000000002', 'Musa Adebayo',
    (ARRAY['Litigation','Regulatory','Corporate','HR'])[1 + (g.i % 4)],
    now() - (g.i * INTERVAL '17 days'),
    (now() + (ARRAY[20,45,70,-10])[1 + (g.i % 4)] * INTERVAL '1 day')::date,
    CASE WHEN (g.i % 6) = 5 THEN now() - (g.i * INTERVAL '17 days') + INTERVAL '20 days' ELSE NULL END,
    ARRAY['demo']::text[],
    jsonb_build_object('seed','demo_refresh'),
    'bbbbbbbb-0000-0000-0000-000000000001',
    now() - (g.i * INTERVAL '17 days'),
    now() - (g.i * INTERVAL '17 days') + INTERVAL '2 days'
FROM generate_series(1,14) AS g(i)
ON CONFLICT (id) DO NOTHING;

-- Link some seeded matters to seeded contracts.
INSERT INTO legal_matter_contracts (id, tenant_id, matter_id, contract_id, relationship, created_by, created_at)
SELECT
    md5('lex.demo.mc.' || m.id || '.' || c.id)::uuid,
    m.tenant_id, m.id, c.id, 'related',
    'bbbbbbbb-0000-0000-0000-000000000001', m.created_at + INTERVAL '1 day'
FROM (SELECT id, tenant_id, created_at, row_number() OVER (ORDER BY id) rn FROM legal_matters
      WHERE tenant_id='aaaaaaaa-0000-0000-0000-000000000001' AND metadata->>'seed'='demo_refresh') m
JOIN (SELECT id, row_number() OVER (ORDER BY id) rn FROM contracts
      WHERE tenant_id='aaaaaaaa-0000-0000-0000-000000000001' AND metadata->>'seed'='demo_refresh') c
  ON c.rn = m.rn
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3c. LEGAL OBLIGATIONS -- add 20 obligations with due dates spread past+future.
-- ---------------------------------------------------------------------------
INSERT INTO legal_obligations (
    id, tenant_id, title, description, type, status, priority,
    contract_id, owner_user_id, owner_name, due_date, completed_at,
    reminder_enabled, reminder_lead_days, tags, metadata, created_by, created_at, updated_at
)
SELECT
    md5('lex.demo.obl.' || g.i)::uuid,
    'aaaaaaaa-0000-0000-0000-000000000001',
    (ARRAY[
      'Renewal notice','Insurance certificate','Compliance report','Milestone delivery',
      'Payment installment','Regulatory filing','Audit response','Covenant certification',
      'Data retention review','SLA performance review'
    ])[1 + (g.i % 10)] || ' for contract ' || g.i,
    'Demo obligation tracked for Apex Bank Holdings.',
    (ARRAY['renewal','reporting','compliance','payment','delivery','notice','regulatory','covenant'])[1 + (g.i % 8)],
    (ARRAY['open','in_progress','completed','open','blocked','open'])[1 + (g.i % 6)],
    (ARRAY['critical','high','medium','low'])[1 + (g.i % 4)],
    c.id,
    (ARRAY['bbbbbbbb-0000-0000-0000-000000000003','bbbbbbbb-0000-0000-0000-000000000004','bbbbbbbb-0000-0000-0000-000000000005','bbbbbbbb-0000-0000-0000-000000000006'])[1 + (g.i % 4)]::uuid,
    (ARRAY['Ifeoma Nwosu','Lara Bamidele','Tade Akinola','Chika Nwachukwu'])[1 + (g.i % 4)],
    (now() + (ARRAY[-5,3,7,14,30,60,-20,45])[1 + (g.i % 8)] * INTERVAL '1 day')::date,
    CASE WHEN (g.i % 6) = 2 THEN now() - (g.i * INTERVAL '2 days') ELSE NULL END,
    true, ARRAY[30,7,1]::int[],
    ARRAY['demo']::text[],
    jsonb_build_object('seed','demo_refresh'),
    'bbbbbbbb-0000-0000-0000-000000000001',
    now() - (g.i * INTERVAL '11 days'),
    now() - (g.i * INTERVAL '11 days') + INTERVAL '1 day'
FROM generate_series(1,20) AS g(i)
JOIN LATERAL (
    SELECT id FROM contracts
    WHERE tenant_id='aaaaaaaa-0000-0000-0000-000000000001' AND metadata->>'seed'='demo_refresh'
    ORDER BY id OFFSET (g.i % 24) LIMIT 1
) c ON true
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3d. SIGNATURE ENVELOPES (+ recipients + events) -- full lifecycle, 12 envelopes.
-- ---------------------------------------------------------------------------
INSERT INTO signature_envelopes (
    id, tenant_id, target_type, contract_id, title, subject, message, status,
    provider, method, due_at, expires_at, sent_at, completed_at, created_by,
    created_at, updated_at, language
)
SELECT
    md5('lex.demo.env.' || g.i)::uuid,
    'aaaaaaaa-0000-0000-0000-000000000001', 'contract', c.id,
    'Execution - ' || c.title,
    'Please sign: ' || c.title, 'Kindly review and sign the attached agreement.',
    (ARRAY['signed','sent','viewed','signed','draft','signed'])[1 + (g.i % 6)],
    'native', 'otp',
    now() - (g.i * INTERVAL '9 days') + INTERVAL '10 days',
    now() - (g.i * INTERVAL '9 days') + INTERVAL '14 days',
    now() - (g.i * INTERVAL '9 days') + INTERVAL '1 hour',
    CASE WHEN (ARRAY['signed','sent','viewed','signed','draft','signed'])[1 + (g.i % 6)] = 'signed'
         THEN now() - (g.i * INTERVAL '9 days') + INTERVAL '2 days' ELSE NULL END,
    'bbbbbbbb-0000-0000-0000-000000000001',
    now() - (g.i * INTERVAL '9 days'),
    now() - (g.i * INTERVAL '9 days') + INTERVAL '2 days',
    'bilingual'
FROM generate_series(1,12) AS g(i)
JOIN LATERAL (
    SELECT id, title FROM contracts
    WHERE tenant_id='aaaaaaaa-0000-0000-0000-000000000001' AND metadata->>'seed'='demo_refresh'
    ORDER BY id OFFSET (g.i % 24) LIMIT 1
) c ON true
ON CONFLICT (id) DO NOTHING;

-- Two recipients per seeded envelope.
INSERT INTO signature_recipients (
    id, tenant_id, envelope_id, name, email, role, status, provider, method,
    signing_order, viewed_at, signed_at, created_at, updated_at, language
)
SELECT
    md5('lex.demo.recip.' || e.id || '.' || r.ord)::uuid,
    e.tenant_id, e.id,
    (ARRAY['Apex Authorized Signatory','Counterparty Representative'])[r.ord],
    (ARRAY['signatory@apexbank.demo','rep@counterparty.demo'])[r.ord],
    'signer',
    CASE WHEN e.status='signed' THEN 'signed'
         WHEN e.status='viewed' THEN (ARRAY['viewed','draft'])[r.ord]
         WHEN e.status='sent'   THEN 'draft'
         ELSE 'draft' END,
    'native','otp', r.ord,
    CASE WHEN e.status IN ('signed','viewed') THEN e.sent_at + INTERVAL '3 hours' ELSE NULL END,
    CASE WHEN e.status='signed' THEN e.completed_at ELSE NULL END,
    e.created_at, e.updated_at, 'bilingual'
FROM signature_envelopes e
CROSS JOIN (VALUES (1),(2)) AS r(ord)
WHERE e.tenant_id='aaaaaaaa-0000-0000-0000-000000000001'
  AND e.id IN (SELECT md5('lex.demo.env.' || gs)::uuid FROM generate_series(1,12) gs)
ON CONFLICT (id) DO NOTHING;

-- Lifecycle events per seeded envelope (created/sent + signed when applicable).
INSERT INTO signature_events (
    id, tenant_id, envelope_id, event_type, actor_name, actor_email, occurred_at, created_at, provider
)
SELECT md5('lex.demo.evt.created.' || e.id)::uuid, e.tenant_id, e.id, 'created',
       'Ada Okafor','ada@apexbank.demo', e.created_at, e.created_at, 'native'
FROM signature_envelopes e
WHERE e.tenant_id='aaaaaaaa-0000-0000-0000-000000000001'
  AND e.id IN (SELECT md5('lex.demo.env.' || gs)::uuid FROM generate_series(1,12) gs)
ON CONFLICT (id) DO NOTHING;

INSERT INTO signature_events (
    id, tenant_id, envelope_id, event_type, actor_name, actor_email, occurred_at, created_at, provider
)
SELECT md5('lex.demo.evt.sent.' || e.id)::uuid, e.tenant_id, e.id, 'sent',
       'Ada Okafor','ada@apexbank.demo', e.sent_at, e.sent_at, 'native'
FROM signature_envelopes e
WHERE e.tenant_id='aaaaaaaa-0000-0000-0000-000000000001'
  AND e.status <> 'draft'
  AND e.id IN (SELECT md5('lex.demo.env.' || gs)::uuid FROM generate_series(1,12) gs)
ON CONFLICT (id) DO NOTHING;

INSERT INTO signature_events (
    id, tenant_id, envelope_id, event_type, actor_name, actor_email, occurred_at, created_at, provider
)
SELECT md5('lex.demo.evt.signed.' || e.id)::uuid, e.tenant_id, e.id, 'signed',
       'Apex Authorized Signatory','signatory@apexbank.demo', e.completed_at, e.completed_at, 'native'
FROM signature_envelopes e
WHERE e.tenant_id='aaaaaaaa-0000-0000-0000-000000000001'
  AND e.status='signed' AND e.completed_at IS NOT NULL
  AND e.id IN (SELECT md5('lex.demo.env.' || gs)::uuid FROM generate_series(1,12) gs)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3e. LEGAL DOCUMENTS (+ versions) -- 12 documents across types.
-- ---------------------------------------------------------------------------
INSERT INTO legal_documents (
    id, tenant_id, title, type, description, file_id, file_name, file_size_bytes,
    category, confidentiality, current_version, status, tags, metadata, created_by, created_at, updated_at
)
SELECT
    md5('lex.demo.doc.' || g.i)::uuid,
    'aaaaaaaa-0000-0000-0000-000000000001',
    (ARRAY[
      'Data Protection Policy','Anti-Bribery Policy','Board Resolution','Legal Opinion - Tax',
      'Regulatory Filing Q','NDA Template','Engagement Letter Template','Privacy Notice',
      'Outsourcing Standard','Records Retention Schedule','Whistleblower Policy','Code of Conduct'
    ])[1 + (g.i % 12)] || ' ' || g.i,
    (ARRAY['policy','regulation','template','memo','opinion','filing','correspondence','resolution'])[1 + (g.i % 8)],
    'Demo legal document for Apex Bank Holdings.',
    md5('lex.demo.docfile.' || g.i)::uuid,
    'document-' || g.i || '.pdf',
    20000 + (g.i * 1500),
    (ARRAY['Compliance','Corporate','Regulatory','Client Intake','Governance'])[1 + (g.i % 5)],
    (ARRAY['internal','confidential','privileged','public'])[1 + (g.i % 4)],
    1,
    (ARRAY['active','active','draft','archived'])[1 + (g.i % 4)],
    ARRAY['demo']::text[],
    jsonb_build_object('seed','demo_refresh'),
    'bbbbbbbb-0000-0000-0000-000000000001',
    now() - (g.i * INTERVAL '13 days'),
    now() - (g.i * INTERVAL '13 days') + INTERVAL '1 day'
FROM generate_series(1,12) AS g(i)
ON CONFLICT (id) DO NOTHING;

INSERT INTO document_versions (
    id, tenant_id, document_id, version, file_id, file_name, file_size_bytes,
    content_hash, change_summary, uploaded_by, uploaded_at
)
SELECT
    md5('lex.demo.docver.' || d.id)::uuid,
    d.tenant_id, d.id, 1, md5('lex.demo.docfile2.'||d.id)::uuid,
    'document-' || substr(d.id::text,1,8) || '.pdf', 21000,
    encode(digest(d.id::text,'sha256'),'hex'),
    'Initial seeded document version.',
    'bbbbbbbb-0000-0000-0000-000000000001',
    d.created_at + INTERVAL '1 hour'
FROM legal_documents d
WHERE d.tenant_id='aaaaaaaa-0000-0000-0000-000000000001' AND d.metadata->>'seed'='demo_refresh'
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3f. COMPLIANCE ALERTS -- add 16 (mostly resolved + a few open) spread in time.
-- ---------------------------------------------------------------------------
INSERT INTO compliance_alerts (
    id, tenant_id, contract_id, title, description, severity, status,
    resolved_by, resolved_at, resolution_notes, evidence, created_at, updated_at
)
SELECT
    md5('lex.demo.alert.' || g.i)::uuid,
    'aaaaaaaa-0000-0000-0000-000000000001',
    c.id,
    (ARRAY[
      'Contract expiring soon','Missing data protection clause','High-risk liability terms',
      'Renewal notice overdue','Unreviewed high-risk clause','Auto-renewal without approval'
    ])[1 + (g.i % 6)],
    'Automated compliance check flagged this contract during demo refresh.',
    (ARRAY['high','medium','low','critical','medium','high'])[1 + (g.i % 6)],
    -- ~75% resolved so the score stays healthy; rest open/acknowledged
    (ARRAY['resolved','resolved','resolved','open','acknowledged','resolved'])[1 + (g.i % 6)],
    CASE WHEN (ARRAY['resolved','resolved','resolved','open','acknowledged','resolved'])[1 + (g.i % 6)]='resolved'
         THEN 'bbbbbbbb-0000-0000-0000-000000000001' ELSE NULL END,
    CASE WHEN (ARRAY['resolved','resolved','resolved','open','acknowledged','resolved'])[1 + (g.i % 6)]='resolved'
         THEN now() - (g.i * INTERVAL '5 days') + INTERVAL '2 days' ELSE NULL END,
    CASE WHEN (ARRAY['resolved','resolved','resolved','open','acknowledged','resolved'])[1 + (g.i % 6)]='resolved'
         THEN 'Resolved by Legal Operations.' ELSE NULL END,
    jsonb_build_object('seed','demo_refresh'),
    now() - (g.i * INTERVAL '5 days'),
    now() - (g.i * INTERVAL '5 days') + INTERVAL '1 day'
FROM generate_series(1,16) AS g(i)
JOIN LATERAL (
    SELECT id FROM contracts
    WHERE tenant_id='aaaaaaaa-0000-0000-0000-000000000001' AND metadata->>'seed'='demo_refresh'
    ORDER BY id OFFSET (g.i % 24) LIMIT 1
) c ON true
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3g. LEGAL HOLDS -- table was EMPTY. Seed 6 (active + released history).
-- ---------------------------------------------------------------------------
INSERT INTO legal_holds (
    id, tenant_id, subject_type, subject_id, reason, reference, status, custodian,
    notes, applied_by, applied_at, released_by, released_at, release_note,
    metadata, created_at, updated_at
)
SELECT
    md5('lex.demo.hold.' || g.i)::uuid,
    'aaaaaaaa-0000-0000-0000-000000000001',
    'contract', c.id,
    (ARRAY['Pending litigation','Regulatory investigation','Internal audit','Dispute escalation'])[1 + (g.i % 4)],
    'HOLD-2026-' || lpad(g.i::text,3,'0'),
    CASE WHEN g.i % 3 = 0 THEN 'released' ELSE 'active' END,
    (ARRAY['Lara Bamidele','Ifeoma Nwosu','Tade Akinola'])[1 + (g.i % 3)],
    'Preservation hold applied during demo refresh.',
    'bbbbbbbb-0000-0000-0000-000000000004',
    now() - (g.i * INTERVAL '21 days'),
    CASE WHEN g.i % 3 = 0 THEN 'bbbbbbbb-0000-0000-0000-000000000004' ELSE NULL END,
    CASE WHEN g.i % 3 = 0 THEN now() - (g.i * INTERVAL '21 days') + INTERVAL '15 days' ELSE NULL END,
    CASE WHEN g.i % 3 = 0 THEN 'Matter closed; hold released.' ELSE '' END,
    jsonb_build_object('seed','demo_refresh'),
    now() - (g.i * INTERVAL '21 days'),
    now() - (g.i * INTERVAL '21 days') + INTERVAL '1 day'
FROM generate_series(1,6) AS g(i)
JOIN LATERAL (
    SELECT id FROM contracts
    WHERE tenant_id='aaaaaaaa-0000-0000-0000-000000000001' AND metadata->>'seed'='demo_refresh'
    ORDER BY id OFFSET (g.i * 3) LIMIT 1
) c ON true
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3h. LEX DRAFT REVIEWS -- table was EMPTY. Seed 10 across statuses.
-- ---------------------------------------------------------------------------
INSERT INTO lex_draft_reviews (
    id, tenant_id, draft_id, title, draft_kind, content, review_status,
    assignee_id, assignee_role, sla_deadline, review_notes, reviewed_by, reviewed_at,
    submitted_by, metadata, created_at, updated_at
)
SELECT
    md5('lex.demo.draftrev.' || g.i)::uuid,
    'aaaaaaaa-0000-0000-0000-000000000001',
    md5('lex.demo.draftid.' || g.i)::uuid,
    (ARRAY['Indemnification clause draft','NDA full draft','Liability cap rewrite','Termination clause draft','Service agreement draft'])[1 + (g.i % 5)] || ' #' || g.i,
    (ARRAY['clause','contract','rewrite'])[1 + (g.i % 3)],
    jsonb_build_object('text','Draft generated by AI for legal review.','kind',(ARRAY['clause','contract','rewrite'])[1 + (g.i % 3)]),
    (ARRAY['pending','approved','rejected','changes_requested','approved'])[1 + (g.i % 5)],
    (ARRAY['bbbbbbbb-0000-0000-0000-000000000002','bbbbbbbb-0000-0000-0000-000000000003'])[1 + (g.i % 2)]::uuid,
    'legal-reviewer',
    now() + INTERVAL '3 days' - (g.i * INTERVAL '6 days'),
    CASE WHEN (ARRAY['pending','approved','rejected','changes_requested','approved'])[1 + (g.i % 5)] <> 'pending'
         THEN 'Reviewed during demo refresh.' ELSE '' END,
    CASE WHEN (ARRAY['pending','approved','rejected','changes_requested','approved'])[1 + (g.i % 5)] <> 'pending'
         THEN 'bbbbbbbb-0000-0000-0000-000000000002' ELSE NULL END,
    CASE WHEN (ARRAY['pending','approved','rejected','changes_requested','approved'])[1 + (g.i % 5)] <> 'pending'
         THEN now() - (g.i * INTERVAL '6 days') + INTERVAL '1 day' ELSE NULL END,
    'bbbbbbbb-0000-0000-0000-000000000001',
    jsonb_build_object('seed','demo_refresh'),
    now() - (g.i * INTERVAL '6 days'),
    now() - (g.i * INTERVAL '6 days') + INTERVAL '1 day'
FROM generate_series(1,10) AS g(i)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3i. LEX PROMPT TEMPLATES -- table was EMPTY. Seed 8 drafting prompts.
-- ---------------------------------------------------------------------------
INSERT INTO lex_prompt_templates (
    id, tenant_id, name, description, category, system_prompt, user_prompt,
    variables, metadata, created_by, created_at, updated_at
)
SELECT
    md5('lex.demo.prompt.' || g.i)::uuid,
    'aaaaaaaa-0000-0000-0000-000000000001',
    (ARRAY[
      'Draft NDA','Summarize Contract','Extract Obligations','Redline Liability Clause',
      'Generate Termination Clause','Compliance Gap Analysis','Draft Engagement Letter','Risk Summary'
    ])[1 + (g.i % 8)],
    'Demo drafting prompt for Apex Bank legal team.',
    (ARRAY['drafting','analysis','extraction','redline','general'])[1 + (g.i % 5)],
    'You are an expert legal drafting assistant for a Saudi bank. Be precise and compliant with PDPL and SAMA guidance.',
    'Draft a {{document_type}} for {{counterparty}} governing {{subject_matter}} under {{governing_law}}.',
    '[{"name":"document_type"},{"name":"counterparty"},{"name":"subject_matter"},{"name":"governing_law"}]'::jsonb,
    jsonb_build_object('seed','demo_refresh'),
    'bbbbbbbb-0000-0000-0000-000000000001',
    now() - (g.i * INTERVAL '15 days'),
    now() - (g.i * INTERVAL '15 days') + INTERVAL '1 day'
FROM generate_series(1,8) AS g(i)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3j. OBLIGATION NOTIFICATION OUTBOX -- table was EMPTY. Seed reminders for
--     open/upcoming obligations (pending + sent), so the outbox/reminders view
--     has rows across recent + upcoming dates.
-- ---------------------------------------------------------------------------
INSERT INTO legal_obligation_notification_outbox (
    id, tenant_id, obligation_id, event_id, event_type, lead_days, channel,
    recipient_user_id, recipient_name, recipient_contact, scheduled_at, scheduled_date,
    status, provider, sent_at, attempt_count, created_by, created_at, updated_at
)
SELECT
    md5('lex.demo.outbox.' || o.id || '.' || ld.lead)::uuid,
    o.tenant_id, o.id, md5('lex.demo.outboxevt.' || o.id || '.' || ld.lead)::uuid,
    'reminder', ld.lead, 'email',
    o.owner_user_id, o.owner_name, 'legal-ops@apexbank.demo',
    (o.due_date - (ld.lead || ' days')::interval),
    (o.due_date - (ld.lead || ' days')::interval)::date,
    CASE WHEN (o.due_date - (ld.lead || ' days')::interval) < now() THEN 'sent' ELSE 'pending' END,
    'notification-service',
    CASE WHEN (o.due_date - (ld.lead || ' days')::interval) < now()
         THEN (o.due_date - (ld.lead || ' days')::interval) ELSE NULL END,
    CASE WHEN (o.due_date - (ld.lead || ' days')::interval) < now() THEN 1 ELSE 0 END,
    'bbbbbbbb-0000-0000-0000-000000000001',
    o.created_at, o.created_at + INTERVAL '1 hour'
FROM legal_obligations o
CROSS JOIN (VALUES (30),(7),(1)) AS ld(lead)
WHERE o.tenant_id='aaaaaaaa-0000-0000-0000-000000000001'
  AND o.metadata->>'seed'='demo_refresh'
  AND o.status NOT IN ('completed','waived','cancelled')
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3k. EXPIRY NOTIFICATIONS -- record notifications for contracts expiring soon.
-- ---------------------------------------------------------------------------
INSERT INTO expiry_notifications (id, tenant_id, contract_id, horizon_days, sent_at)
SELECT
    md5('lex.demo.expnotif.' || c.id || '.' || h.horizon)::uuid,
    c.tenant_id, c.id, h.horizon,
    now() - ((c.expiry_date - now()::date) - h.horizon || ' days')::interval
FROM contracts c
CROSS JOIN (VALUES (30),(7)) AS h(horizon)
WHERE c.tenant_id='aaaaaaaa-0000-0000-0000-000000000001'
  AND c.metadata->>'seed'='demo_refresh'
  AND c.status='active'
  AND c.expiry_date IS NOT NULL
  AND c.expiry_date BETWEEN now()::date AND (now()::date + 60)
ON CONFLICT (contract_id, horizon_days) DO NOTHING;

COMMIT;

-- =============================================================================
-- DONE. Summary counts for the demo tenant:
--   SELECT 'contracts', count(*) FROM contracts WHERE tenant_id='aaaaaaaa-0000-0000-0000-000000000001' AND deleted_at IS NULL
--   ... (see report)
-- =============================================================================
