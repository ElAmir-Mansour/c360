-- Make contract documents uploaded through the primary contract workflow
-- visible to the review desk's named-slot attachment registry.
WITH latest_versions AS (
    SELECT DISTINCT ON (v.tenant_id, v.contract_id)
        v.tenant_id,
        v.contract_id,
        v.file_id,
        v.file_name,
        v.file_size_bytes,
        v.content_hash,
        v.uploaded_by,
        v.uploaded_at
    FROM contract_versions v
    ORDER BY v.tenant_id, v.contract_id, v.version DESC
)
INSERT INTO lex_contract_attachments (
    id,
    tenant_id,
    contract_id,
    slot,
    file_id,
    file_name,
    file_size_bytes,
    content_hash,
    version,
    superseded,
    notes,
    metadata,
    uploaded_by,
    created_at,
    updated_at
)
SELECT
    gen_random_uuid(),
    v.tenant_id,
    v.contract_id,
    'draft',
    v.file_id,
    v.file_name,
    v.file_size_bytes,
    v.content_hash,
    1,
    false,
    'Linked from the existing contract version',
    '{"source":"contract_version_backfill"}'::jsonb,
    v.uploaded_by,
    v.uploaded_at,
    v.uploaded_at
FROM latest_versions v
WHERE NOT EXISTS (
    SELECT 1
    FROM lex_contract_attachments a
    WHERE a.tenant_id = v.tenant_id
      AND a.contract_id = v.contract_id
      AND a.slot = 'draft'
      AND a.superseded = false
      AND a.deleted_at IS NULL
);
