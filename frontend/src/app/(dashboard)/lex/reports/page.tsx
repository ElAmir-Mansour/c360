'use client';

import { useCallback, useMemo } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { type ColumnDef } from '@tanstack/react-table';
import { useQuery } from '@tanstack/react-query';
import {
  addDays,
  differenceInCalendarDays,
  endOfDay,
  endOfMonth,
  endOfYear,
  format,
  startOfDay,
  startOfMonth,
  startOfYear,
} from 'date-fns';
import {
  CheckCircle2,
  Clock3,
  Download,
  Eye,
  FileBarChart,
  FileText,
  Layers,
  SlidersHorizontal,
  ShieldAlert,
  TrendingUp,
  type LucideIcon,
} from 'lucide-react';
import { ErrorState } from '@/components/common/error-state';
import { PageHeader } from '@/components/common/page-header';
import { LexRouteGuard } from '../_guards/lex-route-guard';
import { DataTable } from '@/components/shared/data-table/data-table';
import { SimpleTable, type Column as SimpleTableColumn } from '@/components/shared/simple-table';
import { selectColumn } from '@/components/shared/data-table/columns/common-columns';
import { SavedViewsBar } from '@/components/shared/saved-views-bar';
import { SeverityIndicator } from '@/components/shared/severity-indicator';
import { SectionCard } from '@/components/suites/section-card';
import { LexKpiStrip, type LexKpiItem } from '@/components/lex/kpi-strip';
import { LexListSkeleton } from '@/components/lex/list-skeleton';
import { LexStatusChip, LexPriorityChip } from '@/components/lex/status-chip';
import { rowAccentClass } from '@/components/lex/row-accents';
import { useLexFormat, type LexFormatter } from '@/lib/lex/ksa';
import {
  lexContractStatusLabels,
  lexSeverityLabels,
  resolveLexBilingual,
} from '../_lib/lex-i18n';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useLocale } from '@/components/providers/locale-provider';
import {
  PrintableReport,
  ReportExportMenu,
  ReportPeriodControl,
} from '@/components/lex/reports';
import { useLexContext } from '@/lib/lex/use-lex-context';
import { enterpriseApi } from '@/lib/enterprise';
import {
  lexReportsApi,
  type LexCaseReport,
  type LexCountBucket,
  type LexInvestigationReport,
  type LexInvestigationReportItem,
  type LexReportQuery,
} from '@/lib/lex/reports';
import { downloadBlob, titleCase } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { FetchParams, FilterConfig, BulkAction } from '@/types/table';
import type {
  LexContractReport,
  LexContractSummary,
  LexMatterReport,
  LexMatterSummary,
  LexObligationReport,
  LexObligationSummary,
} from '@/types/suites';
import { type ReportKind, type ReportsLabels, useReportsLabels } from './_lib/reports-labels';
import { ContractsManagerReports } from './_components/contracts-manager-reports';

type ReportResponse = LexContractReport | LexMatterReport | LexObligationReport | LexCaseReport | LexInvestigationReport;
type ReportViewParams = Record<string, string | string[] | undefined>;

/**
 * Locale-resolved enum label maps used to localize the filter dropdowns whose
 * tokens have no per-report `labels.enums.*` bundle (contract lifecycle status,
 * the severity ramp shared by risk + priority). Sourced from the canonical
 * suite-wide bilingual maps so the option text matches the chips elsewhere.
 */
interface ReportEnumFilterLabels {
  contractStatuses: Record<string, string>;
  severity: Record<string, string>;
}

interface ReportDateRange {
  from: Date | undefined;
  to: Date | undefined;
}

interface ReportPreset {
  id: string;
  report: ReportKind;
  label: string;
  icon: LucideIcon;
  params: ReportViewParams;
}

interface ReportRowsTableProps<TData extends { id: string }> {
  title: string;
  description: string;
  columns: ColumnDef<TData>[];
  rows: TData[];
  totalRows: number;
  page: number;
  pageSize: number;
  sortColumn?: string;
  sortDirection: 'asc' | 'desc';
  searchValue: string;
  activeFilters: Record<string, string | string[]>;
  filters: FilterConfig[];
  isLoading: boolean;
  error: string | null;
  tableKey: string;
  tableId: string;
  emptyTitle: string;
  emptyDescription: string;
  searchPlaceholder: string;
  bulkActions: BulkAction[];
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  onSortChange: (column: string, direction: 'asc' | 'desc') => void;
  onSearchChange: (value: string) => void;
  onFilterChange: (key: string, value: string | string[] | undefined) => void;
  onClearFilters: () => void;
  onRetry: () => void;
  onSelectionChange?: (selectedIds: string[]) => void;
}

const REPORT_KINDS = ['contracts', 'matters', 'obligations', 'cases', 'investigations'] as const satisfies readonly ReportKind[];

const RESERVED_PARAMS = new Set([
  'report',
  'page',
  'per_page',
  'sort',
  'order',
  'search',
  'from',
  'to',
]);

const REPORT_DEFAULT_SORT: Record<ReportKind, { column: string; direction: 'asc' | 'desc' }> = {
  contracts: { column: 'created_at', direction: 'desc' },
  matters: { column: 'created_at', direction: 'desc' },
  obligations: { column: 'due_date', direction: 'asc' },
  cases: { column: 'created_at', direction: 'desc' },
  investigations: { column: 'created_at', direction: 'desc' },
};

const REPORT_SORT_KEYS: Record<ReportKind, Set<string>> = {
  contracts: new Set(['title', 'status', 'type', 'risk_level', 'expiry_date', 'created_at']),
  matters: new Set(['title', 'status', 'type', 'priority', 'due_date', 'created_at']),
  obligations: new Set(['title', 'status', 'type', 'priority', 'due_date', 'created_at']),
  cases: new Set(['created_at', 'status', 'type', 'department']),
  investigations: new Set(['created_at', 'status', 'type', 'department']),
};

const REPORT_FILTER_KEYS: Record<ReportKind, Set<string>> = {
  contracts: new Set([
    'status',
    'type',
    'risk_level',
    'department',
    'tag',
    'owner_user_id',
    'expiring_in_days',
  ]),
  matters: new Set([
    'status',
    'type',
    'priority',
    'department',
    'tag',
    'owner_user_id',
    'contract_id',
    'due_before',
    'due_after',
  ]),
  obligations: new Set([
    'status',
    'type',
    'priority',
    'owner_user_id',
    'contract_id',
    'matter_id',
    'due_before',
    'due_after',
    'overdue',
    'tag',
  ]),
  cases: new Set(['status', 'type', 'department']),
  investigations: new Set(['status', 'type', 'department']),
};

function percent(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((part / whole) * 100)));
}

const CONTRACT_STATUS_VALUES = [
  'draft',
  'internal_review',
  'legal_review',
  'negotiation',
  'pending_signature',
  'active',
  'suspended',
  'expired',
  'terminated',
  'renewed',
  'cancelled',
];

const CONTRACT_TYPE_VALUES = [
  'service_agreement',
  'nda',
  'employment',
  'vendor',
  'license',
  'lease',
  'partnership',
  'consulting',
  'procurement',
  'sla',
  'mou',
  'amendment',
  'renewal',
  'other',
];

const RISK_VALUES = ['critical', 'high', 'medium', 'low', 'none'];
const PRIORITY_VALUES = ['critical', 'high', 'medium', 'low'];
const MATTER_STATUS_VALUES = ['intake', 'open', 'in_review', 'waiting_on_business', 'on_hold', 'closed', 'cancelled'];
const MATTER_TYPE_VALUES = ['general', 'contract', 'litigation', 'regulatory', 'employment', 'dispute', 'advisory', 'other'];
const OBLIGATION_STATUS_VALUES = ['open', 'in_progress', 'blocked', 'completed', 'waived', 'cancelled'];
const CASE_STATUS_VALUES = ['intake', 'phase1', 'phase2', 'open', 'under_procedure', 'on_hold', 'closed', 'cancelled'];
const INVESTIGATION_STATUS_VALUES = [
  'registered',
  'in_progress',
  'results_recorded',
  'pending_approval',
  'approved',
  'rejected',
  'closed',
  'cancelled',
];
const OBLIGATION_TYPE_VALUES = [
  'contractual',
  'renewal',
  'notice',
  'payment',
  'delivery',
  'reporting',
  'compliance',
  'covenant',
  'condition_precedent',
  'regulatory',
  'other',
];

/**
 * resolveEnum returns a localized label for a raw backend token, falling back to
 * `titleCase` so unknown values still render gracefully and the English surface
 * (whose enum maps are intentionally empty) is unchanged.
 */
function resolveEnum(map: Record<string, string>, token: string): string {
  return map[token] ?? titleCase(token);
}

export default function LexReportsPage() {
  const { activeRole, loading } = useLexContext();
  if (loading) {
    return (
      <LexRouteGuard requirement="lex:report:read">
        <LexListSkeleton />
      </LexRouteGuard>
    );
  }
  if (activeRole?.slug.replace(/_/g, '-') === 'legal-contracts-manager') {
    return (
      <LexRouteGuard requirement="lex:report:read">
        <ContractsManagerReports />
      </LexRouteGuard>
    );
  }
  return <GeneralLexReportsPage />;
}

function GeneralLexReportsPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const searchParamString = searchParams?.toString() ?? '';
  const urlParams = useMemo(() => new URLSearchParams(searchParamString), [searchParamString]);
  const { locale, direction } = useLocale();
  const f = useLexFormat();
  const labels = useReportsLabels();
  // Localized labels for filter dropdowns whose enums have no per-report bundle
  // (contract status + the severity ramp reused by risk & priority). Resolving
  // from the canonical suite maps keeps the option text bilingual and identical
  // to the chips those tokens render as elsewhere.
  const enumFilterLabels = useMemo<ReportEnumFilterLabels>(() => {
    const loc = locale === 'ar' ? 'ar' : 'en';
    return {
      contractStatuses: resolveLexBilingual(lexContractStatusLabels, loc),
      severity: resolveLexBilingual(lexSeverityLabels, loc),
    };
  }, [locale]);

  const activeReport = normalizeReport(urlParams.get('report'));
  const defaultSort = REPORT_DEFAULT_SORT[activeReport];
  const page = parsePositiveInt(urlParams.get('page'), 1);
  const pageSize = parsePositiveInt(urlParams.get('per_page'), 25);
  const sortColumn = normalizeSort(activeReport, urlParams.get('sort')) ?? defaultSort.column;
  const sortDirection = normalizeOrder(urlParams.get('order'), defaultSort.direction);
  const searchValue = urlParams.get('search') ?? '';
  const dateRange = useMemo<ReportDateRange>(
    () => ({
      from: parseDateParam(urlParams.get('from')),
      to: parseDateParam(urlParams.get('to')),
    }),
    [urlParams],
  );
  const activeFilters = useMemo(
    () => collectActiveFilters(urlParams, activeReport),
    [urlParams, activeReport],
  );

  const navigateToParams = useCallback(
    (params: URLSearchParams) => {
      const query = params.toString();
      router.push(query ? `${pathname ?? '/lex/reports'}?${query}` : pathname ?? '/lex/reports');
    },
    [pathname, router],
  );

  const updateParams = useCallback(
    (updates: ReportViewParams) => {
      const next = new URLSearchParams(searchParamString);
      for (const [key, value] of Object.entries(updates)) {
        next.delete(key);
        if (Array.isArray(value)) {
          value.filter(Boolean).forEach((entry) => next.append(key, entry));
        } else if (value) {
          next.set(key, value);
        }
      }
      navigateToParams(next);
    },
    [navigateToParams, searchParamString],
  );

  const applyViewParams = useCallback(
    (params: ReportViewParams) => {
      const report = normalizeReport(firstParam(params.report) ?? activeReport);
      const nextDefaultSort = REPORT_DEFAULT_SORT[report];
      const next = new URLSearchParams();
      next.set('report', report);
      next.set('page', '1');

      const currentPageSize = urlParams.get('per_page');
      if (currentPageSize) {
        next.set('per_page', currentPageSize);
      }

      const nextSort = normalizeSort(report, firstParam(params.sort)) ?? nextDefaultSort.column;
      next.set('sort', nextSort);
      next.set('order', normalizeOrder(firstParam(params.order), nextDefaultSort.direction));

      for (const key of ['search', 'from', 'to'] as const) {
        const value = firstParam(params[key]);
        if (value) {
          next.set(key, value);
        }
      }

      const filterKeys = REPORT_FILTER_KEYS[report];
      for (const [key, value] of Object.entries(params)) {
        if (RESERVED_PARAMS.has(key) || !filterKeys.has(key)) {
          continue;
        }
        if (Array.isArray(value)) {
          value.filter(Boolean).forEach((entry) => next.append(key, entry));
        } else if (value) {
          next.set(key, value);
        }
      }

      navigateToParams(next);
    },
    [activeReport, navigateToParams, urlParams],
  );

  const setActiveReport = useCallback(
    (value: string) => {
      const nextReport = normalizeReport(value);
      applyViewParams({
        report: nextReport,
        search: searchValue || undefined,
        from: urlParams.get('from') ?? undefined,
        to: urlParams.get('to') ?? undefined,
      });
    },
    [applyViewParams, searchValue, urlParams],
  );

  const setDateRange = useCallback(
    (range: ReportDateRange) => {
      updateParams({
        from: range.from ? formatDateParam(range.from) : undefined,
        to: range.to ? formatDateParam(range.to) : undefined,
        page: '1',
      });
    },
    [updateParams],
  );

  const clearDateRange = useCallback(() => {
    updateParams({ from: undefined, to: undefined, page: '1' });
  }, [updateParams]);

  const setFilter = useCallback(
    (key: string, value: string | string[] | undefined) => {
      updateParams({ [key]: value, page: '1' });
    },
    [updateParams],
  );

  const clearFilters = useCallback(() => {
    const next = new URLSearchParams();
    next.set('report', activeReport);
    next.set('page', '1');
    for (const key of ['per_page', 'sort', 'order', 'search'] as const) {
      const value = urlParams.get(key);
      if (value) {
        next.set(key, value);
      }
    }
    navigateToParams(next);
  }, [activeReport, navigateToParams, urlParams]);

  const clearAggregateFilters = useCallback(() => {
    updateParams({
      status: undefined,
      type: undefined,
      department: undefined,
      page: '1',
    });
  }, [updateParams]);

  const requestFilters = useMemo(
    () => buildRequestFilters(activeReport, activeFilters, dateRange),
    [activeReport, activeFilters, dateRange],
  );

  const reportParams: FetchParams = useMemo(
    () => ({
      page,
      per_page: pageSize,
      sort: sortColumn,
      order: sortDirection,
      search: searchValue || undefined,
      filters: Object.keys(requestFilters).length > 0 ? requestFilters : undefined,
    }),
    [page, pageSize, requestFilters, searchValue, sortColumn, sortDirection],
  );

  const analyticsQuery = useMemo<LexReportQuery>(() => {
    const first = (value: string | string[] | undefined) =>
      Array.isArray(value) ? value[0] : value;
    return {
      from: dateRange.from ? formatDateParam(dateRange.from) : undefined,
      to: dateRange.to ? formatDateParam(dateRange.to) : undefined,
      department: first(activeFilters.department),
      status: first(activeFilters.status),
      type: first(activeFilters.type),
    };
  }, [activeFilters, dateRange]);

  const reportQuery = useQuery({
    queryKey: ['lex-reports', activeReport, reportParams, analyticsQuery],
    queryFn: () => fetchReport(activeReport, reportParams, analyticsQuery),
  });

  const datePresets = useMemo(() => {
    if (activeReport === 'cases' || activeReport === 'investigations') return undefined;
    const now = startOfDay(new Date());
    return [
      { label: labels.dateRange.presets.next30, from: now, to: addDays(now, 30) },
      { label: labels.dateRange.presets.next90, from: now, to: addDays(now, 90) },
      { label: labels.dateRange.presets.thisMonth, from: startOfMonth(now), to: endOfMonth(now) },
      { label: labels.dateRange.presets.thisYear, from: startOfYear(now), to: endOfYear(now) },
    ];
  }, [activeReport, labels.dateRange.presets]);

  const presetViews = useMemo(() => buildReportPresets(labels), [labels]);
  const currentViewParams = useMemo(
    () => buildCurrentViewParams(activeReport, searchValue, sortColumn, sortDirection, dateRange, activeFilters),
    [activeFilters, activeReport, dateRange, searchValue, sortColumn, sortDirection],
  );
  const activePresetId = useMemo(
    () => presetViews.find((preset) => presetMatches(currentViewParams, preset))?.id ?? null,
    [currentViewParams, presetViews],
  );

  const filterConfigs = useMemo(
    () => getReportFilters(activeReport, labels, enumFilterLabels),
    [activeReport, labels, enumFilterLabels],
  );

  const errorMessage = reportQuery.error
    ? reportQuery.error instanceof Error
      ? reportQuery.error.message
      : labels.errors[activeReport]
    : null;
  const hasDateFilter = Boolean(dateRange.from || dateRange.to);
  const tableKey = useMemo(
    () =>
      JSON.stringify({
        report: activeReport,
        page,
        pageSize,
        sortColumn,
        sortDirection,
        searchValue,
        activeFilters,
        from: dateRange.from ? formatDateParam(dateRange.from) : '',
        to: dateRange.to ? formatDateParam(dateRange.to) : '',
      }),
    [activeFilters, activeReport, dateRange, page, pageSize, searchValue, sortColumn, sortDirection],
  );

  const exportCsv = useCallback(async () => {
    const params: FetchParams = { ...reportParams, page: 1, per_page: 1000 };
    const blob =
      activeReport === 'contracts'
        ? await enterpriseApi.lex.exportContractReportCsv(params)
        : activeReport === 'matters'
          ? await enterpriseApi.lex.exportMatterReportCsv(params)
          : activeReport === 'obligations'
            ? await enterpriseApi.lex.exportObligationReportCsv(params)
            : activeReport === 'cases'
              ? await lexReportsApi.exportCaseReportCsv(analyticsQuery)
              : await lexReportsApi.exportInvestigationReportCsv(analyticsQuery);
    downloadBlob(blob, `watheeq-${activeReport}-report-${new Date().toISOString().slice(0, 10)}.csv`);
  }, [activeReport, analyticsQuery, reportParams]);

  const exportXlsx = useCallback(async () => {
    const params: FetchParams = { ...reportParams, page: 1, per_page: 1000 };
    const blob =
      activeReport === 'contracts'
        ? await enterpriseApi.lex.exportContractReportXlsx(params)
        : activeReport === 'matters'
          ? await enterpriseApi.lex.exportMatterReportXlsx(params)
          : activeReport === 'obligations'
            ? await enterpriseApi.lex.exportObligationReportXlsx(params)
            : activeReport === 'cases'
              ? await lexReportsApi.exportCaseReportXlsx(analyticsQuery)
              : await lexReportsApi.exportInvestigationReportXlsx(analyticsQuery);
    downloadBlob(blob, `watheeq-${activeReport}-report-${new Date().toISOString().slice(0, 10)}.xlsx`);
  }, [activeReport, analyticsQuery, reportParams]);

  const onPageChange = useCallback((nextPage: number) => updateParams({ page: String(nextPage) }), [updateParams]);
  const onPageSizeChange = useCallback(
    (nextPageSize: number) => updateParams({ per_page: String(nextPageSize), page: '1' }),
    [updateParams],
  );
  const onSortChange = useCallback(
    (column: string, direction: 'asc' | 'desc') => updateParams({ sort: column, order: direction, page: '1' }),
    [updateParams],
  );
  const onSearchChange = useCallback(
    (value: string) => updateParams({ search: value || undefined, page: '1' }),
    [updateParams],
  );

  return (
    <LexRouteGuard requirement="lex:report:read">
      <div className="space-y-6" dir={direction} lang={locale}>
        <PageHeader
          title={labels.pageTitle}
          description={labels.descriptions[activeReport]}
          actions={
            <div className="lex-report-no-print flex flex-wrap items-center gap-2">
              <ReportPeriodControl
                value={dateRange}
                onChange={setDateRange}
                presets={datePresets}
              />
              {hasDateFilter ? (
                <Button variant="ghost" size="sm" onClick={clearDateRange}>
                  {labels.dateRange.clear}
                </Button>
              ) : null}
              <Button variant="outline" asChild>
                <Link href="/lex/signatures">{labels.actions.signatures}</Link>
              </Button>
              <Button variant="outline" asChild>
                <Link href="/lex/reports/builder">
                  <SlidersHorizontal className="me-1.5 h-3.5 w-3.5" />
                  {labels.actions.builder}
                </Link>
              </Button>
              <ReportExportMenu
                onCsv={exportCsv}
                onXlsx={exportXlsx}
                disabled={reportQuery.isLoading}
              />
            </div>
          }
        />

        <SectionCard
          title={labels.analyticsCallout.title}
          description={labels.analyticsCallout.description}
          className="lex-report-no-print"
        >
          <Button asChild>
            <Link href="/lex/reports/analytics">
              <TrendingUp className="me-1.5 h-3.5 w-3.5" />
              {labels.analyticsCallout.action}
            </Link>
          </Button>
        </SectionCard>

        <div className="lex-report-no-print space-y-3">
          <Tabs value={activeReport} onValueChange={setActiveReport}>
            <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1 bg-transparent p-0">
              {REPORT_KINDS.map((value) => (
                <TabsTrigger key={value} value={value} className="min-w-28">
                  {labels.tabs[value]}
                </TabsTrigger>
              ))}
            </TabsList>
            {/* Hidden panels satisfy each trigger's aria-controls; report bodies render below by state. */}
            {REPORT_KINDS.map((value) => (
              <TabsContent key={value} value={value} forceMount className="sr-only m-0" />
            ))}
          </Tabs>

          <ReportPresetChips
            presets={presetViews}
            activePresetId={activePresetId}
            label={labels.presets.label}
            onApply={(preset) => applyViewParams({ report: preset.report, ...preset.params })}
          />

          {activeReport === 'cases' || activeReport === 'investigations' ? (
            <AggregateReportFilters
              report={activeReport}
              labels={labels}
              activeFilters={activeFilters}
              onFilterChange={setFilter}
              onClear={clearAggregateFilters}
            />
          ) : null}

          <SavedViewsBar
            namespace="lex-reports"
            activeFilters={currentViewParams}
            onApply={applyViewParams}
            labels={labels.savedViews}
          />
        </div>

        <PrintableReport
          title={`${labels.pageTitle} — ${labels.tabs[activeReport]}`}
          period={{ from: dateRange.from, to: dateRange.to }}
          className="lex-report-printable"
          contentClassName="space-y-6"
        >
          {activeReport === 'contracts' ? (
            <ContractReportView
              data={reportQuery.data as LexContractReport | undefined}
              isError={reportQuery.isError}
              isLoading={reportQuery.isLoading}
              error={errorMessage}
              onRetry={() => void reportQuery.refetch()}
              labels={labels}
              f={f}
              tableKey={tableKey}
              filters={filterConfigs}
              tableControls={{
                page,
                pageSize,
                sortColumn,
                sortDirection,
                searchValue,
                activeFilters,
                onPageChange,
                onPageSizeChange,
                onSortChange,
                onSearchChange,
                onFilterChange: setFilter,
                onClearFilters: clearFilters,
              }}
            />
          ) : activeReport === 'matters' ? (
            <MatterReportView
              data={reportQuery.data as LexMatterReport | undefined}
              isError={reportQuery.isError}
              isLoading={reportQuery.isLoading}
              error={errorMessage}
              onRetry={() => void reportQuery.refetch()}
              labels={labels}
              f={f}
              tableKey={tableKey}
              filters={filterConfigs}
              tableControls={{
                page,
                pageSize,
                sortColumn,
                sortDirection,
                searchValue,
                activeFilters,
                onPageChange,
                onPageSizeChange,
                onSortChange,
                onSearchChange,
                onFilterChange: setFilter,
                onClearFilters: clearFilters,
              }}
            />
          ) : activeReport === 'obligations' ? (
            <ObligationReportView
              data={reportQuery.data as LexObligationReport | undefined}
              isError={reportQuery.isError}
              isLoading={reportQuery.isLoading}
              error={errorMessage}
              onRetry={() => void reportQuery.refetch()}
              labels={labels}
              f={f}
              tableKey={tableKey}
              filters={filterConfigs}
              tableControls={{
                page,
                pageSize,
                sortColumn,
                sortDirection,
                searchValue,
                activeFilters,
                onPageChange,
                onPageSizeChange,
                onSortChange,
                onSearchChange,
                onFilterChange: setFilter,
                onClearFilters: clearFilters,
              }}
            />
          ) : activeReport === 'cases' ? (
            <CaseReportView
              data={reportQuery.data as LexCaseReport | undefined}
              isError={reportQuery.isError}
              isLoading={reportQuery.isLoading}
              error={errorMessage}
              onRetry={() => void reportQuery.refetch()}
              labels={labels}
              f={f}
            />
          ) : (
            <InvestigationReportView
              data={reportQuery.data as LexInvestigationReport | undefined}
              isError={reportQuery.isError}
              isLoading={reportQuery.isLoading}
              error={errorMessage}
              onRetry={() => void reportQuery.refetch()}
              labels={labels}
              f={f}
            />
          )}
        </PrintableReport>
      </div>
    </LexRouteGuard>
  );
}

