/**
 * Settlement portfolio analytics + proper report export (FEATURES 1 + 3).
 *
 * Renders the `getSettlementReport(params)` payload (`SettlementReport`) as a
 * premium, RTL-aware analytics panel that mirrors `matter-analytics.tsx`:
 *
 *   - KPI tiles: settled value (Σ executed), value at risk (Σ pending_approval),
 *     average settlement value, settlement count, and recovery / abandon rate.
 *   - Charts: value by method (pie), status funnel (horizontal bar), and a
 *     cycle-time / settled-value signal group (executed turnaround days).
 *   - Optional CSV export via the same report endpoint (`?format=csv`).
 *
 * It ALSO exports two helpers the LIST page consumes so its KPIs become
 * SERVER-accurate (i.e. across the whole filtered result set, not just the
 * currently-loaded page the old `countByStatus(data)` summed):
 *
 *   - `useSettlementReport(params)`   — the shared react-query read hook.
 *   - `SettlementKpiTiles`            — a drop-in KPI row driven by the report.
 *
 * Self-contained bilingual labels (English + professional MSA) follow the
 * canonical lex bilingual contract. Legal glossary: تسوية (settlement) /
 * صلح (reconciliation) / وساطة (mediation) / تحكيم (arbitration) /
 * تفاوض (negotiation) / اعتماد (approval) / قيمة (value).
 *
 * fe-client ownership: the report client method lives in the integrator-owned
 * settlement client (`@/lib/lex/settlements`) under the agreed names
 * `settlementsApi.getReport(params)` / `settlementsApi.exportReportCsv(params)`.
 * This module references those names through a defensive accessor and falls
 * back to a local `apiGet`/`api` call against `/api/v1/lex/reports/settlements`
 * so it compiles and renders independently of the fe-client edit ordering.
 */

'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  BarChart3,
  ChevronDown,
  CircleDollarSign,
  Clock,
  Download,
  Handshake,
  Hourglass,
  Loader2,
  Percent,
  ShieldAlert,
  TrendingUp,
} from 'lucide-react';

import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { SectionCard } from '@/components/suites/section-card';
import { BarChart } from '@/components/shared/charts/bar-chart';
import { PieChart } from '@/components/shared/charts/pie-chart';
import { StatTile } from '@/components/shared/stat-tile';
import {
  SourceRecordsDrilldown,
  type AnalyticsSourceSelection,
} from '../../analytics/_components/source-records-drilldown';
import { Button } from '@/components/ui/button';
import api, { apiGet } from '@/lib/api';
import {
  CHART_COLORS,
  SEVERITY_COLORS,
  STATUS_COLORS as STATUS_TONE_COLORS,
} from '@/lib/design-tokens';
import { downloadBlob } from '@/lib/format';
import { useLexFormat } from '@/lib/lex/ksa';
import type { LexFormatter } from '@/lib/lex/ksa';
import { showApiError, showSuccess } from '@/lib/toast';
import type { AppLocale } from '@/lib/i18n';
import type { FetchParams } from '@/types/table';
import {
  formatSettlementValue,
  settlementsApi,
  SETTLEMENT_METHOD_VALUES,
  SETTLEMENT_STATUS_VALUES,
  type SettlementMethod,
  type SettlementStatus,
} from '@/lib/lex/settlements';
import { type LexBilingual, resolveLexBilingual } from '../../_lib/lex-i18n';

/* ------------------------------------------------------------------------- *
 * Report contract (mirrors backend model.SettlementReport — FEATURES 1 + 3).
 *
 * Defined locally so the panel compiles independently of the fe-client edit
 * ordering; once `@/lib/lex/settlements` exports an identical `SettlementReport`
 * the integrator can swap this alias for the imported type verbatim.
 * ------------------------------------------------------------------------- */

/** One PII-free settlement line item on a {@link SettlementReport}. */
export interface SettlementReportLineItem {
  id: string;
  reference: string;
  matter_id: string;
  title: string;
  status: SettlementStatus;
  method: SettlementMethod;
  value?: number | null;
  currency?: string | null;
  approved_at?: string | null;
  executed_at?: string | null;
  created_at: string;
}

/** create->execute turnaround stats over executed settlements (whole-ish days). */
export interface SettlementCycleTime {
  executed_count: number;
  avg_days: number;
  min_days: number;
  max_days: number;
}

/** The aggregated Settlements / ADR analytics report. */
export interface SettlementReport {
  generated_at: string;
  total: number;
  filters: Partial<Record<'search' | 'status' | 'method' | 'matter_id', string>>;
  settlements: SettlementReportLineItem[];
  by_status: Record<string, number>;
  by_method: Record<string, number>;
  value_by_status: Record<string, number>;
  settled_value: number;
  value_at_risk: number;
  total_value: number;
  valued_count: number;
  average_value: number;
  cycle_time: SettlementCycleTime;
}

