from __future__ import annotations

from dataclasses import dataclass, field

from clario360.client import Clario360


def paginated(items: list[dict[str, object]]) -> dict[str, object]:
    return {
        "data": items,
        "meta": {"page": 1, "per_page": 50, "total": len(items), "total_pages": 1},
    }


@dataclass
class TextResponse:
    text_override: str
    status_code: int = 200
    headers: dict[str, str] = field(default_factory=lambda: {"Content-Type": "text/csv"})
    reason: str = "OK"

    @property
    def text(self) -> str:
        return self.text_override

    @property
    def content(self) -> bytes:
        return self.text_override.encode("utf-8")


def test_lex_namespace_exposes_current_watheeq_surface(api_key_client: Clario360) -> None:
    for name in [
        "contracts",
        "documents",
        "workflows",
        "reports",
        "dashboard",
        "matters",
        "obligations",
        "clause_library",
        "regulations",
        "signatures",
        "compliance",
        "drafting",
    ]:
        assert hasattr(api_key_client.lex, name)
        assert hasattr(api_key_client.watheeq, name)

    assert api_key_client.lex.contracts._base == "/api/v1/lex/contracts"
    assert api_key_client.watheeq.contracts._base == "/api/v1/watheeq/contracts"
    assert api_key_client.lex.drafting._base == "/api/v1/lex/drafting"
    assert api_key_client.watheeq.drafting._base == "/api/v1/watheeq/drafting"


def test_drafting_models_are_importable_from_sdk_packages() -> None:
    from clario360.models import DraftingContractSummary, GeneratedClause
    from clario360.models.drafting import ContractSummary as DraftingSummary

    assert DraftingContractSummary is DraftingSummary
    assert GeneratedClause.from_dict({"text": "Supplier liability is capped."}).text == (
        "Supplier liability is capped."
    )


def test_lex_drafting_resource_routes_and_parses_results(
    api_url: str,
    router,
    api_key_client: Clario360,
) -> None:
    route_specs = [
        (
            "clauses",
            {"intent": "cap liability", "language": "en"},
            {
                "title": "Limitation of liability",
                "clause_type": "liability",
                "text": "Supplier liability is capped.",
                "assumptions": ["Saudi law"],
                "language": "en",
            },
        ),
        (
            "contracts",
            {"contract_type": "msa", "deal_terms": {"value": 100000}},
            {
                "title": "Master Services Agreement",
                "sections": [{"heading": "Scope", "body": "Services are described."}],
                "open_items": ["confirm fees"],
                "language": "en",
            },
        ),
        (
            "clauses/rewrite",
            {"text": "old clause", "target_tone": "plain"},
            {
                "rewritten_text": "Plain clause",
                "changes": [{"summary": "Simplified", "reason": "Plain language"}],
                "risk_shift": "neutral",
                "residual_risks": ["carve-outs"],
            },
        ),
        (
            "clauses/fallbacks",
            {"clause_text": "strict clause", "count": 1},
            {
                "fallbacks": [
                    {
                        "label": "Balanced",
                        "text": "Balanced fallback",
                        "concession_level": "medium",
                        "when_to_use": "Escalated negotiation",
                    }
                ]
            },
        ),
        (
            "translate",
            {"text": "legal text", "source_lang": "en", "target_lang": "ar"},
            {
                "translation": "Arabic legal text",
                "equivalence": "equivalent",
                "notes": ["Reviewed terminology"],
                "source_lang": "en",
                "target_lang": "ar",
            },
        ),
        (
            "summary",
            {"text": "long contract"},
            {
                "executive_summary": "Short summary",
                "key_terms": [{"label": "Term", "value": "12 months"}],
                "obligations": ["notify"],
                "risks": ["uncapped liability"],
                "renewal_notes": "Auto-renewal applies.",
            },
        ),
        (
            "glossary",
            {"text": "defined terms"},
            {
                "glossary": [{"term": "Agreement", "definition": "This contract"}],
                "inconsistencies": [{"term": "Services", "issue": "Used before definition"}],
            },
        ),
        (
            "assemble",
            {"sections": [], "variables": {}},
            {
                "document": "Assembled contract",
                "included_sections": ["intro"],
                "skipped_sections": ["optional"],
                "unresolved_vars": ["counterparty"],
            },
        ),
        (
            "rfp-response",
            {"requirements": "SOC 2 response"},
            {
                "sections": [{"requirement": "Security", "response": "Controls are in place."}],
                "summary": "Ready for review",
                "gaps": ["pricing"],
                "language": "en",
            },
        ),
        (
            "obligations/qa-review",
            {"contract_text": "contract", "obligations": [{"title": "Notice"}]},
            {
                "issues": [
                    {
                        "obligation_index": 0,
                        "severity": "medium",
                        "issue": "Missing deadline",
                        "suggestion": "Add due date",
                    }
                ],
                "overall_confidence": 0.93,
                "missing_obligations": ["audit right"],
            },
        ),
    ]
    for suffix, _, response in route_specs:
        router.add_json("POST", f"{api_url}/api/v1/lex/drafting/{suffix}", {"data": response})

    drafting = api_key_client.lex.drafting
    clause = drafting.generate_clause(route_specs[0][1])
    contract = drafting.draft_contract(route_specs[1][1])
    rewrite = drafting.rewrite_clause(route_specs[2][1])
    fallbacks = drafting.suggest_fallbacks(route_specs[3][1])
    translation = drafting.translate(route_specs[4][1])
    summary = drafting.summarize(route_specs[5][1])
    glossary = drafting.glossary(route_specs[6][1])
    assembly = drafting.assemble(route_specs[7][1])
    rfp = drafting.draft_rfp_response(route_specs[8][1])
    review = drafting.review_obligations(route_specs[9][1])

    assert clause.text == "Supplier liability is capped."
    assert contract.sections[0].heading == "Scope"
    assert rewrite.changes[0].reason == "Plain language"
    assert fallbacks.fallbacks[0].concession_level == "medium"
    assert translation.target_lang == "ar"
    assert summary.key_terms[0].value == "12 months"
    assert glossary.inconsistencies[0].term == "Services"
    assert assembly.unresolved_vars == ["counterparty"]
    assert rfp.sections[0].response == "Controls are in place."
    assert review.issues[0].obligation_index == 0
    assert review.overall_confidence == 0.93

    assert [request.method for request in router.requests] == ["POST"] * len(route_specs)
    assert [request.url for request in router.requests] == [
        f"{api_url}/api/v1/lex/drafting/{suffix}" for suffix, _, _ in route_specs
    ]
    assert [request.json_body for request in router.requests] == [
        payload for _, payload, _ in route_specs
    ]


