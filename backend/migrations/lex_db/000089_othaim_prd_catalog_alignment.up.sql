-- Align the active legal-service baseline with the Al Othaim Investment PRD
-- dated 2026-07-14. Historical/custom services are retained; only rows owned
-- by the synthetic seed actor are converged or retired.

CREATE TEMP TABLE othaim_prd_service_spec (
    code                        TEXT PRIMARY KEY,
    request_type                TEXT NOT NULL,
    name                        JSONB NOT NULL,
    description                 JSONB NOT NULL,
    audience                    TEXT NOT NULL,
    requester_approval_required BOOLEAN NOT NULL,
    provider_approval_required  BOOLEAN NOT NULL,
    intake_mailbox              TEXT NOT NULL,
    urgent_days                 INT NOT NULL,
    normal_days                 INT NOT NULL
) ON COMMIT DROP;

INSERT INTO othaim_prd_service_spec (
    code, request_type, name, description, audience,
    requester_approval_required, provider_approval_required,
    intake_mailbox, urgent_days, normal_days
) VALUES
    (
        'LEGAL_CONSULTATION', 'consultation',
        '{"ar":"الاستشارات القانونية","en":"Legal Consultations"}',
        '{"ar":"طلب مشورة قانونية أو رأي مكتوب من الإدارة القانونية بشأن مسألة تتعلق بالعمل أو التشغيل.","en":"Providing preliminary legal advice and consultation to various departments regarding legal and regulatory matters, ensuring compliance with relevant laws and regulations."}',
        'department_managers', true, false, 'contract-legal@othaim.com', 4, 6
    ),
    (
        'CONTRACT_REVIEW', 'contract_review',
        '{"ar":"مراجعة العقود والاتفاقيات","en":"Review of Contracts and Agreements"}',
        '{"ar":"تقديم عقد أو اتفاقية لمراجعتها قانونياً وإبداء الملاحظات وتقييم المخاطر قبل التوقيع.","en":"Reviewing contracts and agreements to verify their compliance with applicable laws and regulations."}',
        'all_employees', true, true, 'contract-legal@othaim.com', 3, 5
    ),
    (
        'LEGAL_OPINION', 'legal_opinion',
        '{"ar":"تقديم دراسة قانونية أولية","en":"Providing Preliminary Legal Study"}',
        '{"ar":"طلب دراسة قانونية أولية تبيّن موقف الشركة والخيارات المتاحة بشأن مسألة معينة.","en":"Preparing a preliminary legal study to determine the company''s legal position, assess risks, and identify available options for appropriate decision-making."}',
        'department_managers', true, false, 'case-legal@othaim.com', 5, 15
    ),
    (
        'LITIGATION_SUPPORT', 'litigation',
        '{"ar":"دراسة حالة قضائية","en":"Judicial Case Study"}',
        '{"ar":"طلب دراسة حالة قضائية ورفع الدعوى أمام الجهة القضائية أو المختصة.","en":"Studying and preparing a judicial case, filing a lawsuit before the competent judicial authorities, and following up on its procedures to ensure the protection of the company''s rights and interests."}',
        'all_employees', true, true, 'case-legal@othaim.com', 10, 30
    ),
    (
        'ENFORCEMENT_REQUEST', 'enforcement',
        '{"ar":"تقديم طلب تنفيذ","en":"Submission of Execution Request"}',
        '{"ar":"طلب قيام الإدارة القانونية بتقديم ومتابعة طلب تنفيذ حكم أو سند تنفيذي.","en":"Preparing and submitting an execution request to the competent authorities to initiate the judgment execution procedures."}',
        'all_employees', true, true, 'case-legal@othaim.com', 10, 20
    ),
    (
        'VIOLATION_STUDY', 'investigation',
        '{"ar":"دراسة مخالفة أو تجاوز","en":"Investigation of Violation or Breach"}',
        '{"ar":"طلب دراسة قانونية لمخالفة أو تجاوز، تشمل النتائج والإجراء الموصى به.","en":"Studying suspected violations and breaches, collecting and analyzing evidence to determine responsibilities, and providing recommendations for appropriate legal actions."}',
        'department_managers', true, true, 'case-legal@othaim.com', 10, 20
    ),
    (
        'FIELD_INSPECTION', 'inspection',
        '{"ar":"المعاينة الميدانية وتوثيق الحوادث","en":"Field Inspection and Incident Documentation"}',
        '{"ar":"طلب معاينة قانونية ميدانية وتوثيق حادثة لأغراض الإثبات.","en":"Immediate response to cases requiring site visits to conduct field inspections and accurately document facts and damages."}',
        'department_managers', true, true, 'case-legal@othaim.com', 10, 20
    ),
    (
        'POWER_OF_ATTORNEY', 'power_of_attorney',
        '{"ar":"إصدار الوكالات والتفاويض","en":"Issuing Power of Attorney and Delegations"}',
        '{"ar":"طلب إعداد وإصدار وكالة أو تفويض نيابة عن الشركة.","en":"Preparing, drafting, reviewing, and issuing necessary Powers of Attorney (PoAs) and delegations to enable company representatives to exercise specific powers on its behalf, whether before government, judicial, or private entities."}',
        'department_managers', true, true, 'am@othaim.com', 10, 20
    );

