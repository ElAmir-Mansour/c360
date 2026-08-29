/**
 * @deprecated Use `Skeleton.Table` / `Skeleton.Board` from
 * `@/components/ui/skeleton` — the staggered table + kanban placeholders are
 * now canonical shaped variants of the platform skeleton primitive. These
 * wrappers remain as thin adapters that keep the historic Lex APIs (and their
 * `role="status"` live-region semantics) compiling.
 */

'use client';

import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import {
  type LexBilingual,
  resolveLexBilingual,
} from '@/app/(dashboard)/lex/_lib/lex-i18n';

/** Component-local bilingual bundle for the skeleton live-region copy. */
interface LexSkeletonLabels {
  /** aria-label on the `role="status"` wrapper. */
  loading: string;
  /** sr-only text announced to assistive tech. */
  loadingSr: string;
}

const lexSkeletonLabels: LexBilingual<LexSkeletonLabels> = {
  en: { loading: 'Loading', loadingSr: 'Loading…' },
  ar: { loading: 'جارٍ التحميل', loadingSr: 'جارٍ التحميل…' },
};

function useLexSkeletonLabels(): LexSkeletonLabels {
  const { locale } = useLocaleOrDefault();
  return resolveLexBilingual(lexSkeletonLabels, locale);
}

export interface LexListSkeletonProps {
  rows?: number;
  cols?: number;
  className?: string;
}

/** @deprecated Thin adapter over the canonical `Skeleton.Table`. */
export function LexListSkeleton({ rows = 8, cols = 5, className }: LexListSkeletonProps) {
  const t = useLexSkeletonLabels();
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label={t.loading}
      className={cn(className)}
    >
      <Skeleton.Table rows={rows} cols={cols} />
      <span className="sr-only">{t.loadingSr}</span>
    </div>
  );
}

export interface LexBoardSkeletonProps {
  columns?: number;
  /** Cards rendered per column. */
  cards?: number;
  className?: string;
}

/** @deprecated Thin adapter over the canonical `Skeleton.Board`. */
export function LexBoardSkeleton({ columns = 4, cards = 3, className }: LexBoardSkeletonProps) {
  const t = useLexSkeletonLabels();
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label={t.loading}
      className={cn(className)}
    >
      <Skeleton.Board columns={columns} cards={cards} />
      <span className="sr-only">{t.loadingSr}</span>
    </div>
  );
}
