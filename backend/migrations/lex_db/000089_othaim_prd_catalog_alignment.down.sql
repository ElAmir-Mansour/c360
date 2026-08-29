-- Roll back the published baseline without deleting historical requests or
-- client-authored catalogue/SLA records.

DELETE FROM legal_service_eligibility_rules rule
USING legal_service_catalog service
WHERE rule.service_id = service.id
  AND service.code IN ('ENFORCEMENT_REQUEST', 'VIOLATION_STUDY', 'FIELD_INSPECTION')
  AND service.created_by = '00000000-0000-0000-0000-000000000001'::uuid
  AND service.metadata->>'prd_baseline' = 'othaim-2026-07-14';

DELETE FROM legal_service_catalog
WHERE code IN ('ENFORCEMENT_REQUEST', 'VIOLATION_STUDY', 'FIELD_INSPECTION')
  AND created_by = '00000000-0000-0000-0000-000000000001'::uuid
  AND metadata->>'prd_baseline' = 'othaim-2026-07-14';

UPDATE legal_service_catalog
SET active = true,
    metadata = metadata - 'superseded_by_prd',
    updated_at = now()
WHERE code IN ('CONTRACT_DRAFTING', 'REGULATORY_COMPLIANCE', 'GENERAL_LEGAL_REQUEST')
  AND created_by = '00000000-0000-0000-0000-000000000001'::uuid
  AND metadata->>'superseded_by_prd' = 'othaim-2026-07-14';

DELETE FROM legal_sla_targets
WHERE lower(service_code) IN ('enforcement_request', 'violation_study', 'field_inspection')
  AND created_by = '00000000-0000-0000-0000-000000000001'::uuid
  AND metadata->>'prd_baseline' = 'othaim-2026-07-14';

UPDATE legal_sla_targets
SET active = true,
    metadata = metadata - 'superseded_by_prd',
    updated_at = now()
WHERE lower(service_code) IN ('contract_drafting', 'regulatory_compliance', 'general_legal_request')
  AND created_by = '00000000-0000-0000-0000-000000000001'::uuid
  AND metadata->>'superseded_by_prd' = 'othaim-2026-07-14';
