'use client';

import { useEffect, useMemo, useState } from 'react';
import { Plus, Sparkles } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import type { JsonValue } from '@/lib/data-suite';
import type { PipelineTransformDraft } from '@/app/(dashboard)/data/pipelines/_components/pipeline-wizard-types';
import { createEmptyTransform } from '@/app/(dashboard)/data/pipelines/_components/pipeline-wizard-utils';
import { TransformCard } from '@/app/(dashboard)/data/pipelines/_components/transform-builder/transform-card';
import { useDataLabels, type DataLabels, type StringKeys } from '@/app/(dashboard)/data/_lib/data-i18n';

interface TransformListProps {
  transforms: PipelineTransformDraft[];
  availableColumns: string[];
  previewBeforeRows: Array<Record<string, JsonValue>>;
  previewAfterRows: Array<Record<string, JsonValue>>;
  previewError: string | null;
  onChange: (value: PipelineTransformDraft[]) => void;
  onPreview: () => void;
}

const TRANSFORM_TYPES: Array<{ labelKey: StringKeys<DataLabels['pipelines']>; value: PipelineTransformDraft['type'] }> = [
  { labelKey: 'ttRename', value: 'rename' },
  { labelKey: 'ttCast', value: 'cast' },
  { labelKey: 'ttFilter', value: 'filter' },
  { labelKey: 'ttMapValues', value: 'map_values' },
  { labelKey: 'ttDerive', value: 'derive' },
  { labelKey: 'ttDeduplicate', value: 'deduplicate' },
  { labelKey: 'ttAggregate', value: 'aggregate' },
];

export function TransformList({
  transforms,
  availableColumns,
  previewBeforeRows,
  previewAfterRows,
  previewError,
  onChange,
  onPreview,
}: TransformListProps) {
  const labels = useDataLabels();
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<string[]>([]);

  useEffect(() => {
    setExpandedIds((current) => Array.from(new Set([...current, ...transforms.map((transform) => transform.id)])));
  }, [transforms]);

  const previewColumns = useMemo(() => {
    const columns = new Set<string>();
    [...previewBeforeRows, ...previewAfterRows].forEach((row) => {
      Object.keys(row).forEach((key) => columns.add(key));
    });
    return Array.from(columns);
  }, [previewAfterRows, previewBeforeRows]);

  const reorderTo = (targetId: string) => {
    if (!draggedId || draggedId === targetId) {
      return;
    }
    const next = [...transforms];
    const draggedIndex = next.findIndex((transform) => transform.id === draggedId);
    const targetIndex = next.findIndex((transform) => transform.id === targetId);
    if (draggedIndex < 0 || targetIndex < 0) {
      return;
    }
    const [dragged] = next.splice(draggedIndex, 1);
    next.splice(targetIndex, 0, dragged);
    onChange(next);
  };

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        {transforms.length === 0 ? (
          <div className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">
            {labels.pipelines.emptyTransforms}
          </div>
        ) : (
          transforms.map((transform, index) => (
            <TransformCard
              key={transform.id}
              value={transform}
              index={index}
              expanded={expandedIds.includes(transform.id)}
              availableColumns={availableColumns}
              onToggleExpand={() =>
                setExpandedIds((current) =>
                  current.includes(transform.id)
                    ? current.filter((item) => item !== transform.id)
                    : [...current, transform.id],
                )
              }
              onChange={(next) =>
                onChange(transforms.map((item) => (item.id === transform.id ? next : item)))
              }
              onRemove={() => onChange(transforms.filter((item) => item.id !== transform.id))}
              onDragStart={() => setDraggedId(transform.id)}
              onDragEnd={() => setDraggedId(null)}
              onDragOver={() => undefined}
              onDrop={() => {
                reorderTo(transform.id);
                setDraggedId(null);
              }}
            />
          ))
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="outline">
              <Plus className="me-2 h-4 w-4" />
              {labels.pipelines.addTransformation}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {TRANSFORM_TYPES.map((type) => (
              <DropdownMenuItem
                key={type.value}
                onClick={() => onChange([...transforms, createEmptyTransform(type.value)])}
              >
                {labels.pipelines[type.labelKey]}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <Button type="button" onClick={onPreview} disabled={availableColumns.length === 0}>
          <Sparkles className="me-2 h-4 w-4" />
          {labels.pipelines.previewTransformation}
        </Button>
      </div>

      {previewError ? <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{previewError}</div> : null}

      {previewColumns.length > 0 && !previewError ? (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <PreviewTable title={labels.pipelines.before} columns={previewColumns} rows={previewBeforeRows} />
          <PreviewTable title={labels.pipelines.after} columns={previewColumns} rows={previewAfterRows} />
        </div>
      ) : null}
    </div>
  );
}

function PreviewTable({
  title,
  columns,
  rows,
}: {
  title: string;
  columns: string[];
  rows: Array<Record<string, JsonValue>>;
}) {
  return (
    <div className="rounded-xl border">
      <div className="border-b px-4 py-3">
        <div className="font-medium">{title}</div>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/20 text-start">
              {columns.map((column) => (
                <th key={column} className="px-3 py-2 font-medium">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={`${title}-${rowIndex}`} className="border-b">
                {columns.map((column) => (
                  <td key={`${title}-${rowIndex}-${column}`} className="px-3 py-2 text-muted-foreground">
                    {`${row[column] ?? '—'}`}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
