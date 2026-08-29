/**
 * <ContractsAnalyticsView> — the 4th contracts list view (table / board /
 * calendar / ANALYTICS) for `/lex/contracts`.
 *
 * A read-only analytics workspace over the CURRENT filter set:
 *   - headline tiles: contracts in scope, total value (per-currency split),
 *     next-12-month expiry exposure;
 *   - cycle-time headline (avg / p50 / p90 draft→active) — {@link ContractsCycleTimeCard};
 *   - spend by type + spend by department bars — {@link ContractsSpendChart};
 *   - risk distribution donut — {@link ContractsRiskDonut};
 *   - 24-month expiry cliff (count | value) — {@link ContractsExpiryCliffChart}.
 *
 * DATA — two queries:
 *   1. `lexReportsApi.getContractAnalytics(query)` with the page's
 *      `activeFilters` mapped through the pure `toContractAnalyticsScope`
 *      helper. The endpoint scopes on department/status/type only; every other
 *      active filter is surfaced in a "not applied" notice instead of being
 *      silently dropped.
 *   2. `enterpriseApi.lex.getContractStats()` for the risk donut — the SAME
 *      query key + staleTime as the page's KPI tiles, so TanStack dedupes the
 *      two consumers onto one request.
 *
 * RBAC: strictly read-only (no mutation surface), so nothing to gate beyond
 * the page's own route/view gate. Bilingual EN/AR via the canonical
 * `LexBilingual` contract; all numbers ride `useLexFormat` (SAR-first,
 * Arabic-Indic digits under `ar`); layout is logical-properties-only (RTL-safe).
 */

'use client';

import { memo, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Filter } from 'lucide-react';
import { StatTile } from '@/components/shared/stat-tile';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { useLexFormat } from '@/lib/lex/ksa';
import { lexReportsApi, type LexValueBucket } from '@/lib/lex/reports';
import { enterpriseApi } from '@/lib/enterprise';
import { cn } from '@/lib/utils';
import { type LexBilingual, resolveLexBilingual } from '../../_lib/lex-i18n';
import {
  deriveCurrencyTotals,
  deriveSpendRows,
  SPEND_OTHER_KEY,
  summarizeExpiryCliff,
  toContractAnalyticsScope,
} from '../_lib/contracts-analytics';
import { contractTypeLabels } from '../_lib/contracts-labels';
import { ContractsCycleTimeCard } from './contracts-cycle-time-card';
import { ContractsExpiryCliffChart } from './contracts-expiry-cliff-chart';
import { ContractsRiskDonut } from './contracts-risk-donut';
import { ContractsSpendChart } from './contracts-spend-chart';
import {
  SPEND_BY_DEPARTMENT_COLOR,
  SPEND_BY_TYPE_COLOR,
} from './contracts-analytics-palette';

/* ---------------------------- Bilingual labels ---------------------------- */

export interface ContractsAnalyticsLabels {
  tiles: {
    total: string;
    totalValue: string;
    expiry12m: string;
    /** Sub-line under the expiry tile. Receives a PRE-FORMATTED value. */
    expiry12mValue: (value: string) => string;
    undisclosed: string;
    noData: string;
  };
  charts: {
    spendByTypeTitle: string;
    spendByTypeDescription: string;
    spendByDepartmentTitle: string;
    spendByDepartmentDescription: string;
  };
  /** "Charts follow …" lead of the partial-scope notice. */
  scopeNoticeLead: string;
  /** Trailing list label of the notice. Receives the joined filter names. */
  scopeNoticeUnapplied: (filters: string) => string;
  /** Display names for filter keys the analytics rollup cannot apply. */
  filterNames: Record<string, string>;
  loadError: string;
  /** Footer freshness line. Receives a PRE-FORMATTED relative time. */
  generatedAt: (relative: string) => string;
}