def test_watheeq_drafting_alias_uses_watheeq_route(
    api_url: str,
    router,
    api_key_client: Clario360,
) -> None:
    router.add_json(
        "POST",
        f"{api_url}/api/v1/watheeq/drafting/translate",
        {"data": {"translation": "Translated", "source_lang": "en", "target_lang": "ar"}},
    )

    result = api_key_client.watheeq.drafting.translate(
        {"text": "Translate this", "source_lang": "en", "target_lang": "ar"}
    )

    assert result.translation == "Translated"
    assert router.requests[-1].url == f"{api_url}/api/v1/watheeq/drafting/translate"


def test_contract_detail_keeps_get_compatibility(
    api_url: str,
    router,
    api_key_client: Clario360,
) -> None:
    router.add_json(
        "GET",
        f"{api_url}/api/v1/lex/contracts/contract-1",
        {
            "data": {
                "contract": {"id": "contract-1", "title": "Master Services", "status": "active"},
                "clauses": [],
                "version_count": 1,
            }
        },
    )

    contract = api_key_client.lex.contracts.get("contract-1")

    assert contract.id == "contract-1"
    assert contract.title == "Master Services"


def test_watheeq_alias_uses_watheeq_route(api_url: str, router, api_key_client: Clario360) -> None:
    router.add_json(
        "POST",
        f"{api_url}/api/v1/watheeq/signatures/signature-1/send",
        {"data": {"id": "signature-1", "title": "Board resolution", "status": "sent"}},
    )

    envelope = api_key_client.watheeq.signatures.send("signature-1", {"message": "Please sign"})

    assert envelope.status == "sent"
    assert router.requests[-1].url == f"{api_url}/api/v1/watheeq/signatures/signature-1/send"
    assert router.requests[-1].json_body == {"message": "Please sign"}


def test_lex_domain_resources_call_registered_routes(
    api_url: str,
    router,
    api_key_client: Clario360,
) -> None:
    router.add_json(
        "GET",
        f"{api_url}/api/v1/lex/documents",
        paginated([{"id": "doc-1", "title": "Policy"}]),
    )
    router.add_json(
        "GET",
        f"{api_url}/api/v1/lex/matters",
        paginated([{"id": "matter-1", "title": "NDA review"}]),
    )
    router.add_json(
        "GET",
        f"{api_url}/api/v1/lex/obligations",
        paginated([{"id": "obl-1", "title": "Notice"}]),
    )
    router.add_json(
        "GET",
        f"{api_url}/api/v1/lex/clause-library",
        paginated([{"id": "clause-1", "code": "IP-1"}]),
    )
    router.add_json(
        "GET",
        f"{api_url}/api/v1/lex/regulations",
        paginated([{"id": "reg-1", "code": "PDPL"}]),
    )
    router.add_json(
        "GET",
        f"{api_url}/api/v1/lex/workflows",
        paginated(
            [
                {
                    "workflow_instance_id": "workflow-1",
                    "contract_title": "MSA",
                    "approval_policy": {"required_role": "finance_director"},
                    "delegation": {"delegated_to": "delegate-1"},
                }
            ]
        ),
    )
    router.add_json(
        "GET",
        f"{api_url}/api/v1/lex/reports/contracts",
        {"data": {"total": 0, "contracts": []}},
    )
    router.add_json(
        "GET",
        f"{api_url}/api/v1/lex/reports/matters",
        {"data": {"total": 1, "matters": [{"id": "matter-1", "title": "NDA review"}]}},
    )
    router.add_json(
        "GET",
        f"{api_url}/api/v1/lex/reports/obligations",
        {"data": {"total": 1, "obligations": [{"id": "obl-1", "title": "Notice"}]}},
    )

    assert api_key_client.lex.documents.list().data[0].id == "doc-1"
    assert api_key_client.lex.matters.list().data[0].id == "matter-1"
    assert api_key_client.lex.obligations.list().data[0].id == "obl-1"
    assert api_key_client.lex.clause_library.list().data[0].code == "IP-1"
    assert api_key_client.lex.regulations.list().data[0].code == "PDPL"
    workflow = api_key_client.lex.workflows.list().data[0]
    assert workflow.workflow_instance_id == "workflow-1"
    assert workflow.approval_policy["required_role"] == "finance_director"
    assert workflow.delegation["delegated_to"] == "delegate-1"

    contract_report = api_key_client.lex.reports.contracts()
    matter_report = api_key_client.lex.reports.matters()
    obligation_report = api_key_client.lex.reports.obligations()
    assert contract_report.total == 0
    assert matter_report.matters[0].id == "matter-1"
    assert obligation_report.obligations[0].id == "obl-1"
    assert router.requests[-3].url == f"{api_url}/api/v1/lex/reports/contracts"
    assert router.requests[-2].url == f"{api_url}/api/v1/lex/reports/matters"
    assert router.requests[-1].url == f"{api_url}/api/v1/lex/reports/obligations"


def test_lex_documents_bulk_import_route(
    api_url: str,
    router,
    api_key_client: Clario360,
) -> None:
    router.add_json(
        "POST",
        f"{api_url}/api/v1/lex/documents/bulk-import",
        {
            "data": {
                "batch_id": "legacy-ksa-2026",
                "source_system": "legacy-dms",
                "requested": 1,
                "succeeded": 1,
                "failed": 0,
                "items": [
                    {
                        "index": 0,
                        "status": "imported",
                        "document_id": "doc-1",
                        "ocr_status": "text_provided",
                        "index_status": "content_indexed",
                    }
                ],
            }
        },
    )

    result = api_key_client.lex.documents.bulk_import(
        {
            "batch_id": "legacy-ksa-2026",
            "source_system": "legacy-dms",
            "documents": [{"title": "Legacy policy"}],
        }
    )

    assert result.succeeded == 1
    assert result.items[0].document_id == "doc-1"
    assert result.items[0].index_status == "content_indexed"
    assert router.requests[-1].url == f"{api_url}/api/v1/lex/documents/bulk-import"
    assert router.requests[-1].json_body["source_system"] == "legacy-dms"


