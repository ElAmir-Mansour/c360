'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { type DataSource, type SyncHistory } from '@/lib/data-suite';
import { formatMaybeDateTime } from '@/lib/data-suite/utils';
import { useDataLabels } from '@/app/(dashboard)/data/_lib/data-i18n';

interface SourceActivityTabProps {
  source: DataSource;
  syncHistory: SyncHistory[];
}

export function SourceActivityTab({
  source,
  syncHistory,
}: SourceActivityTabProps) {
  const labels = useDataLabels();
  const timeline = [
    { id: `${source.id}-created`, title: labels.sourcesDetail.activityCreated, detail: source.name, at: source.created_at },
    { id: `${source.id}-updated`, title: labels.sourcesDetail.activityUpdated, detail: source.description || labels.sourcesDetail.configUpdated, at: source.updated_at },
    ...syncHistory.map((sync) => ({
      id: sync.id,
      title: labels.sourcesDetail.syncActivity(sync.status),
      detail: labels.sourcesDetail.syncDetail(sync.sync_type, String(sync.rows_written)),
      at: sync.completed_at ?? sync.started_at,
    })),
  ].sort((left, right) => new Date(right.at).getTime() - new Date(left.at).getTime());

  return (
    <Card>
      <CardHeader>
        <CardTitle>{labels.sourcesDetail.activityTimelineTitle}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {timeline.map((item) => (
          <div key={item.id} className="flex gap-3">
            <div className="mt-2 h-2.5 w-2.5 rounded-full bg-primary" />
            <div className="min-w-0 flex-1 rounded-lg border px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="font-medium">{item.title}</div>
                <div className="text-xs text-muted-foreground">{formatMaybeDateTime(item.at)}</div>
              </div>
              <div className="mt-1 text-sm text-muted-foreground">{item.detail}</div>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
