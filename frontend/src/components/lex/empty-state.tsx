/**
 * @deprecated Use `EmptyState` from `@/components/common/empty-state` — the
 * canonical empty-state primitive (icon or built-in illustration + title +
 * description + actions). `<LexEmptyState>` remains as a thin adapter so the
 * Lex list surfaces keep compiling and now render the canonical visual.
 *
 * Bilingual by props: callers pass already-resolved `title` / `description` /
 * `action.label` strings (each domain owns its local label bundle). RTL is
 * handled by the consumer setting `dir` on an ancestor; the canonical
 * component uses logical spacing so it flips automatically.
 */

'use client';

import type { LucideIcon } from 'lucide-react';
import { Inbox } from 'lucide-react';
import { EmptyState } from '@/components/common/empty-state';

export interface LexEmptyStateAction {
  label: string;
  onClick: () => void;
  /** Optional leading icon for the CTA (rendered before the label). */
  icon?: LucideIcon;
}

export interface LexEmptyStateProps {
  /** Icon shown in the soft disc. Defaults to an inbox. */
  icon?: LucideIcon;
  title: string;
  description?: string;
  /** Optional primary call-to-action. */
  action?: LexEmptyStateAction;
  className?: string;
}

/** @deprecated Thin adapter over the canonical `EmptyState`. */
export function LexEmptyState({
  icon = Inbox,
  title,
  description,
  action,
  className,
}: LexEmptyStateProps) {
  return (
    <EmptyState
      role="status"
      aria-live="polite"
      icon={icon}
      title={title}
      description={description}
      action={action}
      className={className}
    />
  );
}
