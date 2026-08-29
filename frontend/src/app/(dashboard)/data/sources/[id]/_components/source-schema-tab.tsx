'use client';

import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { type DataModel, type DiscoveredSchema, type DiscoveredTable } from '@/lib/data-suite';
import { SchemaTree } from '@/app/(dashboard)/data/sources/[id]/_components/schema-tree';
import { SchemaTableDetail } from '@/app/(dashboard)/data/sources/[id]/_components/schema-table-detail';
import { useDataLabels } from '@/app/(dashboard)/data/_lib/data-i18n';

interface SourceSchemaTabProps {
  sourceId: string;
  schema: DiscoveredSchema | null;
  relatedModels: DataModel[];
  canViewPii: boolean;
}

export function SourceSchemaTab({
  sourceId,
  schema,
  relatedModels,
  canViewPii,
}: SourceSchemaTabProps) {
  const labels = useDataLabels();
  const [filter, setFilter] = useState('');
  const [selectedTable, setSelectedTable] = useState<DiscoveredTable | null>(null);

  const initialTable = useMemo(() => schema?.tables[0] ?? null, [schema]);
  const activeTable = selectedTable ?? initialTable;

  if (!schema) {
    return (
      <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
        {labels.sourcesDetail.noSchemaDiscovered}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[0.35fr_0.65fr]">
      <div className="space-y-4 rounded-lg border p-4">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
          <Input className="ps-9" placeholder={labels.sourcesDetail.searchTables} value={filter} onChange={(event) => setFilter(event.target.value)} />
        </div>
        <SchemaTree
          schema={schema}
          filter={filter}
          selectedTableName={activeTable?.name}
          onSelectTable={setSelectedTable}
          showSummary={false}
          canViewPii={canViewPii}
        />
      </div>

      <SchemaTableDetail
        sourceId={sourceId}
        table={activeTable}
        relatedModels={relatedModels}
        canViewPii={canViewPii}
      />
    </div>
  );
}
