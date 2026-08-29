from __future__ import annotations

from clario360.http_client import AsyncHTTPClient, HTTPClient
from clario360.models.lex import (
    ClauseLibraryEntry,
    ComplianceRule,
    Contract,
    ContractReport,
    LegalDocument,
    LegalWorkflowSummary,
    LexDashboard,
    Matter,
    Obligation,
    Regulation,
    SignatureEnvelope,
)
from clario360.resources.lex.compliance import ComplianceResource
from clario360.resources.lex.contracts import ContractsResource
from clario360.resources.lex.dashboard import DashboardResource
from clario360.resources.lex.documents import DocumentsResource
from clario360.models.drafting import GeneratedClause
from clario360.resources.lex.drafting import DraftingResource
from clario360.resources.lex.library import ClauseLibraryResource, RegulationsResource
from clario360.resources.lex.matters import MattersResource
from clario360.resources.lex.obligations import ObligationsResource
from clario360.resources.lex.reports import ReportsResource
from clario360.resources.lex.signatures import SignaturesResource
from clario360.resources.lex.workflows import WorkflowsResource


class LexNamespace:
    def __init__(
        self,
        http: HTTPClient,
        async_http: AsyncHTTPClient,
        base_path: str = "/api/v1/lex",
    ) -> None:
        base = base_path.rstrip("/")
        self.contracts = ContractsResource(http, async_http, f"{base}/contracts", Contract)
        self.documents = DocumentsResource(http, async_http, f"{base}/documents", LegalDocument)
        self.workflows = WorkflowsResource(
            http,
            async_http,
            f"{base}/workflows",
            LegalWorkflowSummary,
        )
        self.reports = ReportsResource(http, async_http, f"{base}/reports", ContractReport)
        self.dashboard = DashboardResource(http, async_http, f"{base}/dashboard", LexDashboard)
        self.matters = MattersResource(http, async_http, f"{base}/matters", Matter)
        self.obligations = ObligationsResource(http, async_http, f"{base}/obligations", Obligation)
        self.clause_library = ClauseLibraryResource(
            http,
            async_http,
            f"{base}/clause-library",
            ClauseLibraryEntry,
        )
        self.regulations = RegulationsResource(http, async_http, f"{base}/regulations", Regulation)
        self.signatures = SignaturesResource(
            http,
            async_http,
            f"{base}/signatures",
            SignatureEnvelope,
        )
        self.compliance = ComplianceResource(http, async_http, f"{base}/compliance", ComplianceRule)
        self.drafting = DraftingResource(http, async_http, f"{base}/drafting", GeneratedClause)


WatheeqNamespace = LexNamespace


__all__ = ["LexNamespace", "WatheeqNamespace"]
