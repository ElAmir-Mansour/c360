from __future__ import annotations

from typing import Optional

from clario360.models.lex import ContractReport, MatterReport, ObligationReport
from clario360.resources._base import BaseResource


class ReportsResource(BaseResource[ContractReport]):
    def contracts(
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
            f"{self._base}/contracts",
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

    def contracts_csv(
        self,
        *,
        search: Optional[str] = None,
        status: Optional[str] = None,
        type: Optional[str] = None,
        risk_level: Optional[str] = None,
        owner_user_id: Optional[str] = None,
        department: Optional[str] = None,
        tag: Optional[str] = None,
        expiring_in_days: Optional[int] = None,
    ) -> str:
        payload = self._http.get(
            f"{self._base}/contracts",
            params={
                "format": "csv",
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
        return payload if isinstance(payload, str) else ""

    def matters(
        self,
        *,
        page: int = 1,
        per_page: int = 1000,
        search: Optional[str] = None,
        status: Optional[str] = None,
        type: Optional[str] = None,
        priority: Optional[str] = None,
        owner_user_id: Optional[str] = None,
        contract_id: Optional[str] = None,
        department: Optional[str] = None,
        tag: Optional[str] = None,
        due_before: Optional[str] = None,
        due_after: Optional[str] = None,
    ) -> MatterReport:
        return self._get_at(
            f"{self._base}/matters",
            MatterReport,
            params={
                "page": page,
                "per_page": per_page,
                "search": search,
                "status": status,
                "type": type,
                "priority": priority,
                "owner_user_id": owner_user_id,
                "contract_id": contract_id,
                "department": department,
                "tag": tag,
                "due_before": due_before,
                "due_after": due_after,
            },
        )

    def matters_csv(
        self,
        *,
        search: Optional[str] = None,
        status: Optional[str] = None,
        type: Optional[str] = None,
        priority: Optional[str] = None,
        owner_user_id: Optional[str] = None,
        contract_id: Optional[str] = None,
        department: Optional[str] = None,
        tag: Optional[str] = None,
        due_before: Optional[str] = None,
        due_after: Optional[str] = None,
    ) -> str:
        payload = self._http.get(
            f"{self._base}/matters",
            params={
                "format": "csv",
                "search": search,
                "status": status,
                "type": type,
                "priority": priority,
                "owner_user_id": owner_user_id,
                "contract_id": contract_id,
                "department": department,
                "tag": tag,
                "due_before": due_before,
                "due_after": due_after,
            },
        )
        return payload if isinstance(payload, str) else ""

    def obligations(
        self,
        *,
        page: int = 1,
        per_page: int = 1000,
        search: Optional[str] = None,
        status: Optional[str] = None,
        type: Optional[str] = None,
        priority: Optional[str] = None,
        owner_user_id: Optional[str] = None,
        contract_id: Optional[str] = None,
        matter_id: Optional[str] = None,
        due_before: Optional[str] = None,
        due_after: Optional[str] = None,
        overdue: Optional[bool] = None,
        tag: Optional[str] = None,
    ) -> ObligationReport:
        return self._get_at(
            f"{self._base}/obligations",
            ObligationReport,
            params={
                "page": page,
                "per_page": per_page,
                "search": search,
                "status": status,
                "type": type,
                "priority": priority,
                "owner_user_id": owner_user_id,
                "contract_id": contract_id,
                "matter_id": matter_id,
                "due_before": due_before,
                "due_after": due_after,
                "overdue": overdue,
                "tag": tag,
            },
        )

    def obligations_csv(
        self,
        *,
        search: Optional[str] = None,
        status: Optional[str] = None,
        type: Optional[str] = None,
        priority: Optional[str] = None,
        owner_user_id: Optional[str] = None,
        contract_id: Optional[str] = None,
        matter_id: Optional[str] = None,
        due_before: Optional[str] = None,
        due_after: Optional[str] = None,
        overdue: Optional[bool] = None,
        tag: Optional[str] = None,
    ) -> str:
        payload = self._http.get(
            f"{self._base}/obligations",
            params={
                "format": "csv",
                "search": search,
                "status": status,
                "type": type,
                "priority": priority,
                "owner_user_id": owner_user_id,
                "contract_id": contract_id,
                "matter_id": matter_id,
                "due_before": due_before,
                "due_after": due_after,
                "overdue": overdue,
                "tag": tag,
            },
        )
        return payload if isinstance(payload, str) else ""
