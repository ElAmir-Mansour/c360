from __future__ import annotations

from typing import Optional

from clario360.models.common import PaginatedResponse
from clario360.models.lex import (
    ClauseLibraryEntry,
    ClauseLibrarySearchResult,
    Regulation,
    RegulationClauseReference,
    RegulationSearchResult,
)
from clario360.resources._base import BaseResource


class ClauseLibraryResource(BaseResource[ClauseLibraryEntry]):
    def list(
        self,
        *,
        page: int = 1,
        per_page: int = 50,
        search: Optional[str] = None,
        clause_type: Optional[str] = None,
        category: Optional[str] = None,
        jurisdiction: Optional[str] = None,
        status: Optional[str] = None,
        governance_status: Optional[str] = None,
    ) -> PaginatedResponse[ClauseLibraryEntry]:
        return self._list(
            params={
                "page": page,
                "per_page": per_page,
                "search": search,
                "clause_type": clause_type,
                "category": category,
                "jurisdiction": jurisdiction,
                "status": status,
                "governance_status": governance_status,
            }
        )

    def get(self, entry_id: str) -> ClauseLibraryEntry:
        return self._get(entry_id)

    def search(
        self,
        query: Optional[str] = None,
        *,
        page: int = 1,
        per_page: int = 50,
        clause_type: Optional[str] = None,
        category: Optional[str] = None,
        jurisdiction: Optional[str] = None,
        status: Optional[str] = None,
        governance_status: Optional[str] = None,
        risk_level: Optional[str] = None,
        language: Optional[str] = None,
        semantic: Optional[bool] = None,
    ) -> PaginatedResponse[ClauseLibrarySearchResult]:
        return self._paginated_at(
            f"{self._base}/search",
            ClauseLibrarySearchResult,
            params={
                "q": query,
                "page": page,
                "per_page": per_page,
                "clause_type": clause_type,
                "category": category,
                "jurisdiction": jurisdiction,
                "status": status,
                "governance_status": governance_status,
                "risk_level": risk_level,
                "language": language,
                "semantic": semantic,
            },
        )

    def create(self, payload: dict[str, object]) -> ClauseLibraryEntry:
        return self._create(payload)

    def update(self, entry_id: str, payload: dict[str, object]) -> ClauseLibraryEntry:
        return self._update(entry_id, payload)

    def decide_governance(self, entry_id: str, payload: dict[str, object]) -> ClauseLibraryEntry:
        return self._post_at(f"{self._base}/{entry_id}/governance", ClauseLibraryEntry, payload)

    def delete(self, entry_id: str) -> None:
        self._delete(entry_id)


class RegulationsResource(BaseResource[Regulation]):
    def list(
        self,
        *,
        page: int = 1,
        per_page: int = 50,
        search: Optional[str] = None,
        jurisdiction: Optional[str] = None,
        authority: Optional[str] = None,
        regulation_type: Optional[str] = None,
        status: Optional[str] = None,
    ) -> PaginatedResponse[Regulation]:
        return self._list(
            params={
                "page": page,
                "per_page": per_page,
                "search": search,
                "jurisdiction": jurisdiction,
                "authority": authority,
                "regulation_type": regulation_type,
                "status": status,
            }
        )

    def get(self, regulation_id: str) -> Regulation:
        return self._get(regulation_id)

    def search(
        self,
        query: Optional[str] = None,
        *,
        page: int = 1,
        per_page: int = 50,
        jurisdiction: Optional[str] = None,
        authority: Optional[str] = None,
        regulation_type: Optional[str] = None,
        status: Optional[str] = None,
        risk_level: Optional[str] = None,
        language: Optional[str] = None,
        semantic: Optional[bool] = None,
    ) -> PaginatedResponse[RegulationSearchResult]:
        return self._paginated_at(
            f"{self._base}/search",
            RegulationSearchResult,
            params={
                "q": query,
                "page": page,
                "per_page": per_page,
                "jurisdiction": jurisdiction,
                "authority": authority,
                "regulation_type": regulation_type,
                "status": status,
                "risk_level": risk_level,
                "language": language,
                "semantic": semantic,
            },
        )

    def create(self, payload: dict[str, object]) -> Regulation:
        return self._create(payload)

    def update(self, regulation_id: str, payload: dict[str, object]) -> Regulation:
        return self._update(regulation_id, payload)

    def decide_governance(self, regulation_id: str, payload: dict[str, object]) -> Regulation:
        return self._post_at(f"{self._base}/{regulation_id}/governance", Regulation, payload)

    def delete(self, regulation_id: str) -> None:
        self._delete(regulation_id)

    def link_clause(
        self,
        regulation_id: str,
        payload: dict[str, object],
    ) -> RegulationClauseReference:
        return self._post_at(
            f"{self._base}/{regulation_id}/clauses",
            RegulationClauseReference,
            payload,
        )

    def unlink_clause(
        self,
        regulation_id: str,
        clause_id: str,
        *,
        reference_type: Optional[str] = None,
    ) -> None:
        path = f"{self._base}/{regulation_id}/clauses?clause_id={clause_id}"
        if reference_type is not None:
            path = f"{path}&reference_type={reference_type}"
        self._delete_at(path)
