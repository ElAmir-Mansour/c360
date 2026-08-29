'use client';

import Link from 'next/link';
import { MoreHorizontal, PlayCircle, Power, RefreshCcw, TestTubeDiagonal, Trash2 } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { type ConnectionTestResult, type DataSource } from '@/lib/data-suite';
import {
  formatMaybeBytes,
  formatMaybeCompact,
  formatMaybeRelative,
  getSourceTypeVisual,
  getStatusTone,
  humanizeCronOrFrequency,
} from '@/lib/data-suite/utils';
import { truncate } from '@/lib/utils';
import { TestConnectionInline } from '@/app/(dashboard)/data/sources/_components/test-connection-inline';
import { useDataLabels } from '@/app/(dashboard)/data/_lib/data-i18n';

interface SourceCardProps {
  source: DataSource;
  testing: boolean;
  testResult?: ConnectionTestResult | null;
  testError?: string | null;
  onTest: (source: DataSource) => void;
  onSync: (source: DataSource) => void;
  onEdit: (source: DataSource) => void;
  onDelete: (source: DataSource) => void;
  onToggleStatus?: (source: DataSource) => void;
}

export function SourceCard({
  source,
  testing,
  testResult,
  testError,
  onTest,
  onSync,
  onEdit,
  onDelete,
  onToggleStatus,
}: SourceCardProps) {
  const labels = useDataLabels();
  const typeVisual = getSourceTypeVisual(source.type);
  const Icon = typeVisual.icon;

  return (
    <div className="rounded-xl border bg-card p-5 shadow-sm transition-colors hover:border-primary/30">
      <div className="flex items-start justify-between gap-4">
        <Link href={`/data/sources/${source.id}`} className="min-w-0 flex-1">
          <div className="flex items-center gap-3">
            <div className={`rounded-full bg-muted p-2 ${typeVisual.accentClass}`}>
              <Icon className="h-5 w-5" data-testid={`source-type-icon-${source.type}`} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="truncate font-semibold">{source.name}</h3>
                <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
                  <span
                    className={`h-2.5 w-2.5 rounded-full ${getStatusTone(source.status)}`}
                    data-testid={`source-status-dot-${source.status}`}
                  />
                  {source.status}
                </span>
              </div>
              <p className="text-sm text-muted-foreground">{typeVisual.label}</p>
            </div>
          </div>
        </Link>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="ghost" size="icon">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => onEdit(source)}>{labels.common.edit}</DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href={`/data/sources/${source.id}?tab=schema`}>{labels.sources.viewSchema}</Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href={`/data/sources/${source.id}?tab=pipelines`}>{labels.sources.viewPipelines}</Link>
            </DropdownMenuItem>
            {onToggleStatus && (source.status === 'active' || source.status === 'inactive') && (
              <DropdownMenuItem onClick={() => onToggleStatus(source)}>
                <Power className="me-2 h-4 w-4" />
                {source.status === 'active' ? labels.sources.deactivate : labels.sources.activate}
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-rose-700 focus:text-rose-700 dark:text-rose-400 dark:focus:text-rose-400" onClick={() => onDelete(source)}>
              <Trash2 className="me-2 h-4 w-4" />
              {labels.common.delete}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <Link href={`/data/sources/${source.id}`} className="mt-4 block">
        <p className="text-sm text-muted-foreground">
          {source.description ? truncate(source.description, 100) : labels.sources.noDescription}
        </p>
      </Link>

      <div className="mt-4 flex flex-wrap gap-3 text-sm text-muted-foreground">
        <span>{labels.sources.cardTables(String(source.table_count ?? 0))}</span>
        <span>{labels.sources.cardRows(formatMaybeCompact(source.total_row_count))}</span>
        <span>{formatMaybeBytes(source.total_size_bytes)}</span>
      </div>

      <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted-foreground">
        <span>{labels.sources.lastSync(formatMaybeRelative(source.last_synced_at))}</span>
        <span>{humanizeCronOrFrequency(source.sync_frequency)}</span>
      </div>

      {(source.last_error || source.last_sync_error) && source.status === 'error' ? (
        <div className="mt-3 text-xs text-rose-700 dark:text-rose-400">{truncate(source.last_error || source.last_sync_error || '', 96)}</div>
      ) : null}

      <div className="mt-4 flex items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => onTest(source)} disabled={testing}>
          <TestTubeDiagonal className="me-1.5 h-4 w-4" />
          {testing ? labels.sources.testing : labels.sources.test}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => onSync(source)}>
          <RefreshCcw className="me-1.5 h-4 w-4" />
          {labels.sources.sync}
        </Button>
        <Button type="button" variant="ghost" size="sm" asChild>
          <Link href={`/data/sources/${source.id}`}>
            <PlayCircle className="me-1.5 h-4 w-4" />
            {labels.sources.open}
          </Link>
        </Button>
      </div>

      <TestConnectionInline
        loading={testing}
        result={testResult}
        error={testError}
        onEdit={() => onEdit(source)}
      />
    </div>
  );
}
