/**
 * <SettlementBoardSurface> — the framed panel that hosts the settlement pipeline
 * kanban and gives the BOARD view the same loading / error / empty states the
 * shared `DataTable` already renders for the table view (checklist item #4).
 *
 * Mirrors the service-desk `BoardSurface` convention (a bordered, elevated card
 * with a header bar + count pill) so the two Lex list surfaces read identically,
 * and adds an error tone the service-desk variant lacks — the settlements list
 * has a live `error`/`onRetry` from `useDataTable`, so a failed fetch now shows a
 * retry affordance instead of an empty board.
 *
 * State precedence: loading → error → empty → children.
 *
 * Bilingual + RTL: the domain strings (title / empty copy / create CTA) arrive
 * already-resolved from the caller's label bundle; only the generic error-panel
 * chrome (title + retry) is owned here, resolved per the canonical lex i18n
 * contract. Spacing is logical, so it flips correctly under Arabic RTL.
 */

'use client';

import { useMemo, type ReactNode } from 'react';
import { LayoutGrid, type LucideIcon } from 'lucide-react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { LexBoardSkeleton } from '@/components/lex/list-skeleton';
import { LexEmptyState } from '@/components/lex/empty-state';
import { FeedbackState } from '@/components/shared/feedback-state';
import { type LexBilingual, resolveLexBilingual } from '../../_lib/lex-i18n';

/** Generic error-panel chrome — the only copy this surface owns. */
interface BoardSurfaceChromeLabels {
  errorTitle: string;
  retry: string;
}

const chromeLabels: LexBilingual<BoardSurfaceChromeLabels> = {
  en: { errorTitle: 'Couldn’t load settlements', retry: 'Retry' },
  ar: { errorTitle: 'تعذّر تحميل التسويات', retry: 'إعادة المحاولة' },
};

export interface SettlementBoardSurfaceProps {
  /** Header label (e.g. the localized "Board" string). */
  title: string;
  /** Already-formatted (locale-aware) count shown in the header pill. */
  count: string;
  loading: boolean;
  error?: string | null;
  onRetry?: () => void;
  /** Show the empty state instead of `children` (after loading/error resolve). */
  empty: boolean;
  emptyIcon?: LucideIcon;
  emptyTitle: string;
  emptyDescription?: string;
  /** Optional create CTA on the empty state (self-gated by the caller). */
  onCreate?: () => void;
  createLabel?: string;
  createIcon?: LucideIcon;
  /** The board (rendered only in the resolved, non-empty state). */
  children: ReactNode;
}

export function SettlementBoardSurface({
  title,
  count,
  loading,
  error,
  onRetry,
  empty,
  emptyIcon,
  emptyTitle,
  emptyDescription,
  onCreate,
  createLabel,
  createIcon,
  children,
}: SettlementBoardSurfaceProps) {
  const { locale } = useLocaleOrDefault();
  const t = useMemo(() => resolveLexBilingual(chromeLabels, locale), [locale]);

  let body: ReactNode;
  if (loading) {
    body = <LexBoardSkeleton columns={5} />;
  } else if (error) {
    body = (
      <FeedbackState
        tone="error"
        title={t.errorTitle}
        description={error}
        action={onRetry ? { label: t.retry, onClick: onRetry } : undefined}
      />
    );
  } else if (empty) {
    body = (
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
    );
  } else {
    body = children;
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-border/70 bg-card shadow-elevation-1">
      <div className="flex items-center justify-between gap-3 border-b border-border/70 bg-muted/30 px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <LayoutGrid className="h-4 w-4 shrink-0 text-primary" aria-hidden />
          <h2 className="truncate text-sm font-semibold text-foreground">{title}</h2>
        </div>
        <span className="rounded-full border border-border/70 bg-background px-2.5 py-1 text-caption font-semibold tabular-nums text-muted-foreground">
          {count}
        </span>
      </div>
      <div className="p-4">{body}</div>
    </div>
  );
}
