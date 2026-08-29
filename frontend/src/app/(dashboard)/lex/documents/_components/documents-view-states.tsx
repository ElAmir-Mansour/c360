/**
 * Shared loading / error surfaces for the Lex documents repository views.
 *
 * The list (DataTable) view already renders its own skeleton + error states via
 * the shared `<DataTable>` primitive. This module brings the *board* and the
 * *folder tree* branches up to the same bar so every view (table, board, tree)
 * has a first-class loading, empty AND error state — mirroring the
 * service-desk BoardSurface reference.
 *
 * Self-contained bilingual (EN + Modern Standard Arabic) copy per the lex i18n
 * contract; RTL-correct via logical spacing (me-*). Token-driven, no hardcoded
 * colors.
 */

'use client';

import type { ReactNode } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { LexBoardSkeleton } from '@/components/lex/list-skeleton';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { cn } from '@/lib/utils';
import { type LexBilingual, resolveLexBilingual } from '../../_lib/lex-i18n';

interface ViewStateLabels {
  errorTitle: string;
  errorDescription: string;
  retry: string;
}

const viewStateLabels: LexBilingual<ViewStateLabels> = {
  en: {
    errorTitle: 'Unable to load documents',
    errorDescription:
      'Something went wrong while loading this view. Please try again.',
    retry: 'Retry',
  },
  ar: {
    errorTitle: 'تعذّر تحميل الوثائق',
    errorDescription: 'حدث خطأ أثناء تحميل هذا العرض. يرجى المحاولة مرة أخرى.',
    retry: 'إعادة المحاولة',
  },
};

function useViewStateLabels(): ViewStateLabels {
  const { locale } = useLocaleOrDefault();
  return resolveLexBilingual(viewStateLabels, locale);
}

/**
 * DocumentsErrorState — a centered, bilingual error block with an optional
 * Retry affordance. Visually mirrors the shared DataTableError so the board /
 * folder error states read the same as the table's.
 */
export function DocumentsErrorState({
  message,
  onRetry,
  className,
}: {
  /** Optional raw error message (surfaced under the localized title). */
  message?: string | null;
  onRetry?: () => void;
  className?: string;
}) {
  const t = useViewStateLabels();
  return (
    <div
      role="alert"
      aria-live="assertive"
      className={cn(
        'flex flex-col items-center justify-center px-6 py-12 text-center',
        className,
      )}
    >
      <AlertCircle className="mb-4 h-12 w-12 text-destructive/60" aria-hidden />
      <h3 className="mb-1 text-sm font-semibold text-foreground">{t.errorTitle}</h3>
      <p className="mb-4 max-w-sm text-sm text-muted-foreground" dir="auto">
        {message?.trim() ? message : t.errorDescription}
      </p>
      {onRetry ? (
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RefreshCw className="me-2 h-4 w-4" aria-hidden />
          {t.retry}
        </Button>
      ) : null}
    </div>
  );
}

/**
 * DocumentsBoardShell — wraps the board body with loading (kanban skeleton) and
 * error states, deferring to `children` (empty-state or the board itself) once
 * data has resolved. Keeps the board branch in the page at parity with the
 * DataTable's built-in states.
 */
export function DocumentsBoardShell({
  loading,
  error,
  onRetry,
  children,
}: {
  loading: boolean;
  error?: string | null;
  onRetry?: () => void;
  children: ReactNode;
}) {
  if (error) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-card/40">
        <DocumentsErrorState message={error} onRetry={onRetry} />
      </div>
    );
  }
  if (loading) {
    return (
      <div className="rounded-xl border border-border/70 bg-card/40 p-4">
        <LexBoardSkeleton />
      </div>
    );
  }
  return <>{children}</>;
}

/**
 * FolderTreeSkeleton — a compact placeholder for the repository folder tree
 * while the repository summary is loading.
 */
export function FolderTreeSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div role="status" aria-busy="true" className="space-y-2 py-1">
      {Array.from({ length: rows }).map((_, index) => (
        <Skeleton key={index} className="h-7 w-full rounded-md" />
      ))}
    </div>
  );
}
