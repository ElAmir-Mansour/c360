'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowRight,
  Database,
  GitBranch,
  ShieldAlert,
  Search,
  CheckCircle2,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/common/page-header';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { ErrorState } from '@/components/common/error-state';
import { EmptyState } from '@/components/common/empty-state';
import { PermissionRedirect } from '@/components/common/permission-redirect';
import { HelpTip } from '@/components/shared/help-tip';
import { StatCard, type StatTone } from '@/components/shared/stat-card';
import { apiGet } from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';
import { useDspmLabels, dspmLabels } from '../_lib/dspm-i18n';
import type { LineageGraph, LineageEdge } from '@/types/cyber';

const STATUS_STYLES: Record<string, string> = {
  active: 'bg-primary/15 text-primary',
  inactive: 'bg-secondary text-foreground/70',
  broken: 'bg-error-50 text-error-700 dark:bg-error-700/15 dark:text-error-300',
  deprecated: 'bg-warning-50 text-warning-700 dark:bg-warning-700/15 dark:text-warning-300',
};

const CONFIDENCE_STYLES: Record<string, string> = {
  high: 'text-primary',
  medium: 'text-warning-700 dark:text-warning-300',
  low: 'text-error-600 dark:text-error-300',
};

function getConfidenceLevel(confidence: number): 'high' | 'medium' | 'low' {
  if (confidence >= 0.8) return 'high';
  if (confidence >= 0.5) return 'medium';
  return 'low';
}

