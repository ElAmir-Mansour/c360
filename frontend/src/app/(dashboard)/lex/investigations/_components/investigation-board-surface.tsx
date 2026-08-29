/**
 * <InvestigationBoardSurface> — a framed panel that hosts the investigation
 * lifecycle kanban, mirroring the Service Desk `BoardSurface` convention so the
 * board reads as a contained, elevated surface with the same state ladder the
 * DataTable already provides:
 *
 *   loading → <LexBoardSkeleton>   (shimmer columns)
 *   error   → <ErrorState>         (retry affordance — the gap this closes:
 *                                    the DataTable renders its own error block,
 *                                    but the board view previously had none)
 *   empty   → <LexEmptyState>      (rich empty state + optional create CTA)
 *   else    → children             (the <InvestigationBoard> kanban)
 *
 * All copy is passed in already-localized (the page owns the bilingual bundle),
 * so this wrapper stays label-free and RTL-safe via logical spacing + inherited
 * direction (a `dir` may be forced for isolated tests).
 */

'use client';

import type { ReactNode } from 'react';
import { LayoutGrid, ShieldQuestion, type LucideIcon } from 'lucide-react';
import { ErrorState } from '@/components/common/error-state';
import { LexEmptyState } from '@/components/lex/empty-state';
import { LexBoardSkeleton } from '@/components/lex/list-skeleton';

export interface InvestigationBoardSurfaceProps {
  /** Panel heading (already localized, e.g. "Board" / "لوحة"). */
  title: string;
  /** Pre-formatted count badge (localized digits via `useLexFormat`). */
  count: string;
  loading: boolean;
  /** Truthy when the underlying list query failed. */
  error?: string | null;
  /** Localized error message shown in the error state. */
  errorMessage?: string;
  onRetry?: () => void;
  /** Whether to render the rich empty state instead of the board. */
  empty: boolean;
  emptyIcon?: LucideIcon;
  emptyTitle: string;
  emptyDescription?: string;
  /** Optional create CTA in the empty state. */
  onCreate?: () => void;
  createLabel?: string;
  createIcon?: LucideIcon;
  /** Force a direction; otherwise inherited from the surrounding shell. */
  dir?: 'ltr' | 'rtl';
  children: ReactNode;
}

export function InvestigationBoardSurface({
  title,
  count,
  loading,
  error,
  errorMessage,
  onRetry,
  empty,
  emptyIcon = ShieldQuestion,
  emptyTitle,
  emptyDescription,
  onCreate,
  createLabel,
  createIcon,
  dir,
  children,
}: InvestigationBoardSurfaceProps) {
  return (
    <div
      dir={dir}
      className="overflow-hidden rounded-2xl border border-border/70 bg-card shadow-elevation-1"
    >
      <div className="flex items-center justify-between gap-3 border-b border-border/70 bg-muted/30 px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <LayoutGrid className="h-4 w-4 shrink-0 text-primary" aria-hidden />
          <h2 className="truncate text-sm font-semibold text-foreground">{title}</h2>
        </div>
        <span className="rounded-full border border-border/70 bg-background px-2.5 py-1 text-caption font-semibold tabular-nums text-muted-foreground">
          {count}
        </span>
      </div>
      <div className="p-4">
        {loading ? (
          <LexBoardSkeleton columns={5} cards={3} />
        ) : error ? (
          <ErrorState message={errorMessage} onRetry={onRetry} />
        ) : empty ? (
          <LexEmptyState
            icon={emptyIcon}
            title={emptyTitle}
            description={emptyDescription}
            action={
              onCreate && createLabel
                ? { label: createLabel, onClick: onCreate, icon: createIcon }
                : undefined
            }
          />
        ) : (
          children
        )}
      </div>
    </div>
  );
}
