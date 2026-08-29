from __future__ import annotations

from typing import Optional

from clario360.models.common import PaginatedResponse
from clario360.models.lex import (
    ComplianceAlert,
    ComplianceDashboard,
    ComplianceRule,
    ComplianceRunResult,
    ComplianceScore,
)
from clario360.resources._base import BaseResource


class ComplianceResource(BaseResource[ComplianceRule]):
    @property
    def _rules_base(self) -> str:
        if self._base.endswith("/rules"):
            return self._base
        return f"{self._base}/rules"

    @property
    def _compliance_base(self) -> str:
        if self._base.endswith("/rules"):
            return self._base.rsplit("/", 1)[0]
        return self._base

    def list(self, *, page: int = 1, per_page: int = 50) -> PaginatedResponse[ComplianceRule]:
        return self._paginated_at(
            self._rules_base,
            ComplianceRule,
            params={"page": page, "per_page": per_page},
        )

    def list_rules(self) -> list[ComplianceRule]:
        return self._list_models_at(self._rules_base, ComplianceRule)

    def create_rule(self, payload: dict[str, object]) -> ComplianceRule:
        return self._post_at(self._rules_base, ComplianceRule, payload)

    def update_rule(self, rule_id: str, payload: dict[str, object]) -> ComplianceRule:
        return self._put_at(f"{self._rules_base}/{rule_id}", ComplianceRule, payload)

    def delete_rule(self, rule_id: str) -> None:
        self._delete_at(f"{self._rules_base}/{rule_id}")

    def run(self, payload: Optional[dict[str, object]] = None) -> ComplianceRunResult:
        return self._post_at(f"{self._compliance_base}/run", ComplianceRunResult, payload or {})

    def list_alerts(
        self,
        *,
        page: int = 1,
        per_page: int = 50,
        status: Optional[str] = None,
        severity: Optional[str] = None,
    ) -> PaginatedResponse[ComplianceAlert]:
        return self._paginated_at(
            f"{self._compliance_base}/alerts",
            ComplianceAlert,
            params={"page": page, "per_page": per_page, "status": status, "severity": severity},
        )

    def alerts(self) -> list[ComplianceAlert]:
        return self._list_models_at(f"{self._compliance_base}/alerts", ComplianceAlert)

    def get_alert(self, alert_id: str) -> ComplianceAlert:
        return self._get_at(f"{self._compliance_base}/alerts/{alert_id}", ComplianceAlert)

    def update_alert_status(self, alert_id: str, payload: dict[str, object]) -> ComplianceAlert:
        return self._put_at(
            f"{self._compliance_base}/alerts/{alert_id}/status",
            ComplianceAlert,
            payload,
        )

    def dashboard(self) -> ComplianceDashboard:
        return self._get_at(f"{self._compliance_base}/dashboard", ComplianceDashboard)

    def score(self) -> ComplianceScore:
        return self._get_at(f"{self._compliance_base}/score", ComplianceScore)
