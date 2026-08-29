'use client';

import { Button } from '@/components/ui/button';
import { type SavedQuery } from '@/lib/data-suite';
import { formatMaybeDateTime } from '@/lib/data-suite/utils';
import { useDataLabels } from '@/app/(dashboard)/data/_lib/data-i18n';

interface SavedQueriesListProps {
  queries: SavedQuery[];
  modelNames: Record<string, string>;
  onRun: (query: SavedQuery) => void;
  onEdit: (query: SavedQuery) => void;
  onDelete: (query: SavedQuery) => void;
}

export function SavedQueriesList({
  queries,
  modelNames,
  onRun,
  onEdit,
  onDelete,
}: SavedQueriesListProps) {
  const labels = useDataLabels();

  if (queries.length === 0) {
    return <p className="text-sm text-muted-foreground">{labels.analytics.noSavedQueries}</p>;
  }

  return (
    <div className="rounded-lg border overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="border-b text-start">
            <th className="px-3 py-2 font-medium">{labels.common.name}</th>
            <th className="px-3 py-2 font-medium">{labels.analytics.colModel}</th>
            <th className="px-3 py-2 font-medium">{labels.analytics.colLastRun}</th>
            <th className="px-3 py-2 font-medium">{labels.analytics.colRuns}</th>
            <th className="px-3 py-2 font-medium"></th>
          </tr>
        </thead>
        <tbody>
          {queries.map((query) => (
            <tr key={query.id} className="border-b">
              <td className="px-3 py-2">
                <div className="font-medium">{query.name}</div>
                <div className="text-xs text-muted-foreground">{query.visibility}</div>
              </td>
              <td className="px-3 py-2 text-muted-foreground">{modelNames[query.model_id] ?? query.model_id}</td>
              <td className="px-3 py-2 text-muted-foreground">{formatMaybeDateTime(query.last_run_at)}</td>
              <td className="px-3 py-2 text-muted-foreground">{query.run_count}</td>
              <td className="px-3 py-2">
                <div className="flex gap-2">
                  <Button type="button" size="sm" variant="outline" onClick={() => onRun(query)}>
                    {labels.analytics.run}
                  </Button>
                  <Button type="button" size="sm" variant="outline" onClick={() => onEdit(query)}>
                    {labels.common.edit}
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => onDelete(query)}>
                    {labels.common.delete}
                  </Button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
