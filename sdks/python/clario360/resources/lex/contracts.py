from __future__ import annotations

from typing import List, Optional

from clario360.models.common import MetricsSnapshot, PaginatedResponse
from clario360.models.lex import (
    Clause,
    Contract,
    ContractBrief,
    ContractClassificationResult,
    ContractDetail,
    ContractRedline,
    ContractReport,
    ContractRenewalWarningSummary,
    ContractRiskAnalysis,
    ContractSummary,
    ContractTimeline,
    ContractVersion,
    ExpiringContractSummary,
    LegalWorkflowSummary,
    Obligation,
    ObligationExtractionResult,
)
from clario360.resources._base import BaseResource


class ContractsResource(BaseResource[Contract]):
    def list(
        self,
        *,
        page: int = 1,
        per_page: int = 50,
        search: Optional[str] = None,
        status: Optional[str] = None,
        type: Optional[str] = None,
        risk_level: Optional[str] = None,
        owner_user_id: Optional[str] = None,
        department: Optional[str] = None,
        tag: Optional[str] = None,
        expiring_in_days: Optional[int] = None,
        sort: Optional[str] = None,
        order: Optional[str] = None,
    ) -> PaginatedResponse[Contract]:
        return self._list(
            params={
                "page": page,
                "per_page": per_page,
                "search": search,
                "status": status,
                "type": type,
                "risk_level": risk_level,
                "owner_user_id": owner_user_id,
                "department": department,
                "tag": tag,
                "expiring_in_days": expiring_in_days,
                "sort": sort,
                "order": order,
            }
        )

    def get(self, contract_id: str) -> Contract:
        detail = self.detail(contract_id)
        if detail.contract is not None:
            return detail.contract
        payload = self._http.get(f"{self._base}/{contract_id}")
        return Contract.from_dict(self._unwrap_mapping(payload))

    def detail(self, contract_id: str) -> ContractDetail:
        return self._get_at(f"{self._base}/{contract_id}", ContractDetail)

    def brief(self, contract_id: str) -> ContractBrief:
        return self._get_at(f"{self._base}/{contract_id}/brief", ContractBrief)

    def create(self, payload: dict[str, object]) -> Contract:
        return self._create(payload)

    def update(self, contract_id: str, payload: dict[str, object]) -> Contract:
        return self._update(contract_id, payload)

    def delete(self, contract_id: str) -> None:
        self._delete(contract_id)

    def search(
        self,
        query: str,
        *,
        page: int = 1,
        per_page: int = 50,
    ) -> PaginatedResponse[ContractSummary]:
        return self._paginated_at(
            f"{self._base}/search",
            ContractSummary,
            params={"q": query, "page": page, "per_page": per_page},
        )

    def expiring(self, *, horizon_days: int = 30) -> List[ExpiringContractSummary]:
        return self._list_models_at(
            f"{self._base}/expiring",
            ExpiringContractSummary,
            params={"horizon_days": horizon_days},
        )

    def renewal_warnings(
        self,
        *,
        horizon_days: int = 60,
        lead_days: int = 30,
    ) -> ContractRenewalWarningSummary:
        return self._get_at(
            f"{self._base}/renewal-warnings",
            ContractRenewalWarningSummary,
            params={"horizon_days": horizon_days, "lead_days": lead_days},
        )

    def analysis(self, contract_id: str) -> ContractRiskAnalysis:
        return self._get_at(f"{self._base}/{contract_id}/analysis", ContractRiskAnalysis)

    def analyze(self, contract_id: str) -> ContractRiskAnalysis:
        return self._post_at(f"{self._base}/{contract_id}/analyze", ContractRiskAnalysis, {})

    def classify(self, contract_id: str, payload: dict[str, object]) -> ContractClassificationResult:
        return self._post_at(f"{self._base}/{contract_id}/classify", ContractClassificationResult, payload)

    def timeline(self, contract_id: str) -> ContractTimeline:
        return self._get_at(f"{self._base}/{contract_id}/timeline", ContractTimeline)

    def update_status(self, contract_id: str, status: str) -> Contract:
        return self._put_at(f"{self._base}/{contract_id}/status", Contract, {"status": status})

    def upload_document(
        self,
        contract_id: str,
        payload: dict[str, object],
    ) -> List[ContractVersion]:
        return self._post_list_at(f"{self._base}/{contract_id}/upload", ContractVersion, payload)

    def versions(self, contract_id: str) -> List[ContractVersion]:
        return self._list_models_at(f"{self._base}/{contract_id}/versions", ContractVersion)

    def redline(
        self,
        contract_id: str,
        *,
        base_version: Optional[int] = None,
        target_version: Optional[int] = None,
    ) -> ContractRedline:
        return self._get_at(
            f"{self._base}/{contract_id}/redline",
            ContractRedline,
            params={"base_version": base_version, "target_version": target_version},
        )

    def renew(self, contract_id: str, payload: dict[str, object]) -> Contract:
        return self._post_at(f"{self._base}/{contract_id}/renew", Contract, payload)

    def start_review(self, contract_id: str, payload: dict[str, object]) -> LegalWorkflowSummary:
        return self._post_at(f"{self._base}/{contract_id}/review", LegalWorkflowSummary, payload)

    def clauses(self, contract_id: str) -> List[Clause]:
        return self._list_models_at(f"{self._base}/{contract_id}/clauses", Clause)

    def clause(self, contract_id: str, clause_id: str) -> Clause:
        return self._get_at(f"{self._base}/{contract_id}/clauses/{clause_id}", Clause)

    def clause_risks(self, contract_id: str) -> List[Clause]:
        return self._list_models_at(f"{self._base}/{contract_id}/clauses/risks", Clause)

    def review_clause(
        self,
        contract_id: str,
        clause_id: str,
        payload: dict[str, object],
    ) -> Clause:
        return self._put_at(
            f"{self._base}/{contract_id}/clauses/{clause_id}/review",
            Clause,
            payload,
        )

    def obligations(
        self,
        contract_id: str,
        *,
        page: int = 1,
        per_page: int = 50,
    ) -> PaginatedResponse[Obligation]:
        return self._paginated_at(
            f"{self._base}/{contract_id}/obligations",
            Obligation,
            params={"page": page, "per_page": per_page},
        )

    def extract_obligations(
        self,
        contract_id: str,
        payload: dict[str, object],
    ) -> ObligationExtractionResult:
        return self._post_at(
            f"{self._base}/{contract_id}/obligations/extract",
            ObligationExtractionResult,
            payload,
        )

    def report(
        self,
        *,
        page: int = 1,
        per_page: int = 1000,
        search: Optional[str] = None,
        status: Optional[str] = None,
        type: Optional[str] = None,
        risk_level: Optional[str] = None,
        owner_user_id: Optional[str] = None,
        department: Optional[str] = None,
        tag: Optional[str] = None,
        expiring_in_days: Optional[int] = None,
    ) -> ContractReport:
        return self._get_at(
            f"{self._base.rsplit('/', 1)[0]}/reports/contracts",
            ContractReport,
            params={
                "page": page,
                "per_page": per_page,
                "search": search,
                "status": status,
                "type": type,
                "risk_level": risk_level,
                "owner_user_id": owner_user_id,
                "department": department,
                "tag": tag,
                "expiring_in_days": expiring_in_days,
            },
        )

    def stats(self) -> MetricsSnapshot:
        return self._metrics(f"{self._base}/stats")
