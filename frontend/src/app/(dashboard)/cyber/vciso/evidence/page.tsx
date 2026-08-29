'use client';

import { useState, useMemo, useCallback } from 'react';
import { type ColumnDef, type Row } from '@tanstack/react-table';
import {
  Archive,
  CheckCircle,
  Download,
  Eye,
  FileText,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Shield,
  Trash2,
  Upload,
  AlertTriangle,
  Layers,
  Bot,
  Monitor,
  User,
} from 'lucide-react';

import { PageHeader } from '@/components/common/page-header';
import { useVcisoLabels, useVcisoEvidenceListLabels, type VcisoEvidenceListLabels } from '../_lib/vciso-i18n';
import { ErrorState } from '@/components/common/error-state';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { PermissionRedirect } from '@/components/common/permission-redirect';
import { DataTable } from '@/components/shared/data-table/data-table';
import { KpiCard } from '@/components/shared/kpi-card';
import { StatusBadge } from '@/components/shared/status-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

import { useDataTable } from '@/hooks/use-data-table';
import { useRealtimeData } from '@/hooks/use-realtime-data';
import { useApiMutation } from '@/hooks/use-api-mutation';
import { apiGet } from '@/lib/api';
import { buildSuiteQueryParams } from '@/lib/suite-api';
import { API_ENDPOINTS } from '@/lib/constants';
import { evidenceStatusConfig } from '@/lib/status-configs';
import { formatDate, formatBytes, titleCase } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { PaginatedResponse } from '@/types/api';
import type { FetchParams, FilterConfig } from '@/types/table';
import type {
  VCISOEvidence,
  VCISOEvidenceStats,
} from '@/types/cyber';

import { EvidenceDetailPanel } from './_components/evidence-detail-panel';
import { EvidenceFormDialog } from './_components/evidence-form-dialog';

// ─── Filter Configurations ──────────────────────────────────────────────────

function buildEvidenceFilters(el: VcisoEvidenceListLabels): FilterConfig[] {
  return [
    {
      key: 'type',
      label: el.filters.type,
      type: 'select',
      options: [
        { label: el.filters.typeOptions.screenshot, value: 'screenshot' },
        { label: el.filters.typeOptions.log, value: 'log' },
        { label: el.filters.typeOptions.config, value: 'config' },
        { label: el.filters.typeOptions.report, value: 'report' },
        { label: el.filters.typeOptions.policy, value: 'policy' },
        { label: el.filters.typeOptions.certificate, value: 'certificate' },
        { label: el.filters.typeOptions.other, value: 'other' },
      ],
    },
    {
      key: 'source',
      label: el.filters.source,
      type: 'select',
      options: [
        { label: el.filters.sourceOptions.manual, value: 'manual' },
        { label: el.filters.sourceOptions.automated, value: 'automated' },
      ],
    },
    {
      key: 'status',
      label: el.filters.status,
      type: 'select',
      options: [
        { label: el.filters.statusOptions.current, value: 'current' },
        { label: el.filters.statusOptions.stale, value: 'stale' },
        { label: el.filters.statusOptions.expired, value: 'expired' },
      ],
    },
  ];
}

// ─── Fetch Function ─────────────────────────────────────────────────────────

function fetchEvidence(params: FetchParams): Promise<PaginatedResponse<VCISOEvidence>> {
  return apiGet<PaginatedResponse<VCISOEvidence>>(
    API_ENDPOINTS.CYBER_VCISO_EVIDENCE,
    buildSuiteQueryParams(params),
  );
}

// ─── Type Badge Color Map ───────────────────────────────────────────────────

const TYPE_BADGE_CLASSES: Record<string, string> = {
  screenshot: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300',
  log: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300',
  config: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  report: 'bg-primary/15 text-primary dark:bg-primary/30 dark:text-primary',
  policy: 'bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-300',
  certificate: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
  other: 'bg-secondary text-foreground dark:bg-neutral-ink dark:text-foreground/70',
};

// ─── Main Page Component ────────────────────────────────────────────────────