export default function DataLineagePage() {
  const t = useDspmLabels().lineage;
  const edgeTypeLabel = (type: string): string =>
    (t.edgeTypes as Record<string, string>)[type] ?? type;
  const [filterEdgeType, setFilterEdgeType] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');

  const {
    data: graphEnvelope,
    isLoading: graphLoading,
    error: graphError,
    refetch: refetchGraph,
  } = useQuery({
    queryKey: ['dspm-lineage-graph'],
    queryFn: () => apiGet<{ data: LineageGraph }>(API_ENDPOINTS.CYBER_DSPM_LINEAGE_GRAPH),
    staleTime: 120000,
  });

  const {
    data: piiFlowEnvelope,
    isLoading: piiLoading,
  } = useQuery({
    queryKey: ['dspm-lineage-pii-flow'],
    queryFn: () => apiGet<{ data: LineageEdge[] }>(API_ENDPOINTS.CYBER_DSPM_LINEAGE_PII_FLOW),
    staleTime: 120000,
  });

  const graph = graphEnvelope?.data;
  const piiFlowEdges = piiFlowEnvelope?.data ?? [];
  const isLoading = graphLoading || piiLoading;

  const classificationChanges = useMemo(() => {
    if (!graph) return 0;
    return graph.edges.filter((e) => e.classification_changed).length;
  }, [graph]);

  const filteredEdges = useMemo(() => {
    if (!graph) return [];
    return graph.edges.filter((edge) => {
      if (filterEdgeType !== 'all' && edge.edge_type !== filterEdgeType) return false;
      if (filterStatus !== 'all' && edge.status !== filterStatus) return false;
      if (searchTerm) {
        const term = searchTerm.toLowerCase();
        const sourceName = (edge.source_asset_name ?? edge.source_asset_id).toLowerCase();
        const targetName = (edge.target_asset_name ?? edge.target_asset_id).toLowerCase();
        const pipeline = (edge.pipeline_name ?? '').toLowerCase();
        if (!sourceName.includes(term) && !targetName.includes(term) && !pipeline.includes(term)) {
          return false;
        }
      }
      return true;
    });
  }, [graph, filterEdgeType, filterStatus, searchTerm]);

  const edgeTypeOptions = useMemo(() => {
    if (!graph) return [];
    const types = new Set(graph.edges.map((e) => e.edge_type));
    return Array.from(types).sort();
  }, [graph]);

  const statusOptions = useMemo(() => {
    if (!graph) return [];
    const statuses = new Set(graph.edges.map((e) => e.status));
    return Array.from(statuses).sort();
  }, [graph]);

  return (
    <PermissionRedirect permission="cyber:read">
      <div className="space-y-6">
        <PageHeader
          title={t.title}
          description={t.description}
          actions={
            <HelpTip
              title={{ en: dspmLabels.en.lineage.helpTitle, ar: dspmLabels.ar.lineage.helpTitle }}
              content={{
                en: dspmLabels.en.lineage.helpContent,
                ar: dspmLabels.ar.lineage.helpContent,
              }}
            />
          }
        />

        {isLoading ? (
          <LoadingSkeleton variant="card" count={4} />
        ) : graphError ? (
          <ErrorState message={t.loadError} onRetry={() => void refetchGraph()} />
        ) : (
          <>
            {/* KPI Cards */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {([
                { label: t.kpiTotalNodes, value: graph?.total_nodes ?? 0, icon: Database, tone: 'sky' },
                { label: t.kpiTotalEdges, value: graph?.total_edges ?? 0, icon: GitBranch, tone: 'sky' },
                {
                  label: t.kpiPiiFlowCount,
                  value: graph?.pii_flow_count ?? 0,
                  icon: ShieldAlert,
                  tone: (graph?.pii_flow_count ?? 0) > 0 ? 'rose' : 'emerald',
                },
                {
                  label: t.kpiClassificationChanges,
                  value: classificationChanges,
                  icon: ArrowRight,
                  tone: classificationChanges > 0 ? 'gold' : 'emerald',
                },
              ] as Array<{ label: string; value: number; icon: typeof Database; tone: StatTone }>).map((kpi) => (
                <StatCard
                  key={kpi.label}
                  label={kpi.label}
                  value={kpi.value}
                  icon={kpi.icon}
                  tone={kpi.tone}
                  className=""
                />
              ))}
            </div>

            {/* PII Flow Highlights */}
            {piiFlowEdges.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <ShieldAlert className="h-4 w-4 text-status-error" />
                    {t.piiFlowHighlights}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="divide-y">
                    {piiFlowEdges.map((edge) => (
                      <div
                        key={edge.id}
                        className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div className="flex items-center gap-2 text-sm">
                          <span className="font-medium truncate max-w-[120px] sm:max-w-[180px]">
                            {edge.source_asset_name ?? edge.source_asset_id}
                          </span>
                          {edge.source_table && (
                            <span className="text-xs text-muted-foreground">({edge.source_table})</span>
                          )}
                          <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                          <span className="font-medium truncate max-w-[120px] sm:max-w-[180px]">
                            {edge.target_asset_name ?? edge.target_asset_id}
                          </span>
                          {edge.target_table && (
                            <span className="text-xs text-muted-foreground">({edge.target_table})</span>
                          )}
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          {edge.pii_types_transferred.map((pii) => (
                            <Badge key={pii} variant="destructive" className="text-xs">
                              {pii}
                            </Badge>
                          ))}
                          <Badge variant="outline" className="text-xs capitalize">
                            {edgeTypeLabel(edge.edge_type)}
                          </Badge>
                          {edge.classification_changed && (
                            <Badge variant="secondary" className="text-xs">
                              {t.classificationChanged}
                            </Badge>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Lineage Edges Table */}
            <Card>
              <CardHeader>
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <CardTitle className="text-sm">{t.lineageEdges}</CardTitle>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="relative">
                      <Search className="absolute start-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                      <input
                        type="text"
                        placeholder={t.searchPlaceholder}
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="h-8 rounded-md border border-input bg-background ps-8 pe-3 text-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      />
                    </div>
                    <select
                      value={filterEdgeType}
                      onChange={(e) => setFilterEdgeType(e.target.value)}
                      aria-label={t.filterEdgeTypeAria}
                      className="h-8 rounded-md border border-input bg-background px-2 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    >
                      <option value="all">{t.allTypes}</option>
                      {edgeTypeOptions.map((type) => (
                        <option key={type} value={type}>
                          {edgeTypeLabel(type)}
                        </option>
                      ))}
                    </select>
                    <select
                      value={filterStatus}
                      onChange={(e) => setFilterStatus(e.target.value)}
                      aria-label={t.filterStatusAria}
                      className="h-8 rounded-md border border-input bg-background px-2 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    >
                      <option value="all">{t.allStatuses}</option>
                      {statusOptions.map((status) => (
                        <option key={status} value={status}>
                          {status.charAt(0).toUpperCase() + status.slice(1)}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {filteredEdges.length === 0 ? (
                  <EmptyState
                    size="compact"
                    icon={CheckCircle2}
                    title={t.noEdgesTitle}
                    description={
                      searchTerm || filterEdgeType !== 'all' || filterStatus !== 'all'
                        ? t.noEdgesFiltered
                        : t.noEdgesEmpty
                    }
                  />
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-start">
                          <th className="pb-3 pe-4 text-xs font-medium text-muted-foreground">{t.colSource}</th>
                          <th className="pb-3 pe-4 text-xs font-medium text-muted-foreground" />
                          <th className="pb-3 pe-4 text-xs font-medium text-muted-foreground">{t.colTarget}</th>
                          <th className="pb-3 pe-4 text-xs font-medium text-muted-foreground">{t.colEdgeType}</th>
                          <th className="pb-3 pe-4 text-xs font-medium text-muted-foreground">{t.colPiiTypes}</th>
                          <th className="pb-3 pe-4 text-xs font-medium text-muted-foreground">{t.colStatus}</th>
                          <th className="pb-3 text-xs font-medium text-muted-foreground">{t.colConfidence}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {filteredEdges.map((edge) => {
                          const confidenceLevel = getConfidenceLevel(edge.confidence);
                          return (
                            <tr key={edge.id} className="hover:bg-muted/50">
                              <td className="py-3 pe-4">
                                <div className="flex items-center gap-2">
                                  <Database className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                  <div className="min-w-0">
                                    <p className="truncate font-medium text-sm">
                                      {edge.source_asset_name ?? edge.source_asset_id}
                                    </p>
                                    {edge.source_table && (
                                      <p className="truncate text-xs text-muted-foreground">{edge.source_table}</p>
                                    )}
                                    {edge.source_classification && (
                                      <Badge variant="outline" className="mt-0.5 text-overline capitalize">
                                        {edge.source_classification}
                                      </Badge>
                                    )}
                                  </div>
                                </div>
                              </td>
                              <td className="py-3 pe-4">
                                <ArrowRight className="h-4 w-4 text-muted-foreground" />
                              </td>
                              <td className="py-3 pe-4">
                                <div className="flex items-center gap-2">
                                  <Database className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                  <div className="min-w-0">
                                    <p className="truncate font-medium text-sm">
                                      {edge.target_asset_name ?? edge.target_asset_id}
                                    </p>
                                    {edge.target_table && (
                                      <p className="truncate text-xs text-muted-foreground">{edge.target_table}</p>
                                    )}
                                    {edge.target_classification && (
                                      <Badge variant="outline" className="mt-0.5 text-overline capitalize">
                                        {edge.target_classification}
                                      </Badge>
                                    )}
                                  </div>
                                </div>
                              </td>
                              <td className="py-3 pe-4">
                                <Badge variant="secondary" className="text-xs">
                                  {edgeTypeLabel(edge.edge_type)}
                                </Badge>
                                {edge.pipeline_name && (
                                  <p className="mt-0.5 text-xs text-muted-foreground truncate max-w-[100px] sm:max-w-[140px]">
                                    {edge.pipeline_name}
                                  </p>
                                )}
                              </td>
                              <td className="py-3 pe-4">
                                {edge.pii_types_transferred.length > 0 ? (
                                  <div className="flex flex-wrap gap-1">
                                    {edge.pii_types_transferred.map((pii) => (
                                      <Badge key={pii} variant="destructive" className="text-overline">
                                        {pii}
                                      </Badge>
                                    ))}
                                  </div>
                                ) : (
                                  <span className="text-xs text-muted-foreground">{t.none}</span>
                                )}
                              </td>
                              <td className="py-3 pe-4">
                                <span
                                  className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize ${STATUS_STYLES[edge.status] ?? 'bg-muted text-muted-foreground'}`}
                                >
                                  {edge.status}
                                </span>
                              </td>
                              <td className="py-3">
                                <span className={`text-sm font-medium tabular-nums ${CONFIDENCE_STYLES[confidenceLevel]}`}>
                                  {Math.round(edge.confidence * 100)}%
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
                {filteredEdges.length > 0 && (
                  <p className="mt-3 text-xs text-muted-foreground">
                    {t.showingEdges(filteredEdges.length, graph?.edges.length ?? 0)}
                  </p>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </PermissionRedirect>
  );
}
