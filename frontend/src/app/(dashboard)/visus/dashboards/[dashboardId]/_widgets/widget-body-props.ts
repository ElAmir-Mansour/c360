import type { VisusWidget } from '@/types/suites';

/**
 * Props every widget-body component receives from {@link WidgetRenderer}.
 *
 * `data` is the live payload from `GET /dashboards/{id}/widgets/{id}/data`,
 * already selected by the renderer's `widget.type` switch. Each body narrows it
 * to its specific `Visus*WidgetData` shape via the generic parameter, e.g.
 * `WidgetBodyProps<VisusKpiCardWidgetData>`. It is `undefined` until the first
 * fetch resolves — bodies must handle `isLoading` / `isError` / empty.
 */
export interface WidgetBodyProps<T> {
  widget: VisusWidget;
  data: T | undefined;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
}
