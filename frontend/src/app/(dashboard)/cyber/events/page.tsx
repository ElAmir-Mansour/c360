'use client';

import { useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Activity, Copy, FileJson } from 'lucide-react';
import { useState } from 'react';
import { PageHeader } from '@/components/common/page-header';
import { PermissionRedirect } from '@/components/common/permission-redirect';
import { DataTable } from '@/components/shared/data-table/data-table';
import { KpiCard } from '@/components/shared/kpi-card';
import { PieChart } from '@/components/shared/charts/pie-chart';
import { BarChart } from '@/components/shared/charts/bar-chart';
import { useDataTable } from '@/hooks/use-data-table';
import api, { apiGet } from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';
import { chartVar, normalizeSeverity, severityVar } from '@/lib/design-tokens';
import { downloadBlob } from '@/lib/format';
import { showSuccess, showError } from '@/lib/toast';
import type { PaginatedResponse } from '@/types/api';
import type { FetchParams, FilterConfig, RowAction } from '@/types/table';
import type { DetectionRule, SecurityEvent, EventStats } from '@/types/cyber';

import { getEventColumns } from './_components/event-columns';
import { EventDetailPanel } from './_components/event-detail-panel';
import { useEventLabels, type eventLabels } from './_lib/events-i18n';

type EventFilterLabels = (typeof eventLabels)['en']['filters'];

function buildEventFilters(
  labels: EventFilterLabels,
  ruleOptions: Array<{ label: string; value: string }>,
): FilterConfig[] {
  return [
    {
      key: 'time_range',
      label: labels.timeRange,
      type: 'date-range',
    },
    {
      key: 'severity',
      label: labels.severity,
      type: 'multi-select',
      options: [
        { label: labels.critical, value: 'critical' },
        { label: labels.high, value: 'high' },
        { label: labels.medium, value: 'medium' },
        { label: labels.low, value: 'low' },
        { label: labels.info, value: 'info' },
      ],
    },
    {
      key: 'protocol',
      label: labels.protocol,
      type: 'multi-select',
      options: [
        { label: 'TCP', value: 'TCP' },
        { label: 'UDP', value: 'UDP' },
        { label: 'ICMP', value: 'ICMP' },
        { label: 'HTTP', value: 'HTTP' },
        { label: 'DNS', value: 'DNS' },
      ],
    },
    {
      key: 'source',
      label: labels.source,
      type: 'text',
      placeholder: labels.placeholderSource,
    },
    {
      key: 'type',
      label: labels.eventType,
      type: 'text',
      placeholder: labels.placeholderType,
    },
    {
      key: 'source_ip',
      label: labels.sourceIp,
      type: 'text',
      placeholder: labels.placeholderSourceIp,
    },
    {
      key: 'dest_ip',
      label: labels.destIp,
      type: 'text',
      placeholder: labels.placeholderDestIp,
    },
    {
      key: 'username',
      label: labels.username,
      type: 'text',
      placeholder: labels.placeholderUsername,
    },
    {
      key: 'process',
      label: labels.process,
      type: 'text',
      placeholder: labels.placeholderProcess,
    },
    {
      key: 'cmd_contains',
      label: labels.command,
      type: 'text',
      placeholder: labels.placeholderCommand,
    },
    {
      key: 'file_hash',
      label: labels.fileHash,
      type: 'text',
      placeholder: labels.placeholderFileHash,
    },
    {
      key: 'matched_rule',
      label: labels.ruleId,
      type: 'select',
      placeholder: labels.placeholderRuleId,
      options: ruleOptions,
    },
  ];
}

function flattenParams(params: FetchParams): Record<string, unknown> {
  const flat: Record<string, unknown> = {
    page: params.page,
    per_page: params.per_page,
    sort: params.sort,
    order: params.order,
    search: params.search,
  };
  for (const [key, value] of Object.entries(params.filters ?? {})) {
    if (key === 'time_range' && typeof value === 'string') {
      // date-range filter stores as "ISO_FROM,ISO_TO"
      const [from, to] = value.split(',');
      if (from) flat.from = from;
      if (to) flat.to = to;
    } else {
      flat[key] = value;
    }
  }
  return flat;
}

