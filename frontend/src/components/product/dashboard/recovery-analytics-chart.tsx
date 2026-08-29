'use client';

import dynamic from 'next/dynamic';
import { RECOVERY_CHART_HEIGHT } from './recovery-utils';

export type {
  RecoveryAnalyticsChartProps,
  RecoveryAnalyticsPoint,
} from './recovery-analytics-chart-impl';

/**
 * Lazy wrapper for the recovery analytics chart. recharts (~150KB) is code-split
 * out of the base bundle and only fetched when this chart actually renders, so
 * the recovery dashboards stay light on first paint. Mirrors the established
 * shared/charts split pattern. `ssr: false` keeps recharts off the server path;
 * the placeholder reserves layout height to avoid CLS.
 */
export const RecoveryAnalyticsChart = dynamic(
  () => import('./recovery-analytics-chart-impl').then((m) => m.RecoveryAnalyticsChart),
  {
    ssr: false,
    loading: () => (
      <div
        className="w-full animate-pulse rounded-card bg-bg-inset"
        style={{ height: RECOVERY_CHART_HEIGHT }}
        aria-hidden
        data-testid="recovery-analytics-chart-loading"
      />
    ),
  },
);
