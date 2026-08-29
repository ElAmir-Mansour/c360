'use client';

import { type ImpactAnalysis } from '@/lib/data-suite';
import { useDataLabels } from '@/app/(dashboard)/data/_lib/data-i18n';

interface LineageImpactPanelProps {
  impact: ImpactAnalysis | null;
}

export function LineageImpactPanel({
  impact,
}: LineageImpactPanelProps) {
  const labels = useDataLabels();

  if (!impact) {
    return (
      <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
        {labels.lineage.impactPrompt}
      </div>
    );
  }

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="font-medium">{labels.lineage.impactTitle}</div>
      <div className="mt-2 text-sm text-muted-foreground">{impact.summary}</div>
      <div className="mt-4 grid gap-3">
        <Metric label={labels.common.severity} value={impact.severity} />
        <Metric label={labels.lineage.mDirectlyAffected} value={impact.directly_affected.length.toString()} />
        <Metric label={labels.lineage.mIndirectlyAffected} value={impact.indirectly_affected.length.toString()} />
        <Metric label={labels.lineage.mAffectedSuites} value={impact.affected_suites.length.toString()} />
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-md border bg-muted/20 p-3">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm font-medium capitalize">{value}</div>
    </div>
  );
}
