'use client';

/**
 * Recently-viewed strip for the lex shell — now a thin DELEGATE over the
 * global recents store (`@/hooks/use-recent-items`, localStorage
 * `recent:global`). The old lex-only `lex.recent` list is migrated into the
 * global store on first read, so nothing recorded before this change is lost.
 *
 * The strip renders only lex entries (href under `/lex`) as quick-jump chips;
 * its clear action removes only those entries, leaving the rest of the global
 * history (cyber alerts, admin tenants, …) intact for the Cmd+K palette.
 *
 * SSR-safe: `useRecentItems` exposes an empty list until mounted, so server
 * and first client render agree (no hydration mismatch).
 */

import Link from 'next/link';
import { Clock, X, Gavel, FileText, Inbox, Scale, FileSearch } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  recordVisit,
  useRecentItems,
  type RecentItem as GlobalRecentItem,
  type RecentItemType,
} from '@/hooks/use-recent-items';
import { useLexShellLabels } from './lex-shell-labels';

const MAX_ITEMS = 8;

/** @deprecated Use {@link RecentItemType} from `@/hooks/use-recent-items`. */
export type RecentKind =
  | 'case'
  | 'contract'
  | 'request'
  | 'matter'
  | 'document'
  | 'clause'
  | 'other';

/** @deprecated Use `RecentItem` from `@/hooks/use-recent-items` (typed `{type,id,title,href}`). */
export interface RecentItem {
  href: string;
  label: string;
  kind: RecentKind;
  /** Epoch ms of the visit; used for ordering. */
  at?: number;
}

const KIND_ICON: Partial<Record<RecentItemType, LucideIcon>> = {
  case: Gavel,
  contract: FileText,
  request: Inbox,
  matter: Scale,
  document: FileSearch,
  clause: FileSearch,
  other: Clock,
};

/**
 * @deprecated Adapter over the global {@link recordVisit}. Prefer mounting
 * `<RecordRecent />` (or calling `recordVisit`) from `@/hooks/use-recent-items`
 * so entries carry a real entity id.
 */
export function pushRecent(item: Omit<RecentItem, 'at'>): void {
  if (!item.href || !item.label) return;
  recordVisit({
    type: item.kind as RecentItemType,
    id: item.href,
    title: item.label,
    href: item.href,
  });
}

function isLexItem(item: GlobalRecentItem): boolean {
  return item.href.startsWith('/lex');
}

export function RecentItems({ className }: { className?: string }) {
  const labels = useLexShellLabels();
  const { items: allItems, clear } = useRecentItems();
  const items = allItems.filter(isLexItem).slice(0, MAX_ITEMS);

  // Render nothing before mount (`useRecentItems` returns [] on the server and
  // first client render) and when there is nothing to show.
  if (items.length === 0) return null;

  return (
    <div
      className={cn(
        'flex min-w-0 items-center gap-2 motion-safe:animate-fade-up',
        className,
      )}
    >
      <span className="flex shrink-0 items-center gap-1.5 text-[11px] font-medium uppercase tracking-caps-wide text-muted-foreground">
        <Clock className="h-3.5 w-3.5" aria-hidden />
        {labels.recent.title}
      </span>
      <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {items.map((item) => {
          const Icon = KIND_ICON[item.type] ?? Clock;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'group inline-flex max-w-[16rem] shrink-0 items-center gap-1.5 rounded-full border border-border/60 bg-card/60 px-2.5 py-1 text-xs font-medium text-foreground/80',
                'transition-[background-color,border-color,box-shadow] duration-fast ease-standard',
                'hover:border-primary/40 hover:bg-primary/5 hover:text-foreground hover:shadow-elevation-1',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              )}
            >
              <Icon
                className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-colors group-hover:text-primary"
                aria-hidden
              />
              <span className="truncate">{item.title}</span>
            </Link>
          );
        })}
      </div>
      <button
        type="button"
        onClick={() => clear(isLexItem)}
        className="shrink-0 rounded-md px-1.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="inline-flex items-center gap-1">
          <X className="h-3 w-3" aria-hidden />
          {labels.recent.clear}
        </span>
      </button>
    </div>
  );
}