/* ------------------------------------------------------------------------- *
 * Report client — references the agreed fe-client method names, with a local
 * fallback so this module never blocks on the parallel settlements.ts edit.
 * ------------------------------------------------------------------------- */

const SETTLEMENT_REPORT_ENDPOINT = '/api/v1/lex/reports/settlements';

/** Agreed fe-client report surface (lands on `settlementsApi` in parallel). */
type SettlementReportApi = {
  getReport?: (params: FetchParams) => Promise<SettlementReport>;
  exportReportCsv?: (params: FetchParams) => Promise<Blob>;
};

function reportApi(): SettlementReportApi {
  return settlementsApi as unknown as typeof settlementsApi & SettlementReportApi;
}

/** Flatten FetchParams (filters/search/sort) into the report query string. */
function buildReportQuery(params: FetchParams): Record<string, unknown> {
  const query: Record<string, unknown> = {
    page: params.page,
    per_page: params.per_page,
    sort: params.sort,
    order: params.order,
    search: params.search,
  };
  for (const [key, value] of Object.entries(params.filters ?? {})) {
    if (value === undefined || value === '' || (Array.isArray(value) && value.length === 0)) {
      continue;
    }
    query[key] = Array.isArray(value) ? value.join(',') : value;
  }
  return query;
}

/** Fetch the settlement report, preferring the fe-client method when present. */
async function fetchSettlementReport(params: FetchParams): Promise<SettlementReport> {
  const client = reportApi();
  if (typeof client.getReport === 'function') {
    return client.getReport(params);
  }
  const envelope = await apiGet<{ data: SettlementReport }>(
    SETTLEMENT_REPORT_ENDPOINT,
    buildReportQuery(params),
  );
  return envelope.data;
}

/** Download the CSV line-item export, preferring the fe-client method. */
async function fetchSettlementReportCsv(params: FetchParams): Promise<Blob> {
  const client = reportApi();
  if (typeof client.exportReportCsv === 'function') {
    return client.exportReportCsv(params);
  }
  const response = await api.get<Blob>(SETTLEMENT_REPORT_ENDPOINT, {
    params: { ...buildReportQuery(params), format: 'csv' },
    responseType: 'blob',
  });
  return response.data;
}

const DEFAULT_PARAMS: FetchParams = { page: 1, per_page: 200 };

/**
 * useSettlementReport is the shared react-query read hook for the Settlements /
 * ADR report. BOTH the analytics panel and the list-page KPI tiles read through
 * it so they share one cached fetch per filter set.
 */
export function useSettlementReport(params?: FetchParams, options?: { enabled?: boolean }) {
  const reportParams = params ?? DEFAULT_PARAMS;
  return useQuery<SettlementReport>({
    queryKey: ['lex-settlements', 'report', reportParams],
    queryFn: () => fetchSettlementReport(reportParams),
    enabled: options?.enabled ?? true,
  });
}

/* ------------------------------------------------------------------------- *
 * Bilingual labels — self-contained per the lex contract.
 * ------------------------------------------------------------------------- */

interface SettlementAnalyticsLabels {
  title: string;
  description: string;
  generatedAt: (date: string) => string;
  totalScope: (count: string) => string;
  export: string;
  exporting: string;
  exportFileName: string;
  loadError: string;
  retry: string;
  emptyTitle: string;
  emptyDescription: string;
  kpis: {
    settledValue: string;
    settledValueHelper: string;
    valueAtRisk: string;
    valueAtRiskHelper: string;
    averageValue: string;
    averageValueHelper: (count: string) => string;
    count: string;
    countHelper: string;
    recoveryRate: string;
    recoveryRateHelper: string;
    abandonRate: string;
    abandonRateHelper: string;
  };
  byMethod: { title: string; description: string; empty: string };
  byStatus: { title: string; description: string; empty: string };
  cycle: {
    title: string;
    description: string;
    executedCount: string;
    executedCountHelper: string;
    avgDays: string;
    avgDaysHelper: string;
    minDays: string;
    maxDays: string;
    fastestHelper: string;
    slowestHelper: string;
    totalValue: string;
    totalValueHelper: string;
    days: (n: string) => string;
    none: string;
  };
  statusOptions: Record<string, string>;
  methodOptions: Record<string, string>;
}

