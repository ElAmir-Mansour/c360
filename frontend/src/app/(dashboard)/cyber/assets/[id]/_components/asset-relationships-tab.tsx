'use client';

import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { ErrorState } from '@/components/common/error-state';
import { EmptyState } from '@/components/common/empty-state';
import { GitBranch } from 'lucide-react';
import { RelationshipGraph } from './relationship-graph';
import type { CyberAsset, AssetRelationship } from '@/types/cyber';
import { useAssetLabels } from '../../_lib/assets-i18n';

interface AssetRelationshipsTabProps {
  asset: CyberAsset;
}

export function AssetRelationshipsTab({ asset }: AssetRelationshipsTabProps) {
  const t = useAssetLabels();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['asset-relationships', asset.id],
    queryFn: () =>
      apiGet<{ data: AssetRelationship[] }>(
        `${API_ENDPOINTS.CYBER_ASSETS}/${asset.id}/relationships`,
      ),
  });

  if (isLoading) return <LoadingSkeleton variant="card" />;
  if (error) return <ErrorState message={t.relTab.loadError} onRetry={() => refetch()} />;

  const relationships = data?.data ?? [];

  if (relationships.length === 0) {
    return (
      <EmptyState
        icon={GitBranch}
        title={t.relTab.emptyTitle}
        description={t.relTab.emptyDescription}
      />
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {t.relTab.countHint(relationships.length)}
      </p>
      <RelationshipGraph
        assetId={asset.id}
        assetName={asset.name}
        assetType={asset.type}
        relationships={relationships}
        height={500}
      />
    </div>
  );
}