function ContractReportView({
  data,
  isError,
  isLoading,
  error,
  onRetry,
  labels,
  f,
  tableKey,
  filters,
  tableControls,
}: {
  data?: LexContractReport;
  isError: boolean;
  isLoading: boolean;
  error: string | null;
  onRetry: () => void;
  labels: ReportsLabels;
  f: LexFormatter;
  tableKey: string;
  filters: FilterConfig[];
  tableControls: ReportTableControls;
}) {
  const columns = useContractReportColumns(labels, f);
  const bulkActions = useMemo<BulkAction[]>(
    () => [
      {
        label: labels.actions.exportSelectedCsv,
        icon: Download,
        onClick: async (selectedIds) => exportSelectedContracts(selectedIds, data?.contracts ?? [], labels),
      },
    ],
    [data?.contracts, labels],
  );

  const kpiItems = useMemo<LexKpiItem[]>(
    () => {
      const total = data?.total ?? 0;
      const statusCount = Object.keys(data?.by_status ?? {}).length;
      const typeCount = Object.keys(data?.by_type ?? {}).length;
      const riskCount = Object.keys(data?.by_risk_level ?? {}).length;
      return [
        {
          id: 'contracts',
          label: labels.metrics.contracts,
          value: total,
          theme: 'primary',
          icon: FileText,
          description: labels.metricDetails.reportScope,
          progress: total > 0 ? 100 : 0,
          progressLabel: labels.metricDetails.currentReport,
          detail: labels.reportRows.contracts,
          detailValue: f.formatNumber(total),
          href: '#lex-report-contracts',
        },
        {
          id: 'statuses',
          label: labels.metrics.statuses,
          value: statusCount,
          theme: 'primary',
          icon: Layers,
          description: labels.metricDetails.statusCoverage,
          progress: percent(statusCount, CONTRACT_STATUS_VALUES.length),
          progressLabel: labels.metricDetails.distributionShare,
          detail: labels.breakdown.byStatus,
          detailValue: f.formatNumber(statusCount),
          href: '#lex-report-contract-statuses',
        },
        {
          id: 'types',
          label: labels.metrics.types,
          value: typeCount,
          theme: 'primary',
          icon: Layers,
          description: labels.metricDetails.typeCoverage,
          progress: percent(typeCount, CONTRACT_TYPE_VALUES.length),
          progressLabel: labels.metricDetails.distributionShare,
          detail: labels.breakdown.byType,
          detailValue: f.formatNumber(typeCount),
          href: '#lex-report-contract-types',
        },
        {
          id: 'risk',
          label: labels.metrics.riskBands,
          value: riskCount,
          theme: 'red',
          icon: ShieldAlert,
          description: labels.metricDetails.riskCoverage,
          progress: percent(riskCount, RISK_VALUES.length),
          progressLabel: labels.metricDetails.distributionShare,
          detail: labels.breakdown.byRisk,
          detailValue: f.formatNumber(riskCount),
          href: '#lex-report-contract-risk',
        },
      ];
    },
    [data, f, labels],
  );

  if (isLoading) {
    return <LexListSkeleton rows={8} cols={6} />;
  }
  if (isError) {
    return <ErrorState message={error ?? labels.errors.contracts} onRetry={onRetry} />;
  }
  if (!data) {
    return null;
  }

  return (
    <>
      <LexKpiStrip items={kpiItems} columns={4} />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <BreakdownCard id="lex-report-contract-statuses" title={labels.breakdown.byStatus} values={data.by_status} labels={labels} f={f} status statusDomain="generic" linkFor={(key) => listHref('/lex/contracts', 'status', key)} />
        <BreakdownCard id="lex-report-contract-types" title={labels.breakdown.byType} values={data.by_type} labels={labels} f={f} formatKey={(key) => resolveEnum(labels.enums.contractTypes, key)} linkFor={(key) => listHref('/lex/contracts', 'type', key)} />
        <BreakdownCard id="lex-report-contract-risk" title={labels.breakdown.byRisk} values={data.by_risk_level} labels={labels} f={f} risk linkFor={(key) => listHref('/lex/contracts', 'risk_level', key)} />
      </div>

      <ReportRowsTable
        title={labels.reportRows.contracts}
        description={labels.generated(f.formatDate(data.generated_at, { dateStyle: 'medium', timeStyle: 'short' }))}
        columns={columns}
        rows={data.contracts}
        totalRows={data.total}
        filters={filters}
        tableKey={tableKey}
        tableId="lex-report-contracts"
        emptyTitle={labels.empty.title}
        emptyDescription={labels.empty.contracts}
        searchPlaceholder={labels.table.searchPlaceholder.contracts}
        bulkActions={bulkActions}
        isLoading={isLoading}
        error={error}
        onRetry={onRetry}
        {...tableControls}
      />
    </>
  );
}