const settlementAnalyticsLabelsBundle: LexBilingual<SettlementAnalyticsLabels> = {
  en: {
    title: 'Settlement Analytics',
    description: 'Realised value, value at risk, and ADR mix across the settlement register.',
    generatedAt: (date) => `Generated ${date}`,
    totalScope: (count) => `${count} settlements in scope`,
    export: 'Export report (CSV)',
    exporting: 'Exporting...',
    exportFileName: 'lex-settlement-report',
    loadError: 'Failed to load settlement analytics.',
    retry: 'Retry',
    emptyTitle: 'No settlements in scope',
    emptyDescription: 'No settlements matched the current filters, so there is nothing to chart.',
    kpis: {
      settledValue: 'Settled value',
      settledValueHelper: 'Realised value of executed settlements',
      valueAtRisk: 'Value at risk',
      valueAtRiskHelper: 'Value awaiting approval',
      averageValue: 'Average value',
      averageValueHelper: (count) => `Across ${count} valued settlements`,
      count: 'Settlements',
      countHelper: 'Matching the active filters',
      recoveryRate: 'Recovery rate',
      recoveryRateHelper: 'Executed share of all settlements',
      abandonRate: 'Abandon rate',
      abandonRateHelper: 'Rejected or abandoned share',
    },
    byMethod: {
      title: 'Value by Method',
      description: 'Settled and in-flight value across ADR methods.',
      empty: 'No method data available.',
    },
    byStatus: {
      title: 'Status Funnel',
      description: 'Settlement volume across the FSM lifecycle.',
      empty: 'No status data available.',
    },
    cycle: {
      title: 'Cycle Time & Realised Value',
      description: 'How long settlements take to execute, and the value they carry.',
      executedCount: 'Executed',
      executedCountHelper: 'Settlements reaching execution',
      avgDays: 'Avg cycle time',
      avgDaysHelper: 'Open to execute, executed settlements',
      minDays: 'Fastest',
      maxDays: 'Slowest',
      fastestHelper: 'Quickest execution',
      slowestHelper: 'Longest execution',
      totalValue: 'Total value',
      totalValueHelper: 'Across all matching settlements',
      days: (n) => `${n} days`,
      none: '—',
    },
    statusOptions: {
      proposed: 'Proposed',
      negotiating: 'Negotiating',
      pending_approval: 'Pending approval',
      approved: 'Approved',
      executed: 'Executed',
      rejected: 'Rejected',
      abandoned: 'Abandoned',
    },
    methodOptions: {
      reconciliation: 'Reconciliation',
      mediation: 'Mediation',
      arbitration: 'Arbitration',
      negotiation: 'Negotiation',
      other: 'Other',
    },
  },
  ar: {
    title: 'تحليلات التسويات',
    description: 'القيمة المحقّقة والقيمة المعرّضة للخطر ومزيج أساليب حل النزاع عبر سجل التسويات.',
    generatedAt: (date) => `أُنشئ في ${date}`,
    totalScope: (count) => `${count} تسوية ضمن النطاق`,
    export: 'تصدير التقرير (CSV)',
    exporting: 'جارٍ التصدير...',
    exportFileName: 'تقرير-التسويات',
    loadError: 'تعذّر تحميل تحليلات التسويات.',
    retry: 'إعادة المحاولة',
    emptyTitle: 'لا توجد تسويات ضمن النطاق',
    emptyDescription: 'لا توجد تسويات مطابقة للمرشّحات الحالية، لذا لا توجد بيانات للعرض.',
    kpis: {
      settledValue: 'القيمة المسوّاة',
      settledValueHelper: 'القيمة المحقّقة للتسويات المنفّذة',
      valueAtRisk: 'القيمة المعرّضة للخطر',
      valueAtRiskHelper: 'القيمة بانتظار الاعتماد',
      averageValue: 'متوسط القيمة',
      averageValueHelper: (count) => `عبر ${count} تسوية ذات قيمة`,
      count: 'التسويات',
      countHelper: 'مطابقة للمرشّحات الحالية',
      recoveryRate: 'معدّل التحصيل',
      recoveryRateHelper: 'نسبة المنفّذة من جميع التسويات',
      abandonRate: 'معدّل التخلّي',
      abandonRateHelper: 'نسبة المرفوضة أو المتروكة',
    },
    byMethod: {
      title: 'القيمة حسب الأسلوب',
      description: 'القيمة المسوّاة والجارية عبر أساليب حل النزاع.',
      empty: 'لا توجد بيانات أساليب متاحة.',
    },
    byStatus: {
      title: 'مسار الحالات',
      description: 'حجم التسويات عبر دورة الحياة.',
      empty: 'لا توجد بيانات حالات متاحة.',
    },
    cycle: {
      title: 'زمن الدورة والقيمة المحقّقة',
      description: 'المدة اللازمة لتنفيذ التسويات والقيمة التي تحملها.',
      executedCount: 'منفّذة',
      executedCountHelper: 'التسويات التي بلغت التنفيذ',
      avgDays: 'متوسط زمن الدورة',
      avgDaysHelper: 'من الفتح إلى التنفيذ، للتسويات المنفّذة',
      minDays: 'الأسرع',
      maxDays: 'الأبطأ',
      fastestHelper: 'أسرع تنفيذ',
      slowestHelper: 'أطول تنفيذ',
      totalValue: 'إجمالي القيمة',
      totalValueHelper: 'عبر جميع التسويات المطابقة',
      days: (n) => `${n} يومًا`,
      none: '—',
    },
    statusOptions: {
      proposed: 'مقترحة',
      negotiating: 'قيد التفاوض',
      pending_approval: 'بانتظار الاعتماد',
      approved: 'معتمدة',
      executed: 'منفّذة',
      rejected: 'مرفوضة',
      abandoned: 'متروكة',
    },
    methodOptions: {
      reconciliation: 'صلح',
      mediation: 'وساطة',
      arbitration: 'تحكيم',
      negotiation: 'تفاوض',
      other: 'أخرى',
    },
  },
};

