'use client';

import { useState, useMemo, useCallback } from 'react';
import {
  Cloud,
  Database,
  Key,
  Monitor,
  Plus,
  RefreshCw,
  Search,
  Shield,
  TicketCheck,
  Unplug,
  type LucideIcon,
} from 'lucide-react';

import { PageHeader } from '@/components/common/page-header';
import {
  useVcisoLabels,
  useVcisoOpsLabels,
  useVcisoIntegrationsListLabels,
} from '../_lib/vciso-i18n';
import { ErrorState } from '@/components/common/error-state';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { PermissionRedirect } from '@/components/common/permission-redirect';
import { KpiCard } from '@/components/shared/kpi-card';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import { useRealtimeData } from '@/hooks/use-realtime-data';
import { useApiMutation } from '@/hooks/use-api-mutation';
import { API_ENDPOINTS } from '@/lib/constants';
import { titleCase } from '@/lib/format';
import { cn } from '@/lib/utils';
import type {
  VCISOIntegration,
  CyberIntegrationType,
  CyberIntegrationStatus,
  IntegrationHealth,
} from '@/types/cyber';

import { IntegrationCard } from './_components/integration-card';
import { IntegrationFormDialog } from './_components/integration-form-dialog';
import { IntegrationDetailPanel } from './_components/integration-detail-panel';
import { useSyncIntegration } from './_components/integration-sync-action';

// ─── Category Definitions (icon + color; labels come from the i18n bundle) ────

interface CategoryMeta {
  icon: LucideIcon;
  iconColor: string;
}

const CATEGORY_META: Record<CyberIntegrationType, CategoryMeta> = {
  asset_management: { icon: Database, iconColor: 'text-purple-600' },
  ticketing: { icon: TicketCheck, iconColor: 'text-severity-high' },
  cloud_security: { icon: Cloud, iconColor: 'text-sky-600' },
  data_protection: { icon: Shield, iconColor: 'text-teal-600' },
  siem: { icon: Monitor, iconColor: 'text-indigo-600' },
  iam: { icon: Key, iconColor: 'text-warning-700 dark:text-warning-300' },
};

const ALL_TYPES: CyberIntegrationType[] = [
  'asset_management',
  'ticketing',
  'cloud_security',
  'data_protection',
  'siem',
  'iam',
];

const STATUS_VALUES: CyberIntegrationStatus[] = ['connected', 'disconnected', 'error', 'pending'];
const HEALTH_VALUES: IntegrationHealth[] = ['healthy', 'degraded', 'unavailable'];

// ─── Main Page Component ────────────────────────────────────────────────────

