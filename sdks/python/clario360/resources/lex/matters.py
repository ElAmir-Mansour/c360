from __future__ import annotations

from typing import Optional

from clario360.models.common import PaginatedResponse
from clario360.models.lex import Matter, MatterConflictCheckResult, MatterContract, Obligation
from clario360.resources._base import BaseResource


class MattersResource(BaseResource[Matter]):
    def list(
        self,
        *,
        page: int = 1,
        per_page: int = 50,
        search: Optional[str] = None,
        status: Optional[str] = None,
        type: Optional[str] = None,
        priority: Optional[str] = None,
        owner_user_id: Optional[str] = None,
        contract_id: Optional[str] = None,
        department: Optional[str] = None,
        tag: Optional[str] = None,
        sort: Optional[str] = None,
        order: Optional[str] = None,
    ) -> PaginatedResponse[Matter]:
        return self._list(
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
                "sort": sort,
                "order": order,
            }
        )

    def get(self, matter_id: str) -> Matter:
        return self._get(matter_id)

    def create(self, payload: dict[str, object]) -> Matter:
        return self._create(payload)

    def update(self, matter_id: str, payload: dict[str, object]) -> Matter:
        return self._update(matter_id, payload)

    def delete(self, matter_id: str) -> None:
        self._delete(matter_id)

    def update_status(self, matter_id: str, status: str) -> Matter:
        return self._put_at(f"{self._base}/{matter_id}/status", Matter, {"status": status})

    def triage(self, matter_id: str, payload: dict[str, object]) -> Matter:
        return self._post_at(f"{self._base}/{matter_id}/triage", Matter, payload)

    def conflict_check(self, payload: dict[str, object]) -> MatterConflictCheckResult:
        return self._post_at(f"{self._base}/conflict-check", MatterConflictCheckResult, payload)

    def link_contract(self, matter_id: str, contract_id: str, relationship: str) -> MatterContract:
        return self._post_at(
            f"{self._base}/{matter_id}/contracts",
            MatterContract,
            {"contract_id": contract_id, "relationship": relationship},
        )

    def unlink_contract(self, matter_id: str, contract_id: str) -> None:
        self._delete_at(f"{self._base}/{matter_id}/contracts/{contract_id}")

    def obligations(
        self,
        matter_id: str,
        *,
        page: int = 1,
        per_page: int = 50,
    ) -> PaginatedResponse[Obligation]:
        return self._paginated_at(
            f"{self._base}/{matter_id}/obligations",
            Obligation,
            params={"page": page, "per_page": per_page},
        )