function useSettlementAnalyticsLabels(): SettlementAnalyticsLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(
    () => resolveLexBilingual(settlementAnalyticsLabelsBundle, locale),
    [locale],
  );
}

/* ------------------------------------------------------------------------- *
 * Palettes + derivation helpers.
 * ------------------------------------------------------------------------- */

const STATUS_COLORS: Record<string, string> = {
  proposed: CHART_COLORS[4],
  negotiating: CHART_COLORS[2],
  pending_approval: SEVERITY_COLORS.high,
  approved: CHART_COLORS[0],
  executed: CHART_COLORS[1],
  rejected: STATUS_TONE_COLORS.error,
  abandoned: STATUS_TONE_COLORS.neutral,
};

const METHOD_PALETTE: Record<string, string> = {
  reconciliation: CHART_COLORS[1],
  mediation: CHART_COLORS[0],
  arbitration: CHART_COLORS[4],
  negotiation: CHART_COLORS[2],
  other: STATUS_TONE_COLORS.neutral,
};

/** Series colour for the status-funnel bar chart (brand teal). */
const STATUS_BAR_COLOR: string = CHART_COLORS[0];

function formatToken(value: string): string {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Round a ratio to a whole-percent string, e.g. 42 -> "42%". Digits route
 * through {@link LexFormatter.formatNumber} so Arabic mode renders Arabic-Indic.
 */
function formatRatePct(numerator: number, denominator: number, f: LexFormatter): string {
  if (denominator <= 0) {
    return `${f.formatNumber(0)}%`;
  }
  return `${f.formatNumber(Math.round((numerator / denominator) * 100))}%`;
}

function percent(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((numerator / denominator) * 100)));
}

type SettlementRecordScope =
  | 'all'
  | 'valued'
  | 'executed'
  | 'at_risk'
  | 'abandoned'
  | { method: SettlementMethod }
  | { status: SettlementStatus };

function recordsForScope(
  report: SettlementReport | undefined,
  scope: SettlementRecordScope,
): SettlementReportLineItem[] {
  const rows = report?.settlements ?? [];
  if (scope === 'all') return rows;
  if (scope === 'valued') return rows.filter((row) => row.value != null);
  if (scope === 'executed') return rows.filter((row) => row.status === 'executed');
  if (scope === 'at_risk') return rows.filter((row) => row.status === 'pending_approval');
  if (scope === 'abandoned') {
    return rows.filter((row) => row.status === 'rejected' || row.status === 'abandoned');
  }
  if ('method' in scope) return rows.filter((row) => row.method === scope.method);
  return rows.filter((row) => row.status === scope.status);
}

function settlementSourceSelection(
  report: SettlementReport | undefined,
  title: string,
  scope: SettlementRecordScope,
): AnalyticsSourceSelection {
  return {
    title,
    records: recordsForScope(report, scope).map((row) => ({
      id: row.id,
      href: `/lex/settlements/${row.id}`,
      eyebrow: row.reference,
      title: row.title,
      status: row.status,
      details: [
        { label: 'Method', value: formatToken(row.method) },
        ...(row.value == null
          ? []
          : [{ label: 'Value', value: formatSettlementValue(row.value) }]),
      ],
    })),
  };
}