function MatterReportView({
  data,
  isError,
  isLoading,
  error,
  onRetry,
  labels,
  f,
  tableKey,
  filters,
  tableControls,
}: {
  data?: LexMatterReport;
  isError: boolean;
  isLoading: boolean;
  error: string | null;
  onRetry: () => void;
  labels: ReportsLabels;
  f: LexFormatter;
  tableKey: string;
  filters: FilterConfig[];
  tableControls: ReportTableControls;
}) {
  const columns = useMatterReportColumns(labels, f);
  const bulkActions = useMemo<BulkAction[]>(
    () => [
      {
        label: labels.actions.exportSelectedCsv,
        icon: Download,
        onClick: async (selectedIds) => exportSelectedMatters(selectedIds, data?.matters ?? [], labels),
      },
    ],
    [data?.matters, labels],
  );

  const kpiItems = useMemo<LexKpiItem[]>(
    () => {
      const total = data?.total ?? 0;
      const statusCount = Object.keys(data?.by_status ?? {}).length;
      const typeCount = Object.keys(data?.by_type ?? {}).length;
      const priorityCount = Object.keys(data?.by_priority ?? {}).length;
      return [
        {
          id: 'matters',
          label: labels.metrics.matters,
          value: total,
          theme: 'primary',
          icon: FileText,
          description: labels.metricDetails.reportScope,
          progress: total > 0 ? 100 : 0,
          progressLabel: labels.metricDetails.currentReport,
          detail: labels.reportRows.matters,
          detailValue: f.formatNumber(total),
          href: '#lex-report-matters',
        },
        {
          id: 'statuses',
          label: labels.metrics.statuses,
          value: statusCount,
          theme: 'primary',
          icon: Layers,
          description: labels.metricDetails.statusCoverage,
          progress: percent(statusCount, MATTER_STATUS_VALUES.length),
          progressLabel: labels.metricDetails.distributionShare,
          detail: labels.breakdown.byStatus,
          detailValue: f.formatNumber(statusCount),
          href: '#lex-report-matter-statuses',
        },
        {
          id: 'types',
          label: labels.metrics.types,
          value: typeCount,
          theme: 'primary',
          icon: Layers,
          description: labels.metricDetails.typeCoverage,
          progress: percent(typeCount, MATTER_TYPE_VALUES.length),
          progressLabel: labels.metricDetails.distributionShare,
          detail: labels.breakdown.byType,
          detailValue: f.formatNumber(typeCount),
          href: '#lex-report-matter-types',
        },
        {
          id: 'priorities',
          label: labels.metrics.priorities,
          value: priorityCount,
          theme: 'amber',
          icon: TrendingUp,
          description: labels.metricDetails.priorityCoverage,
          progress: percent(priorityCount, PRIORITY_VALUES.length),
          progressLabel: labels.metricDetails.distributionShare,
          detail: labels.breakdown.byPriority,
          detailValue: f.formatNumber(priorityCount),
          href: '#lex-report-matter-priorities',
        },
      ];
    },
    [data, f, labels],
  );

  if (isLoading) {
    return <LexListSkeleton rows={8} cols={6} />;
  }
  if (isError) {
    return <ErrorState message={error ?? labels.errors.matters} onRetry={onRetry} />;
  }
  if (!data) {
    return null;
  }

  return (
    <>
      <LexKpiStrip items={kpiItems} columns={4} />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <BreakdownCard id="lex-report-matter-statuses" title={labels.breakdown.byStatus} values={data.by_status} labels={labels} f={f} status statusDomain="case" formatKey={(key) => resolveEnum(labels.enums.matterStatuses, key)} linkFor={(key) => listHref('/lex/matters', 'status', key)} />
        <BreakdownCard id="lex-report-matter-types" title={labels.breakdown.byType} values={data.by_type} labels={labels} f={f} formatKey={(key) => resolveEnum(labels.enums.matterTypes, key)} linkFor={(key) => listHref('/lex/matters', 'type', key)} />
        <BreakdownCard id="lex-report-matter-priorities" title={labels.breakdown.byPriority} values={data.by_priority} labels={labels} f={f} priority linkFor={(key) => listHref('/lex/matters', 'priority', key)} />
      </div>

      <ReportRowsTable
        title={labels.reportRows.matters}
        description={labels.generated(f.formatDate(data.generated_at, { dateStyle: 'medium', timeStyle: 'short' }))}
        columns={columns}
        rows={data.matters}
        totalRows={data.total}
        filters={filters}
        tableKey={tableKey}
        tableId="lex-report-matters"
        emptyTitle={labels.empty.title}
        emptyDescription={labels.empty.matters}
        searchPlaceholder={labels.table.searchPlaceholder.matters}
        bulkActions={bulkActions}
        isLoading={isLoading}
        error={error}
        onRetry={onRetry}
        {...tableControls}
      />
    </>
  );
}

function ObligationReportView({
  data,
  isError,
  isLoading,
  error,
  onRetry,
  labels,
  f,
  tableKey,
  filters,
  tableControls,
}: {
  data?: LexObligationReport;
  isError: boolean;
  isLoading: boolean;
  error: string | null;
  onRetry: () => void;
  labels: ReportsLabels;
  f: LexFormatter;
  tableKey: string;
  filters: FilterConfig[];
  tableControls: ReportTableControls;
}) {
  const columns = useObligationReportColumns(labels, f);
  const bulkActions = useMemo<BulkAction[]>(
    () => [
      {
        label: labels.actions.exportSelectedCsv,
        icon: Download,
        onClick: async (selectedIds) => exportSelectedObligations(selectedIds, data?.obligations ?? [], labels),
      },
    ],
    [data?.obligations, labels],
  );

  const kpiItems = useMemo<LexKpiItem[]>(
    () => {
      const total = data?.total ?? 0;
      const overdue = data?.overdue ?? 0;
      const dueSoon = data?.due_soon ?? 0;
      const completed = data?.completed ?? 0;
      const overdueShare = percent(overdue, total);
      const dueSoonShare = percent(dueSoon, total);
      const completedShare = percent(completed, total);
      return [
        {
          id: 'obligations',
          label: labels.metrics.obligations,
          value: total,
          theme: 'primary',
          icon: FileText,
          description: labels.metricDetails.reportScope,
          progress: total > 0 ? 100 : 0,
          progressLabel: labels.metricDetails.currentReport,
          detail: labels.reportRows.obligations,
          detailValue: f.formatNumber(total),
          href: '#lex-report-obligations',
        },
        {
          id: 'overdue',
          label: labels.metrics.overdue,
          value: overdue,
          theme: 'red',
          icon: ShieldAlert,
          description: labels.metricDetails.overdueQueue,
          progress: overdueShare,
          progressLabel: labels.metricDetails.distributionShare,
          detail: labels.metrics.overdue,
          detailValue: `${f.formatNumber(overdueShare)}%`,
          trendGoodWhenDown: true,
          href: '#lex-report-obligation-statuses',
        },
        {
          id: 'due-soon',
          label: labels.metrics.dueSoon,
          value: dueSoon,
          theme: 'amber',
          icon: Clock3,
          description: labels.metricDetails.dueSoonQueue,
          progress: dueSoonShare,
          progressLabel: labels.metricDetails.distributionShare,
          detail: labels.metrics.dueSoon,
          detailValue: `${f.formatNumber(dueSoonShare)}%`,
          href: '#lex-report-obligation-statuses',
        },
        {
          id: 'completed',
          label: labels.metrics.completed,
          value: completed,
          theme: 'emerald',
          icon: CheckCircle2,
          description: labels.metricDetails.completionCoverage,
          progress: completedShare,
          progressLabel: labels.metricDetails.distributionShare,
          detail: labels.metrics.completed,
          detailValue: `${f.formatNumber(completedShare)}%`,
          href: '#lex-report-obligation-statuses',
        },
      ];
    },
    [data, f, labels],
  );

  if (isLoading) {
    return <LexListSkeleton rows={8} cols={7} />;
  }
  if (isError) {
    return <ErrorState message={error ?? labels.errors.obligations} onRetry={onRetry} />;
  }
  if (!data) {
    return null;
  }

  return (
    <>
      <LexKpiStrip items={kpiItems} columns={4} />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <BreakdownCard id="lex-report-obligation-statuses" title={labels.breakdown.byStatus} values={data.by_status} labels={labels} f={f} status statusDomain="obligation" formatKey={(key) => resolveEnum(labels.enums.obligationStatuses, key)} linkFor={(key) => listHref('/lex/obligations', 'status', key)} />
        <BreakdownCard id="lex-report-obligation-types" title={labels.breakdown.byType} values={data.by_type} labels={labels} f={f} formatKey={(key) => resolveEnum(labels.enums.obligationTypes, key)} linkFor={(key) => listHref('/lex/obligations', 'type', key)} />
        <BreakdownCard id="lex-report-obligation-priorities" title={labels.breakdown.byPriority} values={data.by_priority} labels={labels} f={f} priority linkFor={(key) => listHref('/lex/obligations', 'priority', key)} />
      </div>

      <ReportRowsTable
        title={labels.reportRows.obligations}
        description={labels.generated(f.formatDate(data.generated_at, { dateStyle: 'medium', timeStyle: 'short' }))}
        columns={columns}
        rows={data.obligations}
        totalRows={data.total}
        filters={filters}
        tableKey={tableKey}
        tableId="lex-report-obligations"
        emptyTitle={labels.empty.title}
        emptyDescription={labels.empty.obligations}
        searchPlaceholder={labels.table.searchPlaceholder.obligations}
        bulkActions={bulkActions}
        isLoading={isLoading}
        error={error}
        onRetry={onRetry}
        {...tableControls}
      />
    </>
  );
}