export const contractsAnalyticsLabels: LexBilingual<ContractsAnalyticsLabels> = {
  en: {
    tiles: {
      total: 'Contracts in scope',
      totalValue: 'Total value',
      expiry12m: 'Expiring ≤12 months',
      expiry12mValue: (value) => `${value} at stake`,
      undisclosed: 'Undisclosed',
      noData: '—',
    },
    charts: {
      spendByTypeTitle: 'Spend by type',
      spendByTypeDescription: 'Total contract value per contract type in the current scope.',
      spendByDepartmentTitle: 'Spend by department',
      spendByDepartmentDescription:
        'Total contract value per requesting department in the current scope.',
    },
    scopeNoticeLead: 'Charts follow the department, status, and type filters.',
    scopeNoticeUnapplied: (filters) => `Not applied here: ${filters}.`,
    filterNames: {
      status: 'Status',
      type: 'Type',
      risk_level: 'Risk',
      department: 'Department',
      tag: 'Tag',
      owner_user_id: 'Owner',
      org_entity_id: 'Legal entity',
      expiry_from: 'Expiry from',
      expiry_to: 'Expiry to',
      expiring_in_days: 'Expiring window',
      search: 'Search',
    },
    loadError: 'Unable to load the contract analytics report.',
    generatedAt: (relative) => `Generated ${relative}`,
  },
  ar: {
    tiles: {
      total: 'العقود ضمن النطاق',
      totalValue: 'القيمة الإجمالية',
      expiry12m: 'تنتهي خلال ١٢ شهرًا',
      expiry12mValue: (value) => `${value} قيمة معرّضة`,
      undisclosed: 'غير مُفصح عنها',
      noData: '—',
    },
    charts: {
      spendByTypeTitle: 'الإنفاق حسب النوع',
      spendByTypeDescription: 'القيمة الإجمالية للعقود لكل نوع عقد ضمن النطاق الحالي.',
      spendByDepartmentTitle: 'الإنفاق حسب الإدارة',
      spendByDepartmentDescription:
        'القيمة الإجمالية للعقود لكل إدارة طالبة ضمن النطاق الحالي.',
    },
    scopeNoticeLead: 'تتبع الرسوم البيانية مرشّحات الإدارة والحالة والنوع.',
    scopeNoticeUnapplied: (filters) => `غير مطبَّقة هنا: ${filters}.`,
    filterNames: {
      status: 'الحالة',
      type: 'النوع',
      risk_level: 'المخاطر',
      department: 'الإدارة',
      tag: 'الوسم',
      owner_user_id: 'المالك',
      org_entity_id: 'الكيان القانوني',
      expiry_from: 'الانتهاء من',
      expiry_to: 'الانتهاء إلى',
      expiring_in_days: 'نافذة الانتهاء',
      search: 'البحث',
    },
    loadError: 'تعذّر تحميل تقرير تحليلات العقود.',
    generatedAt: (relative) => `أُنشئ ${relative}`,
  },
};

export function useContractsAnalyticsLabels(): ContractsAnalyticsLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveLexBilingual(contractsAnalyticsLabels, locale), [locale]);
}

/* -------------------------- Headline KPI tile ----------------------------- */

function AnalyticsHeadlineTile({
  label,
  value,
  subLines,
  loading,
  onAction,
}: {
  label: string;
  value: string;
  /** Optional small lines under the value (e.g. per-currency split). */
  subLines?: string[];
  loading?: boolean;
  onAction: () => void;
}) {
  return (
    <StatTile
      label={label}
      value={value}
      loading={loading}
      size="md"
      appearance="operational"
      className="contract-analytics-kpi-card"
      onAction={onAction}
      spark={
        subLines && subLines.length > 0 ? (
          <div className="space-y-1 text-start">
            {subLines.map((line) => (
              <p key={line} className="text-xs tabular-nums text-muted-foreground">
                <bdi dir="ltr">{line}</bdi>
              </p>
            ))}
          </div>
        ) : undefined
      }
    />
  );
}

/* --------------------------------- View ----------------------------------- */

export interface ContractsAnalyticsViewProps {
  /** `activeFilters` from `useDataTable` — the scope the charts mirror. */
  filters: Record<string, string | string[]>;
  onOpenRecords: (filters: Record<string, string | string[]>) => void;
  className?: string;
}