/** Ordered status-count pairs following the FSM lifecycle (funnel order). */
function statusBarsFromReport(
  report: SettlementReport | undefined,
  labels: SettlementAnalyticsLabels,
): { data: Array<Record<string, unknown>>; colors: string[] } {
  if (!report) {
    return { data: [], colors: [] };
  }
  const data: Array<Record<string, unknown>> = [];
  const colors: string[] = [];
  for (const status of SETTLEMENT_STATUS_VALUES) {
    const count = report.by_status?.[status] ?? 0;
    if (count <= 0) {
      continue;
    }
    data.push({ status: labels.statusOptions[status] ?? formatToken(status), count });
    colors.push(STATUS_COLORS[status] ?? STATUS_TONE_COLORS.neutral);
  }
  return { data, colors };
}

/**
 * Value-by-method pie slices. Prefers the realised/in-flight VALUE per method
 * when any method carries value; otherwise falls back to settlement COUNT per
 * method so the chart is never blank when values are undisclosed.
 */
function methodPieFromReport(
  report: SettlementReport | undefined,
  labels: SettlementAnalyticsLabels,
): { data: Array<{ name: string; value: number; color: string }>; valueMode: boolean } {
  if (!report) {
    return { data: [], valueMode: false };
  }
  // The report exposes value_by_status (not value_by_method); derive per-method
  // value from the line items, falling back to counts when no value is present.
  const valueByMethod = new Map<string, number>();
  for (const item of report.settlements ?? []) {
    if (item.value == null) {
      continue;
    }
    valueByMethod.set(item.method, (valueByMethod.get(item.method) ?? 0) + item.value);
  }
  const valueMode = Array.from(valueByMethod.values()).some((v) => v > 0);

  const data = SETTLEMENT_METHOD_VALUES.map((method) => {
    const value = valueMode
      ? valueByMethod.get(method) ?? 0
      : report.by_method?.[method] ?? 0;
    return {
      name: labels.methodOptions[method] ?? formatToken(method),
      value,
      color: METHOD_PALETTE[method] ?? STATUS_TONE_COLORS.neutral,
    };
  }).filter((slice) => slice.value > 0);

  return { data, valueMode };
}

/* ------------------------------------------------------------------------- *
 * KPI tiles — exported so the LIST page can render server-accurate numbers.
 * ------------------------------------------------------------------------- */

export interface SettlementKpiTilesProps {
  /** The active list FetchParams. The report mirrors what the user is viewing. */
  params?: FetchParams;
  /** Skip the fetch (e.g. before the page is ready). */
  enabled?: boolean;
  className?: string;
}

/**
 * SettlementKpiTiles renders the SERVER-accurate KPI row for the settlements
 * list. Unlike the old page-local `countByStatus(data)` (which only summed the
 * loaded page), every tile here reflects the full filtered result set returned
 * by the report endpoint. Drop it in where the page previously rendered its
 * compact KPI grid.
 */