WITH tenant_scope AS (
    SELECT id AS tenant_id FROM tenants
    UNION
    SELECT DISTINCT tenant_id FROM legal_service_catalog
)
INSERT INTO legal_service_catalog (
    tenant_id, code, request_type, name, description, available_to,
    requester_approval_required, provider_approval_required,
    intake_email, channel, active, metadata, created_by
)
SELECT
    tenant_scope.tenant_id,
    spec.code,
    spec.request_type,
    spec.name,
    spec.description,
    ARRAY[spec.audience],
    spec.requester_approval_required,
    spec.provider_approval_required,
    NULL,
    'both',
    true,
    jsonb_build_object(
        'available_to_label',
        CASE WHEN spec.audience = 'department_managers' THEN 'Department Managers' ELSE 'All Employees' END,
        'intake_mailbox', spec.intake_mailbox,
        'sla', jsonb_build_object(
            'unit', 'working_days',
            'urgent', jsonb_build_object('to', spec.urgent_days),
            'normal', jsonb_build_object('to', spec.normal_days),
            'acknowledgement', jsonb_build_object(
                'normal_working_days', '0-1',
                'urgent_working_hours', '0-4'
            )
        ),
        'prd_baseline', 'othaim-2026-07-14'
    ),
    '00000000-0000-0000-0000-000000000001'::uuid
FROM tenant_scope
CROSS JOIN othaim_prd_service_spec spec
ON CONFLICT DO NOTHING;

UPDATE legal_service_catalog service
SET request_type = spec.request_type,
    name = spec.name,
    description = spec.description,
    available_to = ARRAY[spec.audience],
    requester_approval_required = spec.requester_approval_required,
    provider_approval_required = spec.provider_approval_required,
    intake_email = NULL,
    channel = 'both',
    active = true,
    metadata = COALESCE(service.metadata, '{}'::jsonb) || jsonb_build_object(
        'available_to_label',
        CASE WHEN spec.audience = 'department_managers' THEN 'Department Managers' ELSE 'All Employees' END,
        'intake_mailbox', spec.intake_mailbox,
        'sla', jsonb_build_object(
            'unit', 'working_days',
            'urgent', jsonb_build_object('to', spec.urgent_days),
            'normal', jsonb_build_object('to', spec.normal_days),
            'acknowledgement', jsonb_build_object(
                'normal_working_days', '0-1',
                'urgent_working_hours', '0-4'
            )
        ),
        'prd_baseline', 'othaim-2026-07-14'
    ),
    updated_at = now()
FROM othaim_prd_service_spec spec
WHERE service.code = spec.code
  AND service.deleted_at IS NULL
  AND (
      service.created_by = '00000000-0000-0000-0000-000000000001'::uuid
      OR (
          service.metadata->>'intake_mailbox' = spec.intake_mailbox
          AND service.metadata ? 'sla'
      )
  );

