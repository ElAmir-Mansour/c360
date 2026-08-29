'use client';

import { type LineageNode } from '@/lib/data-suite';
import { useDataLabels } from '@/app/(dashboard)/data/_lib/data-i18n';

interface LineageDetailPanelProps {
  node: LineageNode | null;
}

export function LineageDetailPanel({
  node,
}: LineageDetailPanelProps) {
  const labels = useDataLabels();

  if (!node) {
    return (
      <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
        {labels.lineage.selectNodePrompt}
      </div>
    );
  }

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="font-medium">{node.name}</div>
      <div className="mt-1 text-sm capitalize text-muted-foreground">{node.type.replace(/_/g, ' ')}</div>
      <div className="mt-4 grid gap-3">
        <Metric label={labels.common.status} value={node.status ?? '—'} />
        <Metric label={labels.lineage.mDepth} value={node.depth.toString()} />
        <Metric label={labels.lineage.mInbound} value={node.in_degree.toString()} />
        <Metric label={labels.lineage.mOutbound} value={node.out_degree.toString()} />
        <Metric label={labels.lineage.mCritical} value={node.is_critical ? labels.common.yes : labels.common.no} />
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
      <div className="mt-1 text-sm font-medium">{value}</div>
    </div>
  );
}