export function SettlementKpiTiles({ params, enabled = true, className }: SettlementKpiTilesProps) {
  const labels = useSettlementAnalyticsLabels();
  const f = useLexFormat();
  const { data: report, isLoading } = useSettlementReport(params, { enabled });
  const [selection, setSelection] = useState<AnalyticsSourceSelection | null>(null);

  const total = report?.total ?? 0;
  const executed = report?.by_status?.executed ?? 0;
  const abandoned = (report?.by_status?.rejected ?? 0) + (report?.by_status?.abandoned ?? 0);
  const totalValue = report?.total_value ?? 0;
  const settledValue = report?.settled_value ?? 0;
  const valueAtRisk = report?.value_at_risk ?? 0;
  const valuedCount = report?.valued_count ?? 0;
  const recoveryRate = percent(executed, total);
  const abandonRate = percent(abandoned, total);

  const openRecords = (title: string, scope: SettlementRecordScope) =>
    setSelection(settlementSourceSelection(report, title, scope));

  return (
    <>
    <div
      className={
        className ??
        'settlement-analytics-kpi-grid grid grid-cols-2 gap-3 lg:grid-cols-3 2xl:grid-cols-6'
      }
    >
      <StatTile
        label={labels.kpis.settledValue}
        value={formatSettlementValue(settledValue)}
        themeClass="kpi-theme-emerald"
        icon={CircleDollarSign}
        progress={percent(settledValue, totalValue)}
        progressLabel={labels.kpis.recoveryRate}
        detail={labels.cycle.totalValue}
        detailValue={formatSettlementValue(totalValue)}
        loading={isLoading}
        size="md"
        appearance="operational"
        className="settlement-analytics-kpi-card"
        onAction={() => openRecords(labels.kpis.settledValue, 'executed')}
      />
      <StatTile
        label={labels.kpis.valueAtRisk}
        value={formatSettlementValue(valueAtRisk)}
        themeClass="kpi-theme-amber"
        icon={ShieldAlert}
        progress={percent(valueAtRisk, totalValue)}
        progressLabel={labels.kpis.valueAtRisk}
        detail={labels.cycle.totalValue}
        detailValue={formatSettlementValue(totalValue)}
        loading={isLoading}
        size="md"
        appearance="operational"
        className="settlement-analytics-kpi-card"
        onAction={() => openRecords(labels.kpis.valueAtRisk, 'at_risk')}
      />
      <StatTile
        label={labels.kpis.averageValue}
        value={formatSettlementValue(report?.average_value ?? 0)}
        themeClass="kpi-theme-primary"
        icon={TrendingUp}
        progress={percent(valuedCount, total)}
        progressLabel={labels.kpis.count}
        detail={labels.kpis.count}
        detailValue={f.formatNumber(valuedCount)}
        loading={isLoading}
        size="md"
        appearance="operational"
        className="settlement-analytics-kpi-card"
        onAction={() => openRecords(labels.kpis.averageValue, 'valued')}
      />
      <StatTile
        label={labels.kpis.count}
        value={f.formatNumber(total)}
        themeClass="kpi-theme-primary"
        icon={Handshake}
        progress={total > 0 ? 100 : 0}
        progressLabel={labels.kpis.count}
        detail={labels.totalScope(f.formatNumber(total))}
        loading={isLoading}
        size="md"
        appearance="operational"
        className="settlement-analytics-kpi-card"
        onAction={() => openRecords(labels.kpis.count, 'all')}
      />
      <StatTile
        label={labels.kpis.recoveryRate}
        value={formatRatePct(executed, total, f)}
        themeClass="kpi-theme-emerald"
        icon={Percent}
        progress={recoveryRate}
        progressLabel={labels.kpis.recoveryRate}
        detail={labels.cycle.executedCount}
        detailValue={f.formatNumber(executed)}
        loading={isLoading}
        size="md"
        appearance="operational"
        className="settlement-analytics-kpi-card"
        onAction={() => openRecords(labels.kpis.recoveryRate, 'executed')}
      />
      <StatTile
        label={labels.kpis.abandonRate}
        value={formatRatePct(abandoned, total, f)}
        themeClass="kpi-theme-red"
        icon={Percent}
        progress={abandonRate}
        progressLabel={labels.kpis.abandonRate}
        detail={labels.kpis.count}
        detailValue={f.formatNumber(abandoned)}
        loading={isLoading}
        size="md"
        appearance="operational"
        className="settlement-analytics-kpi-card"
        onAction={() => openRecords(labels.kpis.abandonRate, 'abandoned')}
      />
    </div>
    <SourceRecordsDrilldown
      selection={selection}
      onOpenChange={(open) => {
        if (!open) setSelection(null);
      }}
    />
    </>
  );
}

/* ------------------------------------------------------------------------- *
 * Analytics panel.
 * ------------------------------------------------------------------------- */

export interface SettlementAnalyticsPanelProps {
  /**
   * The active list FetchParams (filters/search/sort). The report mirrors what
   * the user is viewing. Defaults to a single broad page request when omitted.
   */
  params?: FetchParams;
  /** When true the panel renders collapsed and can be expanded inline. */
  defaultCollapsed?: boolean;
  className?: string;
}

