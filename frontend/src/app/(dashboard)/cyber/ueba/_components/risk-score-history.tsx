'use client';

import { format } from 'date-fns';
import { useUebaLabels } from '../_lib/ueba-i18n';

export function RiskScoreHistory({
  history,
}: {
  history: Array<{ timestamp: string; score: number; severity?: string; alert_type?: string }>;
}) {
  const t = useUebaLabels();
  const max = Math.max(...history.map((item) => item.score), 1);

  return (
    <div className="space-y-3">
      {history.map((item) => (
        <div key={`${item.timestamp}-${item.score}`} className="grid grid-cols-[72px_1fr_48px] items-center gap-3">
          <span className="text-xs text-muted-foreground">{format(new Date(item.timestamp), 'MMM d')}</span>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary"
              style={{ width: `${(item.score / max) * 100}%` }}
            />
          </div>
          <span className="text-end text-xs font-medium">{item.score.toFixed(0)}</span>
        </div>
      ))}
      {history.length === 0 && <p className="text-sm text-muted-foreground">{t.riskHistoryEmpty}</p>}
    </div>
  );
}
