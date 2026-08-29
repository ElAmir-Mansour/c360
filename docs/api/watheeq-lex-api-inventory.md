# Watheeq / Lex API Inventory

This is a route and client inventory for the current Watheeq implementation surface.
The formal phase-1 API contract is `docs/api/watheeq-lex-service.openapi.yaml`;
this file remains as a compact implementation and RTM companion. It does not
define new runtime routes.

Watheeq currently runs through the incumbent Lex route prefix `/api/v1/lex`.
`/api/v1/watheeq` is mounted as a public alias to the same handlers. Both
prefixes are gateway-routed to `lex-service` and gated by entitlement
`app.watheeq`.

## Current Runtime Surface

| Domain | Observed API hooks |
| --- | --- |
| Dashboard | `GET /dashboard` |
| Contracts | `GET /contracts`, `POST /contracts`, `GET /contracts/search`, `GET /contracts/stats`, `GET /contracts/expiring`, `GET /contracts/renewal-warnings`, `GET /contracts/{id}`, `GET /contracts/{id}/brief`, `GET /contracts/{id}/timeline`, `PUT /contracts/{id}`, `DELETE /contracts/{id}`, `PUT /contracts/{id}/status`, `POST /contracts/{id}/renew` |
| Analysis, redline, and playbooks | `GET /contracts/{id}/analysis`, `POST /contracts/{id}/analyze`, `POST /contracts/{id}/classify`, `GET /contracts/{id}/redline`, `GET /contracts/{id}/clause-deviations` |
| Contract versions | `POST /contracts/{id}/upload`, `GET /contracts/{id}/versions` |
| Contract clauses | `GET /contracts/{id}/clauses`, `GET /contracts/{id}/clauses/{clauseId}`, `PUT /contracts/{id}/clauses/{clauseId}/review`, `GET /contracts/{id}/clauses/risks` |
| Documents | `GET /documents`, `POST /documents`, `POST /documents/bulk-import`, `GET /documents/repository-summary`, `GET /documents/{id}`, `PUT /documents/{id}`, `DELETE /documents/{id}`, `POST /documents/{id}/upload`, `GET /documents/{id}/versions` |
| Clause library | `GET /clause-library`, `POST /clause-library`, `GET /clause-library/search`, `GET /clause-library/{id}`, `PUT /clause-library/{id}`, `DELETE /clause-library/{id}`, `POST /clause-library/{id}/governance` |
| Clause playbooks | `GET /playbooks`, `POST /playbooks`, `GET /playbooks/{id}`, `PUT /playbooks/{id}`, `DELETE /playbooks/{id}`, `GET /contracts/{id}/clause-deviations` |
| Regulation library | `GET /regulations`, `POST /regulations`, `GET /regulations/search`, `GET /regulations/{id}`, `PUT /regulations/{id}`, `DELETE /regulations/{id}`, `POST /regulations/{id}/governance`, `POST /regulations/{id}/clauses`, `DELETE /regulations/{id}/clauses` |
| Compliance and regulations | `GET /compliance/rules`, `POST /compliance/rules`, `PUT /compliance/rules/{id}`, `DELETE /compliance/rules/{id}`, `POST /compliance/run`, `GET /compliance/alerts`, `GET /compliance/alerts/{id}`, `PUT /compliance/alerts/{id}/status`, `GET /compliance/dashboard`, `GET /compliance/score` |
| Workflow bridge | `POST /contracts/{id}/review`, `GET /workflows`, `POST /workflows/tasks/bulk-decision`, `POST /workflows/{workflowInstanceID}/tasks/{taskID}/decision` |
| Workflow approval policies | `GET /workflow-policies/approval`, `POST /workflow-policies/approval`, `PATCH /workflow-policies/approval/{id}`, `DELETE /workflow-policies/approval/{id}`, `GET /workflow-policies/approval/recommend`, `GET /workflow-policies/approval/analytics` |
| Signatures | `GET /signatures`, `POST /signatures`, `GET /signatures/{id}`, `POST /signatures/{id}/send`, `POST /signatures/{id}/recipients/{recipientId}/actions`, `GET /signatures/{id}/recipients/{recipientId}/rendering`, `POST /signatures/{id}/provider-events`, `POST /signatures/{id}/custody`, `POST /signatures/{id}/cancel` |
| Reports | `GET /reports/contracts`, `GET /reports/matters`, `GET /reports/obligations`, with CSV selected by query parameter in the frontend client |
| Drafting | `POST /drafting/clauses`, `POST /drafting/contracts`, `POST /drafting/clauses/rewrite`, `POST /drafting/clauses/fallbacks`, `POST /drafting/translate`, `POST /drafting/summary`, `POST /drafting/glossary`, `POST /drafting/assemble`, `POST /drafting/rfp-response`, `POST /drafting/obligations/qa-review` |

