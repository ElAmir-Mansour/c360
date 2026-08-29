'use client';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { type Pipeline } from '@/lib/data-suite';
import { useDataLabels } from '@/app/(dashboard)/data/_lib/data-i18n';

interface PipelineConfigTabProps {
  pipeline: Pipeline;
}

export function PipelineConfigTab({
  pipeline,
}: PipelineConfigTabProps) {
  const labels = useDataLabels();
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>{labels.pipelinesDetail.configTitle}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Property label={labels.pipelinesDetail.pSourceTable} value={pipeline.config.source_table ?? '—'} />
          <Property label={labels.pipelinesDetail.pSourceQuery} value={pipeline.config.source_query ?? '—'} />
          <Property label={labels.pipelinesDetail.pTargetTable} value={pipeline.config.target_table ?? '—'} />
          <Property label={labels.pipelinesDetail.pLoadStrategy} value={pipeline.config.load_strategy ?? '—'} />
          <Property label={labels.pipelinesDetail.pBatchSize} value={pipeline.config.batch_size?.toLocaleString() ?? '—'} />
          <Property label={labels.pipelinesDetail.pIncrementalField} value={pipeline.config.incremental_field ?? '—'} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{labels.pipelinesDetail.transformFlowTitle}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {(pipeline.config.transformations ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">{labels.pipelinesDetail.noTransforms}</p>
          ) : (
            (pipeline.config.transformations ?? []).map((transform, index) => (
              <div key={`${transform.type}-${index}`} className="rounded-lg border px-4 py-3">
                <div className="flex items-center gap-2">
                  <Badge variant="outline">{index + 1}</Badge>
                  <span className="font-medium capitalize">{transform.type.replace(/_/g, ' ')}</span>
                </div>
                <pre className="mt-2 overflow-x-auto rounded bg-muted/20 p-3 text-xs">
                  {JSON.stringify(transform.config, null, 2)}
                </pre>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Property({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm">{value}</div>
    </div>
  );
}
