'use client';

import { useQuery } from '@tanstack/react-query';
import { enterpriseApi } from '@/lib/enterprise';
import type { VisusWidget, VisusWidgetData } from '@/types/suites';

/**
 * Fetches a single widget's live data payload and keeps it fresh on the widget's
 * own `refresh_interval_seconds` cadence (React Query `refetchInterval`). Each
 * widget owns its query key so one slow/failing suite never blocks the others —
 * the dashboard degrades widget-by-widget rather than all-or-nothing.
 */
export function useWidgetData(dashboardId: string, widget: VisusWidget) {
  const refreshMs = widget.refresh_interval_seconds > 0 ? widget.refresh_interval_seconds * 1000 : 0;
  return useQuery<VisusWidgetData>({
    queryKey: ['visus-widget-data', dashboardId, widget.id],
    queryFn: () => enterpriseApi.visus.getWidgetData(dashboardId, widget.id),
    refetchInterval: refreshMs > 0 ? refreshMs : false,
    staleTime: refreshMs > 0 ? Math.floor(refreshMs / 2) : 30_000,
  });
}
