# Lex cross-cutting reliability & DataStream DR scope (CAP-184..186)

This note documents the reliability posture of the lex (Watheeq) suite's
cross-cutting Phase-4 surface. It introduces NO new infrastructure; it records
where the suite's data lives for DataStream DR planning and how the runtime
confirms integration readiness.

## DataStream DR scope (CAP-184)

- **`lex_db`** is the authoritative store for the entire lex suite, including the
  Phase-4 cross-cutting tables added by the staged migration
  `crosscut_rbac_attachments_fts_integrations`:
  - `lex_attachment_policies` (attachment-requirement master data, CAP-165..170)
  - `lex_integration_endpoints` (integration registry; connection config is
    FieldCrypto-encrypted at rest, CAP-179)
  - `legal_documents.extracted_text` + `legal_documents.search_vector` (FTS,
    CAP-169/182) — derived/regenerable from the document file text layer.
- **`audit_db`** receives lex audit records emitted by `LexAuditEmitter` via the
  platform audit event topic; it is hash-chained and immutable.
- DataStream DR must include `lex_db` (and the shared `audit_db`) in its
  replication set. The FTS columns are recoverable by re-running text extraction,
  so they are a lower-priority recovery target than the policy/registry tables.

## Readiness / health confirmation (CAP-185/186)

- The integration registry exposes per-endpoint and tenant-wide health probes
  (`IntegrationRegistryService.Health` / `HealthAll`) surfaced at
  `GET /integrations/{id}/health` and `GET /integrations/health`. The bundled
  stub adapters report an honest verdict derived from each endpoint's configured
  status (planned/disabled => not reachable; active => reachable iff configured),
  so the suite readiness endpoint reflects real registry state, not a fake green.
- Encryption (CAP-179): integration config is encrypted with the lex `FieldCrypto`
  custody (the same provider used for contract bodies/PII); when crypto is wired
  the `config_encrypted_flag` column is `true`.
- Access control (CAP-180): every cross-cutting route is gated by RBAC
  (`RequireAnyPermission(granular, coarse)`), and the existing ABAC layer applies
  after RBAC when configured.

No new monitors, queues, or external services are introduced by this module.
