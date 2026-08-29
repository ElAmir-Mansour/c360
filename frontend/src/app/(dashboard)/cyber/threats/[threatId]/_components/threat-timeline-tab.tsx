'use client';

import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { ErrorState } from '@/components/common/error-state';
import { EmptyState } from '@/components/common/empty-state';
import { Timeline } from '@/components/shared/timeline';
import { Activity } from 'lucide-react';
import type { ThreatTimelineEntry } from '@/types/cyber';
import { useThreatLabels } from '../../_lib/threats-i18n';

interface ThreatTimelineTabProps {
  threatId: string;
}

export function ThreatTimelineTab({ threatId }: ThreatTimelineTabProps) {
  const t = useThreatLabels();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['threat-timeline', threatId],
    queryFn: () => apiGet<{ data: ThreatTimelineEntry[] }>(API_ENDPOINTS.CYBER_THREAT_TIMELINE(threatId)),
  });

  if (isLoading) return <LoadingSkeleton variant="list-item" count={6} />;
  if (error) return <ErrorState message={t.timelineTab.failedToLoad} onRetry={() => void refetch()} />;

  const items = (data?.data ?? []).map((entry) => ({
    id: entry.id,
    title: entry.title,
    description: entry.description,
    timestamp: entry.timestamp,
    variant: entry.variant,
  }));

  if (items.length === 0) {
    return (
      <EmptyState
        icon={Activity}
        title={t.timelineTab.emptyTitle}
        description={t.timelineTab.emptyDescription}
      />
    );
  }

  return <Timeline items={items} />;
}