def test_lex_library_governance_decision_routes(
    api_url: str,
    router,
    api_key_client: Clario360,
) -> None:
    router.add_json(
        "POST",
        f"{api_url}/api/v1/lex/clause-library/clause-1/governance",
        {"data": {"id": "clause-1", "code": "IP-1", "governance_status": "approved", "status": "active"}},
    )
    router.add_json(
        "POST",
        f"{api_url}/api/v1/lex/regulations/reg-1/governance",
        {"data": {"id": "reg-1", "code": "PDPL", "status": "active"}},
    )

    clause = api_key_client.lex.clause_library.decide_governance(
        "clause-1",
        {
            "decision": "approve",
            "activate": True,
            "notes": "Approved by legal ops.",
            "evidence": {"ticket_id": "GOV-1"},
        },
    )
    regulation = api_key_client.lex.regulations.decide_governance(
        "reg-1",
        {"decision": "reject", "notes": "Citation mismatch."},
    )

    assert clause.governance_status == "approved"
    assert regulation.status == "active"
    assert router.requests[-2].url == f"{api_url}/api/v1/lex/clause-library/clause-1/governance"
    assert router.requests[-2].json_body == {
        "decision": "approve",
        "activate": True,
        "notes": "Approved by legal ops.",
        "evidence": {"ticket_id": "GOV-1"},
    }
    assert router.requests[-1].url == f"{api_url}/api/v1/lex/regulations/reg-1/governance"
    assert router.requests[-1].json_body == {"decision": "reject", "notes": "Citation mismatch."}


def test_lex_report_csv_helpers_send_format_and_filters(
    api_url: str,
    router,
    api_key_client: Clario360,
) -> None:
    router.add("GET", f"{api_url}/api/v1/lex/reports/contracts", TextResponse("contract_id,title\ncontract-1,MSA\n"))
    router.add("GET", f"{api_url}/api/v1/lex/reports/matters", TextResponse("matter_id,title\nmatter-1,NDA review\n"))
    router.add("GET", f"{api_url}/api/v1/lex/reports/obligations", TextResponse("obligation_id,title\nobl-1,Notice\n"))

    assert "contract-1" in api_key_client.lex.reports.contracts_csv(status="active", risk_level="high")
    assert "matter-1" in api_key_client.lex.reports.matters_csv(
        status="open",
        priority="high",
        contract_id="contract-1",
    )
    assert "obl-1" in api_key_client.lex.reports.obligations_csv(status="open", overdue=True)

    assert router.requests[-3].url == f"{api_url}/api/v1/lex/reports/contracts"
    assert router.requests[-3].params == {"format": "csv", "status": "active", "risk_level": "high"}
    assert router.requests[-2].url == f"{api_url}/api/v1/lex/reports/matters"
    assert router.requests[-2].params == {
        "format": "csv",
        "status": "open",
        "priority": "high",
        "contract_id": "contract-1",
    }
    assert router.requests[-1].url == f"{api_url}/api/v1/lex/reports/obligations"
    assert router.requests[-1].params == {"format": "csv", "status": "open", "overdue": True}


