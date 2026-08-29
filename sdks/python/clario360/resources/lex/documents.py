from __future__ import annotations

from typing import List, Optional

from clario360.models.common import PaginatedResponse
from clario360.models.lex import DocumentBulkImportResult, DocumentRepositorySummary, DocumentVersion, LegalDocument
from clario360.resources._base import BaseResource


class DocumentsResource(BaseResource[LegalDocument]):
    def list(
        self,
        *,
        page: int = 1,
        per_page: int = 50,
        search: Optional[str] = None,
        type: Optional[str] = None,
        status: Optional[str] = None,
    ) -> PaginatedResponse[LegalDocument]:
        return self._list(
            params={
                "page": page,
                "per_page": per_page,
                "search": search,
                "type": type,
                "status": status,
            }
        )

    def get(self, document_id: str) -> LegalDocument:
        return self._get(document_id)

    def create(self, payload: dict[str, object]) -> LegalDocument:
        return self._create(payload)

    def update(self, document_id: str, payload: dict[str, object]) -> LegalDocument:
        return self._update(document_id, payload)

    def delete(self, document_id: str) -> None:
        self._delete(document_id)

    def repository_summary(self) -> DocumentRepositorySummary:
        return self._get_at(f"{self._base}/repository-summary", DocumentRepositorySummary)

    def bulk_import(self, payload: dict[str, object]) -> DocumentBulkImportResult:
        return self._post_at(f"{self._base}/bulk-import", DocumentBulkImportResult, payload)

    def upload_version(self, document_id: str, payload: dict[str, object]) -> List[DocumentVersion]:
        return self._post_list_at(f"{self._base}/{document_id}/upload", DocumentVersion, payload)

    def versions(self, document_id: str) -> List[DocumentVersion]:
        return self._list_models_at(f"{self._base}/{document_id}/versions", DocumentVersion)