All paths above are relative to either `/api/v1/lex` or `/api/v1/watheeq`.

## Backend-Backed Watheeq Domain Surface

The first-class Watheeq domain surfaces now have frontend pages, typed client
methods, and backend route anchors in `backend/internal/lex/handler/routes.go`.

| Domain | Frontend hooks | Runtime API paths |
| --- | --- | --- |
| Contracts | `/lex/contracts`, `/lex/contracts/[id]`, `listContracts`, `getContract`, `getContractBrief`, `getContractRenewalWarnings`, `classifyContract`, `getContractTimeline`, Python SDK `lex.contracts.brief`, `lex.contracts.renewal_warnings`, `lex.contracts.classify`, `lex.contracts.timeline` | `GET/POST /contracts`, `GET /contracts/search`, `GET /contracts/stats`, `GET /contracts/expiring`, `GET /contracts/renewal-warnings`, `GET/PUT/DELETE /contracts/{id}`, `GET /contracts/{id}/brief`, `POST /contracts/{id}/classify`, `GET /contracts/{id}/timeline`, `PUT /contracts/{id}/status`, `POST /contracts/{id}/upload`, `GET /contracts/{id}/versions`, `GET /contracts/{id}/redline`, `GET /contracts/{id}/clause-deviations`, `POST /contracts/{id}/renew` |
| Documents | `/lex/documents`, `listDocuments`, `getDocumentRepositorySummary`, `bulkImportDocuments`, Python SDK `lex.documents.repository_summary`, `lex.documents.bulk_import` | `GET/POST /documents`, `POST /documents/bulk-import`, `GET /documents/repository-summary`, `GET/PUT/DELETE /documents/{id}`, `POST /documents/{id}/upload`, `GET /documents/{id}/versions` |
| Matters | `/lex/matters`, `listMatters`, `getMatter`, `checkMatterConflict`, Python SDK `lex.matters.conflict_check`, `API_ENDPOINTS.LEX_MATTERS` | `GET/POST /matters`, `POST /matters/conflict-check`, `GET/PUT/DELETE /matters/{id}`, `POST /matters/{id}/triage`, `PUT /matters/{id}/status`, `POST /matters/{id}/contracts`, `DELETE /matters/{id}/contracts/{contractId}` |
| Obligations | `/lex/obligations`, `listObligations`, `getObligation`, `dispatchObligationReminderOutbox`, `dispatchObligationReminderOutboxItem`, `API_ENDPOINTS.LEX_OBLIGATIONS` | `GET/POST /obligations`, `GET/PUT/DELETE /obligations/{id}`, `PUT /obligations/{id}/status`, `GET /contracts/{id}/obligations`, `GET /matters/{id}/obligations`, `POST /contracts/{id}/obligations/extract`, `GET /obligations/reminders`, `POST /obligations/reminders/enqueue`, `POST /obligations/reminders/outbox/dispatch`, `POST /obligations/reminders/outbox/{outboxId}/dispatch`, `POST /obligations/reminders/outbox/{outboxId}/delivery`, `POST /obligations/{id}/reminders/sent`; HTTP provider mode is configured with `LEX_OBLIGATION_REMINDER_PROVIDER_MODE/ENDPOINT/API_KEY/TIMEOUT` |
| Signatures | `/lex/signatures`, `listSignatures`, `getSignature`, `createSignature`, `sendSignature`, `cancelSignature`, `recordSignatureRecipientAction`, `getSignatureRecipientRendering`, `recordSignatureProviderEvent`, `recordSignatureCustody` | `GET/POST /signatures`, `GET /signatures/{id}`, `POST /signatures/{id}/send`, `POST /signatures/{id}/recipients/{recipientId}/actions`, `GET /signatures/{id}/recipients/{recipientId}/rendering`, `POST /signatures/{id}/provider-events`, `POST /signatures/{id}/custody`, `POST /signatures/{id}/cancel` |
| Clause playbooks | `listPlaybooks`, `getPlaybook`, `createPlaybook`, `updatePlaybook`, `deletePlaybook`, `getContractClauseDeviations` | `GET/POST /playbooks`, `GET/PUT/DELETE /playbooks/{id}`, `GET /contracts/{id}/clause-deviations` |
| Workflow bridge | `listWorkflows`, `bulkDecideWorkflowTasks`, `decideWorkflowTask`, `startContractReview`, `listApprovalPolicies`, `createApprovalPolicy`, `updateApprovalPolicy`, `archiveApprovalPolicy`, `recommendApprovalPolicy`, `getApprovalPolicyAnalytics`, Python SDK `lex.workflows.approval_policy_analytics` | `POST /contracts/{id}/review`, `GET /workflows`, `POST /workflows/tasks/bulk-decision`, `POST /workflows/{workflowInstanceID}/tasks/{taskID}/decision`, `GET/POST /workflow-policies/approval`, `PATCH/DELETE /workflow-policies/approval/{id}`, `GET /workflow-policies/approval/recommend`, `GET /workflow-policies/approval/analytics` |
| Reports | `getContractReport`, `getMatterReport`, `getObligationReport`, `exportContractReportCsv`, `exportMatterReportCsv`, `exportObligationReportCsv` | `GET /reports/contracts`, `GET /reports/matters`, `GET /reports/obligations` |
| Drafting | Backend/API AID-01 through AID-08, AID-10, and AID-11 contract surface; LLM-backed endpoints return `DRAFTING_UNAVAILABLE` when `LEX_LLM_ENRICHMENT_ENABLED` or the provider manager is not configured | `POST /drafting/clauses`, `POST /drafting/contracts`, `POST /drafting/clauses/rewrite`, `POST /drafting/clauses/fallbacks`, `POST /drafting/translate`, `POST /drafting/summary`, `POST /drafting/glossary`, deterministic `POST /drafting/assemble`, `POST /drafting/rfp-response`, `POST /drafting/obligations/qa-review` |
| Clause library | `/lex/clause-library`, `listClauseLibrary`, `getClauseLibraryEntry`, `decideClauseLibraryGovernance`, Python SDK `lex.clause_library.decide_governance`, `API_ENDPOINTS.LEX_CLAUSE_LIBRARY` | `GET/POST /clause-library`, `GET /clause-library/search`, `GET/PUT/DELETE /clause-library/{id}`, `POST /clause-library/{id}/governance` |
| Regulation library | `/lex/regulations`, `listRegulations`, `getRegulation`, `decideRegulationGovernance`, Python SDK `lex.regulations.decide_governance`, `API_ENDPOINTS.LEX_REGULATIONS` | `GET/POST /regulations`, `GET /regulations/search`, `GET/PUT/DELETE /regulations/{id}`, `POST /regulations/{id}/governance`, `POST /regulations/{id}/clauses`, `DELETE /regulations/{id}/clauses` |

