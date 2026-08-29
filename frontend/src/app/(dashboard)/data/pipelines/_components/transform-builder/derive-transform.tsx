'use client';

import { Input } from '@/components/ui/input';
import type { DeriveTransformDraft } from '@/app/(dashboard)/data/pipelines/_components/pipeline-wizard-types';
import { useDataLabels } from '@/app/(dashboard)/data/_lib/data-i18n';

interface DeriveTransformProps {
  value: DeriveTransformDraft;
  availableColumns: string[];
  onChange: (value: DeriveTransformDraft) => void;
}

export function DeriveTransform({
  value,
  availableColumns,
  onChange,
}: DeriveTransformProps) {
  const labels = useDataLabels();
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="space-y-1.5">
          <div className="text-sm font-medium">{labels.pipelines.newColumnName}</div>
          <Input
            value={value.config.name}
            onChange={(event) => onChange({ ...value, config: { ...value.config, name: event.target.value } })}
            placeholder="full_name"
          />
        </div>

        <div className="rounded-lg border bg-muted/20 p-3 text-xs text-muted-foreground">
          {labels.pipelines.functionsHint}
        </div>
      </div>

      <div className="space-y-1.5">
        <div className="text-sm font-medium">{labels.pipelines.expressionLabel}</div>
        <div className="text-xs text-muted-foreground">
          {labels.pipelines.availableColumns(availableColumns.join(', ') || labels.pipelines.noColumnsYet)}
        </div>
        <Input
          value={value.config.expression}
          onChange={(event) => onChange({ ...value, config: { ...value.config, expression: event.target.value } })}
          placeholder="TRIM(first_name) + ' ' + TRIM(last_name)"
        />
      </div>
    </div>
  );
}
