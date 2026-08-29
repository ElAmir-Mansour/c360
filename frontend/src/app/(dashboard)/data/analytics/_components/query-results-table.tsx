'use client';

import { Lock } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { type QueryResult } from '@/lib/data-suite';
import { useDataLabels } from '@/app/(dashboard)/data/_lib/data-i18n';

interface QueryResultsTableProps {
  result: QueryResult | null;
}

export function QueryResultsTable({
  result,
}: QueryResultsTableProps) {
  const labels = useDataLabels();

  if (!result) {
    return (
      <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
        {labels.analytics.runQueryPrompt}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span>
          {labels.analytics.showingResults(String(result.row_count), String(result.total_count))}
        </span>
        <span className="text-muted-foreground">{labels.analytics.completedIn(String(result.metadata.execution_time_ms))}</span>
      </div>

      {result.truncated ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-warning-700 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-warning-300">
          {labels.analytics.resultsTruncated}
        </div>
      ) : null}

      {result.metadata.pii_masking_applied ? (
        <div className="rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-700 dark:border-sky-900/50 dark:bg-sky-950/30 dark:text-sky-300">
          {labels.analytics.piiColumnsMasked((result.metadata.columns_masked ?? []).join(', ') || labels.analytics.sensitiveFields)}
        </div>
      ) : null}

      <div className="rounded-lg border overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b text-start">
              {result.columns.map((column) => (
                <th key={column.name} className="px-3 py-2 font-medium">
                  <div className="flex items-center gap-2">
                    <span>{column.name}</span>
                    <Badge variant="outline">{column.data_type}</Badge>
                    {column.masked ? <Lock className="h-3.5 w-3.5 text-muted-foreground" /> : null}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {result.rows.map((row, index) => (
              <tr key={index} className="border-b">
                {result.columns.map((column) => (
                  <td key={column.name} className="px-3 py-2">
                    {column.masked ? <span className="text-muted-foreground">🔒 </span> : null}
                    {`${row[column.name] ?? '—'}`}
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
