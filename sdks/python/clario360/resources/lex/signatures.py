from __future__ import annotations

from typing import Optional

from clario360.models.common import PaginatedResponse
from clario360.models.lex import SignatureEnvelope
from clario360.resources._base import BaseResource


class SignaturesResource(BaseResource[SignatureEnvelope]):
    def list(
        self,
        *,
        page: int = 1,
        per_page: int = 50,
        search: Optional[str] = None,
        status: Optional[str] = None,
        provider: Optional[str] = None,
        method: Optional[str] = None,
        contract_id: Optional[str] = None,
        document_id: Optional[str] = None,
        sort: Optional[str] = None,
        order: Optional[str] = None,
    ) -> PaginatedResponse[SignatureEnvelope]:
        return self._list(
            params={
                "page": page,
                "per_page": per_page,
                "search": search,
                "status": status,
                "provider": provider,
                "method": method,
                "contract_id": contract_id,
                "document_id": document_id,
                "sort": sort,
                "order": order,
            }
        )

    def get(self, envelope_id: str) -> SignatureEnvelope:
        return self._get(envelope_id)

    def create(self, payload: dict[str, object]) -> SignatureEnvelope:
        return self._create(payload)

    def send(self, envelope_id: str, payload: dict[str, object]) -> SignatureEnvelope:
        return self._post_at(f"{self._base}/{envelope_id}/send", SignatureEnvelope, payload)

    def cancel(self, envelope_id: str, payload: dict[str, object]) -> SignatureEnvelope:
        return self._post_at(f"{self._base}/{envelope_id}/cancel", SignatureEnvelope, payload)

    def custody(self, envelope_id: str, payload: dict[str, object]) -> SignatureEnvelope:
        return self._post_at(f"{self._base}/{envelope_id}/custody", SignatureEnvelope, payload)

    def recipient_action(
        self,
        envelope_id: str,
        recipient_id: str,
        payload: dict[str, object],
    ) -> SignatureEnvelope:
        return self._post_at(
            f"{self._base}/{envelope_id}/recipients/{recipient_id}/actions",
            SignatureEnvelope,
            payload,
        )

    def provider_event(self, envelope_id: str, payload: dict[str, object]) -> SignatureEnvelope:
        return self._post_at(
            f"{self._base}/{envelope_id}/provider-events",
            SignatureEnvelope,
            payload,
        )
