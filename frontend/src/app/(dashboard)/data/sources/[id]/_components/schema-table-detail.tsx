'use client';

import { useMemo, useState } from 'react';
import { ArrowRight, Eye, Network, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { type DataModel, type DiscoveredColumn, type DiscoveredTable } from '@/lib/data-suite';
import {
  formatMaybeBytes,
  formatMaybeCompact,
  getClassificationBadge,
  getColumnPiiType,
  maskColumnSample,
} from '@/lib/data-suite/utils';
import { DataPreviewDialog } from '@/app/(dashboard)/data/sources/[id]/_components/data-preview-dialog';
import { DeriveModelDialog } from '@/app/(dashboard)/data/sources/[id]/_components/derive-model-dialog';
import { useDataLabels, type DataLabels } from '@/app/(dashboard)/data/_lib/data-i18n';

interface SchemaTableDetailProps {
  sourceId: string;
  table: DiscoveredTable | null;
  relatedModels: DataModel[];
  canViewPii: boolean;
}

export function SchemaTableDetail({
  sourceId,
  table,
  relatedModels,
  canViewPii,
}: SchemaTableDetailProps) {
  const labels = useDataLabels();
  const [previewOpen, setPreviewOpen] = useState(false);
  const [deriveOpen, setDeriveOpen] = useState(false);

  const relatedModel = useMemo(
    () => relatedModels.find((model) => model.source_table === table?.name),
    [relatedModels, table?.name],
  );

  if (!table) {
    return (
      <div className="flex h-full items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
        {labels.sourcesDetail.selectTablePrompt}
      </div>
    );
  }

  const classification = getClassificationBadge(table.inferred_classification);

  return (
    <>
      <div className="space-y-4">
        <div className="rounded-lg border bg-card p-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-h4 font-semibold">
                  {(table.schema_name ?? 'public')}.{table.name}
                </h3>
                <Badge variant="outline" className={classification.className}>
                  {classification.label}
                </Badge>
              </div>
              <div className="mt-1 flex flex-wrap gap-3 text-sm text-muted-foreground">
                <span>{labels.sourcesDetail.rowsCount(formatMaybeCompact(table.estimated_rows))}</span>
                <span>{labels.sourcesDetail.estimatedSize(formatMaybeBytes(table.size_bytes))}</span>
                <span>{labels.sourcesDetail.columnsCount(String(table.columns.length))}</span>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={() => setPreviewOpen(true)}>
                <Eye className="me-1.5 h-4 w-4" />
                {labels.sourcesDetail.previewData}
              </Button>
              <Button type="button" variant="outline" onClick={() => setDeriveOpen(true)}>
                <Sparkles className="me-1.5 h-4 w-4" />
                {labels.sourcesDetail.deriveModel}
              </Button>
              <Button type="button" asChild>
                <Link href={`/data/lineage?type=data_source&id=${sourceId}`}>
                  <Network className="me-1.5 h-4 w-4" />
                  {labels.sourcesDetail.viewInLineage}
                </Link>
              </Button>
            </div>
          </div>
        </div>

        <div className="rounded-lg border">
          <ScrollArea className="h-[420px]">
            <table className="min-w-full text-sm">
              <thead className="sticky top-0 z-10 bg-background">
                <tr className="border-b">
                  <th className="px-3 py-2 text-start font-medium">{labels.sourcesDetail.colColumn}</th>
                  <th className="px-3 py-2 text-start font-medium">{labels.sourcesDetail.colDataType}</th>
                  <th className="px-3 py-2 text-start font-medium">{labels.sourcesDetail.colNullable}</th>
                  <th className="px-3 py-2 text-start font-medium">{labels.sourcesDetail.colPii}</th>
                  <th className="px-3 py-2 text-start font-medium">{labels.sourcesDetail.colClassification}</th>
                  <th className="px-3 py-2 text-start font-medium">{labels.sourcesDetail.colDefault}</th>
                  <th className="px-3 py-2 text-start font-medium">{labels.sourcesDetail.colSampleValues}</th>
                </tr>
              </thead>
              <tbody>
                {[...table.columns]
                  .sort((left, right) => left.name.localeCompare(right.name))
                  .map((column) => (
                    <ColumnRow key={column.name} column={column} canViewPii={canViewPii} labels={labels} />
                  ))}
              </tbody>
            </table>
          </ScrollArea>
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <DetailListCard title={labels.sourcesDetail.pkTitle} items={table.primary_keys ?? []} emptyLabel={labels.sourcesDetail.pkEmpty} />
          <DetailListCard
            title={labels.sourcesDetail.fkTitle}
            items={(table.foreign_keys ?? []).map(
              (item) =>
                `${item.column} → ${item.referenced_ref.schema ? `${item.referenced_ref.schema}.` : ''}${item.referenced_ref.table}.${item.referenced_ref.column}`,
            )}
            emptyLabel={labels.sourcesDetail.fkEmpty}
          />
          <DetailListCard
            title={labels.sourcesDetail.idxTitle}
            items={(table.columns.filter((column) => column.is_primary_key || column.is_foreign_key)).map((column) => `${column.name} (${column.is_primary_key ? labels.sourcesDetail.keyPrimary : labels.sourcesDetail.keyForeign})`)}
            emptyLabel={labels.sourcesDetail.idxEmpty}
          />
        </div>
      </div>

      <DataPreviewDialog
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        model={relatedModel}
        table={table}
      />

      <DeriveModelDialog
        open={deriveOpen}
        onOpenChange={setDeriveOpen}
        sourceId={sourceId}
        tableName={table.name}
      />
    </>
  );
}

function ColumnRow({
  column,
  canViewPii,
  labels,
}: {
  column: DiscoveredColumn;
  canViewPii: boolean;
  labels: DataLabels;
}) {
  const piiType = getColumnPiiType(column);
  const classification = getClassificationBadge(column.inferred_classification);

  return (
    <tr className="border-b align-top">
      <td className="px-3 py-2 font-medium">{column.name}</td>
      <td className="px-3 py-2 text-muted-foreground">
        {column.native_type} ({column.mapped_type})
      </td>
      <td className="px-3 py-2 text-muted-foreground">{column.nullable ? labels.common.yes : labels.common.no}</td>
      <td className="px-3 py-2">
        {piiType ? (
          <Badge variant="outline" className="border-amber-200 bg-amber-50 text-warning-700 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-warning-300">
            {piiType}
          </Badge>
        ) : (
          '—'
        )}
      </td>
      <td className="px-3 py-2">
        <Badge variant="outline" className={classification.className}>
          {classification.label}
        </Badge>
      </td>
      <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
        {column.default_value || '—'}
      </td>
      <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
        {maskColumnSample(column, canViewPii).slice(0, 3).join(' • ') || '—'}
      </td>
    </tr>
  );
}

function DetailListCard({
  title,
  items,
  emptyLabel,
}: {
  title: string;
  items: string[];
  emptyLabel: string;
}) {
  return (
    <div className="rounded-lg border p-4">
      <div className="mb-3 flex items-center justify-between">
        <h4 className="font-medium">{title}</h4>
        {items.length > 0 ? <ArrowRight className="h-4 w-4 text-muted-foreground" /> : null}
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{emptyLabel}</p>
      ) : (
        <ul className="space-y-2 text-sm text-muted-foreground">
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
