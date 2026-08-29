'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { RelativeTime } from '@/components/shared/relative-time';
import { DetailStatCard } from '@/components/shared/detail-stat-card';
import { enterpriseApi } from '@/lib/enterprise';
import { formatJsonInput } from '../../_components/form-utils';
import { useVisusReportSnapshotsLabels } from '../../_lib/visus-i18n';

interface ReportSnapshotsDialogProps {
  reportId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ReportSnapshotsDialog({ reportId, open, onOpenChange }: ReportSnapshotsDialogProps) {
  const t = useVisusReportSnapshotsLabels();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const snapshotsQuery = useQuery({
    queryKey: ['visus-report-snapshots', reportId],
    queryFn: () => enterpriseApi.visus.listReportSnapshots(reportId!),
    enabled: open && Boolean(reportId),
  });

  useEffect(() => {
    if (snapshotsQuery.data && snapshotsQuery.data.length > 0 && !selectedId) {
      setSelectedId(snapshotsQuery.data[0].id);
    }
    if (!open) {
      setSelectedId(null);
    }
  }, [open, selectedId, snapshotsQuery.data]);

  const selected = snapshotsQuery.data?.find((snapshot) => snapshot.id === selectedId) ?? snapshotsQuery.data?.[0];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-5xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t.title}</DialogTitle>
          <DialogDescription>{t.description}</DialogDescription>
        </DialogHeader>

        {snapshotsQuery.isLoading ? <p className="text-sm text-muted-foreground">{t.loading}</p> : null}
        {snapshotsQuery.isError ? <p className="text-sm text-destructive">{t.error}</p> : null}

        {snapshotsQuery.data ? (
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-[280px_1fr]">
            <div className="space-y-2">
              {snapshotsQuery.data.length > 0 ? (
                snapshotsQuery.data.map((snapshot) => (
                  <button
                    key={snapshot.id}
                    type="button"
                    onClick={() => setSelectedId(snapshot.id)}
                    className={`w-full rounded-xl border p-3 text-start transition ${
                      snapshot.id === selected?.id ? 'border-primary bg-primary/5' : 'hover:bg-muted/40'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-medium">{t.snapshotLabel(snapshot.id.slice(0, 8))}</p>
                      <Badge variant="outline">{snapshot.file_format.toUpperCase()}</Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      <RelativeTime date={snapshot.generated_at} />
                    </p>
                  </button>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">{t.empty}</p>
              )}
            </div>

            {selected ? (
              <div className="space-y-4">
                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                  <DetailStatCard
                    label={t.generated}
                    value={<RelativeTime date={selected.generated_at} />}
                    tone="gold"
                  />
                  <DetailStatCard
                    label={t.period}
                    value={t.periodRange(selected.period_start, selected.period_end)}
                    tone="gold"
                  />
                  <DetailStatCard
                    label={t.generationTime}
                    value={t.generationTimeValue(String(selected.generation_time_ms ?? 'n/a'))}
                    tone="sky"
                  />
                </div>

                {selected.sections_included.length > 0 ? (
                  <div>
                    <p className="mb-2 text-sm font-medium">{t.sections}</p>
                    <div className="flex flex-wrap gap-2">
                      {selected.sections_included.map((section) => (
                        <Badge key={section} variant="outline">
                          {section.replace(/_/g, ' ')}
                        </Badge>
                      ))}
                    </div>
                  </div>
                ) : null}

                {selected.narrative ? (
                  <div className="rounded-xl border bg-muted/30 p-4">
                    <p className="text-sm leading-7">{selected.narrative}</p>
                  </div>
                ) : null}

                <div className="space-y-2">
                  <p className="text-sm font-medium">{t.reportPayload}</p>
                  <pre className="overflow-x-auto rounded-xl border bg-muted/40 p-4 text-xs">
                    {formatJsonInput(selected.report_data)}
                  </pre>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
