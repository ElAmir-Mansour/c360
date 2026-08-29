"""AI drafting (AID-*) resource for the Watheeq/Lex suite."""

from __future__ import annotations

from typing import Any, Mapping

from clario360.models.common import PaginatedResponse
from clario360.models.drafting import (
    AssemblyResult,
    ClauseRewrite,
    ContractDraft,
    ContractSummary,
    FallbackSet,
    GeneratedClause,
    GlossaryResult,
    ObligationQAReview,
    PromptRunResult,
    PromptTemplate,
    RFPResponse,
    TranslationResult,
)
from clario360.resources._base import BaseResource


class DraftingResource(BaseResource[GeneratedClause]):
    """Generative contract/clause drafting endpoints.

    Generation methods call the governed per-tenant LLM (claude-opus-4-8);
    ``assemble`` is deterministic (conditional template logic).
    """

    def generate_clause(self, payload: Mapping[str, Any]) -> GeneratedClause:  # AID-01
        return self._post_at(f"{self._base}/clauses", GeneratedClause, payload)

    def draft_contract(self, payload: Mapping[str, Any]) -> ContractDraft:  # AID-02
        return self._post_at(f"{self._base}/contracts", ContractDraft, payload)

    def rewrite_clause(self, payload: Mapping[str, Any]) -> ClauseRewrite:  # AID-03
        return self._post_at(f"{self._base}/clauses/rewrite", ClauseRewrite, payload)

    def suggest_fallbacks(self, payload: Mapping[str, Any]) -> FallbackSet:  # AID-04
        return self._post_at(f"{self._base}/clauses/fallbacks", FallbackSet, payload)

    def translate(self, payload: Mapping[str, Any]) -> TranslationResult:  # AID-05
        return self._post_at(f"{self._base}/translate", TranslationResult, payload)

    def summarize(self, payload: Mapping[str, Any]) -> ContractSummary:  # AID-06
        return self._post_at(f"{self._base}/summary", ContractSummary, payload)

    def glossary(self, payload: Mapping[str, Any]) -> GlossaryResult:  # AID-07
        return self._post_at(f"{self._base}/glossary", GlossaryResult, payload)

    def assemble(self, payload: Mapping[str, Any]) -> AssemblyResult:  # AID-08
        return self._post_at(f"{self._base}/assemble", AssemblyResult, payload)

    def draft_rfp_response(self, payload: Mapping[str, Any]) -> RFPResponse:  # AID-10
        return self._post_at(f"{self._base}/rfp-response", RFPResponse, payload)

    def review_obligations(self, payload: Mapping[str, Any]) -> ObligationQAReview:  # AID-11
        return self._post_at(f"{self._base}/obligations/qa-review", ObligationQAReview, payload)

    # ---- AID-09: prompt library ----

    def list_prompts(self, *, page: int = 1, per_page: int = 50) -> PaginatedResponse[PromptTemplate]:
        return self._paginated_at(
            f"{self._base}/prompts", PromptTemplate, params={"page": page, "per_page": per_page}
        )

    def create_prompt(self, payload: Mapping[str, Any]) -> PromptTemplate:
        return self._post_at(f"{self._base}/prompts", PromptTemplate, payload)

    def get_prompt(self, prompt_id: str) -> PromptTemplate:
        return self._get_at(f"{self._base}/prompts/{prompt_id}", PromptTemplate)

    def update_prompt(self, prompt_id: str, payload: Mapping[str, Any]) -> PromptTemplate:
        return self._put_at(f"{self._base}/prompts/{prompt_id}", PromptTemplate, payload)

    def delete_prompt(self, prompt_id: str) -> None:
        self._http.delete(f"{self._base}/prompts/{prompt_id}")

    def run_prompt(self, prompt_id: str, variables: Mapping[str, Any]) -> PromptRunResult:
        return self._post_at(
            f"{self._base}/prompts/{prompt_id}/run", PromptRunResult, {"variables": variables}
        )
