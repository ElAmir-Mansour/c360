/**
 * <LexListShell> — the premium wrapper for every Lex list / board page.
 *
 * It standardises the page chrome so each domain (cases, requests, settlements,
 * consultations, investigations, compliance…) gets the same elevated, bilingual,
 * RTL-safe layout without re-implementing it:
 *
 *   ┌─ PageHeader (title / description / actions) ─────────────────────────────┐
 *   │  KPI strip slot (caller passes <LexKpiStrip …/> or any node)             │
 *   │  Filter container  (rounded-xl border bg-card/40)          │
 *   │  Body  (the table / board — gets a soft surface frame)                   │
 *   └──────────────────────────────────────────────────────────────────────────┘
 *
 * States:
 *   - `loading`  → renders <LexListSkeleton> in place of the body.
 *   - `empty`    → renders <LexEmptyState> in place of the body (filters/KPIs stay
 *                  visible so the user can adjust them).
 *
 * Direction: reads the active locale from the shared provider and stamps `dir` on
 * the root so logical spacing / `rtl:` variants flip correctly. A caller may force a
 * direction via the `dir` prop (e.g. inside an isolated test).
 */

'use client';

import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { PageHeader } from '@/components/common/page-header';
import { cn } from '@/lib/utils';
import {
  type LexBilingual,
  resolveLexBilingual,
} from '@/app/(dashboard)/lex/_lib/lex-i18n';
import { LexEmptyState, type LexEmptyStateAction } from './empty-state';
import { LexListSkeleton } from './list-skeleton';

/** Bilingual default for the header eyebrow when the caller passes none. */
const DEFAULT_EYEBROW: LexBilingual<string> = {
  en: 'Legal Suite',
  ar: 'المجموعة القانونية',
};

/** Shape of the empty-state slot. Mirrors <LexEmptyState> minus chrome. */
export interface LexListShellEmpty {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: LexEmptyStateAction;
}

export interface LexListShellProps {
  title: ReactNode;
  description?: ReactNode;
  /** Trailing actions in the hero (e.g. "New case", export). */
  actions?: ReactNode;
  /**
   * Uppercase eyebrow above the title; pass `null` to hide. When omitted it
   * defaults to a locale-resolved "Legal Suite" / "المجموعة القانونية".
   */
  eyebrow?: ReactNode;
  /** KPI strip node (e.g. <LexKpiStrip …/>). Rendered between header and filters. */
  kpi?: ReactNode;
  /** Filter controls. Rendered inside the standard filter container. */
  filters?: ReactNode;
  /** The table / board / list body. */
  children: ReactNode;
  /** When true, the body region shows the shimmer skeleton instead. */
  loading?: boolean;
  /** Skeleton geometry while `loading`. */
  skeletonRows?: number;
  skeletonCols?: number;
  /** When set (and not loading), the body region shows the empty state. */
  empty?: LexListShellEmpty | null;
  /**
   * Wrap the body in the soft surface frame (border + card bg + elevation) so a
   * raw `.table-premium` inside reads as a contained, lifted panel. Defaults to
   * `true`; set `false` for bodies that bring their own framing (e.g. a board, or
   * the shared `DataTable`, which already renders its own bordered surface).
   */
  framedBody?: boolean;
  /** Force a direction; otherwise derived from the active locale. */
  dir?: 'ltr' | 'rtl';
  className?: string;
  /** Extra classes for the body wrapper (the framed/plain region). */
  bodyClassName?: string;
}

export function LexListShell({
  title,
  description,
  actions,
  eyebrow,
  kpi,
  filters,
  children,
  loading = false,
  skeletonRows = 8,
  skeletonCols = 5,
  empty = null,
  framedBody = true,
  dir,
  className,
  bodyClassName,
}: LexListShellProps) {
  const { locale, direction } = useLocaleOrDefault();
  const resolvedDir: 'ltr' | 'rtl' = dir ?? (direction === 'rtl' ? 'rtl' : 'ltr');
  // `undefined` → localized default; explicit `null` (or any node) → honoured as passed.
  const resolvedEyebrow =
    eyebrow === undefined ? resolveLexBilingual(DEFAULT_EYEBROW, locale) : eyebrow;

  // Decide what occupies the body region.
  const showEmpty = !loading && Boolean(empty);

  let body: ReactNode;
  if (loading) {
    body = <LexListSkeleton rows={skeletonRows} cols={skeletonCols} />;
  } else if (showEmpty && empty) {
    body = (
      <LexEmptyState
        icon={empty.icon}
        title={empty.title}
        description={empty.description}
        action={empty.action}
      />
    );
  } else {
    body = children;
  }

  // The body frame: a contained, lifted surface so a bare `.table-premium` inside
  // reads as a panel. Empty / loading states get the same frame so the page doesn't
  // jump between states. Plain (unframed) bodies skip the chrome.
  const framed = framedBody || loading || showEmpty;

  return (
    <div
      dir={resolvedDir}
      className={cn('space-y-6 motion-safe:animate-fade-up', className)}
    >
      <PageHeader
        title={title}
        description={description}
        actions={actions}
        eyebrow={resolvedEyebrow}
      />

      {kpi ? <div className="motion-safe:animate-fade-up">{kpi}</div> : null}

      {filters ? (
        <div className="rounded-xl border border-border/60 bg-card/40 p-4">
          {filters}
        </div>
      ) : null}

      <div
        className={cn(
          framed &&
            'overflow-hidden rounded-2xl border border-border/60 bg-card/60 shadow-elevation-1',
          bodyClassName,
        )}
      >
        {body}
      </div>
    </div>
  );
}