type CaseDrilldownRow = Record<string, unknown> & {
  dimension: string;
  bucket: LexCountBucket;
  href: string;
};

function CaseReportView({
  data,
  isError,
  isLoading,
  error,
  onRetry,
  labels,
  f,
}: {
  data?: LexCaseReport;
  isError: boolean;
  isLoading: boolean;
  error: string | null;
  onRetry: () => void;
  labels: ReportsLabels;
  f: LexFormatter;
}) {
  if (isLoading) return <LexListSkeleton rows={8} cols={5} />;
  if (isError) return <ErrorState message={error ?? labels.errors.cases} onRetry={onRetry} />;
  if (!data) return null;

  const kpiItems: LexKpiItem[] = [
    {
      id: 'case-total',
      label: labels.metrics.cases,
      value: data.total,
      theme: 'primary',
      icon: FileText,
      href: '/lex/cases',
      detail: labels.metricDetails.currentReport,
      detailValue: f.formatNumber(data.total),
    },
    {
      id: 'case-closed',
      label: labels.metrics.closed,
      value: data.closed,
      theme: 'emerald',
      icon: CheckCircle2,
      href: listHref('/lex/cases', 'status', 'closed'),
      progress: percent(data.closed, data.total),
      progressLabel: labels.metricDetails.distributionShare,
    },
    {
      id: 'case-procedure',
      label: resolveEnum({}, 'under_procedure'),
      value: data.under_procedure,
      theme: 'orange',
      icon: Clock3,
      href: listHref('/lex/cases', 'status', 'under_procedure'),
      progress: percent(data.under_procedure, data.total),
      progressLabel: labels.metricDetails.distributionShare,
    },
    {
      id: 'case-types',
      label: labels.metrics.types,
      value: data.by_type.length,
      theme: 'primary',
      icon: Layers,
      href: '#lex-report-case-types',
      detail: labels.breakdown.byType,
      detailValue: f.formatNumber(data.by_type.length),
    },
  ];

  const drilldownRows: CaseDrilldownRow[] = [
    ...data.by_status.map((bucket) => ({ dimension: labels.breakdown.byStatus, bucket, href: listHref('/lex/cases', 'status', bucket.key) })),
    ...data.by_type.map((bucket) => ({ dimension: labels.breakdown.byType, bucket, href: listHref('/lex/cases', 'case_type', bucket.key) })),
    ...data.by_department.map((bucket) => ({ dimension: labels.breakdown.byDepartment, bucket, href: listHref('/lex/cases', 'department', bucket.key) })),
    ...data.by_company_status.map((bucket) => ({ dimension: labels.table.status, bucket, href: listHref('/lex/cases', 'company_status', bucket.key) })),
  ];

  return (
    <div className="space-y-6">
      <LexKpiStrip items={kpiItems} columns={4} />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2" data-report-section="true">
        <BucketBreakdown
          id="lex-report-case-statuses"
          title={labels.breakdown.byStatus}
          buckets={data.by_status}
          labels={labels}
          f={f}
          status
          statusDomain="case"
          linkFor={(key) => listHref('/lex/cases', 'status', key)}
        />
        <BucketBreakdown
          id="lex-report-case-types"
          title={labels.breakdown.byType}
          buckets={data.by_type}
          labels={labels}
          f={f}
          linkFor={(key) => listHref('/lex/cases', 'case_type', key)}
        />
        <BucketBreakdown
          title={labels.breakdown.byDepartment}
          buckets={data.by_department}
          labels={labels}
          f={f}
          linkFor={(key) => listHref('/lex/cases', 'department', key)}
        />
        <BucketBreakdown
          title={labels.table.status}
          buckets={data.by_company_status}
          labels={labels}
          f={f}
          linkFor={(key) => listHref('/lex/cases', 'company_status', key)}
        />
      </div>
      <div data-report-section="true">
      <SectionCard
        title={labels.reportRows.cases}
        description={labels.generated(f.formatDate(data.generated_at, { dateStyle: 'medium', timeStyle: 'short' }))}
      >
        <SimpleTable<CaseDrilldownRow>
          ariaLabel={labels.reportRows.cases}
          data={drilldownRows}
          getRowKey={(row) => `${row.dimension}-${row.bucket.key}`}
          columns={[
            { key: 'dimension', header: labels.table.type },
            { key: 'bucket', header: labels.table.status, render: (row) => <span dir="auto">{titleCase(row.bucket.key)}</span> },
            { key: 'count', header: labels.metrics.cases, align: 'right', render: (row) => <span className="tabular-nums">{f.formatNumber(row.bucket.count)}</span> },
            { key: 'action', header: labels.table.action, align: 'right', render: (row) => <OpenReportLink href={row.href} labels={labels} /> },
          ] satisfies SimpleTableColumn<CaseDrilldownRow>[]}
        />
      </SectionCard>
      </div>
    </div>
  );
}

function InvestigationReportView({
  data,
  isError,
  isLoading,
  error,
  onRetry,
  labels,
  f,
}: {
  data?: LexInvestigationReport;
  isError: boolean;
  isLoading: boolean;
  error: string | null;
  onRetry: () => void;
  labels: ReportsLabels;
  f: LexFormatter;
}) {
  if (isLoading) return <LexListSkeleton rows={8} cols={7} />;
  if (isError) return <ErrorState message={error ?? labels.errors.investigations} onRetry={onRetry} />;
  if (!data) return null;

  const kpiItems: LexKpiItem[] = [
    { id: 'investigations-total', label: labels.metrics.investigations, value: data.total, theme: 'primary', icon: FileText, href: '/lex/investigations' },
    { id: 'investigations-open', label: labels.metrics.open, value: data.open, theme: 'orange', icon: Clock3, href: listHref('/lex/investigations', 'status', 'registered,in_progress,results_recorded,pending_approval,rejected'), progress: percent(data.open, data.total), progressLabel: labels.metricDetails.distributionShare },
    { id: 'investigations-closed', label: labels.metrics.closed, value: data.closed, theme: 'emerald', icon: CheckCircle2, href: listHref('/lex/investigations', 'status', 'approved,closed,cancelled'), progress: percent(data.closed, data.total), progressLabel: labels.metricDetails.distributionShare },
    { id: 'investigations-age', label: labels.metrics.averageAge, value: data.avg_open_age_days, unit: localeUnitDays(f), theme: 'orange', icon: Clock3, href: listHref('/lex/investigations', 'status', 'registered,in_progress,results_recorded,pending_approval,rejected') },
    { id: 'investigations-approval', label: labels.metrics.approvalTime, value: data.avg_register_to_approved_hours, unit: 'h', theme: 'primary', icon: TrendingUp, href: listHref('/lex/investigations', 'status', 'approved,closed'), detail: labels.metrics.investigations, detailValue: f.formatNumber(data.approval_sample_size) },
    { id: 'investigations-sla', label: labels.metrics.slaCompliance, value: `${f.formatNumber(data.sla.compliance_rate_pct)}%`, theme: data.sla.breached > 0 ? 'red' : 'emerald', icon: ShieldAlert, href: '#lex-report-investigation-sla', detail: labels.metrics.overdue, detailValue: f.formatNumber(data.sla.breached) },
  ];

  const slaBuckets: LexCountBucket[] = [
    { key: 'on_time', count: data.sla.on_time },
    { key: 'breached', count: data.sla.breached },
    { key: 'pending', count: data.sla.pending },
  ];

  return (
    <div className="space-y-6">
      <LexKpiStrip items={kpiItems} columns={6} />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3" data-report-section="true">
        <BucketBreakdown title={labels.breakdown.byStatus} buckets={data.by_status} labels={labels} f={f} status linkFor={(key) => reportDrilldownHref('investigations', data.filters, { status: key })} />
        <BucketBreakdown title={labels.breakdown.byCategory} buckets={data.by_category} labels={labels} f={f} linkFor={(key) => reportDrilldownHref('investigations', data.filters, { type: key })} />
        <BucketBreakdown id="lex-report-investigation-sla" title={labels.metrics.slaCompliance} buckets={slaBuckets} labels={labels} f={f} />
      </div>
      <InvestigationRowsTable data={data} labels={labels} f={f} />
    </div>
  );
}

function localeUnitDays(f: LexFormatter): string {
  return f.direction === 'rtl' ? 'يوم' : 'days';
}

type InvestigationTableRow = LexInvestigationReportItem & Record<string, unknown>;

function InvestigationRowsTable({ data, labels, f }: { data: LexInvestigationReport; labels: ReportsLabels; f: LexFormatter }) {
  return (
    <div data-report-section="true">
    <SectionCard
      title={labels.reportRows.investigations}
      description={`${labels.generated(f.formatDate(data.generated_at, { dateStyle: 'medium', timeStyle: 'short' }))}${data.items_truncated ? ' · 200+' : ''}`}
    >
      {data.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{labels.empty.investigations}</p>
      ) : (
        <SimpleTable<InvestigationTableRow>
          ariaLabel={labels.reportRows.investigations}
          data={data.items.map((item) => ({ ...item }))}
          getRowKey={(item) => item.id}
          columns={[
            { key: 'investigation_number', header: labels.table.number, render: (item) => <Link href={`/lex/investigations/${item.id}`} className="font-medium text-primary hover:underline">{item.investigation_number}</Link> },
            { key: 'status', header: labels.table.status, render: (item) => <LexStatusChip value={item.status} domain="generic" size="sm" /> },
            { key: 'category', header: labels.table.category, render: (item) => <span dir="auto">{titleCase(item.category)}</span> },
            { key: 'priority', header: labels.table.priority, render: (item) => <LexPriorityChip value={item.priority} size="sm" /> },
            { key: 'department', header: labels.table.department, render: (item) => <span dir="auto">{item.department || labels.rows.unassigned}</span> },
            { key: 'age_days', header: labels.table.age, align: 'right', render: (item) => <span className="tabular-nums">{f.formatNumber(item.age_days)}</span> },
            { key: 'sla_outcome', header: labels.table.sla, render: (item) => <span dir="auto">{item.sla_outcome ? titleCase(item.sla_outcome) : '—'}</span> },
            { key: 'action', header: labels.table.action, align: 'right', render: (item) => <OpenReportLink href={`/lex/investigations/${item.id}`} labels={labels} /> },
          ] satisfies SimpleTableColumn<InvestigationTableRow>[]}
        />
      )}
    </SectionCard>
    </div>
  );
}

