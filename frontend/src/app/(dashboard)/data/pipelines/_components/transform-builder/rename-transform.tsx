'use client';

import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { RenameTransformDraft } from '@/app/(dashboard)/data/pipelines/_components/pipeline-wizard-types';
import { useDataLabels } from '@/app/(dashboard)/data/_lib/data-i18n';

interface RenameTransformProps {
  value: RenameTransformDraft;
  availableColumns: string[];
  onChange: (value: RenameTransformDraft) => void;
}

export function RenameTransform({
  value,
  availableColumns,
  onChange,
}: RenameTransformProps) {
  const labels = useDataLabels();
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <div className="space-y-1.5">
        <div className="text-sm font-medium">{labels.pipelines.fromLabel}</div>
        <Select
          value={value.config.from}
          onValueChange={(next) => onChange({ ...value, config: { ...value.config, from: next } })}
        >
          <SelectTrigger>
            <SelectValue placeholder={labels.pipelines.selectColumn} />
          </SelectTrigger>
          <SelectContent>
            {availableColumns.map((column) => (
              <SelectItem key={column} value={column}>
                {column}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <div className="text-sm font-medium">{labels.pipelines.toLabel}</div>
        <Input
          value={value.config.to}
          onChange={(event) => onChange({ ...value, config: { ...value.config, to: event.target.value } })}
          placeholder="renamed_column"
        />
      </div>
    </div>
  );
}
