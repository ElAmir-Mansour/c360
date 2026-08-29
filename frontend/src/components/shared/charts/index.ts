/**
 * Shared charts barrel — the ONE import surface for platform charts.
 *
 *   import { LineChart, ChartLegend, ChartTooltip } from '@/components/shared/charts';
 *
 * The chart components (Area/Bar/Line/Pie/Gauge) are lazy wrappers: recharts is
 * code-split out of the initial bundle and only loads when a chart renders.
 * Series colors default to the categorical `--chart-1..6` token ramp (via the
 * design-tokens JS mirror), axes/grid/tooltip/legend all ride the shared
 * chart-theme, and every wrapper ships loading / empty / error states plus
 * RTL-aware axis orientation out of the box.
 */

export { AreaChart } from './area-chart';
export { BarChart } from './bar-chart';
export { LineChart } from './line-chart';
export { PieChart } from './pie-chart';
export { GaugeChart } from './gauge-chart';

export { ChartContainer, isEmptyChartData } from './chart-container';
export { ChartTooltip } from './chart-tooltip';
export { ChartLegend } from './chart-legend';
export type { ChartLegendItem, ChartLegendProps } from './chart-legend';

export {
  AXIS_TICK_STYLE,
  CHART_TICK_FONT_SIZE,
  CURSOR_FILL,
  CURSOR_STROKE,
  GRID_DASH,
  GRID_STROKE,
  chartMargin,
  seriesColorAt,
  useChartDir,
} from './chart-theme';
export type { ChartDir, ChartMargin } from './chart-theme';

// Token color helpers (JS mirror of --chart-* / --severity-* / --status-*):
// re-exported so chart callers can theme series without a second import.
export { chartVar, severityVar, statusVar } from '@/lib/design-tokens';