function BucketBreakdown({ buckets, ...props }: Omit<Parameters<typeof BreakdownCard>[0], 'values'> & { buckets: LexCountBucket[] }) {
  return <BreakdownCard {...props} values={Object.fromEntries(buckets.map((bucket) => [bucket.key, bucket.count]))} />;
}

interface ReportTableControls {
  page: number;
  pageSize: number;
  sortColumn?: string;
  sortDirection: 'asc' | 'desc';
  searchValue: string;
  activeFilters: Record<string, string | string[]>;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  onSortChange: (column: string, direction: 'asc' | 'desc') => void;
  onSearchChange: (value: string) => void;
  onFilterChange: (key: string, value: string | string[] | undefined) => void;
  onClearFilters: () => void;
}

function ReportRowsTable<TData extends { id: string }>({
  title,
  description,
  columns,
  rows,
  totalRows,
  page,
  pageSize,
  sortColumn,
  sortDirection,
  searchValue,
  activeFilters,
  filters,
  isLoading,
  error,
  tableKey,
  tableId,
  emptyTitle,
  emptyDescription,
  searchPlaceholder,
  bulkActions,
  onPageChange,
  onPageSizeChange,
  onSortChange,
  onSearchChange,
  onFilterChange,
  onClearFilters,
  onRetry,
  onSelectionChange,
}: ReportRowsTableProps<TData>) {
  return (
    <div id={tableId} className="scroll-mt-24 space-y-3">
      <div>
        <h2 className="text-h4 font-semibold">{title}</h2>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <DataTable
        key={tableKey}
        columns={columns}
        data={rows}
        totalRows={totalRows}
        page={page}
        pageSize={pageSize}
        pageSizeOptions={[10, 25, 50, 100]}
        onPageChange={onPageChange}
        onPageSizeChange={onPageSizeChange}
        sortColumn={sortColumn}
        sortDirection={sortDirection}
        onSortChange={onSortChange}
        searchValue={searchValue}
        onSearchChange={onSearchChange}
        searchPlaceholder={searchPlaceholder}
        filters={filters}
        activeFilters={activeFilters}
        onFilterChange={onFilterChange}
        onClearFilters={onClearFilters}
        enableSelection
        onSelectionChange={onSelectionChange}
        getRowId={(row) => row.id}
        bulkActions={bulkActions}
        enableColumnToggle={false}
        isLoading={isLoading}
        error={error}
        onRetry={onRetry}
        emptyState={{
          icon: FileBarChart,
          title: emptyTitle,
          description: emptyDescription,
        }}
        tableId={tableId}
        stickyHeader
        striped
        compact
      />
    </div>
  );
}

function useContractReportColumns(labels: ReportsLabels, f: LexFormatter): ColumnDef<LexContractSummary>[] {
  return useMemo<ColumnDef<LexContractSummary>[]>(
    () => [
      selectColumn<LexContractSummary>(),
      {
        id: 'title',
        accessorKey: 'title',
        header: labels.table.title,
        enableSorting: true,
        cell: ({ row }) => (
          <div className="min-w-[220px] border-s-2 border-s-transparent ps-2">
            <Link
              href={`/lex/contracts/${row.original.id}`}
              className="font-medium hover:underline"
              dir="auto"
            >
              {row.original.title}
            </Link>
            <p className="text-xs text-muted-foreground" dir="auto">
              {row.original.party_b_name} / {labels.rows.versionPrefix(row.original.current_version)}
            </p>
          </div>
        ),
      },
      {
        id: 'status',
        accessorKey: 'status',
        header: labels.table.status,
        enableSorting: true,
        cell: ({ row }) => <LexStatusChip value={row.original.status} domain="generic" size="sm" />,
      },
      {
        id: 'type',
        accessorKey: 'type',
        header: labels.table.type,
        enableSorting: true,
        cell: ({ row }) => resolveEnum(labels.enums.contractTypes, row.original.type),
      },
      {
        id: 'risk_level',
        accessorKey: 'risk_level',
        header: labels.table.risk,
        enableSorting: true,
        cell: ({ row }) => <SeverityIndicator severity={normalizeRisk(row.original.risk_level)} size="sm" />,
      },
      {
        id: 'expiry_date',
        accessorKey: 'expiry_date',
        header: labels.table.expiryDate,
        enableSorting: true,
        cell: ({ row }) =>
          row.original.expiry_date ? (
            <DateCell f={f} value={row.original.expiry_date} />
          ) : (
            <span className="text-xs text-muted-foreground">{labels.rows.noExpiryDate}</span>
          ),
      },
      {
        id: 'created_at',
        accessorKey: 'created_at',
        header: labels.table.createdAt,
        enableSorting: true,
        cell: ({ row }) => <DateCell f={f} value={row.original.created_at} />,
      },
      {
        id: 'action',
        header: labels.table.action,
        enableSorting: false,
        cell: ({ row }) => <OpenReportLink href={`/lex/contracts/${row.original.id}`} labels={labels} />,
      },
    ],
    [labels, f],
  );
}

function useMatterReportColumns(labels: ReportsLabels, f: LexFormatter): ColumnDef<LexMatterSummary>[] {
  return useMemo<ColumnDef<LexMatterSummary>[]>(
    () => [
      selectColumn<LexMatterSummary>(),
      {
        id: 'title',
        accessorKey: 'title',
        header: labels.table.title,
        enableSorting: true,
        cell: ({ row }) => (
          <div className="min-w-[220px]">
            <Link
              href={`/lex/matters/${row.original.id}`}
              className="font-medium hover:underline"
              dir="auto"
            >
              {row.original.title}
            </Link>
            <p className="text-xs text-muted-foreground" dir="auto">
              {row.original.matter_number} / {row.original.owner_name || labels.rows.unassigned}
            </p>
          </div>
        ),
      },
      {
        id: 'status',
        accessorKey: 'status',
        header: labels.table.status,
        enableSorting: true,
        cell: ({ row }) => (
          <LexStatusChip
            value={row.original.status}
            domain="case"
            labels={labels.enums.matterStatuses}
            size="sm"
          />
        ),
      },
      {
        id: 'type',
        accessorKey: 'type',
        header: labels.table.type,
        enableSorting: true,
        cell: ({ row }) => resolveEnum(labels.enums.matterTypes, row.original.type),
      },
      {
        id: 'priority',
        accessorKey: 'priority',
        header: labels.table.priority,
        enableSorting: true,
        cell: ({ row }) => <LexPriorityChip value={row.original.priority} size="sm" />,
      },
      {
        id: 'due_date',
        accessorKey: 'due_date',
        header: labels.table.dueDate,
        enableSorting: true,
        cell: ({ row }) =>
          row.original.due_date ? (
            <DateCell f={f} value={row.original.due_date} />
          ) : (
            <span className="text-xs text-muted-foreground">{labels.rows.noDueDate}</span>
          ),
      },
      {
        id: 'created_at',
        accessorKey: 'created_at',
        header: labels.table.createdAt,
        enableSorting: true,
        cell: ({ row }) => <DateCell f={f} value={row.original.created_at} />,
      },
      {
        id: 'action',
        header: labels.table.action,
        enableSorting: false,
        cell: ({ row }) => <OpenReportLink href={`/lex/matters/${row.original.id}`} labels={labels} />,
      },
    ],
    [labels, f],
  );
}

function useObligationReportColumns(labels: ReportsLabels, f: LexFormatter): ColumnDef<LexObligationSummary>[] {
  return useMemo<ColumnDef<LexObligationSummary>[]>(
    () => [
      selectColumn<LexObligationSummary>(),
      {
        id: 'title',
        accessorKey: 'title',
        header: labels.table.title,
        enableSorting: true,
        cell: ({ row }) => (
          <div className="min-w-[220px]">
            <Link
              href={`/lex/obligations?search=${encodeURIComponent(row.original.title)}`}
              className="font-medium hover:underline"
              dir="auto"
            >
              {row.original.title}
            </Link>
            <p className="text-xs text-muted-foreground" dir="auto">
              {row.original.owner_name || labels.rows.unassigned} / {formatDueWindow(row.original.days_until_due, labels, f)}
            </p>
          </div>
        ),
      },
      {
        id: 'status',
        accessorKey: 'status',
        header: labels.table.status,
        enableSorting: true,
        cell: ({ row }) => (
          <LexStatusChip
            value={row.original.status}
            domain="obligation"
            labels={labels.enums.obligationStatuses}
            size="sm"
          />
        ),
      },
      {
        id: 'type',
        accessorKey: 'type',
        header: labels.table.type,
        enableSorting: true,
        cell: ({ row }) => resolveEnum(labels.enums.obligationTypes, row.original.type),
      },
      {
        id: 'priority',
        accessorKey: 'priority',
        header: labels.table.priority,
        enableSorting: true,
        cell: ({ row }) => <LexPriorityChip value={row.original.priority} size="sm" />,
      },
      {
        id: 'source',
        header: labels.table.source,
        enableSorting: false,
        cell: ({ row }) => {
          const sourceLabel = row.original.contract_title || row.original.matter_title || labels.rows.unlinked;
          const href = row.original.contract_id
            ? `/lex/contracts/${row.original.contract_id}`
            : row.original.matter_id
              ? `/lex/matters/${row.original.matter_id}`
              : '/lex/obligations';
          return (
            <Link href={href} className="font-medium hover:underline" dir="auto">
              {sourceLabel}
            </Link>
          );
        },
      },
      {
        id: 'due_date',
        accessorKey: 'due_date',
        header: labels.table.dueDate,
        enableSorting: true,
        cell: ({ row }) => <DateCell f={f} value={row.original.due_date} />,
      },
      {
        id: 'created_at',
        accessorKey: 'created_at',
        header: labels.table.createdAt,
        enableSorting: true,
        cell: ({ row }) => <DateCell f={f} value={row.original.created_at} />,
      },
      {
        id: 'action',
        header: labels.table.action,
        enableSorting: false,
        cell: ({ row }) => <OpenReportLink href={`/lex/obligations?search=${encodeURIComponent(row.original.title)}`} labels={labels} />,
      },
    ],
    [labels, f],
  );
}

