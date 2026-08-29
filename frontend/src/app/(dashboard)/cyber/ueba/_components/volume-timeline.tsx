'use client';

import { format } from 'date-fns';
import { useUebaLabels } from '../_lib/ueba-i18n';

export function VolumeTimeline({
  points,
  expectedBytesMean,
  expectedRowsMean,
}: {
  points: Array<Record<string, unknown>>;
  expectedBytesMean: number;
  expectedRowsMean: number;
}) {
  const t = useUebaLabels();
  const maxBytes = Math.max(...points.map((point) => Number(point.bytes ?? 0)), expectedBytesMean, 1);

  return (
    <div className="space-y-3">
      <div className="text-xs text-muted-foreground">
        {t.expectedDailyMean(
          Math.round(expectedBytesMean).toLocaleString(),
          Math.round(expectedRowsMean).toLocaleString(),
        )}
      </div>
      {points.map((point) => (
        <div key={String(point.bucket)} className="grid grid-cols-[72px_1fr_120px] items-center gap-3">
          <span className="text-xs text-muted-foreground">
            {format(new Date(String(point.bucket)), 'MMM d')}
          </span>
          <div className="relative h-2 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary"
              style={{ width: `${(Number(point.bytes ?? 0) / maxBytes) * 100}%` }}
            />
          </div>
          <span className="text-end text-xs font-medium">
            {Number(point.bytes ?? 0).toLocaleString()} B
          </span>
        </div>
      ))}
      {points.length === 0 && <p className="text-sm text-muted-foreground">{t.volumeEmpty}</p>}
    </div>
  );
}