function fetchEvents(params: FetchParams): Promise<PaginatedResponse<SecurityEvent>> {
  return apiGet<PaginatedResponse<SecurityEvent>>(API_ENDPOINTS.CYBER_EVENTS, flattenParams(params));
}

export default function CyberEventsPage() {
  const t = useEventLabels();
  const [selectedEvent, setSelectedEvent] = useState<SecurityEvent | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const { tableProps } = useDataTable<SecurityEvent>({
    fetchFn: fetchEvents,
    queryKey: 'cyber-events',
    defaultPageSize: 50,
    defaultSort: { column: 'timestamp', direction: 'desc' },
  });

  // Sync stats time range with the active time_range filter
  const activeTimeRange = tableProps.activeFilters?.['time_range'];
  const [statsFrom, statsTo] =
    typeof activeTimeRange === 'string' ? activeTimeRange.split(',') : [];

  const statsQuery = useQuery({
    queryKey: ['cyber-event-stats', statsFrom, statsTo],
    queryFn: () => {
      const params: Record<string, string> = {};
      if (statsFrom) params.from = statsFrom;
      if (statsTo) params.to = statsTo;
      return apiGet<{ data: EventStats }>(API_ENDPOINTS.CYBER_EVENT_STATS, params);
    },
    refetchInterval: 60000,
  });

  const rulesQuery = useQuery({
    queryKey: ['cyber-event-filter-rules'],
    queryFn: () => {
      return apiGet<PaginatedResponse<DetectionRule>>(API_ENDPOINTS.CYBER_RULES, {
        page: 1,
        per_page: 100,
        sort: 'name',
        order: 'asc',
      });
    },
    staleTime: 5 * 60_000,
  });
  const ruleOptions = useMemo(
    () => (rulesQuery.data?.data ?? []).map((rule) => ({ label: rule.name, value: rule.id })),
    [rulesQuery.data?.data],
  );

  const stats = statsQuery.data?.data;
  const columns = useMemo(() => getEventColumns(t.columns), [t.columns]);
  const filters = useMemo(() => buildEventFilters(t.filters, ruleOptions), [ruleOptions, t.filters]);

  const rowActions = useMemo<RowAction<SecurityEvent>[]>(
    () => [
      {
        label: t.rowActions.copyId,
        icon: Copy,
        onClick: (row) => {
          navigator.clipboard.writeText(row.id);
          showSuccess(t.rowActions.eventIdCopied);
        },
      },
      {
        label: t.rowActions.copyRawJson,
        icon: FileJson,
        onClick: (row) => {
          navigator.clipboard.writeText(JSON.stringify(row.raw_event, null, 2));
          showSuccess(t.rowActions.rawJsonCopied);
        },
      },
    ],
    [t.rowActions],
  );

  const handleExport = useCallback(
    async (format: 'csv' | 'json') => {
      const serverFormat = format === 'json' ? 'ndjson' : 'csv';
      const ext = format === 'json' ? 'ndjson' : 'csv';

      // Build query params from active filters
      const exportParams: Record<string, unknown> = {};
      const filters = tableProps.activeFilters ?? {};
      for (const [key, value] of Object.entries(filters)) {
        if (key === 'time_range' && typeof value === 'string') {
          const [from, to] = value.split(',');
          if (from) exportParams.from = from;
          if (to) exportParams.to = to;
        } else {
          exportParams[key] = value;
        }
      }

      // Server-side export requires 'from'; default to 30 days ago if not set
      if (!exportParams.from) {
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        exportParams.from = thirtyDaysAgo.toISOString();
      }

      if (tableProps.searchValue) exportParams.search = tableProps.searchValue;
      if (tableProps.sortColumn) exportParams.sort = tableProps.sortColumn;
      if (tableProps.sortDirection) exportParams.order = tableProps.sortDirection;
      exportParams.format = serverFormat;

      try {
        const response = await api.get(API_ENDPOINTS.CYBER_EVENTS_EXPORT, {
          params: exportParams,
          responseType: 'blob',
        });
        const filename = `cyber-events-${new Date().toISOString().slice(0, 10)}.${ext}`;
        downloadBlob(response.data as Blob, filename);
        showSuccess(t.rowActions.exportDownloaded);
      } catch {
        showError(t.rowActions.exportFailedTitle, t.rowActions.exportFailedBody);
      }
    },
    [tableProps.activeFilters, tableProps.searchValue, tableProps.sortColumn, tableProps.sortDirection, t.rowActions],
  );

  const bySeverityChart = (stats?.by_severity ?? []).map((entry) => ({
    name: entry.name.charAt(0).toUpperCase() + entry.name.slice(1),
    value: entry.count,
    color: severityVar(normalizeSeverity(entry.name)),
  }));

  const bySourceChart = (stats?.by_source ?? []).slice(0, 10).map((entry) => ({
    name: entry.name,
    count: entry.count,
  }));

  const byTypeChart = (stats?.by_type ?? []).slice(0, 8).map((entry) => ({
    name: entry.name.replace(/_/g, ' '),
    count: entry.count,
  }));

  return (
    <PermissionRedirect permission="cyber:read">
      <div className="space-y-6">
        <PageHeader
          title={t.page.title}
          description={t.page.description}
        />

        {/* KPI Row */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <KpiCard
            title={t.kpi.totalEvents}
            value={stats?.total ?? 0}
            loading={statsQuery.isLoading}
          />
          <KpiCard
            title={t.kpi.sources}
            value={stats?.by_source?.length ?? 0}
            loading={statsQuery.isLoading}
          />
          <KpiCard
            title={t.kpi.eventTypes}
            value={stats?.by_type?.length ?? 0}
            loading={statsQuery.isLoading}
          />
          <KpiCard
            title={t.kpi.criticalHigh}
            value={
              (stats?.by_severity ?? [])
                .filter((s) => s.name === 'critical' || s.name === 'high')
                .reduce((sum, s) => sum + s.count, 0)
            }
            colorTheme="red"
            loading={statsQuery.isLoading}
          />
        </div>

        {/* Charts Row */}
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <BarChart
            title={t.charts.eventsBySource}
            data={bySourceChart}
            xKey="name"
            yKeys={[{ key: 'count', label: t.charts.events, color: chartVar(5) }]}
            cellColors={bySourceChart.map((_, i) => chartVar(i))}
            loading={statsQuery.isLoading}
            height={240}
            showLegend={false}
          />
          <BarChart
            title={t.charts.eventsByType}
            data={byTypeChart}
            xKey="name"
            yKeys={[{ key: 'count', label: t.charts.events, color: chartVar(0) }]}
            cellColors={byTypeChart.map((_, i) => chartVar(i))}
            loading={statsQuery.isLoading}
            height={240}
            showLegend={false}
          />
          <PieChart
            title={t.charts.eventsBySeverity}
            data={bySeverityChart}
            loading={statsQuery.isLoading}
            centerLabel={t.charts.eventsCenterLabel}
            centerValue={String(stats?.total ?? 0)}
            height={240}
          />
        </div>

        {/* Events Table */}
        <DataTable
          columns={columns}
          filters={filters}
          searchPlaceholder={t.page.searchPlaceholder}
          emptyState={{
            icon: Activity,
            title: t.page.emptyTitle,
            description: t.page.emptyDescription,
          }}
          getRowId={(row) => row.id}
          onRowClick={(row) => {
            setSelectedEvent(row);
            setDetailOpen(true);
          }}
          rowActions={rowActions}
          enableExport
          onExport={handleExport}
          enableColumnToggle
          defaultHiddenColumns={['parent_process', 'command_line', 'file_hash', 'asset_id']}
          compact
          {...tableProps}
        />
      </div>

      <EventDetailPanel
        event={selectedEvent}
        open={detailOpen}
        onOpenChange={setDetailOpen}
      />
    </PermissionRedirect>
  );
}