function OpenReportLink({ href, labels }: { href: string; labels: ReportsLabels }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium transition-colors hover:border-primary/30 hover:bg-primary/5"
      onClick={(event) => event.stopPropagation()}
    >
      <Eye className="h-3.5 w-3.5" />
      {labels.table.open}
    </Link>
  );
}

/**
 * DateCell — a Gregorian+Hijri dual date (KSA-aware) with the precise localized
 * timestamp on hover. Arabic mode renders the Umm al-Qura date + Arabic-Indic
 * digits automatically.
 */
function DateCell({ f, value }: { f: LexFormatter; value: string | null | undefined }) {
  if (!value) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  return (
    <span className="whitespace-nowrap tabular-nums" title={f.formatDual(value)}>
      {f.formatDate(value, { day: '2-digit', month: 'short', year: 'numeric' })}
    </span>
  );
}

function BreakdownCard({
  id,
  title,
  values,
  labels,
  f,
  formatKey,
  linkFor,
  priority = false,
  risk = false,
  status = false,
  statusDomain = 'generic',
}: {
  id?: string;
  title: string;
  values: Record<string, number>;
  labels: ReportsLabels;
  f: LexFormatter;
  formatKey?: (key: string) => string;
  linkFor?: (key: string) => string;
  priority?: boolean;
  risk?: boolean;
  status?: boolean;
  statusDomain?: 'generic' | 'case' | 'obligation';
}) {
  const entries = Object.entries(values).sort((left, right) => right[1] - left[1]);
  const max = entries.reduce((peak, [, count]) => Math.max(peak, count), 0);

  // Tone the row accent by dimension so the distribution reads as color-coded,
  // elevated rows (matches the unified row-accent language used suite-wide).
  const accentKind: 'status' | 'priority' | 'severity' = risk || priority ? 'severity' : 'status';

  return (
    <div id={id} className="scroll-mt-24">
      <SectionCard title={title} description={labels.breakdown.distribution}>
        <div className="space-y-2.5">
        {entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">{labels.breakdown.noData}</p>
        ) : (
          entries.map(([key, count]) => {
            const pct = max > 0 ? Math.round((count / max) * 100) : 0;
            const inner = (
              <>
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2">
                    {risk ? <SeverityIndicator severity={normalizeRisk(key)} size="sm" /> : null}
                    {priority ? <SeverityIndicator severity={normalizePriority(key)} size="sm" /> : null}
                    {status ? (
                      <LexStatusChip value={key} domain={statusDomain} labels={statusLabelsFor(labels, statusDomain)} size="sm" />
                    ) : (
                      <Badge variant="outline" dir="auto">
                        {formatKey ? formatKey(key) : titleCase(key)}
                      </Badge>
                    )}
                  </div>
                  <span className="text-sm font-medium tabular-nums">{f.formatNumber(count)}</span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted" role="presentation">
                  <div
                    className="h-full rounded-full bg-primary/70 transition-[width] duration-500"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </>
            );
            const href = linkFor?.(key);
            return (
              <div
                key={key}
                className={cn(
                  'space-y-1.5 rounded-lg px-3 py-2',
                  rowAccentClass(accentKind === 'severity' ? (priority ? 'priority' : 'severity') : 'status', key),
                )}
              >
                {href ? (
                  <Link href={href} className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    {inner}
                  </Link>
                ) : (
                  inner
                )}
              </div>
            );
          })
        )}
        </div>
      </SectionCard>
    </div>
  );
}

function AggregateReportFilters({
  report,
  labels,
  activeFilters,
  onFilterChange,
  onClear,
}: {
  report: 'cases' | 'investigations';
  labels: ReportsLabels;
  activeFilters: Record<string, string | string[]>;
  onFilterChange: (key: string, value: string | string[] | undefined) => void;
  onClear: () => void;
}) {
  const valueOf = (key: string) => {
    const value = activeFilters[key];
    return Array.isArray(value) ? value[0] ?? '' : value ?? '';
  };
  const statuses = report === 'cases' ? CASE_STATUS_VALUES : INVESTIGATION_STATUS_VALUES;
  return (
    <div className="flex flex-wrap items-end gap-3 rounded-xl border bg-card p-4">
      <label className="grid gap-1 text-xs font-medium text-muted-foreground">
        {labels.filters.status}
        <select
          className="h-9 min-w-44 rounded-md border bg-background px-3 text-sm text-foreground"
          value={valueOf('status')}
          onChange={(event) => onFilterChange('status', event.target.value || undefined)}
        >
          <option value="">{labels.dateRange.all}</option>
          {statuses.map((status) => <option key={status} value={status}>{titleCase(status)}</option>)}
        </select>
      </label>
      <label className="grid gap-1 text-xs font-medium text-muted-foreground">
        {report === 'cases' ? labels.filters.type : labels.table.category}
        <Input
          key={`${report}-type-${valueOf('type')}`}
          className="h-9 min-w-44"
          defaultValue={valueOf('type')}
          onBlur={(event) => onFilterChange('type', event.target.value.trim() || undefined)}
        />
      </label>
      <label className="grid gap-1 text-xs font-medium text-muted-foreground">
        {labels.filters.department}
        <Input
          key={`${report}-department-${valueOf('department')}`}
          className="h-9 min-w-44"
          defaultValue={valueOf('department')}
          onBlur={(event) => onFilterChange('department', event.target.value.trim() || undefined)}
        />
      </label>
      <Button type="button" variant="ghost" size="sm" onClick={onClear}>
        {labels.dateRange.clear}
      </Button>
    </div>
  );
}

/** Pick the right enum label map for a breakdown's status chips, by domain. */
function statusLabelsFor(
  labels: ReportsLabels,
  domain: 'generic' | 'case' | 'obligation',
): Record<string, string> | undefined {
  if (domain === 'case') return labels.enums.matterStatuses;
  if (domain === 'obligation') return labels.enums.obligationStatuses;
  return undefined;
}

function ReportPresetChips({
  presets,
  activePresetId,
  label,
  onApply,
}: {
  presets: ReportPreset[];
  activePresetId: string | null;
  label: string;
  onApply: (preset: ReportPreset) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs font-medium uppercase tracking-caps-xwide text-muted-foreground">{label}</span>
      {presets.map((preset) => {
        const Icon = preset.icon;
        const active = preset.id === activePresetId;
        return (
          <Button
            key={preset.id}
            type="button"
            variant={active ? 'secondary' : 'outline'}
            size="sm"
            className={cn('h-8 gap-1.5 rounded-full px-3 text-xs', active && 'border-primary/30 bg-primary/10 text-primary')}
            aria-pressed={active}
            onClick={() => onApply(preset)}
          >
            <Icon className="h-3.5 w-3.5" />
            {preset.label}
          </Button>
        );
      })}
    </div>
  );
}

function buildReportPresets(labels: ReportsLabels): ReportPreset[] {
  const today = startOfDay(new Date());
  return [
    {
      id: 'high-risk-contracts',
      report: 'contracts',
      label: labels.presets.highRiskContracts,
      icon: ShieldAlert,
      params: { risk_level: 'high', sort: 'risk_level', order: 'desc' },
    },
    {
      id: 'active-matters',
      report: 'matters',
      label: labels.presets.activeMatters,
      icon: Clock3,
      params: { status: 'open', sort: 'created_at', order: 'desc' },
    },
    {
      id: 'closed-matters',
      report: 'matters',
      label: labels.presets.closedMatters,
      icon: CheckCircle2,
      params: { status: 'closed', sort: 'created_at', order: 'desc' },
    },
    {
      id: 'overdue-obligations',
      report: 'obligations',
      label: labels.presets.overdueObligations,
      icon: ShieldAlert,
      params: { overdue: 'true', sort: 'due_date', order: 'asc' },
    },
    {
      id: 'due-soon-obligations',
      report: 'obligations',
      label: labels.presets.dueSoonObligations,
      icon: Clock3,
      params: {
        status: 'open',
        from: formatDateParam(today),
        to: formatDateParam(addDays(today, 30)),
        sort: 'due_date',
        order: 'asc',
      },
    },
  ];
}

function getReportFilters(
  report: ReportKind,
  labels: ReportsLabels,
  enumLabels: ReportEnumFilterLabels,
): FilterConfig[] {
  if (report === 'cases') {
    return [
      { key: 'status', label: labels.filters.status, type: 'select', options: optionsFrom(CASE_STATUS_VALUES) },
      { key: 'type', label: labels.filters.type, type: 'text' },
      { key: 'department', label: labels.filters.department, type: 'text' },
    ];
  }
  if (report === 'investigations') {
    return [
      { key: 'status', label: labels.filters.status, type: 'select', options: optionsFrom(INVESTIGATION_STATUS_VALUES) },
      { key: 'type', label: labels.table.category, type: 'text' },
      { key: 'department', label: labels.filters.department, type: 'text' },
    ];
  }
  if (report === 'contracts') {
    return [
      { key: 'status', label: labels.filters.status, type: 'select', options: optionsFrom(CONTRACT_STATUS_VALUES, enumLabels.contractStatuses) },
      { key: 'type', label: labels.filters.type, type: 'select', options: optionsFrom(CONTRACT_TYPE_VALUES, labels.enums.contractTypes) },
      { key: 'risk_level', label: labels.filters.riskLevel, type: 'select', options: optionsFrom(RISK_VALUES, enumLabels.severity) },
      { key: 'department', label: labels.filters.department, type: 'text' },
      { key: 'tag', label: labels.filters.tag, type: 'text' },
    ];
  }
  if (report === 'matters') {
    return [
      { key: 'status', label: labels.filters.status, type: 'select', options: optionsFrom(MATTER_STATUS_VALUES, labels.enums.matterStatuses) },
      { key: 'type', label: labels.filters.type, type: 'select', options: optionsFrom(MATTER_TYPE_VALUES, labels.enums.matterTypes) },
      { key: 'priority', label: labels.filters.priority, type: 'select', options: optionsFrom(PRIORITY_VALUES, enumLabels.severity) },
      { key: 'department', label: labels.filters.department, type: 'text' },
      { key: 'tag', label: labels.filters.tag, type: 'text' },
    ];
  }
  return [
    { key: 'status', label: labels.filters.status, type: 'select', options: optionsFrom(OBLIGATION_STATUS_VALUES, labels.enums.obligationStatuses) },
    { key: 'type', label: labels.filters.type, type: 'select', options: optionsFrom(OBLIGATION_TYPE_VALUES, labels.enums.obligationTypes) },
    { key: 'priority', label: labels.filters.priority, type: 'select', options: optionsFrom(PRIORITY_VALUES, enumLabels.severity) },
    { key: 'overdue', label: labels.filters.overdue, type: 'select', options: [{ label: labels.filters.overdueYes, value: 'true' }] },
    { key: 'tag', label: labels.filters.tag, type: 'text' },
  ];
}