export default function EvidencePage() {
  const tv = useVcisoLabels();
  const el = useVcisoEvidenceListLabels();
  const [selectedEvidence, setSelectedEvidence] = useState<VCISOEvidence | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editEvidence, setEditEvidence] = useState<VCISOEvidence | null>(null);

  const typeLabel = useCallback(
    (type: string) => (el.filters.typeOptions as Record<string, string>)[type] ?? titleCase(type),
    [el],
  );
  const sourceLabel = useCallback(
    (source: string) => (el.filters.sourceOptions as Record<string, string>)[source] ?? titleCase(source),
    [el],
  );

  // ── Stats ───────────────────────────────────────────────────────────────
  const {
    data: statsEnvelope,
    isLoading: statsLoading,
    error: statsError,
    mutate: refetchStats,
  } = useRealtimeData<{ data: VCISOEvidenceStats }>(
    API_ENDPOINTS.CYBER_VCISO_EVIDENCE_STATS,
    {
      wsTopics: ['evidence.created', 'evidence.updated', 'evidence.deleted'],
    },
  );
  const stats = statsEnvelope?.data;

  // ── Data Table ──────────────────────────────────────────────────────────
  const { tableProps, refetch, data: evidenceData } = useDataTable<VCISOEvidence>({
    fetchFn: fetchEvidence,
    queryKey: 'vciso-evidence',
    defaultPageSize: 25,
    defaultSort: { column: 'collected_at', direction: 'desc' },
    wsTopics: ['evidence.created', 'evidence.updated', 'evidence.deleted'],
  });

  // ── Mutations ───────────────────────────────────────────────────────────
  const { mutate: deleteEvidence } = useApiMutation<unknown, { id: string }>(
    'delete',
    (variables) => `${API_ENDPOINTS.CYBER_VCISO_EVIDENCE}/${variables.id}`,
    {
      successMessage: el.toasts.deleted,
      invalidateKeys: ['vciso-evidence', 'vciso-evidence-stats'],
    },
  );

  const { mutate: verifyEvidence } = useApiMutation<unknown, { id: string }>(
    'put',
    (variables) => `${API_ENDPOINTS.CYBER_VCISO_EVIDENCE}/${variables.id}/verify`,
    {
      successMessage: el.toasts.verified,
      invalidateKeys: ['vciso-evidence', 'vciso-evidence-stats'],
    },
  );

  // ── Handlers ────────────────────────────────────────────────────────────
  const handleView = useCallback((evidence: VCISOEvidence) => {
    setSelectedEvidence(evidence);
    setDetailOpen(true);
  }, []);

  const handleUpload = useCallback(() => {
    setEditEvidence(null);
    setFormOpen(true);
  }, []);

  // ── Stale/Expired items for Collection Status tab ───────────────────────
  const staleExpiredItems = useMemo(
    () => evidenceData.filter((e) => e.status === 'stale' || e.status === 'expired'),
    [evidenceData],
  );

  const evidenceFilters = useMemo(() => buildEvidenceFilters(el), [el]);

  // ── Columns ─────────────────────────────────────────────────────────────
  const columns = useMemo<ColumnDef<VCISOEvidence>[]>(
    () => [
      {
        id: 'title',
        accessorKey: 'title',
        header: el.columns.title,
        cell: ({ row }: { row: Row<VCISOEvidence> }) => (
          <button
            className="text-start font-medium hover:underline max-w-[180px] sm:max-w-[280px] truncate block"
            onClick={() => handleView(row.original)}
          >
            {row.original.title}
          </button>
        ),
        enableSorting: true,
      },
      {
        id: 'type',
        accessorKey: 'type',
        header: el.columns.type,
        cell: ({ row }: { row: Row<VCISOEvidence> }) => (
          <Badge
            variant="secondary"
            className={cn(
              'text-xs capitalize',
              TYPE_BADGE_CLASSES[row.original.type] ?? TYPE_BADGE_CLASSES.other,
            )}
          >
            {typeLabel(row.original.type)}
          </Badge>
        ),
        enableSorting: true,
      },
      {
        id: 'source',
        accessorKey: 'source',
        header: el.columns.source,
        cell: ({ row }: { row: Row<VCISOEvidence> }) => (
          <Badge
            variant="secondary"
            className={cn(
              'text-xs',
              row.original.source === 'automated'
                ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300'
                : '',
            )}
          >
            {sourceLabel(row.original.source)}
          </Badge>
        ),
        enableSorting: true,
      },
      {
        id: 'status',
        accessorKey: 'status',
        header: el.columns.status,
        cell: ({ row }: { row: Row<VCISOEvidence> }) => (
          <StatusBadge status={row.original.status} config={evidenceStatusConfig} />
        ),
        enableSorting: true,
      },
      {
        id: 'frameworks',
        header: el.columns.frameworks,
        cell: ({ row }: { row: Row<VCISOEvidence> }) => {
          const fw = row.original.frameworks;
          if (!fw || fw.length === 0) return <span className="text-muted-foreground">--</span>;
          const shown = fw.slice(0, 2);
          const extra = fw.length - 2;
          return (
            <div className="flex flex-wrap gap-1">
              {shown.map((f) => (
                <Badge key={f} variant="outline" className="text-xs">
                  {f}
                </Badge>
              ))}
              {extra > 0 && (
                <Badge variant="outline" className="text-xs text-muted-foreground">
                  +{extra}
                </Badge>
              )}
            </div>
          );
        },
      },
      {
        id: 'file_name',
        header: el.columns.file,
        cell: ({ row }: { row: Row<VCISOEvidence> }) => (
          <span className="text-sm text-muted-foreground max-w-[100px] sm:max-w-[150px] truncate block">
            {row.original.file_name ?? '—'}
          </span>
        ),
      },
      {
        id: 'collected_at',
        accessorKey: 'collected_at',
        header: el.columns.collected,
        cell: ({ row }: { row: Row<VCISOEvidence> }) => (
          <span className="text-sm text-muted-foreground">
            {formatDate(row.original.collected_at)}
          </span>
        ),
        enableSorting: true,
      },
      {
        id: 'expires_at',
        accessorKey: 'expires_at',
        header: el.columns.expires,
        cell: ({ row }: { row: Row<VCISOEvidence> }) => (
          <span className="text-sm text-muted-foreground">
            {row.original.expires_at ? formatDate(row.original.expires_at) : '—'}
          </span>
        ),
        enableSorting: true,
      },
      {
        id: 'actions',
        header: '',
        cell: ({ row }: { row: Row<VCISOEvidence> }) => (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => handleView(row.original)}>
                <Eye className="me-2 h-3.5 w-3.5" />
                {el.rowMenu.view}
              </DropdownMenuItem>
              {row.original.file_url && (
                <DropdownMenuItem asChild>
                  <a
                    href={row.original.file_url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Download className="me-2 h-3.5 w-3.5" />
                    {el.rowMenu.download}
                  </a>
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                onClick={() => verifyEvidence({ id: row.original.id })}
              >
                <CheckCircle className="me-2 h-3.5 w-3.5" />
                {el.rowMenu.verify}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive"
                onClick={() => deleteEvidence({ id: row.original.id })}
              >
                <Trash2 className="me-2 h-3.5 w-3.5" />
                {el.rowMenu.delete}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ),
        enableSorting: false,
      },
    ],
    [el, typeLabel, sourceLabel, handleView, verifyEvidence, deleteEvidence],
  );

  // ── KPI computation ─────────────────────────────────────────────────────
  const staleExpiredCount = (stats?.stale_count ?? 0) + (stats?.expired_count ?? 0);
  const controlsTotal =
    (stats?.controls_with_evidence ?? 0) + (stats?.controls_without_evidence ?? 0);
  const controlCoverageChange =
    controlsTotal > 0
      ? ((stats?.controls_with_evidence ?? 0) / controlsTotal) * 100 - 100
      : 0;

  return (
    <PermissionRedirect permission="cyber:read">
      <div className="space-y-6">
        <PageHeader
          title={tv.pages.evidence.title}
          description={tv.pages.evidence.description}
          actions={
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  void refetch();
                  void refetchStats();
                }}
              >
                <RefreshCw className="me-1.5 h-4 w-4" />
                {el.refresh}
              </Button>
              <Button size="sm" onClick={handleUpload}>
                <Upload className="me-1.5 h-4 w-4" />
                {el.uploadEvidence}
              </Button>
            </div>
          }
        />

        {/* KPI Stats Row */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard
            title={tv.pages.evidence.totalEvidence}
            value={stats?.total ?? 0}
            icon={Archive}
            tone="sky"
            loading={statsLoading}
            description={el.sourceSummary(stats?.by_source?.manual ?? 0, stats?.by_source?.automated ?? 0)}
          />
          <KpiCard
            title={tv.pages.evidence.needsAttention}
            value={staleExpiredCount}
            icon={AlertTriangle}
            tone="rose"
            loading={statsLoading}
            description={el.attentionSummary(stats?.stale_count ?? 0, stats?.expired_count ?? 0)}
            className={staleExpiredCount > 0 ? 'border-warning-300 dark:border-warning-800' : ''}
          />
          <KpiCard
            title={tv.pages.evidence.frameworksCovered}
            value={stats?.frameworks_covered ?? 0}
            icon={Shield}
            tone="sky"
            loading={statsLoading}
          />
          <KpiCard
            title={tv.pages.evidence.controlsWithEvidence}
            value={stats?.controls_with_evidence ?? 0}
            icon={Layers}
            tone="emerald"
            loading={statsLoading}
            change={controlsTotal > 0 ? controlCoverageChange : undefined}
            changeLabel={controlsTotal > 0 ? el.ofTotal(controlsTotal) : undefined}
          />
        </div>

        {/* Tabs */}
        <Tabs defaultValue="repository" className="space-y-4">
          <TabsList>
            <TabsTrigger value="repository">{el.tabs.repository}</TabsTrigger>
            <TabsTrigger value="collection">{el.tabs.collection}</TabsTrigger>
          </TabsList>

          {/* ── Evidence Repository Tab ──────────────────────────────────── */}
          <TabsContent value="repository" className="space-y-4">
            <DataTable
              columns={columns}
              filters={evidenceFilters}
              searchPlaceholder={el.search}
              emptyState={{
                icon: FileText,
                title: el.empty.title,
                description: el.empty.desc,
                action: {
                  label: el.uploadEvidence,
                  onClick: handleUpload,
                  icon: Plus,
                },
              }}
              getRowId={(row) => row.id}
              onRowClick={handleView}
              {...tableProps}
            />
          </TabsContent>

          {/* ── Collection Status Tab ────────────────────────────────────── */}
          <TabsContent value="collection" className="space-y-6">
            {statsLoading ? (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <LoadingSkeleton variant="card" />
                <LoadingSkeleton variant="card" />
              </div>
            ) : statsError || !stats ? (
              <ErrorState
                message={el.collection.statsError}
                onRetry={() => void refetchStats()}
              />
            ) : (
              <>
                {/* Source Breakdown */}
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm font-semibold flex items-center gap-2">
                        <User className="h-4 w-4 text-muted-foreground" />
                        {el.collection.manualTitle}
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-3xl font-semibold tracking-tight">
                        {stats.by_source?.manual ?? 0}
                      </p>
                      <p className="text-sm text-muted-foreground mt-1">
                        {el.collection.manualDesc}
                      </p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm font-semibold flex items-center gap-2">
                        <Bot className="h-4 w-4 text-status-info" />
                        {el.collection.automatedTitle}
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-3xl font-semibold tracking-tight">
                        {stats.by_source?.automated ?? 0}
                      </p>
                      <p className="text-sm text-muted-foreground mt-1">
                        {el.collection.automatedDesc}
                      </p>
                    </CardContent>
                  </Card>
                </div>

                {/* Type Breakdown */}
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-semibold">{el.collection.byType}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
                      {Object.entries(stats.by_type ?? {}).map(([type, count]) => (
                        <div
                          key={type}
                          className="flex items-center justify-between rounded-lg border p-3"
                        >
                          <div className="flex items-center gap-2">
                            <Badge
                              variant="secondary"
                              className={cn(
                                'text-xs capitalize',
                                TYPE_BADGE_CLASSES[type] ?? TYPE_BADGE_CLASSES.other,
                              )}
                            >
                              {typeLabel(type)}
                            </Badge>
                          </div>
                          <span className="text-lg font-semibold tabular-nums">{count}</span>
                        </div>
                      ))}
                      {Object.keys(stats.by_type ?? {}).length === 0 && (
                        <p className="col-span-full text-sm text-muted-foreground text-center py-4">
                          {el.collection.noTypeData}
                        </p>
                      )}
                    </div>
                  </CardContent>
                </Card>

                {/* Controls Coverage */}
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-semibold">{el.collection.coverageTitle}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                      <div className="rounded-lg border border-primary/30 bg-primary/10 dark:bg-primary/10 p-4">
                        <div className="flex items-center gap-2 mb-2">
                          <CheckCircle className="h-5 w-5 text-primary" />
                          <span className="text-sm font-medium text-primary dark:text-primary">
                            {el.collection.withEvidence}
                          </span>
                        </div>
                        <p className="text-3xl font-semibold text-primary dark:text-primary/70">
                          {stats.controls_with_evidence}
                        </p>
                      </div>
                      <div className="rounded-lg border border-error-100 bg-error-50 dark:bg-error-700/10 p-4">
                        <div className="flex items-center gap-2 mb-2">
                          <AlertTriangle className="h-5 w-5 text-status-error" />
                          <span className="text-sm font-medium text-error-700 dark:text-error-300">
                            {el.collection.withoutEvidence}
                          </span>
                        </div>
                        <p className="text-3xl font-semibold text-error-700 dark:text-error-100">
                          {stats.controls_without_evidence}
                        </p>
                      </div>
                    </div>
                    {controlsTotal > 0 && (
                      <div className="mt-4">
                        <div className="flex items-center justify-between text-sm mb-1.5">
                          <span className="text-muted-foreground">{el.collection.coverage}</span>
                          <span className="font-medium">
                            {((stats.controls_with_evidence / controlsTotal) * 100).toFixed(1)}%
                          </span>
                        </div>
                        <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                          <div
                            className="h-full rounded-full bg-primary transition-all"
                            style={{
                              width: `${(stats.controls_with_evidence / controlsTotal) * 100}%`,
                            }}
                          />
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Stale/Expired Items */}
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-semibold flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4 text-warning-700 dark:text-warning-300" />
                      {el.collection.itemsAttention(staleExpiredCount)}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {staleExpiredItems.length > 0 ? (
                      <div className="space-y-2 max-h-80 overflow-y-auto">
                        {staleExpiredItems.map((item) => (
                          <div
                            key={item.id}
                            className="flex items-center justify-between rounded-lg border p-3 cursor-pointer hover:bg-muted/50 transition-colors"
                            onClick={() => handleView(item)}
                          >
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium truncate">{item.title}</p>
                              <div className="flex items-center gap-2 mt-1">
                                <StatusBadge
                                  status={item.status}
                                  config={evidenceStatusConfig}
                                  size="sm"
                                />
                                <span className="text-xs text-muted-foreground">
                                  {typeLabel(item.type)}
                                </span>
                                {item.expires_at && (
                                  <span className="text-xs text-muted-foreground">
                                    {el.collection.expiresPrefix(formatDate(item.expires_at))}
                                  </span>
                                )}
                              </div>
                            </div>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="shrink-0"
                              onClick={(e) => {
                                e.stopPropagation();
                                verifyEvidence({ id: item.id });
                              }}
                            >
                              <CheckCircle className="h-3.5 w-3.5 me-1" />
                              {el.rowMenu.verify}
                            </Button>
                          </div>
                        ))}
                      </div>
                    ) : staleExpiredCount > 0 ? (
                      <p className="text-sm text-muted-foreground py-4 text-center">
                        {el.collection.needAttention(staleExpiredCount)}
                      </p>
                    ) : (
                      <p className="text-sm text-muted-foreground py-4 text-center">
                        {el.collection.allCurrent}
                      </p>
                    )}
                  </CardContent>
                </Card>
              </>
            )}
          </TabsContent>
        </Tabs>

        {/* Detail Panel */}
        <EvidenceDetailPanel
          evidence={selectedEvidence}
          open={detailOpen}
          onOpenChange={setDetailOpen}
          onVerified={() => {
            void refetch();
            void refetchStats();
          }}
        />

        {/* Form Dialog */}
        <EvidenceFormDialog
          open={formOpen}
          onOpenChange={setFormOpen}
          evidence={editEvidence}
        />
      </div>
    </PermissionRedirect>
  );
}
