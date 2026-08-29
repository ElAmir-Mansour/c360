from __future__ import annotations

from clario360.models.lex import LexDashboard
from clario360.resources._base import BaseResource


class DashboardResource(BaseResource[LexDashboard]):
    def get(self) -> LexDashboard:
        return self._get_at(self._base, LexDashboard)
