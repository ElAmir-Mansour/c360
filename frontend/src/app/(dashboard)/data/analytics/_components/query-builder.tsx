'use client';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { type DataModel } from '@/lib/data-suite';
import { type QueryAggregationRowState, QueryAggregationBuilder } from '@/app/(dashboard)/data/analytics/_components/query-aggregation-builder';
import { type QueryFilterRowState, QueryFilterBuilder } from '@/app/(dashboard)/data/analytics/_components/query-filter-builder';
import { useDataLabels } from '@/app/(dashboard)/data/_lib/data-i18n';

export interface QueryOrderRowState {
  id: string;
  column: string;
  direction: 'asc' | 'desc';
}

interface QueryBuilderProps {
  models: DataModel[];
  selectedModelId: string | null;
  selectedColumns: string[];
  filters: QueryFilterRowState[];
  aggregations: QueryAggregationRowState[];
  groupBy: string[];
  orders: QueryOrderRowState[];
  limit: number;
  running: boolean;
  onSelectModel: (modelId: string) => void;
  onToggleColumn: (column: string) => void;
  onSelectAllColumns: () => void;
  onClearColumns: () => void;
  onChangeFilters: (rows: QueryFilterRowState[]) => void;
  onChangeAggregations: (rows: QueryAggregationRowState[]) => void;
  onChangeGroupBy: (values: string[]) => void;
  onChangeOrders: (rows: QueryOrderRowState[]) => void;
  onChangeLimit: (limit: number) => void;
  onRun: () => void;
  onSave: () => void;
  onClear: () => void;
}

export function QueryBuilder({
  models,
  selectedModelId,
  selectedColumns,
  filters,
  aggregations,
  groupBy,
  orders,
  limit,
  running,
  onSelectModel,
  onToggleColumn,
  onSelectAllColumns,
  onClearColumns,
  onChangeFilters,
  onChangeAggregations,
  onChangeGroupBy,
  onChangeOrders,
  onChangeLimit,
  onRun,
  onSave,
  onClear,
}: QueryBuilderProps) {
  const labels = useDataLabels();
  const selectedModel = models.find((model) => model.id === selectedModelId) ?? null;
  const columnOptions = selectedModel?.schema_definition.map((field) => field.name) ?? [];

  return (
    <div className="space-y-6 rounded-lg border bg-card p-4">
      <section className="space-y-3">
        <h3 className="font-medium">{labels.analytics.modelHeading}</h3>
        <Select value={selectedModelId ?? ''} onValueChange={onSelectModel}>
          <SelectTrigger>
            <SelectValue placeholder={labels.analytics.selectModel} />
          </SelectTrigger>
          <SelectContent>
            {models.map((model) => (
              <SelectItem key={model.id} value={model.id}>
                {model.display_name || model.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-medium">{labels.analytics.columnsHeading}</h3>
          <div className="flex gap-2">
            <Button type="button" size="sm" variant="outline" onClick={onSelectAllColumns} disabled={!selectedModel}>
              {labels.analytics.selectAll}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={onClearColumns}>
              {labels.analytics.deselectAll}
            </Button>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {selectedModel?.schema_definition.map((field) => (
            <label key={field.name} className="flex items-center gap-3 rounded-md border px-3 py-2 text-sm">
              <Checkbox checked={selectedColumns.includes(field.name)} onCheckedChange={() => onToggleColumn(field.name)} />
              <span>{field.name}</span>
              <span className="ms-auto text-xs text-muted-foreground">{field.data_type}</span>
            </label>
          )) ?? <p className="text-sm text-muted-foreground">{labels.analytics.selectModelPrompt}</p>}
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-medium">{labels.analytics.filtersHeading}</h3>
          <Button type="button" size="sm" variant="outline" onClick={() => onChangeFilters([...filters, { id: crypto.randomUUID(), column: '', operator: 'eq', value: '', secondaryValue: '' }])} disabled={!selectedModel}>
            {labels.analytics.addFilter}
          </Button>
        </div>
        <QueryFilterBuilder rows={filters} columnOptions={columnOptions} onChange={onChangeFilters} />
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-medium">{labels.analytics.aggregationsHeading}</h3>
          <Button type="button" size="sm" variant="outline" onClick={() => onChangeAggregations([...aggregations, { id: crypto.randomUUID(), column: '', func: 'count', alias: '' }])} disabled={!selectedModel}>
            {labels.pipelines.addAggregation}
          </Button>
        </div>
        <QueryAggregationBuilder rows={aggregations} columnOptions={columnOptions} onChange={onChangeAggregations} />
      </section>

      {aggregations.length > 0 ? (
        <section className="space-y-3">
          <h3 className="font-medium">{labels.analytics.groupByHeading}</h3>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {selectedModel?.schema_definition.map((field) => (
              <label key={field.name} className="flex items-center gap-3 rounded-md border px-3 py-2 text-sm">
                <Checkbox checked={groupBy.includes(field.name)} onCheckedChange={() => onChangeGroupBy(groupBy.includes(field.name) ? groupBy.filter((item) => item !== field.name) : [...groupBy, field.name])} />
                <span>{field.name}</span>
              </label>
            )) ?? null}
          </div>
        </section>
      ) : null}

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-medium">{labels.analytics.orderByHeading}</h3>
          <Button type="button" size="sm" variant="outline" onClick={() => onChangeOrders([...orders, { id: crypto.randomUUID(), column: '', direction: 'asc' }])} disabled={!selectedModel}>
            {labels.analytics.addOrder}
          </Button>
        </div>
        <div className="space-y-3">
          {orders.map((row) => (
            <div key={row.id} className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_180px_auto]">
              <Select value={row.column} onValueChange={(value) => onChangeOrders(orders.map((item) => (item.id === row.id ? { ...item, column: value } : item)))}>
                <SelectTrigger>
                  <SelectValue placeholder={labels.pipelines.columnPlaceholder} />
                </SelectTrigger>
                <SelectContent>
                  {columnOptions.map((column) => (
                    <SelectItem key={column} value={column}>
                      {column}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={row.direction} onValueChange={(value) => onChangeOrders(orders.map((item) => (item.id === row.id ? { ...item, direction: value as 'asc' | 'desc' } : item)))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="asc">ASC</SelectItem>
                  <SelectItem value="desc">DESC</SelectItem>
                </SelectContent>
              </Select>
              <Button type="button" variant="ghost" onClick={() => onChangeOrders(orders.filter((item) => item.id !== row.id))}>
                {labels.common.remove}
              </Button>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="font-medium">{labels.analytics.limitHeading}</h3>
        <Input type="number" value={limit} onChange={(event) => onChangeLimit(Number(event.target.value) || 100)} min={1} max={10_000} />
      </section>

      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={onRun} disabled={running || !selectedModel}>
          {running ? labels.analytics.running : labels.analytics.runQuery}
        </Button>
        <Button type="button" variant="outline" onClick={onSave} disabled={!selectedModel}>
          {labels.analytics.saveQuery}
        </Button>
        <Button type="button" variant="ghost" onClick={onClear}>
          {labels.analytics.clear}
        </Button>
      </div>
    </div>
  );
}
