from __future__ import annotations

from typing import Optional

from clario360.models.common import PaginatedResponse
from clario360.models.lex import (
    Obligation,
    ObligationExtractionResult,
    ObligationNotificationOutboxItem,
    ObligationReminderDispatchResult,
    ObligationReminderEnqueueResult,
    ObligationReminderPlan,
)
from clario360.resources._base import BaseResource


class ObligationsResource(BaseResource[Obligation]):
    @property
    def _domain_base(self) -> str:
        return self._base.rsplit("/", 1)[0]

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
        matter_id: Optional[str] = None,
        due_before: Optional[str] = None,
        due_after: Optional[str] = None,
        overdue: Optional[bool] = None,
        tag: Optional[str] = None,
        sort: Optional[str] = None,
        order: Optional[str] = None,
    ) -> PaginatedResponse[Obligation]:
        return self._list(
            params=self._list_params(
                page=page,
                per_page=per_page,
                search=search,
                status=status,
                type=type,
                priority=priority,
                owner_user_id=owner_user_id,
                contract_id=contract_id,
                matter_id=matter_id,
                due_before=due_before,
                due_after=due_after,
                overdue=overdue,
                tag=tag,
                sort=sort,
                order=order,
            )
        )

    def list_by_contract(
        self,
        contract_id: str,
        *,
        page: int = 1,
        per_page: int = 50,
        search: Optional[str] = None,
        status: Optional[str] = None,
        type: Optional[str] = None,
        priority: Optional[str] = None,
        owner_user_id: Optional[str] = None,
        due_before: Optional[str] = None,
        due_after: Optional[str] = None,
        overdue: Optional[bool] = None,
        tag: Optional[str] = None,
        sort: Optional[str] = None,
        order: Optional[str] = None,
    ) -> PaginatedResponse[Obligation]:
        return self._paginated_at(
            f"{self._domain_base}/contracts/{contract_id}/obligations",
            Obligation,
            params=self._list_params(
                page=page,
                per_page=per_page,
                search=search,
                status=status,
                type=type,
                priority=priority,
                owner_user_id=owner_user_id,
                due_before=due_before,
                due_after=due_after,
                overdue=overdue,
                tag=tag,
                sort=sort,
                order=order,
            ),
        )

    def list_by_matter(
        self,
        matter_id: str,
        *,
        page: int = 1,
        per_page: int = 50,
        search: Optional[str] = None,
        status: Optional[str] = None,
        type: Optional[str] = None,
        priority: Optional[str] = None,
        owner_user_id: Optional[str] = None,
        due_before: Optional[str] = None,
        due_after: Optional[str] = None,
        overdue: Optional[bool] = None,
        tag: Optional[str] = None,
        sort: Optional[str] = None,
        order: Optional[str] = None,
    ) -> PaginatedResponse[Obligation]:
        return self._paginated_at(
            f"{self._domain_base}/matters/{matter_id}/obligations",
            Obligation,
            params=self._list_params(
                page=page,
                per_page=per_page,
                search=search,
                status=status,
                type=type,
                priority=priority,
                owner_user_id=owner_user_id,
                due_before=due_before,
                due_after=due_after,
                overdue=overdue,
                tag=tag,
                sort=sort,
                order=order,
            ),
        )

    def get(self, obligation_id: str) -> Obligation:
        return self._get(obligation_id)

    def create(self, payload: dict[str, object]) -> Obligation:
        return self._create(payload)

    def update(self, obligation_id: str, payload: dict[str, object]) -> Obligation:
        return self._update(obligation_id, payload)

    def delete(self, obligation_id: str) -> None:
        self._delete(obligation_id)

    def update_status(self, obligation_id: str, status: str) -> Obligation:
        return self._put_at(f"{self._base}/{obligation_id}/status", Obligation, {"status": status})

    def extract_from_contract(
        self,
        contract_id: str,
        payload: dict[str, object],
    ) -> ObligationExtractionResult:
        return self._post_at(
            f"{self._domain_base}/contracts/{contract_id}/obligations/extract",
            ObligationExtractionResult,
            payload,
        )

    def reminder_plan(
        self,
        *,
        as_of: Optional[str] = None,
        horizon_days: int = 30,
        include_escalations: bool = True,
    ) -> ObligationReminderPlan:
        return self._get_at(
            f"{self._base}/reminders",
            ObligationReminderPlan,
            params={
                "as_of": as_of,
                "horizon_days": horizon_days,
                "include_escalations": include_escalations,
            },
        )

    def mark_reminder_sent(
        self,
        obligation_id: str,
        payload: Optional[dict[str, object]] = None,
    ) -> Obligation:
        return self._post_at(
            f"{self._base}/{obligation_id}/reminders/sent",
            Obligation,
            payload or {},
        )

    def enqueue_reminders(
        self,
        payload: Optional[dict[str, object]] = None,
    ) -> ObligationReminderEnqueueResult:
        return self._post_at(
            f"{self._base}/reminders/enqueue",
            ObligationReminderEnqueueResult,
            payload or {},
        )

    def dispatch_outbox(
        self,
        payload: Optional[dict[str, object]] = None,
    ) -> ObligationReminderDispatchResult:
        return self._post_at(
            f"{self._base}/reminders/outbox/dispatch",
            ObligationReminderDispatchResult,
            payload or {},
        )

    def dispatch_outbox_item(
        self,
        outbox_id: str,
        payload: Optional[dict[str, object]] = None,
    ) -> ObligationReminderDispatchResult:
        return self._post_at(
            f"{self._base}/reminders/outbox/{outbox_id}/dispatch",
            ObligationReminderDispatchResult,
            payload or {},
        )

    def mark_reminder_delivery(
        self,
        outbox_id: str,
        payload: dict[str, object],
    ) -> ObligationNotificationOutboxItem:
        return self._post_at(
            f"{self._base}/reminders/outbox/{outbox_id}/delivery",
            ObligationNotificationOutboxItem,
            payload,
        )

    def mark_delivery(
        self,
        outbox_id: str,
        payload: dict[str, object],
    ) -> ObligationNotificationOutboxItem:
        return self.mark_reminder_delivery(outbox_id, payload)

    def _list_params(
        self,
        *,
        page: int,
        per_page: int,
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
        sort: Optional[str] = None,
        order: Optional[str] = None,
    ) -> dict[str, object]:
        return {
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
            "sort": sort,
            "order": order,
        }
