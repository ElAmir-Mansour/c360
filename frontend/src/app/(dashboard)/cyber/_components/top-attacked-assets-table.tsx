'use client';

import Link from 'next/link';
import { Server, Monitor, Cloud, Router, Wifi, AppWindow, Database, Box, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { EmptyState } from '@/components/common/empty-state';
import type { AssetAlertSummary, Criticality } from '@/types/cyber';
import { useCyberDashboardLabels, useCyberCriticalityLabels } from '../_lib/cyber-i18n';

interface TopAttackedAssetsTableProps {
  assets: AssetAlertSummary[];
}

const TYPE_ICONS: Record<string, React.ElementType> = {
  server: Server,
  endpoint: Monitor,
  cloud_resource: Cloud,
  network_device: Router,
  iot_device: Wifi,
  application: AppWindow,
  database: Database,
  container: Box,
};

const CRITICALITY_COLORS: Record<Criticality, string> = {
  critical: 'bg-severity-critical/15 text-severity-critical',
  high: 'bg-severity-high/15 text-severity-high',
  medium: 'bg-severity-medium/15 text-warning-700 dark:text-warning-300',
  low: 'bg-severity-low/15 text-severity-low',
};

function alertCountColor(count: number): string {
  if (count >= 10) return 'text-severity-critical font-semibold';
  if (count >= 5) return 'text-severity-high font-medium';
  if (count >= 1) return 'text-warning-700 dark:text-warning-300';
  return 'text-muted-foreground';
}

export function TopAttackedAssetsTable({ assets }: TopAttackedAssetsTableProps) {
  const t = useCyberDashboardLabels();
  const criticalityLabels = useCyberCriticalityLabels();
  if (assets.length === 0) {
    return (
      <EmptyState
        icon={AlertTriangle}
        title={t.attackedAssetsEmptyTitle}
        description={t.attackedAssetsEmptyDescription}
      />
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border">
      <table className="w-full text-sm">
        <thead className="border-b bg-muted/30">
          <tr>
            <th className="px-3 py-2 text-start text-xs font-medium text-muted-foreground">{t.colAsset}</th>
            <th className="px-3 py-2 text-start text-xs font-medium text-muted-foreground">{t.colCriticality}</th>
            <th className="px-3 py-2 text-start text-xs font-medium text-muted-foreground">{t.colAlerts}</th>
          </tr>
        </thead>
        <tbody>
          {assets.map((asset) => {
            const Icon = TYPE_ICONS[asset.asset_type] ?? Server;
            return (
              <tr key={asset.asset_id} className="border-b last:border-0 hover:bg-muted/20">
                <td className="px-3 py-2">
                  <Link href={`/cyber/assets/${asset.asset_id}`} className="flex items-center gap-2 hover:underline">
                    <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="font-medium truncate max-w-[100px] sm:max-w-[140px]">{asset.asset_name}</span>
                  </Link>
                </td>
                <td className="px-3 py-2">
                  <span className={cn('inline-flex rounded-full px-1.5 py-0.5 text-xs font-medium capitalize', CRITICALITY_COLORS[asset.criticality as Criticality] ?? 'bg-secondary text-foreground')}>
                    {criticalityLabels[asset.criticality] ?? asset.criticality}
                  </span>
                </td>
                <td className="px-3 py-2">
                  <span className={alertCountColor(asset.alert_count)}>{asset.alert_count}</span>
                  {asset.critical_open > 0 && (
                    <span className="ms-1 text-xs text-severity-critical">{t.critShort(asset.critical_open)}</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