function optionsFrom(values: string[], enumMap: Record<string, string> = {}) {
  return values.map((value) => ({ label: resolveEnum(enumMap, value), value }));
}

async function fetchReport(report: ReportKind, params: FetchParams, analyticsQuery: LexReportQuery): Promise<ReportResponse> {
  if (report === 'cases') {
    return lexReportsApi.getCaseReport(analyticsQuery);
  }
  if (report === 'investigations') {
    return lexReportsApi.getInvestigationReport(analyticsQuery);
  }
  if (report === 'contracts') {
    return enterpriseApi.lex.getContractReport(params);
  }
  if (report === 'matters') {
    return enterpriseApi.lex.getMatterReport(params);
  }
  return enterpriseApi.lex.getObligationReport(params);
}

function collectActiveFilters(params: URLSearchParams, report: ReportKind): Record<string, string | string[]> {
  const allowed = REPORT_FILTER_KEYS[report];
  const filters: Record<string, string | string[]> = {};
  params.forEach((value, key) => {
    if (RESERVED_PARAMS.has(key) || !allowed.has(key)) {
      return;
    }
    const existing = filters[key];
    if (existing) {
      filters[key] = Array.isArray(existing) ? [...existing, value] : [existing, value];
    } else {
      filters[key] = value;
    }
  });
  return filters;
}

function buildRequestFilters(
  report: ReportKind,
  activeFilters: Record<string, string | string[]>,
  range: ReportDateRange,
): Record<string, string | string[]> {
  const filters: Record<string, string | string[]> = { ...activeFilters };
  if (report === 'cases' || report === 'investigations') {
    return filters;
  }
  if (!range.from && !range.to) {
    return filters;
  }

  if (report === 'contracts') {
    const days = range.to ? differenceInCalendarDays(endOfDay(range.to), startOfDay(new Date())) : null;
    if (days !== null && days >= 0) {
      filters.expiring_in_days = String(days);
    }
    return filters;
  }

  if (range.from) {
    filters.due_after = formatDateParam(range.from);
  }
  if (range.to) {
    filters.due_before = formatDateParam(range.to);
  }
  return filters;
}

function buildCurrentViewParams(
  report: ReportKind,
  searchValue: string,
  sortColumn: string,
  sortDirection: 'asc' | 'desc',
  range: ReportDateRange,
  filters: Record<string, string | string[]>,
): Record<string, string | string[]> {
  const params: Record<string, string | string[]> = {
    report,
    sort: sortColumn,
    order: sortDirection,
    ...filters,
  };
  if (searchValue) {
    params.search = searchValue;
  }
  if (range.from) {
    params.from = formatDateParam(range.from);
  }
  if (range.to) {
    params.to = formatDateParam(range.to);
  }
  return params;
}

function presetMatches(current: Record<string, string | string[]>, preset: ReportPreset): boolean {
  if (current.report !== preset.report) {
    return false;
  }
  return Object.entries(preset.params).every(([key, value]) => {
    if (value === undefined) {
      return true;
    }
    const currentValue = current[key];
    if (Array.isArray(value) || Array.isArray(currentValue)) {
      const left = Array.isArray(currentValue) ? [...currentValue].sort() : currentValue ? [currentValue] : [];
      const right = Array.isArray(value) ? [...value].sort() : [value];
      return left.length === right.length && left.every((entry, index) => entry === right[index]);
    }
    return currentValue === value;
  });
}

function normalizeReport(value: string | null | undefined): ReportKind {
  return REPORT_KINDS.includes(value as ReportKind) ? (value as ReportKind) : 'contracts';
}

function normalizeSort(report: ReportKind, value: string | null | undefined): string | undefined {
  if (!value || !REPORT_SORT_KEYS[report].has(value)) {
    return undefined;
  }
  return value;
}

function normalizeOrder(value: string | null | undefined, fallback: 'asc' | 'desc'): 'asc' | 'desc' {
  return value === 'asc' || value === 'desc' ? value : fallback;
}

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function parsePositiveInt(value: string | null, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseDateParam(value: string | null): Date | undefined {
  if (!value) {
    return undefined;
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return undefined;
  }
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.valueOf()) ? undefined : date;
}

function formatDateParam(date: Date): string {
  return format(date, 'yyyy-MM-dd');
}

/**
 * listHref builds a pre-filtered list URL (e.g. /lex/contracts?status=active).
 * The destination list pages read non-reserved query params as active filters
 * via useDataTable, so the segment a user clicks becomes the applied filter.
 */
function listHref(basePath: string, key: string, value: string): string {
  return `${basePath}?${key}=${encodeURIComponent(value)}`;
}

function reportDrilldownHref(
  report: 'cases' | 'investigations',
  filters: LexCaseReport['filters'] | LexInvestigationReport['filters'],
  updates: Partial<LexReportQuery>,
): string {
  const params = new URLSearchParams({ report });
  const resolved = { ...filters, ...updates };
  for (const key of ['from', 'to', 'department', 'status', 'type'] as const) {
    const value = resolved[key];
    if (value) params.set(key, value);
  }
  return `/lex/reports?${params.toString()}`;
}

function normalizeRisk(value: string): 'critical' | 'high' | 'medium' | 'low' | 'info' {
  switch (value) {
    case 'critical':
    case 'high':
    case 'medium':
    case 'low':
      return value;
    default:
      return 'info';
  }
}

function normalizePriority(value: string): 'critical' | 'high' | 'medium' | 'low' | 'info' {
  switch (value) {
    case 'critical':
    case 'high':
    case 'medium':
    case 'low':
      return value;
    default:
      return 'info';
  }
}

function formatDueWindow(daysUntilDue: number, labels: ReportsLabels, f: LexFormatter): string {
  if (daysUntilDue < 0) {
    return labels.dueWindow.overdue(f.formatNumber(Math.abs(daysUntilDue)));
  }
  if (daysUntilDue === 0) {
    return labels.dueWindow.today;
  }
  return labels.dueWindow.dueIn(f.formatNumber(daysUntilDue));
}

function exportSelectedContracts(selectedIds: string[], rows: LexContractSummary[], labels: ReportsLabels): void {
  const selected = selectedVisibleRows(selectedIds, rows);
  downloadCsv(
    `watheeq-contracts-selected-${new Date().toISOString().slice(0, 10)}.csv`,
    [labels.table.title, labels.table.status, labels.table.type, labels.table.risk, labels.table.expiryDate, labels.table.createdAt],
    selected.map((contract) => [
      contract.title,
      contract.status,
      resolveEnum(labels.enums.contractTypes, contract.type),
      contract.risk_level,
      contract.expiry_date ?? '',
      contract.created_at,
    ]),
  );
}

function exportSelectedMatters(selectedIds: string[], rows: LexMatterSummary[], labels: ReportsLabels): void {
  const selected = selectedVisibleRows(selectedIds, rows);
  downloadCsv(
    `watheeq-matters-selected-${new Date().toISOString().slice(0, 10)}.csv`,
    [labels.table.title, labels.table.status, labels.table.type, labels.table.priority, labels.table.owner, labels.table.dueDate, labels.table.createdAt],
    selected.map((matter) => [
      matter.title,
      resolveEnum(labels.enums.matterStatuses, matter.status),
      resolveEnum(labels.enums.matterTypes, matter.type),
      matter.priority,
      matter.owner_name || labels.rows.unassigned,
      matter.due_date ?? '',
      matter.created_at,
    ]),
  );
}

function exportSelectedObligations(selectedIds: string[], rows: LexObligationSummary[], labels: ReportsLabels): void {
  const selected = selectedVisibleRows(selectedIds, rows);
  downloadCsv(
    `watheeq-obligations-selected-${new Date().toISOString().slice(0, 10)}.csv`,
    [labels.table.title, labels.table.status, labels.table.type, labels.table.priority, labels.table.owner, labels.table.source, labels.table.dueDate, labels.table.createdAt],
    selected.map((obligation) => [
      obligation.title,
      resolveEnum(labels.enums.obligationStatuses, obligation.status),
      resolveEnum(labels.enums.obligationTypes, obligation.type),
      obligation.priority,
      obligation.owner_name || labels.rows.unassigned,
      obligation.contract_title || obligation.matter_title || labels.rows.unlinked,
      obligation.due_date,
      obligation.created_at,
    ]),
  );
}

function selectedVisibleRows<TData extends { id: string }>(selectedIds: string[], rows: TData[]): TData[] {
  const selected = new Set(selectedIds);
  return rows.filter((row) => selected.has(row.id));
}

function downloadCsv(filename: string, headers: string[], rows: Array<Array<string | number | null | undefined>>): void {
  const lines = [headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\n');
  downloadBlob(new Blob([lines], { type: 'text/csv;charset=utf-8' }), filename);
}

function csvCell(value: string | number | null | undefined): string {
  const text = value == null ? '' : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
