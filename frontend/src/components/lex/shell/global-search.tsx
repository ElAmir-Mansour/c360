'use client';

/**
 * Header global-search affordance for the lex shell.
 *
 * This is a lightweight trigger, not a second search surface: typing (or
 * pressing Enter / clicking) opens the shared command palette in *search mode*,
 * seeded with whatever the user typed, so a single ranked result list (lex
 * cases + requests + the global palette's contracts/matters/clauses) does the
 * actual searching. This keeps one source of truth for results and avoids a
 * competing popover.
 *
 * - `⌘K` / `Ctrl+K` hint badge (mirrors the app header pattern).
 * - Opens the palette and forwards the query (`setOpen` clears the query first,
 *   so we set it again right after).
 * - Bilingual + RTL-aware; `dir` inherited from the shell.
 */

import { useCallback, useState } from 'react';
import { Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useCommandPaletteStore } from '@/stores/command-palette-store';
import { useLexShellLabels } from './lex-shell-labels';

export function LexGlobalSearch({ className }: { className?: string }) {
  const labels = useLexShellLabels();
  const setOpen = useCommandPaletteStore((s) => s.setOpen);
  const setQuery = useCommandPaletteStore((s) => s.setQuery);
  const [value, setValue] = useState('');

  // Open the shared palette seeded with the current text. `setOpen` resets the
  // store query, so we re-apply `value` immediately afterwards.
  const openPalette = useCallback(
    (seed: string) => {
      setOpen(true);
      if (seed.trim().length > 0) setQuery(seed.trim());
    },
    [setOpen, setQuery],
  );

  const isMac =
    typeof navigator !== 'undefined' && navigator.platform.toUpperCase().includes('MAC');
  const shortcut = isMac ? '⌘K' : 'Ctrl K';

  return (
    <div className={cn('min-w-0', className)}>
      {/* Compact icon button through compact desktop widths. */}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={labels.search.label}
        onClick={() => openPalette(value)}
        className={cn(
          'inline-flex h-9 w-9 items-center justify-center rounded-xl border border-border/60 bg-card/50 text-muted-foreground xl:hidden',
          'transition-colors duration-fast ease-standard hover:border-primary/40 hover:text-foreground',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        )}
      >
        <Search className="h-4 w-4" aria-hidden />
      </Button>

      {/* Full search field on xl+. The input never searches in place — it just
          carries the seed text into the palette on focus/Enter/click. */}
      <div className="hidden xl:block">
        <label className="sr-only" htmlFor="lex-global-search">
          {labels.search.label}
        </label>
        <div
          className={cn(
            'group flex h-9 w-full min-w-[14rem] items-center gap-2 rounded-xl border border-border/60 bg-card/50 px-3',
            'transition-[border-color,box-shadow] duration-fast ease-standard',
            'focus-within:border-primary/50',
          )}
        >
          <Search
            className="h-4 w-4 shrink-0 text-muted-foreground transition-colors group-focus-within:text-primary"
            aria-hidden
          />
          <input
            id="lex-global-search"
            type="search"
            value={value}
            placeholder={labels.search.placeholder}
            // Opening on focus turns this into a true palette trigger while still
            // letting the user keep typing inside the palette afterwards.
            onFocus={() => openPalette(value)}
            onChange={(e) => {
              setValue(e.target.value);
              openPalette(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') openPalette(value);
            }}
            className="min-w-0 flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:appearance-none"
          />
          <kbd className="hidden shrink-0 items-center gap-0.5 rounded-md border border-border/60 bg-muted/60 px-1.5 py-0.5 text-overline font-medium text-muted-foreground lg:inline-flex">
            {shortcut}
          </kbd>
        </div>
      </div>
    </div>
  );
}
