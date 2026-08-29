'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Download, RotateCcw } from 'lucide-react';
import { startOfMonth } from 'date-fns';
import { LexRouteGuard } from '../../_guards/lex-route-guard';
import { LexListShell } from '@/components/lex/list-shell';
import { SearchInput } from '@/components/shared/forms/search-input';
import {
  DateRangePicker,
  type DateRange,
} from '@/components/shared/forms/date-range-picker';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useDataTable } from '@/hooks/use-data-table';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { downloadBlob } from '@/lib/format';
import { showApiError } from '@/lib/toast';
import {
  CONSULTATION_STATUS_VALUES,
  CONSULTATION_TYPE_VALUES,
  consultationsApi,
  type Consultation,
} from '@/lib/lex/consultations';
import type { FetchParams } from '@/types/table';
import { useConsultationLabels } from '../_components/labels';
import { ConsultationArchiveKpis } from './_components/archive-kpis';
import { useConsultationArchiveLabels } from './_components/archive-labels';
import { ConsultationArchiveTable } from './_components/archive-table';
import { buildConsultationsCsv } from './_components/archive-utils';

const ALL = '__all__';

interface FilterOption {
  value: string;
  label: string;
}

function ArchiveFilterSelect({
  value,
  placeholder,
  options,
  ariaLabel,
  onChange,
}: {
  value?: string;
  placeholder: string;
  options: FilterOption[];
  ariaLabel: string;
  onChange: (value: string | undefined) => void;
}) {
  return (
    <Select
      value={value || ALL}
      onValueChange={(next) => onChange(next === ALL ? undefined : next)}
    >
      <SelectTrigger className="w-full bg-background" aria-label={ariaLabel}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{placeholder}</SelectItem>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function filterValue(
  filters: Record<string, string | string[]>,
  key: string,
): string | undefined {
  const value = filters[key];
  return typeof value === 'string' ? value : undefined;
}

function consultationCatalogOptions(consultations: Consultation[]) {
  const advisors = new Map<string, string>();
  const departments = new Set<string>();

  for (const consultation of consultations) {
    if (consultation.advisor_id && consultation.advisor_name) {
      advisors.set(consultation.advisor_id, consultation.advisor_name);
    }
    if (consultation.department?.trim()) {
      departments.add(consultation.department.trim());
    }
  }

  return {
    advisors: [...advisors.entries()]
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label)),
    departments: [...departments]
      .sort((a, b) => a.localeCompare(b))
      .map((department) => ({ value: department, label: department })),
  };
}

async function fetchAllConsultations(
  params: Omit<FetchParams, 'page' | 'per_page'>,
): Promise<Consultation[]> {
  const first = await consultationsApi.list({
    ...params,
    page: 1,
    per_page: 200,
  });
  const rows = [...first.data];

  for (let page = 2; page <= first.meta.total_pages; page += 1) {
    const next = await consultationsApi.list({
      ...params,
      page,
      per_page: 200,
    });
    rows.push(...next.data);
  }

  return rows;
}