def test_lex_production_post_wrappers(
    api_url: str,
    router,
    api_key_client: Clario360,
) -> None:
    router.add_json(
        "POST",
        f"{api_url}/api/v1/lex/workflows/workflow-1/tasks/task-1/decision",
        {
            "data": {
                "workflow_instance_id": "workflow-1",
                "task_id": "task-1",
                "contract_id": "contract-1",
                "decision": "approve",
                "task_status": "completed",
                "authority_evidence": {
                    "role": "finance_director",
                    "authority_amount": 750000,
                    "currency": "SAR",
                    "evidence_id": "DOA-BOARD-MINUTES-001",
                },
                "delegation": {"delegated_to": "delegate-1"},
            }
        },
    )
    router.add_json(
        "POST",
        f"{api_url}/api/v1/lex/workflows/tasks/bulk-decision",
        {
            "data": {
                "decision": "approve",
                "requested": 2,
                "succeeded": 1,
                "failed": 1,
                "decided_by": "user-1",
                "decided_at": "2026-06-14T12:00:00Z",
                "results": [
                    {
                        "workflow_instance_id": "workflow-1",
                        "task_id": "task-1",
                        "contract_id": "contract-1",
                        "decision": "approve",
                        "task_status": "completed",
                    }
                ],
                "errors": [
                    {
                        "workflow_instance_id": "workflow-2",
                        "task_id": "task-2",
                        "code": "task_not_pending",
                        "message": "Task is no longer pending.",
                    }
                ],
            }
        },
    )
    router.add_json(
        "POST",
        f"{api_url}/api/v1/lex/signatures/signature-1/custody",
        {
            "data": {
                "id": "signature-1",
                "title": "Board resolution",
                "status": "completed",
                "custody_evidence": [
                    {
                        "id": "custody-1",
                        "file_id": "file-1",
                        "file_name": "signed.pdf",
                        "content_hash": "sha256:abc",
                    }
                ],
            }
        },
    )
    router.add_json(
        "POST",
        f"{api_url}/api/v1/lex/obligations/reminders/outbox/dispatch",
        {
            "data": {
                "provider": "email",
                "requested_count": 1,
                "dispatched_count": 1,
                "sent_count": 1,
                "attempts": [{"outbox_id": "outbox-1", "status": "sent"}],
            }
        },
    )
    router.add_json(
        "POST",
        f"{api_url}/api/v1/lex/obligations/reminders/outbox/outbox-1/dispatch",
        {
            "data": {
                "provider": "email",
                "requested_count": 1,
                "dispatched_count": 1,
                "sent_count": 1,
                "attempts": [{"outbox_id": "outbox-1", "status": "sent"}],
            }
        },
    )

    decision = api_key_client.lex.workflows.decide_task(
        "workflow-1",
        "task-1",
        {
            "decision": "approve",
            "form_data": {"business_justification": "Critical renewal"},
            "authority_evidence": {
                "role": "finance_director",
                "authority_amount": 750000,
                "currency": "SAR",
                "evidence_id": "DOA-BOARD-MINUTES-001",
            },
        },
    )
    assert decision.workflow_instance_id == "workflow-1"
    assert decision.task_status == "completed"
    assert decision.authority_evidence["evidence_id"] == "DOA-BOARD-MINUTES-001"
    assert decision.delegation["delegated_to"] == "delegate-1"
    assert router.requests[-1].url == (
        f"{api_url}/api/v1/lex/workflows/workflow-1/tasks/task-1/decision"
    )
    assert router.requests[-1].json_body == {
        "decision": "approve",
        "form_data": {"business_justification": "Critical renewal"},
        "authority_evidence": {
            "role": "finance_director",
            "authority_amount": 750000,
            "currency": "SAR",
            "evidence_id": "DOA-BOARD-MINUTES-001",
        },
    }

    bulk_decision = api_key_client.lex.workflows.bulk_decide(
        {
            "decision": "approve",
            "notes": "Bulk approved from SDK.",
            "items": [
                {"workflow_instance_id": "workflow-1", "task_id": "task-1"},
                {
                    "workflow_instance_id": "workflow-2",
                    "task_id": "task-2",
                    "notes": "Escalated approval",
                },
            ],
        }
    )
    assert bulk_decision.requested == 2
    assert bulk_decision.succeeded == 1
    assert bulk_decision.failed == 1
    assert bulk_decision.results[0].workflow_instance_id == "workflow-1"
    assert bulk_decision.errors[0].code == "task_not_pending"
    assert router.requests[-1].url == f"{api_url}/api/v1/lex/workflows/tasks/bulk-decision"
    assert router.requests[-1].json_body == {
        "decision": "approve",
        "notes": "Bulk approved from SDK.",
        "items": [
            {"workflow_instance_id": "workflow-1", "task_id": "task-1"},
            {
                "workflow_instance_id": "workflow-2",
                "task_id": "task-2",
                "notes": "Escalated approval",
            },
        ],
    }

    envelope = api_key_client.lex.signatures.custody(
        "signature-1",
        {"file_id": "file-1", "content_hash": "sha256:abc"},
    )
    assert envelope.id == "signature-1"
    assert envelope.custody_evidence[0].content_hash == "sha256:abc"
    assert router.requests[-1].url == f"{api_url}/api/v1/lex/signatures/signature-1/custody"
    assert router.requests[-1].json_body == {"file_id": "file-1", "content_hash": "sha256:abc"}

    dispatch = api_key_client.lex.obligations.dispatch_outbox()
    assert dispatch.sent_count == 1
    assert dispatch.attempts[0].outbox_id == "outbox-1"
    assert router.requests[-1].url == (
        f"{api_url}/api/v1/lex/obligations/reminders/outbox/dispatch"
    )
    assert router.requests[-1].json_body == {}

    item_dispatch = api_key_client.lex.obligations.dispatch_outbox_item(
        "outbox-1",
        {"retry": True},
    )
    assert item_dispatch.dispatched_count == 1
    assert item_dispatch.attempts[0].status == "sent"
    assert router.requests[-1].url == (
        f"{api_url}/api/v1/lex/obligations/reminders/outbox/outbox-1/dispatch"
    )
    assert router.requests[-1].json_body == {"retry": True}


def test_lex_approval_policy_catalog_routes(
    api_url: str,
    router,
    api_key_client: Clario360,
) -> None:
    policy_payload = {
        "id": "policy-1",
        "tenant_id": "tenant-1",
        "name": "Finance DoA approvals",
        "description": "Finance authority matrix approvals.",
        "status": "active",
        "priority": 10,
        "contract_type": "vendor",
        "department": "finance",
        "min_value": 100000,
        "max_value": 500000,
        "currency": "SAR",
        "mode": "sequential",
        "quorum": "all",
        "quorum_n": None,
        "approvers": [{"type": "role", "ref": "finance_director", "label": "Finance Director"}],
        "form_fields": [
            {
                "name": "business_justification",
                "type": "textarea",
                "label": "Business justification",
                "required": True,
            }
        ],
        "require_authority_evidence": True,
        "required_role": "finance_director",
        "required_authority_amount": 500000,
        "metadata": {"source": "watheeq"},
        "created_by": "user-1",
        "updated_by": None,
        "created_at": "2026-06-14T12:00:00Z",
        "updated_at": "2026-06-14T12:00:00Z",
    }
    analytics_payload = {
        "tenant_id": "tenant-1",
        "generated_at": "2026-06-14T12:30:00Z",
        "total_policies": 1,
        "active_policies": 1,
        "draft_policies": 0,
        "archived_policies": 0,
        "total_routed_tasks": 8,
        "active_tasks": 2,
        "completed_tasks": 5,
        "rejected_tasks": 1,
        "cancelled_tasks": 0,
        "awaiting_quorum_tasks": 1,
        "average_decision_hours": 4.5,
        "policies": [
            {
                "policy_id": "policy-1",
                "name": "Finance DoA approvals",
                "status": "active",
                "mode": "sequential",
                "quorum": "all",
                "quorum_n": None,
                "require_authority_evidence": True,
                "total_tasks": 8,
                "active_tasks": 2,
                "completed_tasks": 5,
                "rejected_tasks": 1,
                "cancelled_tasks": 0,
                "awaiting_quorum_tasks": 1,
                "average_decision_hours": 4.5,
                "last_task_at": "2026-06-14T12:15:00Z",
            }
        ],
    }
    create_payload = {
        "name": "Procurement approvals",
        "description": "Procurement authority matrix approvals.",
        "status": "active",
        "priority": 20,
        "contract_type": "procurement",
        "department": "procurement",
        "min_value": 500000,
        "max_value": 1000000,
        "currency": "SAR",
        "mode": "parallel",
        "quorum": "n_of_m",
        "quorum_n": 2,
        "approvers": [
            {"type": "role", "ref": "procurement_director", "label": "Procurement Director"},
            {"type": "role", "ref": "finance_director", "label": "Finance Director"},
        ],
        "form_fields": [
            {
                "name": "business_justification",
                "type": "textarea",
                "label": "Business justification",
                "required": True,
            }
        ],
        "require_authority_evidence": True,
        "required_role": "procurement_director",
        "required_authority_amount": 1000000,
        "metadata": {"source": "watheeq"},
    }

    router.add_json(
        "GET",
        f"{api_url}/api/v1/lex/workflow-policies/approval",
        {"data": [policy_payload]},
    )
    router.add_json(
        "GET",
        f"{api_url}/api/v1/lex/workflow-policies/approval/analytics",
        {"data": analytics_payload},
    )
    router.add_json(
        "POST",
        f"{api_url}/api/v1/lex/workflow-policies/approval",
        {"data": {**policy_payload, "id": "policy-2", "name": "Procurement approvals"}},
    )
    router.add_json(
        "GET",
        f"{api_url}/api/v1/lex/workflow-policies/approval/recommend",
        {
            "data": {
                "policy": policy_payload,
                "matched": True,
                "reason": "Matched finance vendor contract value.",
            }
        },
    )

    policies = api_key_client.lex.workflows.list_approval_policies()
    analytics = api_key_client.lex.workflows.approval_policy_analytics()
    created = api_key_client.lex.workflows.create_approval_policy(create_payload)
    recommendation = api_key_client.lex.workflows.recommend_approval_policy("contract-1")

    assert policies[0].id == "policy-1"
    assert policies[0].approvers[0].ref == "finance_director"
    assert policies[0].form_fields[0].name == "business_justification"
    assert analytics.total_routed_tasks == 8
    assert analytics.policies[0].policy_id == "policy-1"
    assert analytics.policies[0].last_task_at == "2026-06-14T12:15:00Z"
    assert created.id == "policy-2"
    assert recommendation.matched is True
    assert recommendation.policy is not None
    assert recommendation.policy.id == "policy-1"
    assert router.requests[-4].url == f"{api_url}/api/v1/lex/workflow-policies/approval"
    assert router.requests[-4].params is None
    assert router.requests[-3].url == f"{api_url}/api/v1/lex/workflow-policies/approval/analytics"
    assert router.requests[-3].params is None
    assert router.requests[-2].url == f"{api_url}/api/v1/lex/workflow-policies/approval"
    assert router.requests[-2].json_body == create_payload
    assert router.requests[-1].url == f"{api_url}/api/v1/lex/workflow-policies/approval/recommend"
    assert router.requests[-1].params == {"contract_id": "contract-1"}


