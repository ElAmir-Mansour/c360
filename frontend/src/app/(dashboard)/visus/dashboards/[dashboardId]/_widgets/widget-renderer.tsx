'use client';

import type { CSSProperties } from 'react';
import type {
  VisusWidget,
  VisusWidgetData,
  VisusKpiCardWidgetData,
  VisusGaugeWidgetData,
  VisusSparklineWidgetData,
  VisusTrendIndicatorWidgetData,
  VisusAlertFeedWidgetData,
  VisusSeriesWidgetData,
  VisusPieWidgetData,
  VisusTableWidgetData,
  VisusHeatmapWidgetData,
  VisusStatusGridWidgetData,
  VisusTextWidgetData,
} from '@/types/suites';
import { useWidgetData } from './use-widget-data';
import { WidgetShell } from './widget-shell';
import { KpiCardWidget, TrendIndicatorWidget, SparklineWidget } from './kpi-widgets';
import { GaugeWidget } from './gauge-widget';
import { SeriesChartWidget } from './series-chart-widget';
import { PieChartWidget, HeatmapWidget } from './distribution-widgets';
import { AlertFeedWidget, StatusGridWidget } from './feed-widgets';
import { TableWidget, TextWidget } from './table-text-widgets';
import { useVisusWidgetChromeLabels } from '../../../_lib/visus-i18n';

interface WidgetRendererProps {
  dashboardId: string;
  widget: VisusWidget;
  style?: CSSProperties;
  className?: string;
  onEdit: (widget: VisusWidget) => void;
  onDelete: (widget: VisusWidget) => void;
  onPreviewRaw: (widget: VisusWidget) => void;
}

/**
 * Turns one widget definition into a live-rendered visualization. Fetches the
 * widget's data on its own refresh cadence, frames it in {@link WidgetShell},
 * and dispatches on `widget.type` to the matching body. Unknown types fall back
 * to a small notice rather than crashing the grid.
 */
export function WidgetRenderer({
  dashboardId,
  widget,
  style,
  className,
  onEdit,
  onDelete,
  onPreviewRaw,
}: WidgetRendererProps) {
  const t = useVisusWidgetChromeLabels();
  const query = useWidgetData(dashboardId, widget);
  const common = {
    widget,
    isLoading: query.isLoading,
    isError: query.isError,
    onRetry: () => void query.refetch(),
  };
  const data = query.data as VisusWidgetData | undefined;

  return (
    <WidgetShell
      widget={widget}
      style={style}
      className={className}
      onEdit={onEdit}
      onDelete={onDelete}
      onPreviewRaw={onPreviewRaw}
    >
      {renderBody()}
    </WidgetShell>
  );

  function renderBody() {
    switch (widget.type) {
      case 'kpi_card':
        return <KpiCardWidget {...common} data={data as VisusKpiCardWidgetData | undefined} />;
      case 'trend_indicator':
        return <TrendIndicatorWidget {...common} data={data as VisusTrendIndicatorWidgetData | undefined} />;
      case 'sparkline':
        return <SparklineWidget {...common} data={data as VisusSparklineWidgetData | undefined} />;
      case 'gauge':
        return <GaugeWidget {...common} data={data as VisusGaugeWidgetData | undefined} />;
      case 'line_chart':
      case 'area_chart':
      case 'bar_chart':
        return <SeriesChartWidget {...common} data={data as VisusSeriesWidgetData | undefined} />;
      case 'pie_chart':
        return <PieChartWidget {...common} data={data as VisusPieWidgetData | undefined} />;
      case 'heatmap':
        return <HeatmapWidget {...common} data={data as VisusHeatmapWidgetData | undefined} />;
      case 'alert_feed':
        return <AlertFeedWidget {...common} data={data as VisusAlertFeedWidgetData | undefined} />;
      case 'status_grid':
        return <StatusGridWidget {...common} data={data as VisusStatusGridWidgetData | undefined} />;
      case 'table':
        return <TableWidget {...common} data={data as VisusTableWidgetData | undefined} />;
      case 'text':
        return <TextWidget {...common} data={data as VisusTextWidgetData | undefined} />;
      default:
        return (
          <p className="py-6 text-center text-xs text-muted-foreground">
            {t.unsupportedType(widget.type)}
          </p>
        );
    }
  }
}