export default function IntegrationsPage() {
  const tv = useVcisoLabels();
  const il = useVcisoIntegrationsListLabels();
  const ops = useVcisoOpsLabels();
  const typeLabels = ops.integrations.types as Record<string, string>;
  const typeLabel = useCallback(
    (type: string) => typeLabels[type] ?? titleCase(type),
    [typeLabels],
  );
  const statusOptionLabels = il.statusOptions as Record<string, string>;
  const healthOptionLabels = il.healthOptions as Record<string, string>;

  const [selectedIntegration, setSelectedIntegration] = useState<VCISOIntegration | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editIntegration, setEditIntegration] = useState<VCISOIntegration | null>(null);

  // ── Disconnect (soft) confirmation ───────────────────────────────────────
  const [disconnectTarget, setDisconnectTarget] = useState<VCISOIntegration | null>(null);
  const [disconnectOpen, setDisconnectOpen] = useState(false);

  // ── Remove (hard delete) confirmation ───────────────────────────────────
  const [removeTarget, setRemoveTarget] = useState<VCISOIntegration | null>(null);
  const [removeOpen, setRemoveOpen] = useState(false);

  // ── Filters ─────────────────────────────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterHealth, setFilterHealth] = useState<string>('all');

  // ── Data Fetch ──────────────────────────────────────────────────────────
  const {
    data: integrationsResponse,
    isLoading,
    error,
    mutate: refetch,
  } = useRealtimeData<{ data: VCISOIntegration[] }>(
    API_ENDPOINTS.CYBER_VCISO_INTEGRATIONS,
    {
      params: { per_page: 100 },
      wsTopics: [
        'integration.created',
        'integration.updated',
        'integration.deleted',
        'integration.synced',
        'integration.disconnected',
      ],
    },
  );

  const integrations = useMemo(() => integrationsResponse?.data ?? [], [integrationsResponse]);

  // ── Sync mutation (per-integration syncing tracked by syncingId) ─────────
  const { triggerSync, syncing, syncingId } = useSyncIntegration(() => void refetch());

  // ── Disconnect mutation (PATCH /integrations/{id} body:{status:"disconnected"}) ──
  const { mutate: disconnectIntegration } = useApiMutation<
    unknown,
    { id: string; status: string }
  >(
    'patch',
    (variables) => `${API_ENDPOINTS.CYBER_VCISO_INTEGRATIONS}/${variables.id}`,
    {
      successMessage: il.toasts.disconnected,
      invalidateKeys: [API_ENDPOINTS.CYBER_VCISO_INTEGRATIONS],
      onSuccess: () => {
        void refetch();
        if (disconnectTarget && selectedIntegration?.id === disconnectTarget.id) {
          setDetailOpen(false);
          setSelectedIntegration(null);
        }
        setDisconnectTarget(null);
      },
    },
  );

  // ── Reconnect mutation (PATCH /integrations/{id} body:{status:"pending"}) ───────
  const { mutate: reconnectIntegration } = useApiMutation<
    unknown,
    { id: string; status: string }
  >(
    'patch',
    (variables) => `${API_ENDPOINTS.CYBER_VCISO_INTEGRATIONS}/${variables.id}`,
    {
      successMessage: il.toasts.reconnecting,
      invalidateKeys: [API_ENDPOINTS.CYBER_VCISO_INTEGRATIONS],
      onSuccess: () => void refetch(),
    },
  );

  // ── Remove mutation (hard DELETE) ────────────────────────────────────────
  const { mutate: removeIntegration } = useApiMutation<unknown, { id: string }>(
    'delete',
    (variables) => `${API_ENDPOINTS.CYBER_VCISO_INTEGRATIONS}/${variables.id}`,
    {
      successMessage: il.toasts.removed,
      invalidateKeys: [API_ENDPOINTS.CYBER_VCISO_INTEGRATIONS],
      onSuccess: () => {
        void refetch();
        if (removeTarget && selectedIntegration?.id === removeTarget.id) {
          setDetailOpen(false);
          setSelectedIntegration(null);
        }
        setRemoveTarget(null);
      },
    },
  );

  // ── Filtered data ───────────────────────────────────────────────────────
  const filteredIntegrations = useMemo(() => {
    let result = integrations;

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (i) =>
          i.name.toLowerCase().includes(q) ||
          i.provider.toLowerCase().includes(q),
      );
    }

    if (filterType !== 'all') {
      result = result.filter((i) => i.type === filterType);
    }
    if (filterStatus !== 'all') {
      result = result.filter((i) => i.status === filterStatus);
    }
    if (filterHealth !== 'all') {
      result = result.filter((i) => i.health_status === filterHealth);
    }

    return result;
  }, [integrations, searchQuery, filterType, filterStatus, filterHealth]);

  // ── Category summary stats ─────────────────────────────────────────────
  const categorySummary = useMemo(() => {
    const summary: Record<CyberIntegrationType, { total: number; connected: number; healthy: number }> =
      {} as Record<CyberIntegrationType, { total: number; connected: number; healthy: number }>;

    for (const type of ALL_TYPES) {
      summary[type] = { total: 0, connected: 0, healthy: 0 };
    }

    for (const integration of integrations) {
      const cat = summary[integration.type];
      if (cat) {
        cat.total++;
        if (integration.status === 'connected') cat.connected++;
        if (integration.health_status === 'healthy') cat.healthy++;
      }
    }

    return summary;
  }, [integrations]);

  // ── Global counts ──────────────────────────────────────────────────────
  const totalConnected = integrations.filter((i) => i.status === 'connected').length;
  const totalErrors = integrations.filter((i) => i.status === 'error').length;
  const totalItemsSynced = integrations.reduce((sum, i) => sum + i.items_synced, 0);

  // ── Handlers ────────────────────────────────────────────────────────────
  const handleViewDetails = useCallback((integration: VCISOIntegration) => {
    setSelectedIntegration(integration);
    setDetailOpen(true);
  }, []);

  const handleConfigure = useCallback((integration: VCISOIntegration) => {
    setEditIntegration(integration);
    setFormOpen(true);
  }, []);

  const handleAddNew = useCallback(() => {
    setEditIntegration(null);
    setFormOpen(true);
  }, []);

  const handleDisconnect = useCallback((integration: VCISOIntegration) => {
    setDisconnectTarget(integration);
    setDisconnectOpen(true);
  }, []);

  const handleRemove = useCallback((integration: VCISOIntegration) => {
    setRemoveTarget(integration);
    setRemoveOpen(true);
  }, []);

  const handleReconnect = useCallback((integration: VCISOIntegration) => {
    reconnectIntegration({ id: integration.id, status: 'pending' });
  }, [reconnectIntegration]);

  const confirmDisconnect = useCallback(async () => {
    if (disconnectTarget) {
      disconnectIntegration({ id: disconnectTarget.id, status: 'disconnected' });
    }
  }, [disconnectTarget, disconnectIntegration]);

  const confirmRemove = useCallback(async () => {
    if (removeTarget) {
      removeIntegration({ id: removeTarget.id });
    }
  }, [removeTarget, removeIntegration]);

  // After form dialog saves, re-fetch and refresh the selected integration.
  const handleFormSaved = useCallback(async () => {
    await refetch();
    if (selectedIntegration) {
      const refreshed = integrations.find((i) => i.id === selectedIntegration.id);
      if (refreshed) setSelectedIntegration(refreshed);
    }
  }, [refetch, selectedIntegration, integrations]);

  const hasActiveFilters =
    searchQuery.trim() !== '' ||
    filterType !== 'all' ||
    filterStatus !== 'all' ||
    filterHealth !== 'all';

  const clearFilters = useCallback(() => {
    setSearchQuery('');
    setFilterType('all');
    setFilterStatus('all');
    setFilterHealth('all');
  }, []);

  return (
    <PermissionRedirect permission="cyber:read">
      <div className="space-y-6">
        <PageHeader
          title={tv.pages.integrations.title}
          description={tv.pages.integrations.description}
          actions={
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => void refetch()}
              >
                <RefreshCw className="me-1.5 h-4 w-4" />
                {il.refresh}
              </Button>
              <Button size="sm" onClick={handleAddNew}>
                <Plus className="me-1.5 h-4 w-4" />
                {il.addIntegration}
              </Button>
            </div>
          }
        />

        {/* KPI Summary Row */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard
            title={tv.pages.integrations.totalIntegrations}
            value={integrations.length}
            icon={Database}
            tone="sky"
            loading={isLoading}
            description={il.kpi.connectedSummary(totalConnected)}
          />
          <KpiCard
            title={tv.pages.integrations.connected}
            value={totalConnected}
            icon={Monitor}
            tone="emerald"
            loading={isLoading}
            description={il.kpi.ofTotal(integrations.length)}
          />
          <KpiCard
            title={tv.pages.integrations.errors}
            value={totalErrors}
            icon={Shield}
            tone="rose"
            loading={isLoading}
            description={totalErrors > 0 ? il.kpi.requireAttention : il.kpi.allNominal}
            className={totalErrors > 0 ? 'border-error-100 dark:border-error-700' : ''}
          />
          <KpiCard
            title={tv.pages.integrations.totalItemsSynced}
            value={totalItemsSynced.toLocaleString()}
            icon={RefreshCw}
            tone="sky"
            loading={isLoading}
            description={il.kpi.acrossAll}
          />
        </div>

        {/* Category Summary Cards */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6">
          {ALL_TYPES.map((type) => {
            const meta = CATEGORY_META[type];
            const stats = categorySummary[type];
            const CategoryIcon = meta.icon;
            return (
              <button
                key={type}
                className={cn(
                  'rounded-xl border bg-card p-3 text-start transition-all hover:shadow-sm hover:border-primary/30',
                  filterType === type && 'border-primary ring-1 ring-primary/20',
                )}
                onClick={() => setFilterType(filterType === type ? 'all' : type)}
              >
                <div className="flex items-center gap-2 mb-2">
                  <CategoryIcon className={cn('h-4 w-4 shrink-0', meta.iconColor)} />
                  <span className="text-xs font-semibold truncate">{typeLabel(type)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-lg font-bold tabular-nums">{stats.total}</span>
                  {stats.connected > 0 && (
                    <Badge
                      variant="secondary"
                      className="text-overline bg-primary/15 text-primary dark:bg-primary/30 dark:text-primary"
                    >
                      {il.upSuffix(stats.connected)}
                    </Badge>
                  )}
                </div>
              </button>
            );
          })}
        </div>

        {/* Filters Row */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px] max-w-xs">
            <Search className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder={il.search}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="ps-9"
            />
          </div>

          <Select value={filterType} onValueChange={setFilterType}>
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder={il.filterAll.types} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{il.filterAll.types}</SelectItem>
              {ALL_TYPES.map((type) => (
                <SelectItem key={type} value={type}>
                  {typeLabel(type)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="w-[150px]">
              <SelectValue placeholder={il.filterAll.status()} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{il.filterAll.status()}</SelectItem>
              {STATUS_VALUES.map((value) => (
                <SelectItem key={value} value={value}>
                  {statusOptionLabels[value]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={filterHealth} onValueChange={setFilterHealth}>
            <SelectTrigger className="w-[150px]">
              <SelectValue placeholder={il.filterAll.health} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{il.filterAll.health}</SelectItem>
              {HEALTH_VALUES.map((value) => (
                <SelectItem key={value} value={value}>
                  {healthOptionLabels[value]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {hasActiveFilters && (
            <Button variant="ghost" size="sm" onClick={clearFilters}>
              {il.clearFilters}
            </Button>
          )}
        </div>

        {/* Integration Cards Grid */}
        {isLoading ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <LoadingSkeleton variant="card" count={6} />
          </div>
        ) : error ? (
          <ErrorState
            message={tv.common.loadError}
            onRetry={() => void refetch()}
          />
        ) : filteredIntegrations.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="rounded-full bg-muted p-4 mb-4">
              <Unplug className="h-8 w-8 text-muted-foreground" />
            </div>
            <h3 className="text-base font-medium mb-1">
              {hasActiveFilters ? il.empty.matchingTitle : il.empty.noneTitle}
            </h3>
            <p className="text-sm text-muted-foreground mb-4 max-w-sm">
              {hasActiveFilters ? il.empty.matchingDesc : il.empty.noneDesc}
            </p>
            {hasActiveFilters ? (
              <Button variant="outline" size="sm" onClick={clearFilters}>
                {il.clearFilters}
              </Button>
            ) : (
              <Button size="sm" onClick={handleAddNew}>
                <Plus className="me-1.5 h-4 w-4" />
                {il.addIntegration}
              </Button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filteredIntegrations.map((integration) => (
              <IntegrationCard
                key={integration.id}
                integration={integration}
                onViewDetails={handleViewDetails}
                onConfigure={handleConfigure}
                onSyncNow={triggerSync}
                onDisconnect={handleDisconnect}
                onReconnect={handleReconnect}
                onRemove={handleRemove}
                syncingId={syncingId}
              />
            ))}
          </div>
        )}

        {/* Filtered count */}
        {!isLoading && !error && filteredIntegrations.length > 0 && hasActiveFilters && (
          <p className="text-xs text-muted-foreground text-center">
            {il.showing(filteredIntegrations.length, integrations.length)}
          </p>
        )}

        {/* Detail Panel */}
        <IntegrationDetailPanel
          integration={selectedIntegration}
          open={detailOpen}
          onOpenChange={setDetailOpen}
          onSyncNow={triggerSync}
          onConfigure={handleConfigure}
          onDisconnect={handleDisconnect}
          onReconnect={handleReconnect}
          onRemove={handleRemove}
          syncingId={syncingId}
        />

        {/* Form Dialog */}
        <IntegrationFormDialog
          open={formOpen}
          onOpenChange={setFormOpen}
          integration={editIntegration}
          onSaved={handleFormSaved}
        />

        {/* Disconnect Confirmation (soft: sets status=disconnected) */}
        <ConfirmDialog
          open={disconnectOpen}
          onOpenChange={setDisconnectOpen}
          title={il.confirm.disconnectTitle}
          description={il.confirm.disconnectDesc(disconnectTarget?.name ?? '')}
          confirmLabel={il.confirm.disconnectConfirm}
          variant="destructive"
          onConfirm={confirmDisconnect}
        />

        {/* Remove Confirmation (hard delete) */}
        <ConfirmDialog
          open={removeOpen}
          onOpenChange={setRemoveOpen}
          title={il.confirm.removeTitle}
          description={il.confirm.removeDesc(removeTarget?.name ?? '')}
          confirmLabel={il.confirm.removeConfirm}
          variant="destructive"
          onConfirm={confirmRemove}
        />
      </div>
    </PermissionRedirect>
  );
}
