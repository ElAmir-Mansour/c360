'use client';

/**
 * Real analytics KPI header for the Legal Service Desk list page (feature #2).
 *
 * Replaces the previous client-computed `stats` block (which only saw the loaded
 * page) with the server-side Legal Affairs dashboard report. Every sub-report is
 * nullable, so every field is read through nullish-guarded defaults.
 *
 * KPIs rendered:
 *   - Total requests        — from the list `totalRows` (passed in)
 *   - SLA compliance %      — sla_compliance.overall_rate_pct vs target_pct
 *                             (emerald when overall_meets_target, else rose)
 *   - Overdue requests      — performance.overdue_requests
 *   - Avg processing hours  — performance.avg_request_processing_hours (1 dp)
 *   - Closed-case ratio     — performance.closed_case_ratio as a %
 */

import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Clock, FileText, PieChart } from 'lucide-react';
import { StatTile } from '@/components/shared/stat-tile';
import { lexRequestsApi } from '@/lib/lex/requests';
import { useLexFormat } from '@/lib/lex/ksa';
import { useListExtraLabels } from './list-extra-labels';

interface ListKpiHeaderProps {
  /** Total matched rows from the list query (authoritative count). */
  totalRows: number;
  /** Whether the list itself is still loading its first page. */
  listLoading: boolean;
}

/** Round to a fixed number of decimals, tolerating null/NaN inputs. */
function fixed(value: number | null | undefined, decimals = 0): string {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  return n.toFixed(decimals);
}

function percent(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((part / whole) * 100)));
}

export function ListKpiHeader({ totalRows, listLoading }: ListKpiHeaderProps) {
  const labels = useListExtraLabels();
  const t = labels.kpis;
  const d = labels.kpiDetails;
  const f = useLexFormat();

  const { data, isLoading } = useQuery({
    queryKey: ['lex-legal-affairs-dashboard'],
    queryFn: () => lexRequestsApi.getLegalAffairsDashboard(),
    staleTime: 60_000,
  });

  // Every sub-report is nullable; guard each field.
  const sla = data?.sla_compliance ?? null;
  const perf = data?.performance ?? null;

  const overallRate = sla?.overall_rate_pct ?? 0;
  const targetPct = sla?.target_pct ?? 90;
  const meetsTarget = sla?.overall_meets_target ?? false;

  const overdue = perf?.overdue_requests ?? 0;
  const avgProcessing = perf?.avg_request_processing_hours ?? 0;
  // closed_case_ratio is a 0..1 fraction → render as a percentage.
  const closedRatioPct = (perf?.closed_case_ratio ?? 0) * 100;

  const cardsLoading = isLoading && !data;

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
      <StatTile
        label={t.total}
        value={f.formatNumber(totalRows)}
        themeClass="kpi-theme-primary"
        icon={FileText}
        progress={totalRows > 0 ? 100 : 0}
        progressLabel={d.requestShare}
        detail={d.currentQueue}
        detailValue={f.formatNumber(totalRows)}
        loading={listLoading && totalRows === 0}
        size="md"
        appearance="operational"
        href="/lex/service-desk"
      />
      <StatTile
        label={t.slaCompliance}
        value={`${fixed(overallRate, 1)}%`}
        themeClass={meetsTarget ? 'kpi-theme-emerald' : 'kpi-theme-red'}
        icon={CheckCircle2}
        progress={overallRate}
        progressLabel={d.slaTarget}
        detail={d.slaTarget}
        detailValue={`${f.formatNumber(Math.round(targetPct))}%`}
        loading={cardsLoading}
        size="md"
        appearance="operational"
        href="/lex/service-desk/sla-board"
      />
      <StatTile
        label={t.overdue}
        value={f.formatNumber(overdue)}
        themeClass="kpi-theme-red"
        icon={AlertTriangle}
        progress={percent(overdue, totalRows)}
        progressLabel={d.requestShare}
        detail={t.overdue}
        detailValue={`${f.formatNumber(percent(overdue, totalRows))}%`}
        loading={cardsLoading}
        size="md"
        appearance="operational"
        href="/lex/service-desk/sla-board?breached=true"
      />
      <StatTile
        label={t.avgProcessing}
        value={fixed(avgProcessing, 1)}
        themeClass="kpi-theme-amber"
        icon={Clock}
        detail={d.performanceSignal}
        detailValue={fixed(avgProcessing, 1)}
        loading={cardsLoading}
        size="md"
        appearance="operational"
        href="/lex/reports/analytics"
      />
      <StatTile
        label={t.closedRatio}
        value={`${fixed(closedRatioPct, 0)}%`}
        themeClass="kpi-theme-emerald"
        icon={PieChart}
        progress={closedRatioPct}
        progressLabel={d.requestShare}
        detail={t.closedRatio}
        detailValue={`${fixed(closedRatioPct, 0)}%`}
        loading={cardsLoading}
        size="md"
        appearance="operational"
        href="/lex/reports/analytics"
      />
    </div>
  );
}