def test_watheeq_rtm_route_wrappers(api_url: str, router, api_key_client: Clario360) -> None:
    router.add_json(
        "GET",
        f"{api_url}/api/v1/lex/contracts/contract-1/brief",
        {
            "data": {
                "contract_id": "contract-1",
                "title": "Facilities Services Agreement",
                "type": "services",
                "status": "active",
                "counterparty": "Riyadh Facilities LLC",
                "owner": "Legal Ops",
                "value": 250000,
                "currency": "SAR",
                "executive_summary": "Facilities Services Agreement is active.",
                "risk_summary": "Overall risk is high with score 72.50.",
                "risk_level": "high",
                "risk_score": 72.5,
                "top_clauses": [
                    {
                        "id": "clause-1",
                        "title": "Liability",
                        "clause_type": "limitation_of_liability",
                        "section_reference": "8",
                        "risk_level": "high",
                        "risk_score": 91,
                        "summary": "Uncapped liability.",
                    }
                ],
                "top_risks": [
                    {
                        "title": "Uncapped liability",
                        "description": "No aggregate liability cap.",
                        "severity": "high",
                        "clause_reference": "8",
                        "recommendation": "Add a liability cap.",
                        "clause_type": "limitation_of_liability",
                    }
                ],
                "obligations": [
                    {
                        "label": "Payment terms",
                        "value": "Net 30",
                        "source": "contract.payment_terms",
                    }
                ],
                "renewal_signals": [
                    {
                        "label": "Renewal notice",
                        "value": "60 days",
                        "source": "contract.renewal_notice_days",
                    }
                ],
                "metadata": {"brief_summary": "Critical facilities agreement."},
                "generated_at": "2026-06-14T10:00:00Z",
            }
        },
    )
    router.add_json(
        "POST",
        f"{api_url}/api/v1/lex/matters/conflict-check",
        {
            "data": {
                "checked_at": "2026-06-14T10:01:00Z",
                "conflicts": [
                    {
                        "severity": "conflict",
                        "reasons": ["exact_title"],
                        "matter_id": "matter-1",
                        "matter_title": "NDA review",
                        "matched_terms": ["nda"],
                    }
                ],
                "warnings": [
                    {
                        "severity": "warning",
                        "reasons": ["shared_terms"],
                        "contract_id": "contract-1",
                        "contract_title": "Facilities Services Agreement",
                        "matched_terms": ["facilities"],
                    }
                ],
            }
        },
    )
    router.add_json(
        "GET",
        f"{api_url}/api/v1/lex/documents/repository-summary",
        {
            "data": {
                "tenant_id": "tenant-1",
                "generated_at": "2026-06-14T10:02:00Z",
                "total_documents": 4,
                "by_type": {"policy": 2, "resolution": 2},
                "by_status": {"active": 3, "archived": 1},
                "by_confidentiality": {"internal": 3, "privileged": 1},
                "by_category": {"governance": 3, "uncategorized": 1},
                "folders": [
                    {
                        "path": "/governance",
                        "document_count": 3,
                        "privileged": 1,
                        "archived": 1,
                    }
                ],
                "saved_views": [
                    {
                        "name": "Privileged",
                        "document_count": 1,
                        "filters": {"confidentiality": "privileged"},
                    }
                ],
                "taxonomy": [
                    {"dimension": "tag", "value": "board", "document_count": 2}
                ],
                "retention": {
                    "with_policy": 3,
                    "with_disposition": 2,
                    "disposition_due": 1,
                    "missing_policy": 1,
                },
            }
        },
    )

    brief = api_key_client.lex.contracts.brief("contract-1")
    conflicts = api_key_client.lex.matters.conflict_check(
        {
            "title": "NDA review",
            "counterparty": "Riyadh Facilities LLC",
            "contract_context": "Facilities services renewal",
        }
    )
    repository = api_key_client.lex.documents.repository_summary()

    assert brief.contract_id == "contract-1"
    assert brief.top_clauses[0].risk_score == 91
    assert brief.top_risks[0].recommendation == "Add a liability cap."
    assert brief.obligations[0].source == "contract.payment_terms"
    assert conflicts.conflicts[0].matter_id == "matter-1"
    assert conflicts.warnings[0].contract_id == "contract-1"
    assert repository.total_documents == 4
    assert repository.folders[0].path == "/governance"
    assert repository.saved_views[0].filters["confidentiality"] == "privileged"
    assert repository.retention.disposition_due == 1
    assert router.requests[-3].url == f"{api_url}/api/v1/lex/contracts/contract-1/brief"
    assert router.requests[-2].url == f"{api_url}/api/v1/lex/matters/conflict-check"
    assert router.requests[-2].json_body == {
        "title": "NDA review",
        "counterparty": "Riyadh Facilities LLC",
        "contract_context": "Facilities services renewal",
    }
    assert router.requests[-1].url == f"{api_url}/api/v1/lex/documents/repository-summary"


