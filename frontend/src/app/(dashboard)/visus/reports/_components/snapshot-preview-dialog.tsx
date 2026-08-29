'use client';

import { useQuery } from '@tanstack/react-query';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { enterpriseApi } from '@/lib/enterprise';
import { RelativeTime } from '@/components/shared/relative-time';
import { useVisusSnapshotPreviewLabels } from '../../_lib/visus-i18n';

interface SnapshotPreviewDialogProps {
  reportId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SnapshotPreviewDialog({ reportId, open, onOpenChange }: SnapshotPreviewDialogProps) {
  const t = useVisusSnapshotPreviewLabels();
  const { data: snapshot, isLoading, error } = useQuery({
    queryKey: ['visus-snapshot-preview', reportId],
    queryFn: () => enterpriseApi.visus.getLatestReportSnapshot(reportId!),
    enabled: open && !!reportId,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t.title}</DialogTitle>
          <DialogDescription>{t.description}</DialogDescription>
        </DialogHeader>
        {isLoading && <p className="py-4 text-sm text-muted-foreground">{t.loading}</p>}
        {error && <p className="py-4 text-sm text-destructive">{t.error}</p>}
        {snapshot && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
              <div>
                <p className="text-muted-foreground">{t.period}</p>
                <p className="font-medium">{t.periodRange(snapshot.period_start, snapshot.period_end)}</p>
              </div>
              <div>
                <p className="text-muted-foreground">{t.generated}</p>
                <p className="font-medium"><RelativeTime date={snapshot.generated_at} /></p>
              </div>
              {snapshot.generation_time_ms != null && (
                <div>
                  <p className="text-muted-foreground">{t.generationTime}</p>
                  <p className="font-medium">{t.generationTimeValue(String(snapshot.generation_time_ms))}</p>
                </div>
              )}
              <div>
                <p className="text-muted-foreground">{t.format}</p>
                <p className="font-medium uppercase">{snapshot.file_format}</p>
              </div>
            </div>
            {snapshot.sections_included.length > 0 && (
              <div>
                <p className="mb-1 text-sm text-muted-foreground">{t.sections}</p>
                <div className="flex flex-wrap gap-1">
                  {snapshot.sections_included.map((section) => (
                    <Badge key={section} variant="outline" className="capitalize">
                      {section.replace(/_/g, ' ')}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
            {snapshot.narrative && (
              <div>
                <p className="mb-1 text-sm text-muted-foreground">{t.narrative}</p>
                <p className="rounded-md border bg-muted/50 p-3 text-sm">{snapshot.narrative}</p>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
