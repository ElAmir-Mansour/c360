'use client';

/**
 * /design-system — the LIVING COMPONENT CATALOG for the Clario360 platform.
 *
 * A real, executable reference (internal, English-only):
 *   - Tokens: color ramps, semantic roles, spacing, radii, elevation and
 *     motion — every swatch painted from the live CSS variables in
 *     src/styles/tokens/tokens.css, so the page cannot drift from the source.
 *   - Primitives: the canonical components (Button, StatusBadge + domain maps,
 *     StatTile, EmptyState, Skeleton, DataTable, overlays, PageHeader, wizard
 *     grammar, sonner toasts), rendered from their real modules.
 *   - Patterns: filter bars, confirm + undo, forms with an error summary.
 *   - Do & Don’t (/design-system/do-dont): the rules, encoded.
 *
 * Theme (light/dark/system) and text-direction (LTR/RTL) toggles live in the
 * shell header so reviewers can flip every specimen in place. The previous
 * marketing proof page remains reachable at /design-system/marketing, the
 * story gallery at /design-system/gallery, and the ClarioDR proof dashboard at
 * /design-system/dashboard.
 */

import Link from 'next/link';
import { ArrowRight, BookOpenCheck, LayoutGrid, Palette, Workflow } from 'lucide-react';

import { DsShell } from './_components/ds-shell';
import { TokensSection } from './_components/tokens-section';
import { PrimitivesSection } from './_components/primitives-section';
import { PatternsSection } from './_components/patterns-section';

const ON_THIS_PAGE = [
  { href: '#tokens', label: 'Tokens', icon: Palette },
  { href: '#primitives', label: 'Primitives', icon: LayoutGrid },
  { href: '#patterns', label: 'Patterns', icon: Workflow },
] as const;

const RELATED_PAGES = [
  {
    href: '/design-system/do-dont',
    title: 'Do & Don’t',
    description: 'The rules, encoded: no raw hex, logical properties, one badge system.',
  },
  {
    href: '/design-system/gallery',
    title: 'Story gallery',
    description: 'Every *.gallery.tsx story descriptor, rendered in one surface.',
  },
  {
    href: '/design-system/marketing',
    title: 'Marketing proof',
    description: 'The original ClarioDR landing proof page (kept reachable).',
  },
  {
    href: '/design-system/dashboard',
    title: 'DR proof dashboard',
    description: 'The Phase-3 product layer composed end-to-end.',
  },
] as const;

export default function DesignSystemCatalogPage() {
  return (
    <DsShell active="catalog">
      <div className="flex flex-col gap-12">
        {/* Hero */}
        <div className="flex flex-col gap-4">
          <div>
            <p className="text-overline font-semibold uppercase tracking-wide text-primary">
              Living reference
            </p>
            <h1 className="mt-1 text-h1 font-semibold tracking-tight text-foreground">
              Component catalog
            </h1>
            <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
              Everything below renders the real tokens and the real components —
              not screenshots, not copies. Use the header toggles to audit each
              specimen in light/dark and LTR/RTL before shipping a surface that
              consumes it.
            </p>
          </div>

          <nav aria-label="On this page">
            <ul className="flex flex-wrap items-center gap-2">
              {ON_THIS_PAGE.map(({ href, label, icon: Icon }) => (
                <li key={href}>
                  <a
                    href={href}
                    className="inline-flex h-9 items-center gap-2 rounded-full border border-border/70 bg-card px-4 text-sm font-medium text-foreground shadow-elevation-1 outline-none transition-colors duration-fast ease-standard hover:border-primary/30 hover:bg-primary/5 hover:text-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
                  >
                    <Icon className="h-4 w-4" aria-hidden />
                    {label}
                  </a>
                </li>
              ))}
              <li>
                <Link
                  href="/design-system/do-dont"
                  className="inline-flex h-9 items-center gap-2 rounded-full border border-primary/25 bg-primary/10 px-4 text-sm font-medium text-primary shadow-elevation-1 outline-none transition-colors duration-fast ease-standard hover:bg-primary/15 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
                >
                  <BookOpenCheck className="h-4 w-4" aria-hidden />
                  Do &amp; Don’t
                </Link>
              </li>
            </ul>
          </nav>
        </div>

        <TokensSection />
        <PrimitivesSection />
        <PatternsSection />

        {/* Related design-system pages */}
        <section aria-labelledby="ds-related-heading" className="scroll-mt-28">
          <div className="border-b border-border/70 pb-3">
            <h2
              id="ds-related-heading"
              className="text-h2 font-semibold tracking-tight text-foreground"
            >
              More in this area
            </h2>
          </div>
          <ul className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {RELATED_PAGES.map((page) => (
              <li key={page.href}>
                <Link
                  href={page.href}
                  className="group flex h-full flex-col rounded-2xl border border-border/70 bg-card p-4 shadow-elevation-1 outline-none transition-[border-color,box-shadow] duration-fast ease-standard hover:border-primary/30 hover:shadow-elevation-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                >
                  <span className="flex items-center justify-between gap-2 text-sm font-semibold text-foreground">
                    {page.title}
                    <ArrowRight
                      className="h-4 w-4 text-muted-foreground transition-transform duration-fast ease-standard rtl:rotate-180 motion-safe:group-hover:translate-x-0.5 motion-safe:rtl:group-hover:-translate-x-0.5"
                      aria-hidden
                    />
                  </span>
                  <span className="mt-1.5 text-xs leading-5 text-muted-foreground">
                    {page.description}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </DsShell>
  );
}