export default function ConsultationArchivePage() {
  const labels = useConsultationArchiveLabels();
  const consultationLabels = useConsultationLabels();
  const { locale } = useLocaleOrDefault();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [exporting, setExporting] = useState(false);

  const {
    data,
    totalRows,
    tableProps,
    page,
    pageSize,
    setPage,
    setPageSize,
    searchValue,
    setSearch,
    activeFilters,
    setFilter,
    clearFilters,
    refetch,
  } = useDataTable<Consultation>({
    queryKey: 'lex-consultations-archive',
    fetchFn: (params) => consultationsApi.list(params),
    defaultPageSize: 10,
    defaultSort: { column: 'created_at', direction: 'desc' },
    wsTopics: ['lex.consultations'],
  });

  const totalsQuery = useQuery({
    queryKey: ['lex-consultations-archive-stats'],
    queryFn: () => consultationsApi.stats(),
    staleTime: 60_000,
  });

  const monthRange = useMemo(() => {
    const now = new Date();
    return {
      created_from: startOfMonth(now).toISOString(),
      created_to: now.toISOString(),
    };
  }, []);

  const monthlyQuery = useQuery({
    queryKey: ['lex-consultations-archive-month-stats', monthRange],
    queryFn: () =>
      consultationsApi.stats({
        page: 1,
        per_page: 1,
        filters: monthRange,
      }),
    staleTime: 60_000,
  });

  const catalogQuery = useQuery({
    queryKey: ['lex-consultations-archive-filter-catalog'],
    queryFn: () =>
      fetchAllConsultations({
        sort: 'updated_at',
        order: 'desc',
      }),
    staleTime: 5 * 60_000,
  });

  const catalog = useMemo(
    () => consultationCatalogOptions(catalogQuery.data ?? data),
    [catalogQuery.data, data],
  );

  const createdFrom = filterValue(activeFilters, 'created_from');
  const createdTo = filterValue(activeFilters, 'created_to');
  const dateRange: DateRange = {
    from: createdFrom ? new Date(createdFrom) : undefined,
    to: createdTo ? new Date(createdTo) : undefined,
  };

  const setDateRange = (range: DateRange) => {
    // Both bounds must be written in one navigation. Calling setFilter twice
    // would reuse the same URL snapshot and the second push could drop `from`.
    const params = new URLSearchParams(searchParams?.toString() ?? '');
    if (range.from) params.set('created_from', range.from.toISOString());
    else params.delete('created_from');
    if (range.to) params.set('created_to', range.to.toISOString());
    else params.delete('created_to');
    params.set('page', '1');
    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname);
  };

  const statusOptions = CONSULTATION_STATUS_VALUES.map((status) => ({
    value: status,
    label: consultationLabels.filters.statusOptions[status],
  }));
  const typeOptions = CONSULTATION_TYPE_VALUES.map((type) => ({
    value: type,
    label: consultationLabels.filters.typeOptions[type],
  }));

  const exportResults = async () => {
    setExporting(true);
    try {
      const result = await fetchAllConsultations({
        sort: tableProps.sortColumn,
        order: tableProps.sortDirection,
        search: searchValue || undefined,
        filters:
          Object.keys(activeFilters).length > 0 ? activeFilters : undefined,
      });
      const csv = buildConsultationsCsv(result, locale, labels);
      downloadBlob(
        new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }),
        `legal-consultations-archive-${new Date().toISOString().slice(0, 10)}.csv`,
      );
    } catch (error) {
      showApiError(error);
    } finally {
      setExporting(false);
    }
  };

  const kpiLoading = totalsQuery.isLoading || monthlyQuery.isLoading;
  const kpiError = totalsQuery.isError || monthlyQuery.isError;

  return (
    <LexRouteGuard route="/lex/consultations/archive">
      <LexListShell
        title={labels.title}
        description={labels.description}
        eyebrow={labels.eyebrow}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="outline">
              <Link href="/lex/consultations">{labels.backToConsultations}</Link>
            </Button>
            <Button
              type="button"
              onClick={() => void exportResults()}
              disabled={exporting}
              className="bg-primary text-primary-foreground hover:bg-brand-primary-700 active:bg-brand-primary-800"
            >
              <Download className="me-2 h-4 w-4" aria-hidden />
              {exporting ? labels.exporting : labels.exportResults}
            </Button>
          </div>
        }
        kpi={
          <ConsultationArchiveKpis
            totals={totalsQuery.data}
            monthly={monthlyQuery.data}
            loading={kpiLoading}
            error={kpiError}
          />
        }
        filters={
          <div className="space-y-3">
            <SearchInput
              value={searchValue}
              onChange={setSearch}
              placeholder={labels.filters.search}
              aria-label={labels.filters.search}
              loading={tableProps.isLoading}
              className="w-full"
            />
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-5">
              <DateRangePicker
                value={dateRange}
                onChange={setDateRange}
                labels={{ placeholder: labels.filters.allDates }}
                className="w-full"
              />
              <ArchiveFilterSelect
                value={filterValue(activeFilters, 'advisor_id')}
                placeholder={labels.filters.allAdvisors}
                ariaLabel={labels.filters.allAdvisors}
                options={catalog.advisors}
                onChange={(value) => setFilter('advisor_id', value)}
              />
              <ArchiveFilterSelect
                value={filterValue(activeFilters, 'department')}
                placeholder={labels.filters.allDepartments}
                ariaLabel={labels.filters.allDepartments}
                options={catalog.departments}
                onChange={(value) => setFilter('department', value)}
              />
              <ArchiveFilterSelect
                value={filterValue(activeFilters, 'status')}
                placeholder={labels.filters.allStatuses}
                ariaLabel={labels.filters.allStatuses}
                options={statusOptions}
                onChange={(value) => setFilter('status', value)}
              />
              <ArchiveFilterSelect
                value={filterValue(activeFilters, 'type')}
                placeholder={labels.filters.allTypes}
                ariaLabel={labels.filters.allTypes}
                options={typeOptions}
                onChange={(value) => setFilter('type', value)}
              />
            </div>
            {Object.keys(activeFilters).length > 0 || searchValue ? (
              <Button type="button" variant="ghost" size="sm" onClick={clearFilters}>
                <RotateCcw className="me-2 h-4 w-4" aria-hidden />
                {labels.filters.clear}
              </Button>
            ) : null}
          </div>
        }
        framedBody={false}
      >
        <ConsultationArchiveTable
          consultations={data}
          totalRows={totalRows}
          page={page}
          pageSize={pageSize}
          loading={tableProps.isLoading}
          error={tableProps.error}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
          onRetry={refetch}
        />
      </LexListShell>
    </LexRouteGuard>
  );
}
