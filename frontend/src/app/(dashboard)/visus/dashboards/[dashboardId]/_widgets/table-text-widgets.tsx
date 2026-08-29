'use client';

import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';
import type { JsonValue, VisusTableWidgetData, VisusTextWidgetData } from '@/types/suites';
import type { WidgetBodyProps } from './widget-body-props';
import { useVisusWidgetChromeLabels } from '../../../_lib/visus-i18n';

/* ------------------------------------------------------------------ */
/* Shared helpers                                                       */
/* ------------------------------------------------------------------ */

/** The em-dash placeholder shown for null/undefined cell values. */
const EMPTY_CELL = '—';

/**
 * Coerce an arbitrary JSON cell value to a display string. Strings pass through,
 * numbers/booleans stringify, `null`/`undefined` become the em-dash placeholder,
 * and objects/arrays are JSON-encoded (falling back to `String()` on cycles).
 */
function stringifyCell(value: JsonValue | undefined): string {
  if (value === null || value === undefined) return EMPTY_CELL;
  switch (typeof value) {
    case 'string':
      return value.length > 0 ? value : EMPTY_CELL;
    case 'number':
      return Number.isFinite(value) ? String(value) : EMPTY_CELL;
    case 'boolean':
      return value ? 'true' : 'false';
    default:
      try {
        return JSON.stringify(value);
      } catch {
        return String(value);
      }
  }
}

/** Root wrapper: fills the remaining card height and scrolls its own content. */
function WidgetBodyRoot({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('flex min-h-0 flex-1 flex-col', className)}>{children}</div>;
}

/** Small muted centered note used for empty / placeholder states. */
function MutedNote({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-4">
      <p className="text-xs text-muted-foreground">{children}</p>
    </div>
  );
}

/** Shared error state: a muted message plus a Retry button wired to `onRetry`. */
function ErrorState({ label, onRetry }: { label: string; onRetry: () => void }) {
  const t = useVisusWidgetChromeLabels();
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-4 text-center">
      <p className="text-xs text-muted-foreground">{label}</p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        {t.retry}
      </Button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Table widget                                                        */
/* ------------------------------------------------------------------ */

/** Compact shimmer stand-in for the table while its data loads. */
function TableSkeleton() {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 p-1" aria-hidden>
      <div className="flex gap-3">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="h-3.5 flex-1" />
        ))}
      </div>
      {Array.from({ length: 5 }).map((_, row) => (
        <div key={row} className="flex gap-3">
          {Array.from({ length: 4 }).map((_, col) => (
            <Skeleton key={col} className="h-4 flex-1" />
          ))}
        </div>
      ))}
    </div>
  );
}

export function TableWidget({ data, isLoading, isError, onRetry }: WidgetBodyProps<VisusTableWidgetData>) {
  const t = useVisusWidgetChromeLabels();
  if (isLoading && !data) return <TableSkeleton />;
  if (isError && !data) return <ErrorState label={t.unableToLoadTable} onRetry={onRetry} />;
  if (!data) return <MutedNote>{t.noData}</MutedNote>;

  const { columns, rows, total_count } = data;

  if (columns.length === 0 || rows.length === 0) {
    return <MutedNote>{t.noRows}</MutedNote>;
  }

  const hasMore = rows.length < total_count;

  return (
    <WidgetBodyRoot>
      <div className="min-h-0 flex-1 overflow-auto">
        <Table>
          <TableHeader>
            <TableRow>
              {columns.map((column) => (
                <TableHead key={column.key} scope="col" className="h-9 px-3 py-2">
                  {column.label}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row, index) => (
              <TableRow key={index}>
                {columns.map((column) => (
                  <TableCell key={column.key} className="whitespace-nowrap px-3 py-2 text-xs">
                    {stringifyCell(row[column.key])}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {hasMore ? (
        <p className="shrink-0 border-t border-border/60 px-3 py-1.5 text-overline text-muted-foreground">
          {t.showingOf(rows.length, total_count)}
        </p>
      ) : null}
    </WidgetBodyRoot>
  );
}

/* ------------------------------------------------------------------ */
/* Text widget                                                         */
/* ------------------------------------------------------------------ */

/** Compact shimmer stand-in for the text block while its data loads. */
function TextSkeleton() {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2.5 p-1" aria-hidden>
      <Skeleton className="h-3.5 w-full" />
      <Skeleton className="h-3.5 w-11/12" />
      <Skeleton className="h-3.5 w-4/5" />
      <Skeleton className="h-3.5 w-2/3" />
    </div>
  );
}

export function TextWidget({ data, isLoading, isError, onRetry }: WidgetBodyProps<VisusTextWidgetData>) {
  const t = useVisusWidgetChromeLabels();
  if (isLoading && !data) return <TextSkeleton />;
  if (isError && !data) return <ErrorState label={t.unableToLoadText} onRetry={onRetry} />;

  const content = data?.content?.trim();

  if (!content) {
    return <MutedNote>{t.noContent}</MutedNote>;
  }

  return (
    <WidgetBodyRoot>
      <div className="min-h-0 flex-1 overflow-auto">
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">{content}</p>
      </div>
    </WidgetBodyRoot>
  );
}