export function SettlementAnalyticsPanel({
  params,
  defaultCollapsed = false,
  className,
}: SettlementAnalyticsPanelProps) {
  const labels = useSettlementAnalyticsLabels();
  const f = useLexFormat();
  const reportParams = params ?? DEFAULT_PARAMS;
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const [exporting, setExporting] = useState(false);
  const [selection, setSelection] = useState<AnalyticsSourceSelection | null>(null);

  const query = useSettlementReport(reportParams, { enabled: !collapsed });
  const report = query.data;

  const methodPie = useMemo(() => methodPieFromReport(report, labels), [report, labels]);
  const statusBars = useMemo(() => statusBarsFromReport(report, labels), [report, labels]);

  const total = report?.total ?? 0;
  const executed = report?.by_status?.executed ?? 0;
  const abandoned = (report?.by_status?.rejected ?? 0) + (report?.by_status?.abandoned ?? 0);
  const cycle = report?.cycle_time;

  const hasData = total > 0 || (report?.settlements?.length ?? 0) > 0;
  const openRecords = (title: string, scope: SettlementRecordScope) =>
    setSelection(settlementSourceSelection(report, title, scope));

  const handleExport = async () => {
    setExporting(true);
    try {
      const blob = await fetchSettlementReportCsv(reportParams);
      const stamp = new Date().toISOString().slice(0, 10);
      downloadBlob(blob, `${labels.exportFileName}-${stamp}.csv`);
      showSuccess(labels.export);
    } catch (error) {
      showApiError(error);
    } finally {
      setExporting(false);
    }
  };

  const generatedLine = report?.generated_at
    ? `${labels.generatedAt(f.formatDate(report.generated_at))} · ${labels.totalScope(f.formatNumber(report.total))}`
    : labels.description;

  const actions = (
    <div className="flex items-center gap-2">
      <Button variant="outline" size="sm" onClick={handleExport} disabled={exporting}>
        {exporting ? (
          <Loader2 className="me-2 h-4 w-4 animate-spin" aria-hidden />
        ) : (
          <Download className="me-2 h-4 w-4" aria-hidden />
        )}
        {exporting ? labels.exporting : labels.export}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setCollapsed((prev) => !prev)}
        aria-expanded={!collapsed}
      >
        <ChevronDown
          className={`h-4 w-4 transition-transform ${collapsed ? '' : 'rotate-180'}`}
          aria-hidden
        />
      </Button>
    </div>
  );

  return (
    <SectionCard
      title={labels.title}
      description={generatedLine}
      actions={actions}
      className={className}
      contentClassName="space-y-6"
    >
      {collapsed ? null : query.isError ? (
        <div className="flex flex-col items-center justify-center gap-3 py-10 text-center">
          <AlertTriangle className="h-8 w-8 text-destructive/60" aria-hidden />
          <p className="text-sm text-muted-foreground">{labels.loadError}</p>
          <Button variant="outline" size="sm" onClick={() => query.refetch()}>
            {labels.retry}
          </Button>
        </div>
      ) : !query.isLoading && !hasData ? (
        <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
          <Handshake className="h-8 w-8 text-muted-foreground/40" aria-hidden />
          <p className="text-sm font-medium">{labels.emptyTitle}</p>
          <p className="text-sm text-muted-foreground">{labels.emptyDescription}</p>
        </div>
      ) : (
        <>
          {/* KPI tiles. */}
          <div className="settlement-report-kpi-grid grid grid-cols-2 gap-3 lg:grid-cols-3 2xl:grid-cols-6">
            <StatTile
              themeClass="kpi-theme-emerald"
              icon={CircleDollarSign}
              label={labels.kpis.settledValue}
              value={formatSettlementValue(report?.settled_value ?? 0)}
              size="md"
              appearance="operational"
              className="settlement-report-kpi-card"
              onAction={() => openRecords(labels.kpis.settledValue, 'executed')}
            />
            <StatTile
              themeClass="kpi-theme-amber"
              icon={ShieldAlert}
              label={labels.kpis.valueAtRisk}
              value={formatSettlementValue(report?.value_at_risk ?? 0)}
              size="md"
              appearance="operational"
              className="settlement-report-kpi-card"
              onAction={() => openRecords(labels.kpis.valueAtRisk, 'at_risk')}
            />
            <StatTile
              themeClass="kpi-theme-primary"
              icon={TrendingUp}
              label={labels.kpis.averageValue}
              value={formatSettlementValue(report?.average_value ?? 0)}
              size="md"
              appearance="operational"
              className="settlement-report-kpi-card"
              onAction={() => openRecords(labels.kpis.averageValue, 'valued')}
            />
            <StatTile
              themeClass="kpi-theme-primary"
              icon={Handshake}
              label={labels.kpis.count}
              value={f.formatNumber(total)}
              size="md"
              appearance="operational"
              className="settlement-report-kpi-card"
              onAction={() => openRecords(labels.kpis.count, 'all')}
            />
            <StatTile
              themeClass="kpi-theme-emerald"
              icon={Percent}
              label={labels.kpis.recoveryRate}
              value={formatRatePct(executed, total, f)}
              size="md"
              appearance="operational"
              className="settlement-report-kpi-card"
              onAction={() => openRecords(labels.kpis.recoveryRate, 'executed')}
            />
            <StatTile
              themeClass="kpi-theme-red"
              icon={Percent}
              label={labels.kpis.abandonRate}
              value={formatRatePct(abandoned, total, f)}
              size="md"
              appearance="operational"
              className="settlement-report-kpi-card"
              onAction={() => openRecords(labels.kpis.abandonRate, 'abandoned')}
            />
          </div>

          {/* Distribution charts. */}
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-[color:var(--panel-border)] bg-card/50 p-4">
              <h3 className="mb-1 text-sm font-semibold">{labels.byMethod.title}</h3>
              <p className="mb-3 text-xs text-muted-foreground">{labels.byMethod.description}</p>
              {methodPie.data.length === 0 && !query.isLoading ? (
                <div className="flex h-[260px] items-center justify-center text-sm text-muted-foreground">
                  {labels.byMethod.empty}
                </div>
              ) : (
                <PieChart
                  data={methodPie.data}
                  loading={query.isLoading}
                  height={260}
                  centerValue={
                    methodPie.valueMode
                      ? formatSettlementValue(report?.total_value ?? 0)
                      : f.formatNumber(total)
                  }
                  centerLabel={labels.byMethod.title}
                  onItemSelect={(name) => {
                    const method = SETTLEMENT_METHOD_VALUES.find(
                      (value) => (labels.methodOptions[value] ?? formatToken(value)) === name,
                    );
                    if (method) openRecords(name, { method });
                  }}
                />
              )}
            </div>
            <div className="rounded-xl border border-[color:var(--panel-border)] bg-card/50 p-4">
              <h3 className="mb-1 text-sm font-semibold">{labels.byStatus.title}</h3>
              <p className="mb-3 text-xs text-muted-foreground">{labels.byStatus.description}</p>
              {statusBars.data.length === 0 && !query.isLoading ? (
                <div className="flex h-[260px] items-center justify-center text-sm text-muted-foreground">
                  {labels.byStatus.empty}
                </div>
              ) : (
                <BarChart
                  data={statusBars.data}
                  xKey="status"
                  yKeys={[{ key: 'count', label: labels.byStatus.title, color: STATUS_BAR_COLOR }]}
                  cellColors={statusBars.colors}
                  layout="horizontal"
                  showLegend={false}
                  loading={query.isLoading}
                  height={260}
                  yFormatter={(value) => f.formatNumber(value)}
                  onItemSelect={(datum) => {
                    const status = SETTLEMENT_STATUS_VALUES.find(
                      (value) =>
                        (labels.statusOptions[value] ?? formatToken(value)) === datum.status,
                    );
                    if (status) openRecords(String(datum.status), { status });
                  }}
                />
              )}
            </div>
          </div>

          {/* Cycle time & realised value. */}
          <div className="space-y-3">
            <div>
              <h3 className="text-sm font-semibold">{labels.cycle.title}</h3>
              <p className="text-xs text-muted-foreground">{labels.cycle.description}</p>
            </div>
            <div className="settlement-cycle-kpi-grid grid grid-cols-2 gap-3 lg:grid-cols-3 2xl:grid-cols-5">
              <StatTile
                themeClass="kpi-theme-emerald"
                icon={Handshake}
                label={labels.cycle.executedCount}
                value={f.formatNumber(cycle?.executed_count ?? 0)}
                size="md"
                appearance="operational"
                className="settlement-cycle-kpi-card"
                onAction={() => openRecords(labels.cycle.executedCount, 'executed')}
              />
              <StatTile
                themeClass="kpi-theme-amber"
                icon={Clock}
                label={labels.cycle.avgDays}
                value={
                  cycle && cycle.executed_count > 0
                    ? labels.cycle.days(f.formatNumber(Math.round(cycle.avg_days)))
                    : labels.cycle.none
                }
                size="md"
                appearance="operational"
                className="settlement-cycle-kpi-card"
                onAction={() => openRecords(labels.cycle.avgDays, 'executed')}
              />
              <StatTile
                themeClass="kpi-theme-primary"
                icon={TrendingUp}
                label={labels.cycle.minDays}
                value={
                  cycle && cycle.executed_count > 0
                    ? labels.cycle.days(f.formatNumber(Math.round(cycle.min_days)))
                    : labels.cycle.none
                }
                size="md"
                appearance="operational"
                className="settlement-cycle-kpi-card"
                onAction={() => openRecords(labels.cycle.minDays, 'executed')}
              />
              <StatTile
                themeClass="kpi-theme-primary"
                icon={Hourglass}
                label={labels.cycle.maxDays}
                value={
                  cycle && cycle.executed_count > 0
                    ? labels.cycle.days(f.formatNumber(Math.round(cycle.max_days)))
                    : labels.cycle.none
                }
                size="md"
                appearance="operational"
                className="settlement-cycle-kpi-card"
                onAction={() => openRecords(labels.cycle.maxDays, 'executed')}
              />
              <StatTile
                themeClass="kpi-theme-emerald"
                icon={BarChart3}
                label={labels.cycle.totalValue}
                value={formatSettlementValue(report?.total_value ?? 0)}
                size="md"
                appearance="operational"
                className="settlement-cycle-kpi-card"
                onAction={() => openRecords(labels.cycle.totalValue, 'valued')}
              />
            </div>
          </div>
        </>
      )}
      <SourceRecordsDrilldown
        selection={selection}
        onOpenChange={(open) => {
          if (!open) setSelection(null);
        }}
      />
    </SectionCard>
  );
}

export default SettlementAnalyticsPanel;