UPDATE legal_service_catalog
SET active = false,
    metadata = COALESCE(metadata, '{}'::jsonb)
        || '{"superseded_by_prd":"othaim-2026-07-14"}'::jsonb,
    updated_at = now()
WHERE code IN ('CONTRACT_DRAFTING', 'REGULATORY_COMPLIANCE', 'GENERAL_LEGAL_REQUEST')
  AND deleted_at IS NULL
  AND created_by = '00000000-0000-0000-0000-000000000001'::uuid;

-- Rebuild only the seed-owned eligibility rules. Department-manager services
-- require the corresponding org role; services available to all use the open
-- predicate.
DELETE FROM legal_service_eligibility_rules rule
USING legal_service_catalog service, othaim_prd_service_spec spec
WHERE rule.service_id = service.id
  AND service.code = spec.code
  AND (
      service.created_by = '00000000-0000-0000-0000-000000000001'::uuid
      OR service.metadata->>'prd_baseline' = 'othaim-2026-07-14'
  );

INSERT INTO legal_service_eligibility_rules (
    tenant_id, service_id, rule_type, value, created_by
)
SELECT
    service.tenant_id,
    service.id,
    CASE WHEN spec.audience = 'department_managers' THEN 'role' ELSE 'all' END,
    CASE WHEN spec.audience = 'department_managers' THEN 'department_manager' ELSE '' END,
    '00000000-0000-0000-0000-000000000001'::uuid
FROM legal_service_catalog service
JOIN othaim_prd_service_spec spec ON spec.code = service.code
WHERE service.deleted_at IS NULL
  AND (
      service.created_by = '00000000-0000-0000-0000-000000000001'::uuid
      OR service.metadata->>'prd_baseline' = 'othaim-2026-07-14'
  );

WITH tenant_scope AS (
    SELECT id AS tenant_id FROM tenants
    UNION
    SELECT DISTINCT tenant_id FROM legal_service_catalog
),
targets AS (
    SELECT code, 'urgent'::text AS priority, urgent_days AS turnaround_days,
           4 AS ack_value, 'working_hours'::text AS ack_unit
    FROM othaim_prd_service_spec
    UNION ALL
    SELECT code, 'normal', normal_days, 1, 'working_days'
    FROM othaim_prd_service_spec
)
INSERT INTO legal_sla_targets (
    tenant_id, service_code, priority, turnaround_working_days,
    ack_window_value, ack_window_unit,
    escalation_l1_days, escalation_l2_days, escalation_l3_days,
    active, metadata, created_by
)
SELECT
    tenant_scope.tenant_id,
    targets.code,
    targets.priority,
    targets.turnaround_days,
    targets.ack_value,
    targets.ack_unit,
    2, 4, 6,
    true,
    '{"prd_baseline":"othaim-2026-07-14"}'::jsonb,
    '00000000-0000-0000-0000-000000000001'::uuid
FROM tenant_scope
CROSS JOIN targets
ON CONFLICT (tenant_id, lower(service_code), priority)
    WHERE deleted_at IS NULL
DO UPDATE SET
    service_code = EXCLUDED.service_code,
    turnaround_working_days = EXCLUDED.turnaround_working_days,
    ack_window_value = EXCLUDED.ack_window_value,
    ack_window_unit = EXCLUDED.ack_window_unit,
    escalation_l1_days = 2,
    escalation_l2_days = 4,
    escalation_l3_days = 6,
    active = true,
    metadata = COALESCE(legal_sla_targets.metadata, '{}'::jsonb)
        || EXCLUDED.metadata,
    updated_at = now()
WHERE legal_sla_targets.created_by = '00000000-0000-0000-0000-000000000001'::uuid;

UPDATE legal_sla_targets
SET active = false,
    metadata = COALESCE(metadata, '{}'::jsonb)
        || '{"superseded_by_prd":"othaim-2026-07-14"}'::jsonb,
    updated_at = now()
WHERE lower(service_code) IN ('contract_drafting', 'regulatory_compliance', 'general_legal_request')
  AND deleted_at IS NULL
  AND created_by = '00000000-0000-0000-0000-000000000001'::uuid;