def test_watheeq_contract_intelligence_wrappers(api_url: str, router, api_key_client: Clario360) -> None:
    router.add_json(
        "GET",
        f"{api_url}/api/v1/lex/contracts/renewal-warnings",
        {
            "data": {
                "tenant_id": "tenant-1",
                "generated_at": "2026-06-14T10:00:00Z",
                "horizon_days": 60,
                "lead_days": 30,
                "total": 1,
                "urgent": 1,
                "warning": 0,
                "items": [
                    {
                        "contract_id": "contract-1",
                        "title": "Vendor MSA",
                        "status": "active",
                        "counterparty": "Acme LLC",
                        "owner": "Legal Ops",
                        "expiry_date": "2026-07-10T00:00:00Z",
                        "auto_renew": True,
                        "renewal_notice_days": 45,
                        "configured_lead_days": 45,
                        "trigger_date": "2026-05-26T00:00:00Z",
                        "days_until_trigger": -19,
                        "days_until_expiry": 26,
                        "severity": "urgent",
                        "reason": "expiry_minus_lead",
                    }
                ],
            }
        },
    )
    router.add_json(
        "POST",
        f"{api_url}/api/v1/lex/contracts/contract-1/classify",
        {
            "data": {
                "contract_id": "contract-1",
                "previous_type": "other",
                "recommended_type": "sla",
                "applied_type": "sla",
                "applied": True,
                "confidence": 0.79,
                "matched_terms": ["service level", "uptime"],
                "rationale": "Matched 2 term(s) associated with sla.",
                "classified_at": "2026-06-14T10:01:00Z",
                "metadata": {"source": "deterministic_classifier"},
            }
        },
    )
    router.add_json(
        "GET",
        f"{api_url}/api/v1/lex/contracts/contract-1/timeline",
        {
            "data": {
                "contract_id": "contract-1",
                "generated_at": "2026-06-14T10:02:00Z",
                "events": [
                    {
                        "id": "status-active",
                        "event_type": "status_changed",
                        "title": "Status changed",
                        "description": "Contract moved to active.",
                        "occurred_at": "2026-06-10T10:00:00Z",
                        "actor": "user-1",
                        "source": "contracts.status_changed_at",
                        "metadata": {"status": "active"},
                    }
                ],
            }
        },
    )

    warnings = api_key_client.lex.contracts.renewal_warnings(horizon_days=60, lead_days=30)
    classification = api_key_client.lex.contracts.classify(
        "contract-1",
        {"apply": True, "candidate_text": "service level agreement with uptime credits"},
    )
    timeline = api_key_client.lex.contracts.timeline("contract-1")

    assert warnings.total == 1
    assert warnings.items[0].severity == "urgent"
    assert classification.recommended_type == "sla"
    assert classification.applied is True
    assert classification.matched_terms == ["service level", "uptime"]
    assert timeline.events[0].event_type == "status_changed"
    assert router.requests[-3].url == f"{api_url}/api/v1/lex/contracts/renewal-warnings"
    assert router.requests[-3].params == {"horizon_days": 60, "lead_days": 30}
    assert router.requests[-2].url == f"{api_url}/api/v1/lex/contracts/contract-1/classify"
    assert router.requests[-2].json_body == {
        "apply": True,
        "candidate_text": "service level agreement with uptime credits",
    }
    assert router.requests[-1].url == f"{api_url}/api/v1/lex/contracts/contract-1/timeline"

    router.add_json(
        "GET",
        f"{api_url}/api/v1/watheeq/contracts/renewal-warnings",
        {
            "data": {
                "horizon_days": 45,
                "lead_days": 15,
                "total": 0,
                "urgent": 0,
                "warning": 0,
                "items": [],
            }
        },
    )
    router.add_json(
        "POST",
        f"{api_url}/api/v1/watheeq/contracts/contract-2/classify",
        {
            "data": {
                "contract_id": "contract-2",
                "recommended_type": "nda",
                "applied": False,
                "confidence": 0.91,
                "matched_terms": ["confidential"],
            }
        },
    )
    router.add_json(
        "GET",
        f"{api_url}/api/v1/watheeq/contracts/contract-2/timeline",
        {"data": {"contract_id": "contract-2", "events": []}},
    )

    api_key_client.watheeq.contracts.renewal_warnings(horizon_days=45, lead_days=15)
    api_key_client.watheeq.contracts.classify(
        "contract-2",
        {"apply": False, "override_type": "nda"},
    )
    api_key_client.watheeq.contracts.timeline("contract-2")

    assert router.requests[-3].url == f"{api_url}/api/v1/watheeq/contracts/renewal-warnings"
    assert router.requests[-3].params == {"horizon_days": 45, "lead_days": 15}
    assert router.requests[-2].url == f"{api_url}/api/v1/watheeq/contracts/contract-2/classify"
    assert router.requests[-2].json_body == {"apply": False, "override_type": "nda"}
    assert router.requests[-1].url == f"{api_url}/api/v1/watheeq/contracts/contract-2/timeline"


