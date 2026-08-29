/**
 * @deprecated Use `StatTile` from `@/components/shared/stat-tile` — the
 * canonical KPI primitive. (`shared/kpi-card` itself is now a thin adapter
 * over `StatTile`.) This file remains as a re-export so existing
 * `dashboard/kpi-card` imports keep working unchanged.
 */
export {
  KpiCard,
  type KpiCardProps,
  type KpiColorTheme,
  type KpiTrend,
} from '@/components/shared/kpi-card';
