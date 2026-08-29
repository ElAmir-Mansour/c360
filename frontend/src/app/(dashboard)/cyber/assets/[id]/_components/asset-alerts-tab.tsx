'use client';

import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { apiGet } from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';
import { SeverityIndicator } from '@/components/shared/severity-indicator';
import { StatusBadge } from '@/components/shared/status-badge';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { ErrorState } from '@/components/common/error-state';
import { EmptyState } from '@/components/common/empty-state';
import { Bell, ArrowRight } from 'lucide-react';
import { timeAgo, cn } from '@/lib/utils';
import type { PaginatedResponse } from '@/types/api';
import type { CyberAlert } from '@/types/cyber';
import { useAssetLabels } from '../../_lib/assets-i18n';

interface AssetAlertsTabProps {
  assetId: string;
}

const STATUS_RING: Record<string, string> = {
  new: 'ring-1 ring-error-500/30 bg-error-50/50 dark:bg-error-700/20',
  acknowledged: 'ring-1 ring-warning-500/30 bg-warning-50/50 dark:bg-warning-800/20',
  investigating: 'ring-1 ring-blue-500/30 bg-blue-50/50 dark:bg-blue-950/20',
  in_progress: 'ring-1 ring-blue-500/30 bg-blue-50/50 dark:bg-blue-950/20',
  resolved: '',
  closed: '',
};

export function AssetAlertsTab({ assetId }: AssetAlertsTabProps) {
  const router = useRouter();
  const t = useAssetLabels();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['asset-alerts', assetId],
    queryFn: () =>
      apiGet<PaginatedResponse<CyberAlert>>(
        API_ENDPOINTS.CYBER_ALERTS,
        { asset_id: assetId, per_page: 50, sort: 'created_at', order: 'desc' },
      ),
  });

  if (isLoading) return <LoadingSkeleton variant="table-row" count={6} />;
  if (error) return <ErrorState message={t.alertsTab.loadError} onRetry={() => refetch()} />;
  if (!data || data.data.length === 0) {
    return (
      <EmptyState
        icon={Bell}
        title={t.alertsTab.emptyTitle}
        description={t.alertsTab.emptyDescription}
      />
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">{t.alertsTab.countLabel(data.meta.total)}</p>
      <div className="space-y-2">
        {data.data.map((alert) => (
          <div
            key={alert.id}
            className={cn(
              'group flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors hover:bg-muted/30',
              STATUS_RING[alert.status] ?? '',
            )}
            onClick={() => router.push(`/cyber/alerts/${alert.id}`)}
          >
            <SeverityIndicator severity={alert.severity} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium group-hover:underline">{alert.title}</p>
              <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{alert.description}</p>
              <div className="mt-1.5 flex items-center gap-3 text-xs text-muted-foreground">
                <StatusBadge status={alert.status} />
                <span>{t.alertsTab.confidence(alert.confidence_score)}</span>
                <span>{timeAgo(alert.created_at)}</span>
              </div>
            </div>
            <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
          </div>
        ))}
      </div>
    </div>
  );
}
