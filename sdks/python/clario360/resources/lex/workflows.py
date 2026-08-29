from __future__ import annotations

from clario360.models.common import PaginatedResponse
from clario360.models.lex import (
    ApprovalPolicy,
    ApprovalPolicyAnalytics,
    ApprovalPolicyRecommendationResult,
    LegalWorkflowBulkDecisionResult,
    LegalWorkflowDecisionResult,
    LegalWorkflowSummary,
)
from clario360.resources._base import BaseResource


class WorkflowsResource(BaseResource[LegalWorkflowSummary]):
    @property
    def _approval_policy_base(self) -> str:
        return f"{self._base.rsplit('/', 1)[0]}/workflow-policies/approval"

    def list(self, *, page: int = 1, per_page: int = 50) -> PaginatedResponse[LegalWorkflowSummary]:
        return self._list(params={"page": page, "per_page": per_page})

    def decide_task(
        self,
        workflow_instance_id: str,
        task_id: str,
        payload: dict[str, object],
    ) -> LegalWorkflowDecisionResult:
        return self._post_at(
            f"{self._base}/{workflow_instance_id}/tasks/{task_id}/decision",
            LegalWorkflowDecisionResult,
            payload,
        )

    def bulk_decide_tasks(self, payload: dict[str, object]) -> LegalWorkflowBulkDecisionResult:
        return self._post_at(
            f"{self._base}/tasks/bulk-decision",
            LegalWorkflowBulkDecisionResult,
            payload,
        )

    def bulk_decide(self, payload: dict[str, object]) -> LegalWorkflowBulkDecisionResult:
        return self.bulk_decide_tasks(payload)

    def list_approval_policies(self) -> list[ApprovalPolicy]:
        return self._list_models_at(self._approval_policy_base, ApprovalPolicy)

    def approval_policy_analytics(self) -> ApprovalPolicyAnalytics:
        return self._get_at(f"{self._approval_policy_base}/analytics", ApprovalPolicyAnalytics)

    def create_approval_policy(self, payload: dict[str, object]) -> ApprovalPolicy:
        return self._post_at(self._approval_policy_base, ApprovalPolicy, payload)

    def recommend_approval_policy(self, contract_id: str) -> ApprovalPolicyRecommendationResult:
        return self._get_at(
            f"{self._approval_policy_base}/recommend",
            ApprovalPolicyRecommendationResult,
            params={"contract_id": contract_id},
        )