function ContractsAnalyticsViewImpl({ filters, onOpenRecords, className }: ContractsAnalyticsViewProps) {
  const labels = useContractsAnalyticsLabels();
  const { locale } = useLocaleOrDefault();
  const f = useLexFormat();
  const typeLabels = useMemo(() => resolveLexBilingual(contractTypeLabels, locale), [locale]);

  const scope = useMemo(() => toContractAnalyticsScope(filters), [filters]);

  const analyticsQuery = useQuery({
    queryKey: ['lex-contracts', 'analytics', scope.query],
    queryFn: () => lexReportsApi.getContractAnalytics(scope.query),
    staleTime: 60_000,
  });

  // Same key + staleTime as the page's KPI tiles — one shared fetch.
  const statsQuery = useQuery({
    queryKey: ['lex-contracts', 'stats'],
    queryFn: () => enterpriseApi.lex.getContractStats(),
    staleTime: 60_000,
  });

  const report = analyticsQuery.data;
  const reportLoading = analyticsQuery.isLoading;
  const reportError = analyticsQuery.isError ? labels.loadError : undefined;
  const retryReport = () => void analyticsQuery.refetch();

  const currencyTotals = useMemo(
    () => deriveCurrencyTotals(report?.total_value_by_currency, 3),
    [report?.total_value_by_currency],
  );
  const expirySummary = useMemo(
    () => summarizeExpiryCliff(report?.expiry_cliff, 12),
    [report?.expiry_cliff],
  );

  const scopeFilters = useMemo<Record<string, string | string[]>>(
    () =>
      Object.fromEntries(
        Object.entries(scope.query).filter((entry): entry is [string, string] =>
          typeof entry[1] === 'string' && entry[1].length > 0,
        ),
      ),
    [scope.query],
  );

  const bucketFilter = (
    key: string,
    buckets: LexValueBucket[] | null | undefined,
  ): string | string[] => {
    if (key !== SPEND_OTHER_KEY) return key;
    const displayed = new Set(
      deriveSpendRows(buckets, 8)
        .filter((row) => row.key !== SPEND_OTHER_KEY)
        .map((row) => row.key),
    );
    return (buckets ?? []).map((bucket) => bucket.key).filter((value) => !displayed.has(value));
  };

  const openExpiryMonths = (startMonth: string, months: number) => {
    const start = new Date(`${startMonth}-01T00:00:00Z`);
    if (Number.isNaN(start.valueOf())) return;
    const end = new Date(start);
    end.setUTCMonth(end.getUTCMonth() + months);
    const statuses = scopeFilters.status ?? [
      'draft',
      'internal_review',
      'legal_review',
      'negotiation',
      'pending_signature',
      'active',
      'suspended',
      'expired',
      'renewed',
    ];
    onOpenRecords({
      ...scopeFilters,
      status: statuses,
      expiry_from: start.toISOString().slice(0, 10),
      expiry_to: end.toISOString().slice(0, 10),
    });
  };

  const resolveTypeLabel = useMemo(
    () => (key: string) => typeLabels[key] ?? key.replace(/_/g, ' '),
    [typeLabels],
  );

  const unappliedNames = scope.unsupportedKeys
    .map((key) => labels.filterNames[key] ?? key)
    .join(locale === 'ar' ? '، ' : ', ');

  // Total-value tile: per-currency compact lines (SAR first); when the split
  // is absent fall back to the raw cross-currency sum as a plain number.
  const totalValueDisplay = (() => {
    if (!report) return labels.tiles.noData;
    if (currencyTotals.length > 0) {
      return f.formatCurrencyCompact(currencyTotals[0].value, {
        currency: currencyTotals[0].currency,
      });
    }
    if (typeof report.total_value === 'number' && report.total_value > 0) {
      return f.formatCompact(report.total_value);
    }
    return labels.tiles.undisclosed;
  })();
  const totalValueSubLines = currencyTotals
    .slice(1)
    .map((entry) => f.formatCurrencyCompact(entry.value, { currency: entry.currency }));

  return (
    <div className={cn('space-y-4', className)}>
      {scope.unsupportedKeys.length > 0 ? (
        <p
          className="flex items-start gap-2 rounded-lg border border-severity-medium/40 bg-severity-medium/10 px-3 py-2 text-xs text-foreground"
          role="status"
        >
          <Filter className="mt-0.5 h-3.5 w-3.5 shrink-0 text-severity-medium" aria-hidden />
          <span>
            {labels.scopeNoticeLead}{' '}
            <span className="font-medium">{labels.scopeNoticeUnapplied(unappliedNames)}</span>
          </span>
        </p>
      ) : null}

      <div className="contracts-analytics-kpi-grid grid grid-cols-2 gap-3 lg:grid-cols-3">
        <AnalyticsHeadlineTile
          label={labels.tiles.total}
          value={report ? f.formatNumber(report.total) : labels.tiles.noData}
          loading={reportLoading}
          onAction={() => onOpenRecords(scopeFilters)}
        />
        <AnalyticsHeadlineTile
          label={labels.tiles.totalValue}
          value={totalValueDisplay}
          subLines={totalValueSubLines}
          loading={reportLoading}
          onAction={() => onOpenRecords(scopeFilters)}
        />
        <AnalyticsHeadlineTile
          label={labels.tiles.expiry12m}
          value={report ? f.formatNumber(expirySummary.count) : labels.tiles.noData}
          subLines={
            report && expirySummary.value > 0
              ? [labels.tiles.expiry12mValue(f.formatCompact(expirySummary.value))]
              : undefined
          }
          loading={reportLoading}
          onAction={() => {
            const firstMonth = report?.expiry_cliff?.[0]?.month;
            if (firstMonth) openExpiryMonths(firstMonth, 12);
          }}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ContractsSpendChart
          title={labels.charts.spendByTypeTitle}
          description={labels.charts.spendByTypeDescription}
          buckets={report?.spend_by_type}
          resolveKeyLabel={resolveTypeLabel}
          color={SPEND_BY_TYPE_COLOR}
          loading={reportLoading}
          error={reportError}
          onRetry={retryReport}
          onBucketSelect={(key) =>
            onOpenRecords({
              ...scopeFilters,
              type: bucketFilter(key, report?.spend_by_type),
            })
          }
        />
        <ContractsSpendChart
          title={labels.charts.spendByDepartmentTitle}
          description={labels.charts.spendByDepartmentDescription}
          buckets={report?.spend_by_department}
          color={SPEND_BY_DEPARTMENT_COLOR}
          loading={reportLoading}
          error={reportError}
          onRetry={retryReport}
          onBucketSelect={(key) =>
            onOpenRecords({
              ...scopeFilters,
              department: bucketFilter(key, report?.spend_by_department),
            })
          }
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ContractsRiskDonut
          byRiskLevel={statsQuery.data?.by_risk_level}
          loading={statsQuery.isLoading}
          onRetry={() => void statsQuery.refetch()}
          onRiskSelect={(risk) => onOpenRecords({ risk_level: risk })}
        />
        <ContractsCycleTimeCard
          stats={report?.cycle_time}
          loading={reportLoading}
          onAction={() =>
            onOpenRecords({
              ...scopeFilters,
              status: ['active', 'renewed'],
            })
          }
        />
      </div>

      <ContractsExpiryCliffChart
        points={report?.expiry_cliff}
        loading={reportLoading}
        error={reportError}
        onRetry={retryReport}
        onMonthSelect={(month) => openExpiryMonths(month, 1)}
      />

      {report?.generated_at ? (
        <p className="text-end text-xs text-muted-foreground">
          {labels.generatedAt(f.formatRelative(report.generated_at))}
        </p>
      ) : null}
    </div>
  );
}

/** PERF: memo — re-renders only when the page's `filters` identity changes. */
export const ContractsAnalyticsView = memo(ContractsAnalyticsViewImpl);
