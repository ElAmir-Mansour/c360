'use client';

import { Badge } from '@/components/ui/badge';
import { useUebaLabels } from '../_lib/ueba-i18n';
import { useCyberSeverityLabels } from '../../_lib/cyber-i18n';
import type { UebaAlert } from './types';

export function SignalEvidenceViewer({ alert }: { alert: UebaAlert }) {
  const t = useUebaLabels();
  const severityLabels = useCyberSeverityLabels();
  const signals = alert.triggering_signals ?? [];
  return (
    <div className="space-y-3">
      {signals.map((signal) => (
        <div key={`${alert.id}-${signal.event_id}-${signal.signal_type}`} className="rounded-lg border p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div>
              <div className="font-medium">{signal.title}</div>
              <div className="text-xs text-muted-foreground">{signal.signal_type.replaceAll('_', ' ')}</div>
            </div>
            <Badge variant={signal.severity === 'critical' ? 'destructive' : signal.severity === 'high' ? 'warning' : 'outline'}>
              {severityLabels[signal.severity] ?? signal.severity}
            </Badge>
          </div>
          <div className="grid gap-2 text-xs text-muted-foreground">
            <div>{signal.description}</div>
            <div>{t.expected}: {signal.expected_value}</div>
            <div>{t.actual}: {signal.actual_value}</div>
            <div>{t.confidence}: {(signal.confidence * 100).toFixed(0)}%</div>
            <div>{t.eventId}: <span className="font-mono">{signal.event_id}</span></div>
          </div>
        </div>
      ))}
      {signals.length === 0 && <p className="text-sm text-muted-foreground">{t.evidenceEmpty}</p>}
    </div>
  );
}
