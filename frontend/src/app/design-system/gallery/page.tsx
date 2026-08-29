'use client';

/**
 * ClarioDR design-system COMPONENT GALLERY (public preview at /design-system/gallery).
 * ===================================================================================
 *
 * The Storybook-equivalent for this prod-server setup. Because the app is served
 * via `next start` (not a Storybook dev server), the component library is viewed
 * in-app: this page aggregates every `*.gallery.tsx` descriptor under
 * `src/components` into one browsable, token-driven, RTL-first surface.
 *
 * Each aggregated module's default export is a gallery descriptor of shape
 * `{ title: string; stories: Record<string, React.ComponentType> }`. Every story
 * is rendered in a labelled, bordered, token-styled frame so a reviewer can see
 * the committed components — light/dark and English/Arabic — without leaving the
 * running app. Locale + theme are inherited from the root layout providers
 * (LocaleProvider + next-themes ThemeProvider); the in-page <ThemeLocaleSwitcher/>
 * flips them live (RTL/LTR + light/dark) so every story can be exercised in place.
 *
 * This page composes the committed galleries — it hardcodes no DR data and uses
 * only design-system tokens.
 */

import type { ComponentType } from 'react';

import { ThemeLocaleSwitcher } from '@/components/layout/theme-locale-switcher';

import shellGallery from '@/components/marketing/shell/shell.gallery';
import dashboardGallery from '@/components/product/dashboard/dashboard.gallery';
import nodeMapGallery from '@/components/product/nodemap/node-map.gallery';
import recordsGallery from '@/components/product/records/records.gallery';
import runbookGallery from '@/components/product/runbook/runbook-task-flow.gallery';

/** The shape every `*.gallery.tsx` module exports as its default. */
interface GalleryDescriptor {
  title: string;
  stories: Record<string, ComponentType>;
}

/**
 * Every aggregated gallery descriptor, in display order. Each entry is one
 * committed `*.gallery.tsx` default export; the list is exhaustive for the
 * descriptors that currently exist under `src/components`.
 */
const galleries: readonly GalleryDescriptor[] = [
  shellGallery,
  dashboardGallery,
  nodeMapGallery,
  recordsGallery,
  runbookGallery,
];

/** Derive a stable, URL-safe anchor id from any human-readable label. */
function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export default function DesignSystemGalleryPage() {
  return (
    <div className="min-h-screen bg-bg-page text-content-primary">
      <header className="border-b border-outline-subtle bg-surface-card">
        <div className="flex w-full flex-col gap-gutter px-section-x py-section-y sm:flex-row sm:items-end sm:justify-between">
          <div className="max-w-3xl">
            <p className="text-overline font-semibold uppercase tracking-caps text-brand-primary-600">
              ClarioDR design system
            </p>
            <h1 className="mt-3 text-display font-display font-bold text-content-primary">
              Component gallery
            </h1>
            <p className="mt-4 text-body-lg text-content-secondary">
              Every committed component, rendered from its real DR sample data in
              one browsable surface. Toggle language and theme to verify each story
              in light or dark mode, English or Arabic with full RTL.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-gutter">
            <span className="text-body-sm font-semibold text-content-secondary">
              Appearance
            </span>
            <ThemeLocaleSwitcher />
          </div>
        </div>
      </header>

      <main className="w-full px-section-x py-section-y">
        <nav aria-label="Gallery sections" className="mb-section-y">
          <h2 className="text-overline font-semibold uppercase tracking-caps text-content-muted">
            On this page
          </h2>
          <ul className="mt-3 flex flex-wrap gap-gutter">
            {galleries.map((gallery) => {
              const sectionId = `gallery-${slugify(gallery.title)}`;
              const storyCount = Object.keys(gallery.stories).length;
              return (
                <li key={sectionId}>
                  <a
                    href={`#${sectionId}`}
                    className="inline-flex items-center gap-2 rounded-pill border border-outline-subtle bg-surface-card px-4 py-2 text-body-sm font-semibold text-content-secondary shadow-elevation-1 transition-colors duration-fast ease-standard hover:border-brand-primary-600 hover:text-content-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary-600"
                  >
                    {gallery.title}
                    <span className="rounded-pill bg-bg-subtle px-2 text-overline font-semibold uppercase tracking-caps-wide text-content-muted">
                      {storyCount}
                    </span>
                  </a>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="flex flex-col gap-section-y">
          {galleries.map((gallery) => {
            const sectionId = `gallery-${slugify(gallery.title)}`;
            const headingId = `${sectionId}-heading`;
            const stories = Object.entries(gallery.stories);
            return (
              <section
                key={sectionId}
                id={sectionId}
                aria-labelledby={headingId}
                className="scroll-mt-24"
              >
                <div className="flex items-baseline justify-between border-b border-outline-subtle pb-4">
                  <h2
                    id={headingId}
                    className="text-h2 font-display font-bold text-content-primary"
                  >
                    {gallery.title}
                  </h2>
                  <span className="text-overline font-semibold uppercase tracking-caps text-content-muted">
                    {stories.length} {stories.length === 1 ? 'story' : 'stories'}
                  </span>
                </div>

                <div className="mt-6 flex flex-col gap-gutter">
                  {stories.map(([storyName, Story]) => {
                    const storyId = `${sectionId}-${slugify(storyName)}`;
                    return (
                      <figure
                        key={storyId}
                        id={storyId}
                        aria-labelledby={`${storyId}-caption`}
                        className="overflow-hidden rounded-card border border-outline-subtle bg-surface-card shadow-elevation-1"
                      >
                        <figcaption
                          id={`${storyId}-caption`}
                          className="border-b border-outline-subtle px-card-padding py-3 text-overline font-semibold uppercase tracking-caps text-content-muted"
                        >
                          {storyName}
                        </figcaption>
                        <div className="p-card-padding">
                          <Story />
                        </div>
                      </figure>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      </main>
    </div>
  );
}