def test_lex_new_route_wrappers(api_url: str, router, api_key_client: Clario360) -> None:
    router.add_json(
        "GET",
        f"{api_url}/api/v1/lex/clause-library/search",
        paginated(
            [
                {
                    "item": {"id": "clause-1", "code": "IP-1"},
                    "score": 1,
                    "matched_fields": ["title_en"],
                    "metadata": {"search_mode": "semantic"},
                }
            ]
        ),
    )
    router.add_json(
        "GET",
        f"{api_url}/api/v1/lex/regulations/search",
        paginated(
            [
                {
                    "item": {"id": "reg-1", "code": "PDPL"},
                    "score": 1,
                    "matched_fields": ["title_en"],
                    "metadata": {"search_mode": "semantic"},
                }
            ]
        ),
    )
    router.add_json(
        "POST",
        f"{api_url}/api/v1/lex/obligations/reminders/enqueue",
        {"data": {"requested_count": 1, "queued_count": 1, "queued": [{"id": "outbox-1"}]}},
    )
    router.add_json(
        "POST",
        f"{api_url}/api/v1/lex/obligations/reminders/outbox/outbox-1/delivery",
        {"data": {"id": "outbox-1", "status": "sent"}},
    )
    router.add_json(
        "POST",
        f"{api_url}/api/v1/lex/signatures/signature-1/provider-events",
        {
            "data": {
                "id": "signature-1",
                "title": "Board resolution",
                "events": [{"id": "event-1", "provider": "nafath", "provider_status": "signed"}],
            }
        },
    )

    clause_result = api_key_client.lex.clause_library.search(
        "IP",
        semantic=True,
        language="en",
        risk_level="high",
    ).data[0]
    regulation_result = api_key_client.lex.regulations.search(
        "PDPL",
        semantic=True,
        language="en",
        jurisdiction="SA",
    ).data[0]
    enqueue_result = api_key_client.lex.obligations.enqueue_reminders({"channels": ["email"]})
    delivery = api_key_client.lex.obligations.mark_reminder_delivery(
        "outbox-1",
        {"status": "sent"},
    )
    envelope = api_key_client.lex.signatures.provider_event(
        "signature-1",
        {"provider": "nafath", "provider_status": "signed"},
    )

    assert clause_result.item.code == "IP-1"
    assert regulation_result.item.code == "PDPL"
    assert clause_result.metadata["search_mode"] == "semantic"
    assert regulation_result.metadata["search_mode"] == "semantic"
    assert router.requests[-5].params == {
        "q": "IP",
        "page": 1,
        "per_page": 50,
        "risk_level": "high",
        "language": "en",
        "semantic": True,
    }
    assert router.requests[-4].params == {
        "q": "PDPL",
        "page": 1,
        "per_page": 50,
        "jurisdiction": "SA",
        "language": "en",
        "semantic": True,
    }
    assert enqueue_result.queued_count == 1
    assert delivery.status == "sent"
    assert envelope.events[0].provider_status == "signed"


def test_obligations_resource_backend_route_wrappers(
    api_url: str,
    router,
    api_key_client: Clario360,
) -> None:
    create_payload = {
        "title": "Submit notice",
        "owner_user_id": "user-1",
        "due_date": "2026-07-01T00:00:00Z",
    }
    update_payload = {"title": "Submit renewal notice", "priority": "high"}
    extract_payload = {
        "owner_user_id": "user-1",
        "owner_name": "Legal Ops",
        "items": [],
        "include_contract_renewal": True,
    }

    router.add_json(
        "POST",
        f"{api_url}/api/v1/lex/obligations",
        {
            "data": {
                "id": "obl-1",
                "tenant_id": "tenant-1",
                "title": "Submit notice",
                "status": "open",
                "days_until_due": 17,
                "created_at": "2026-06-14T10:00:00Z",
            }
        },
        status_code=201,
    )
    router.add_json(
        "PUT",
        f"{api_url}/api/v1/lex/obligations/obl-1",
        {"data": {"id": "obl-1", "title": "Submit renewal notice", "priority": "high"}},
    )
    router.add_json(
        "PUT",
        f"{api_url}/api/v1/lex/obligations/obl-1/status",
        {"data": {"id": "obl-1", "title": "Submit renewal notice", "status": "completed"}},
    )
    router.add_json(
        "DELETE",
        f"{api_url}/api/v1/lex/obligations/obl-1",
        {},
        status_code=204,
    )
    router.add_json(
        "GET",
        f"{api_url}/api/v1/lex/contracts/contract-1/obligations",
        paginated([{"id": "obl-contract", "title": "Payment", "contract_id": "contract-1"}]),
    )
    router.add_json(
        "GET",
        f"{api_url}/api/v1/lex/matters/matter-1/obligations",
        paginated([{"id": "obl-matter", "title": "Filing", "matter_id": "matter-1"}]),
    )
    router.add_json(
        "POST",
        f"{api_url}/api/v1/lex/contracts/contract-1/obligations/extract",
        {
            "data": {
                "contract_id": "contract-1",
                "created_count": 1,
                "created": [
                    {
                        "id": "obl-2",
                        "title": "Renewal notice",
                        "contract_id": "contract-1",
                    }
                ],
                "skipped": [
                    {
                        "source": "metadata",
                        "title": "Archived task",
                        "reason": "duplicate",
                    }
                ],
                "planned_notifications": [
                    {
                        "event_id": "event-1",
                        "type": "reminder",
                        "obligation_id": "obl-2",
                        "obligation_title": "Renewal notice",
                        "lead_days": 30,
                    }
                ],
                "committed_at": "2026-06-14T10:05:00Z",
                "deterministic_strategy": "metadata_then_rules",
            }
        },
        status_code=201,
    )
    router.add_json(
        "GET",
        f"{api_url}/api/v1/watheeq/contracts/contract-2/obligations",
        paginated([]),
    )
    router.add_json(
        "GET",
        f"{api_url}/api/v1/watheeq/matters/matter-2/obligations",
        paginated([]),
    )

    created = api_key_client.lex.obligations.create(create_payload)
    assert created.id == "obl-1"
    assert created.tenant_id == "tenant-1"
    assert created.days_until_due == 17
    assert router.requests[-1].url == f"{api_url}/api/v1/lex/obligations"
    assert router.requests[-1].json_body == create_payload

    updated = api_key_client.lex.obligations.update("obl-1", update_payload)
    assert updated.priority == "high"
    assert router.requests[-1].url == f"{api_url}/api/v1/lex/obligations/obl-1"
    assert router.requests[-1].json_body == update_payload

    status = api_key_client.lex.obligations.update_status("obl-1", "completed")
    assert status.status == "completed"
    assert router.requests[-1].url == f"{api_url}/api/v1/lex/obligations/obl-1/status"
    assert router.requests[-1].json_body == {"status": "completed"}

    api_key_client.lex.obligations.delete("obl-1")
    assert router.requests[-1].method == "DELETE"
    assert router.requests[-1].url == f"{api_url}/api/v1/lex/obligations/obl-1"
    assert router.requests[-1].json_body is None

    contract_obligations = api_key_client.lex.obligations.list_by_contract(
        "contract-1",
        page=2,
        per_page=25,
        status="open",
    )
    assert contract_obligations.data[0].contract_id == "contract-1"
    assert router.requests[-1].url == (
        f"{api_url}/api/v1/lex/contracts/contract-1/obligations"
    )
    assert router.requests[-1].params == {"page": 2, "per_page": 25, "status": "open"}

    matter_obligations = api_key_client.lex.obligations.list_by_matter("matter-1", overdue=True)
    assert matter_obligations.data[0].matter_id == "matter-1"
    assert router.requests[-1].url == f"{api_url}/api/v1/lex/matters/matter-1/obligations"
    assert router.requests[-1].params == {"page": 1, "per_page": 50, "overdue": True}

    extraction = api_key_client.lex.obligations.extract_from_contract("contract-1", extract_payload)
    assert extraction.created_count == 1
    assert extraction.created[0].id == "obl-2"
    assert extraction.skipped[0].reason == "duplicate"
    assert extraction.planned_notifications[0].event_id == "event-1"
    assert router.requests[-1].url == (
        f"{api_url}/api/v1/lex/contracts/contract-1/obligations/extract"
    )
    assert router.requests[-1].json_body == extract_payload

    api_key_client.watheeq.obligations.list_by_contract("contract-2")
    assert router.requests[-1].url == f"{api_url}/api/v1/watheeq/contracts/contract-2/obligations"
    assert router.requests[-1].params == {"page": 1, "per_page": 50}

    api_key_client.watheeq.obligations.list_by_matter("matter-2")
    assert router.requests[-1].url == f"{api_url}/api/v1/watheeq/matters/matter-2/obligations"
    assert router.requests[-1].params == {"page": 1, "per_page": 50}