## RTM Domain Readout

| Workbook domain | Current coverage | Remaining API gap |
| --- | --- | --- |
| Contracts | Backend CRUD, detail, generated brief, renewal warnings, classification, timeline, analysis, redline, versioning, renew, dashboard, frontend client, and Python SDK hooks exist. | Richer key-term schema examples and broader brief fixtures are not yet proven. |
| Matters | Backend CRUD, status, matter-contract linking, conflict check, triage route, frontend matters page/client, Python SDK conflict check, and contract-detail Matter Link exist. | Productized triage workflow acceptance is not yet proven. |
| Obligations | Backend CRUD, status, contract/matter-scoped lists, deterministic extraction commit route, autonomous LLM-enriched extraction proof, renewal warning summary, reminder plan/sent/outbox enqueue, delivery, deterministic and HTTP provider dispatch routes/config, frontend obligations page/client, expiring contract APIs, and compliance alert/report APIs exist. | Live production calendar/email adapter acceptance, attestation, and evidence-vault acceptance are not yet proven. |
| Clause library | Backend tenant library CRUD, bilingual AR/EN fields, version/deprecation metadata, ranked and deterministic semantic search route, route-backed governance decisions, frontend clause-library page/client, Python SDK wrapper, and contract-scoped clause review exist. | No remaining route-backed governance decision acceptance gap. |
| Regulation library | Backend regulation CRUD, citations/authority/effective dates, ranked and deterministic semantic search route, regulation-to-clause mapping API, route-backed governance decisions, frontend regulations page/client, Python SDK wrapper, compliance rule CRUD, and Active Regulations exist. | Automated regulatory update ingestion remains unproven. |
| Signatures | Backend signature envelope lifecycle, send/cancel, recipient action/provider-event intake with HMAC validation, deterministic provider dispatch proof, configurable HTTP provider dispatcher, signed-file custody evidence route, frontend signatures page, and typed client methods exist. | Live Nafath/e-sign provider credentials and third-party evidence-vault custody acceptance are not yet proven. |
| Workflows and reports | Backend contract review start, workflow list, single and bulk workflow task decision, persisted approval policy catalog, update, archive, recommendation, and analytics routes, Watheeq DoA/form/out-of-office request payloads, frontend review-dialog controls, shared Workflow approval-chain quorum/delegation substrate, frontend `listApprovalPolicies`/`createApprovalPolicy`/`updateApprovalPolicy`/`archiveApprovalPolicy`/`recommendApprovalPolicy`/`getApprovalPolicyAnalytics` clients, Python SDK `approval_policy_analytics`, and contract/matter/obligation JSON or CSV reports exist with typed client methods. | External reporting warehouse export is not yet proven. |
| AI drafting | Backend AID-* drafting routes are registered under both `/api/v1/lex` and `/api/v1/watheeq`, documented in OpenAPI, contract-checked against `routes.go`, and covered by deterministic assemble acceptance plus disabled-LLM response acceptance. | Live governed LLM provider acceptance is not claimed when the deployment-level LLM provider manager is absent or `LEX_LLM_ENRICHMENT_ENABLED` is off. |
| Repository | Backend documents, document versions, repository-summary taxonomy/folder/saved-view/retention rollups, deterministic bulk import with migration/OCR/index metadata, frontend client, and Python SDK hooks exist. | Live OCR provider processing and external repository indexing acceptance are not yet proven. |

## Contract Status

- Public product/workbook name: Watheeq.
- Current runtime namespace: Lex.
- Current public route prefixes in this branch: `/api/v1/lex` and
  `/api/v1/watheeq`.
- OpenAPI status: present in `docs/api/watheeq-lex-service.openapi.yaml`.
- Drafting status: deterministic `/drafting/assemble` is available without LLM configuration; other `/drafting/*` routes are governed LLM-backed endpoints and return `DRAFTING_UNAVAILABLE` while LLM drafting is disabled.
- The contract intentionally does not claim live Nafath/e-sign provider
  credentials, live production calendar/email reminder credentials or adapter
  acceptance, public unauthenticated webhooks, or third-party evidence-vault
  custody acceptance because those integrations are not proven by the current
  Lex router.
