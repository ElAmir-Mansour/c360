'use client';

import { Badge } from '@/components/ui/badge';
import { type QualityGateResult } from '@/lib/data-suite';
import { useDataLabels } from '@/app/(dashboard)/data/_lib/data-i18n';

interface QualityGateResultsProps {
  results: QualityGateResult[];
}

export function QualityGateResults({
  results,
}: QualityGateResultsProps) {
  const labels = useDataLabels();

  if (!results || results.length === 0) {
    return <p className="text-sm text-muted-foreground">{labels.pipelinesDetail.noGatesEvaluated}</p>;
  }

  return (
    <div className="space-y-3">
      {results.map((result) => (
        <div key={`${result.name}-${result.evaluated_at}`} className="rounded-lg border px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="font-medium">{result.name}</div>
              <div className="mt-1 text-xs text-muted-foreground">
                {result.metric} • {labels.pipelinesDetail.gateValue(String(result.metric_value))}
              </div>
            </div>
            <Badge variant="outline">{result.status}</Badge>
          </div>
          {result.message ? <div className="mt-2 text-sm text-muted-foreground">{result.message}</div> : null}
        </div>
      ))}
    </div>
  );
}
