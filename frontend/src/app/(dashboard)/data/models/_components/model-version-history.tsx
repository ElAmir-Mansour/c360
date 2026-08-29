'use client';

import { Badge } from '@/components/ui/badge';
import { type DataModel } from '@/lib/data-suite';
import { formatMaybeDateTime } from '@/lib/data-suite/utils';
import { useDataLabels } from '@/app/(dashboard)/data/_lib/data-i18n';

interface ModelVersionHistoryProps {
  versions: DataModel[];
  currentModelId: string;
}

export function ModelVersionHistory({
  versions,
  currentModelId,
}: ModelVersionHistoryProps) {
  const labels = useDataLabels();

  if (versions.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
        {labels.models.noVersions}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {versions.map((version) => (
        <div key={version.id} className="rounded-lg border px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="font-medium">
                {labels.models.versionLine(String(version.version), version.display_name || version.name)}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {labels.models.versionMeta(String(version.field_count), formatMaybeDateTime(version.updated_at))}
              </div>
            </div>
            {version.id === currentModelId ? <Badge variant="outline">{labels.models.current}</Badge> : null}
          </div>
        </div>
      ))}
    </div>
  );
}
