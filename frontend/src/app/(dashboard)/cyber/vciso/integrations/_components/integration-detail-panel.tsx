'use client';

import {
  AlertCircle,
  Calendar,
  Clock,
  Database,
  Hash,
  PlugZap,
  RefreshCw,
  Settings,
  Trash2,
  Unplug,
} from 'lucide-react';

import { DetailPanel } from '@/components/shared/detail-panel';
import { StatusBadge } from '@/components/shared/status-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { integrationStatusConfig, integrationHealthConfig } from '@/lib/status-configs';
import { formatDate, formatDateTime, formatCompactNumber, titleCase } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { VCISOIntegration } from '@/types/cyber';
import { useVcisoOpsLabels } from '../../_lib/vciso-i18n';

import { TYPE_ICON_MAP, TYPE_COLOR_MAP } from './integration-card';

// ─── Props ───────────────────────────────────────────────────────────────────

interface IntegrationDetailPanelProps {
  integration: VCISOIntegration | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSyncNow?: (integration: VCISOIntegration) => void;
  onConfigure?: (integration: VCISOIntegration) => void;
  onDisconnect?: (integration: VCISOIntegration) => void;
  onReconnect?: (integration: VCISOIntegration) => void;
  onRemove?: (integration: VCISOIntegration) => void;
  /** ID of the integration currently being synced (null if none). */
  syncingId?: string | null;
}

// ─── Helper ──────────────────────────────────────────────────────────────────

function redactConfigValue(key: string, value: unknown): string {
  const sensitiveKeys = ['key', 'secret', 'password', 'token', 'credential'];
  const lowerKey = key.toLowerCase();
  if (sensitiveKeys.some((s) => lowerKey.includes(s)) && typeof value === 'string' && value.length > 0) {
    return value.slice(0, 4) + '****';
  }
  if (typeof value === 'object' && value !== null) {
    return JSON.stringify(value);
  }
  return String(value);
}

// ─── Component ───────────────────────────────────────────────────────────────

