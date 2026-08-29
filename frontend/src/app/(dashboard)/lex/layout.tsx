'use client';

/**
 * Lex suite SHELL layout.
 *
 * Lex renders inside the SAME platform shell as every other suite — the global
 * dashboard `Sidebar`/`Header` (`src/app/(dashboard)/layout.tsx`) already provide
 * the Watheeq nav section (`src/config/navigation.ts`), the breadcrumb trail
 * (`components/layout/breadcrumbs.tsx`, which resolves lex routes from the same
 * nav config) and the ⌘K search button (opening the single shared
 * `CommandPalette`). So this layout NO LONGER paints a second breadcrumb row or
 * its own search field — that duplicate chrome is what made lex feel like a
 * different product when navigating cyber → lex.
 *
 * What this layout still adds, nested inside `(dashboard)/layout.tsx`:
 *
 *   ┌──────────────────────────────────────────┐
 *   │ Lex context strip: role · persona · recents│  (lex-specific, self-hides)
 *   ├──────────────────────────────────────────┤
 *   │ {children}  ← existing pages render as-is │
 *   └──────────────────────────────────────────┘
 *
 * - {@link LexContextProvider} is the spine: it fetches `/lex/me`, hydrates the
 *   granular effective permissions into the auth store (so the sidebar + page /
 *   action gates evaluate true) and feeds the persona chrome. Mounted here so
 *   EVERY lex page (children) shares one fetch — LOAD-BEARING, do not remove.
 * - Persona chrome (§14, §18.5, §18.6): active role badge · persona switcher
 *   (multi-role only) · "My Lex Access" capabilities sheet. Each renders nothing
 *   when not applicable, so a non-legal user sees a clean shell.
 * - {@link RecentItems} is a slim quick-jump strip over the GLOBAL recents store
 *   (also surfaced in the shared ⌘K palette); it self-hides when empty.
 * - {@link LexCommandPalette} contributes the lex command set (jump-to-domain,
 *   quick actions, live case/request search) into the shared command-palette
 *   store; it renders no UI of its own.
 * - `dir` is taken from the active locale so the strip is RTL-safe.
 * - Resilient: the chrome is pure client UI with no blocking fetches, so even if
 *   a child page's data fails, the strip / palette still render.
 */

import { useLocale } from '@/components/providers/locale-provider';
import { useWatheeqFavicon } from '@/components/brand/use-brand-favicon';
import { RecentItems } from '@/components/lex/shell/recent-items';
import { LexCommandPalette } from '@/components/lex/shell/lex-command-palette';
import { LexContextProvider } from '@/lib/lex/use-lex-context';
import { LexPersonaSwitcher } from '@/components/lex/persona/persona-switcher';

export default function LexLayout({ children }: { children: React.ReactNode }) {
  const { direction } = useLocale();

  // Watheeq tab icon: while anywhere under /lex the browser favicon is the
  // official gavel badge tile; restored to the Clario360 aperture mark on leaving
  // the suite. Route-based on purpose — /lex IS the Watheeq surface (and for
  // Watheeq-only tenants the whole product lives under /lex).
  useWatheeqFavicon();

  return (
    <LexContextProvider>
      <div dir={direction} className="flex min-w-0 flex-col gap-4">
        {/* Lex context strip — persona switcher + recents. Breadcrumbs and
            global search are provided by the shared platform header, so lex no
            longer renders a second header row. Collapses entirely (`empty:hidden`
            cascades through the null-rendering children) for a non-legal user. */}
        <div className="flex flex-col gap-3 empty:hidden motion-safe:animate-fade-up">
          <div className="flex flex-wrap items-center justify-end gap-2 empty:hidden">
            <LexPersonaSwitcher />
          </div>
          <RecentItems />
        </div>

        <div className="min-w-0 flex-1">{children}</div>

        {/* Contributes lex commands into the shared palette; renders no UI. */}
        <LexCommandPalette />
      </div>
    </LexContextProvider>
  );
}
