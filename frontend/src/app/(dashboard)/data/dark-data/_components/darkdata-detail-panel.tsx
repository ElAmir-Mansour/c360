'use client';

import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { type DarkDataAsset } from '@/lib/data-suite';
import { formatMaybeBytes, formatMaybeDateTime, getClassificationBadge } from '@/lib/data-suite/utils';
import { useDataLabels } from '@/app/(dashboard)/data/_lib/data-i18n';

interface DarkDataDetailPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  asset: DarkDataAsset | null;
}

export function DarkDataDetailPanel({
  open,
  onOpenChange,
  asset,
}: DarkDataDetailPanelProps) {
  const labels = useDataLabels();
  const classification = getClassificationBadge(asset?.inferred_classification);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>{asset?.name ?? labels.darkData.detailTitle}</SheetTitle>
          <SheetDescription>{asset?.reason ?? labels.darkData.detailPrompt}</SheetDescription>
        </SheetHeader>
        {asset ? (
          <div className="mt-6 space-y-4">
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">{asset.asset_type}</Badge>
              <Badge variant="outline">{asset.governance_status}</Badge>
              <Badge variant="outline" className={classification.className}>
                {classification.label}
              </Badge>
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <Metric label={labels.darkData.mRiskScore} value={`${asset.risk_score.toFixed(0)}%`} />
              <Metric label={labels.darkData.mEstimatedSize} value={formatMaybeBytes(asset.estimated_size_bytes)} />
              <Metric label={labels.darkData.mColumns} value={asset.column_count?.toLocaleString() ?? '—'} />
              <Metric label={labels.darkData.mLastAccessed} value={formatMaybeDateTime(asset.last_accessed_at)} />
            </div>
            <div className="rounded-lg border">
              <pre className="overflow-x-auto p-4 text-xs">{JSON.stringify(asset.risk_factors, null, 2)}</pre>
            </div>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
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
    <div className="rounded-lg border bg-muted/20 p-3">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm font-medium">{value}</div>
    </div>
  );
}