export function IntegrationDetailPanel({
  integration,
  open,
  onOpenChange,
  onSyncNow,
  onConfigure,
  onDisconnect,
  onReconnect,
  onRemove,
  syncingId = null,
}: IntegrationDetailPanelProps) {
  const labels = useVcisoOpsLabels().integrations;
  const t = labels.detail;
  const typeLabels = labels.types as Record<string, string>;
  const freqLabels = labels.syncFrequencies;

  if (!integration) return null;

  const TypeIcon = TYPE_ICON_MAP[integration.type] ?? Database;
  const typeColor = TYPE_COLOR_MAP[integration.type] ?? TYPE_COLOR_MAP.siem;
  const typeLabel = typeLabels[integration.type] ?? titleCase(integration.type);
  const configEntries = Object.entries(integration.config);
  const isSyncing = syncingId === integration.id;
  const isDisconnected = integration.status === 'disconnected';

  return (
    <DetailPanel
      open={open}
      onOpenChange={onOpenChange}
      title={integration.name}
      description={t.subtitle(integration.provider, typeLabel)}
      width="lg"
    >
      <div className="space-y-6">
        {/* Header badges */}
        <div className="flex items-center gap-2 flex-wrap">
          <div
            className={cn(
              'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
              typeColor,
            )}
          >
            <TypeIcon className="h-4 w-4" aria-hidden />
          </div>
          <StatusBadge
            status={integration.status}
            config={integrationStatusConfig}
          />
          <StatusBadge
            status={integration.health_status}
            config={integrationHealthConfig}
            variant="outline"
          />
          <Badge variant="outline" className="text-xs">
            {typeLabel}
          </Badge>
        </div>

        {/* Error message */}
        {integration.status === 'error' && integration.error_message && (
          <div className="rounded-lg border border-error-100 bg-error-50 dark:bg-error-700/10 p-3">
            <div className="flex items-start gap-2">
              <AlertCircle className="h-4 w-4 text-status-error shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-error-700 dark:text-error-300">{t.errorTitle}</p>
                <p className="text-xs text-error-600 dark:text-error-300 mt-0.5 leading-relaxed">
                  {integration.error_message}
                </p>
              </div>
            </div>
          </div>
        )}

        <Separator />

        {/* Sync details */}
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
            <RefreshCw className="inline h-3.5 w-3.5 me-1 -mt-0.5" />
            {t.syncInformation}
          </h4>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <Database className="h-3 w-3" />
                {t.itemsSynced}
              </p>
              <p className="text-lg font-semibold mt-0.5 tabular-nums">
                {formatCompactNumber(integration.items_synced)}
              </p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {t.syncFrequency}
              </p>
              <p className="text-sm font-medium mt-0.5">
                {freqLabels[integration.sync_frequency]?.() ?? titleCase(integration.sync_frequency)}
              </p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <Calendar className="h-3 w-3" />
                {t.lastSync}
              </p>
              <p className="text-sm font-medium mt-0.5">
                {integration.last_sync_at
                  ? formatDateTime(integration.last_sync_at)
                  : t.never}
              </p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <Hash className="h-3 w-3" />
                {t.provider}
              </p>
              <p className="text-sm font-medium mt-0.5">{integration.provider}</p>
            </div>
          </div>
        </div>

        <Separator />

        {/* Configuration */}
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
            <Settings className="inline h-3.5 w-3.5 me-1 -mt-0.5" />
            {t.configuration(configEntries.length)}
          </h4>
          {configEntries.length > 0 ? (
            <div className="space-y-1.5 rounded-lg border p-3">
              {configEntries.map(([key, value]) => (
                <div key={key} className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground font-mono text-xs">{key}</span>
                  <span className="font-medium font-mono text-xs truncate max-w-[120px] sm:max-w-[200px]">
                    {redactConfigValue(key, value)}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{t.noConfig}</p>
          )}
        </div>

        <Separator />

        {/* Timestamps */}
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
            {t.timeline}
          </h4>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <Calendar className="h-3 w-3" />
                {t.created}
              </p>
              <p className="text-sm font-medium mt-0.5">{formatDate(integration.created_at)}</p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <Calendar className="h-3 w-3" />
                {t.updated}
              </p>
              <p className="text-sm font-medium mt-0.5">{formatDate(integration.updated_at)}</p>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-col gap-2">
          <Button
            className="w-full"
            disabled={isSyncing || isDisconnected}
            onClick={() => onSyncNow?.(integration)}
          >
            <RefreshCw className={cn('me-1.5 h-4 w-4', isSyncing && 'animate-spin')} />
            {isSyncing ? t.syncing : t.syncNow}
          </Button>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <Button
              variant="outline"
              onClick={() => onConfigure?.(integration)}
            >
              <Settings className="me-1.5 h-4 w-4" />
              {t.configure}
            </Button>
            {isDisconnected ? (
              <Button
                variant="outline"
                className="text-primary hover:text-primary dark:text-primary dark:hover:text-primary"
                onClick={() => onReconnect?.(integration)}
              >
                <PlugZap className="me-1.5 h-4 w-4" />
                {t.reconnect}
              </Button>
            ) : (
              <Button
                variant="outline"
                className="text-warning-700 hover:text-warning-700 dark:text-warning-300 dark:hover:text-warning-300"
                onClick={() => onDisconnect?.(integration)}
              >
                <Unplug className="me-1.5 h-4 w-4" />
                {t.disconnect}
              </Button>
            )}
            <Button
              variant="outline"
              className="text-destructive hover:text-destructive"
              onClick={() => onRemove?.(integration)}
            >
              <Trash2 className="me-1.5 h-4 w-4" />
              {t.remove}
            </Button>
          </div>
        </div>
      </div>
    </DetailPanel>
  );
}