def test_obligation_reminder_route_wrappers(
    api_url: str,
    router,
    api_key_client: Clario360,
) -> None:
    router.add_json(
        "GET",
        f"{api_url}/api/v1/lex/obligations/reminders",
        {
            "data": {
                "as_of": "2026-06-14T00:00:00Z",
                "horizon_days": 14,
                "total": 1,
                "events": [
                    {
                        "event_id": "event-1",
                        "type": "reminder",
                        "obligation_id": "obl-1",
                        "obligation_title": "Submit notice",
                        "lead_days": 7,
                        "channel": "email",
                    }
                ],
            }
        },
    )
    router.add_json(
        "POST",
        f"{api_url}/api/v1/lex/obligations/reminders/enqueue",
        {
            "data": {
                "requested_count": 1,
                "queued_count": 1,
                "skipped_duplicate_count": 0,
                "queued": [
                    {
                        "id": "outbox-1",
                        "tenant_id": "tenant-1",
                        "obligation_id": "obl-1",
                        "event_id": "event-1",
                        "status": "pending",
                    }
                ],
            }
        },
        status_code=201,
    )
    router.add_json(
        "POST",
        f"{api_url}/api/v1/lex/obligations/obl-1/reminders/sent",
        {
            "data": {
                "id": "obl-1",
                "title": "Submit notice",
                "status": "open",
                "last_reminder_at": "2026-06-14T10:10:00Z",
            }
        },
    )
    router.add_json(
        "POST",
        f"{api_url}/api/v1/lex/obligations/reminders/outbox/outbox-1/delivery",
        {
            "data": {
                "id": "outbox-1",
                "obligation_id": "obl-1",
                "status": "sent",
                "provider": "email",
                "provider_message_id": "msg-1",
                "attempt_count": 1,
                "sent_at": "2026-06-14T10:10:00Z",
            }
        },
    )

    plan = api_key_client.lex.obligations.reminder_plan(
        as_of="2026-06-14",
        horizon_days=14,
        include_escalations=False,
    )
    assert plan.total == 1
    assert plan.events[0].event_id == "event-1"
    assert router.requests[-1].url == f"{api_url}/api/v1/lex/obligations/reminders"
    assert router.requests[-1].params == {
        "as_of": "2026-06-14",
        "horizon_days": 14,
        "include_escalations": False,
    }

    enqueue = api_key_client.lex.obligations.enqueue_reminders(
        {"channels": ["email"], "horizon_days": 14},
    )
    assert enqueue.queued_count == 1
    assert enqueue.queued[0].tenant_id == "tenant-1"
    assert router.requests[-1].url == f"{api_url}/api/v1/lex/obligations/reminders/enqueue"
    assert router.requests[-1].json_body == {"channels": ["email"], "horizon_days": 14}

    sent = api_key_client.lex.obligations.mark_reminder_sent(
        "obl-1",
        {"channel": "email", "event_type": "reminder", "lead_days": 7},
    )
    assert sent.last_reminder_at == "2026-06-14T10:10:00Z"
    assert router.requests[-1].url == (
        f"{api_url}/api/v1/lex/obligations/obl-1/reminders/sent"
    )
    assert router.requests[-1].json_body == {
        "channel": "email",
        "event_type": "reminder",
        "lead_days": 7,
    }

    delivery = api_key_client.lex.obligations.mark_delivery(
        "outbox-1",
        {"status": "sent", "provider": "email", "provider_message_id": "msg-1"},
    )
    assert delivery.status == "sent"
    assert delivery.provider_message_id == "msg-1"
    assert router.requests[-1].url == (
        f"{api_url}/api/v1/lex/obligations/reminders/outbox/outbox-1/delivery"
    )
    assert router.requests[-1].json_body == {
        "status": "sent",
        "provider": "email",
        "provider_message_id": "msg-1",
    }
