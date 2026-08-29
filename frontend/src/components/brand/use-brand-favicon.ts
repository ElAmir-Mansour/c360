'use client';

/**
 * Watheeq favicon swap — Watheeq surfaces (the `/lex` route subtree) show the
 * official gavel badge tile (`/brand/watheeq-favicon.svg`, the `watheeq-mark.svg`
 * art squared for tab rendering) in the browser tab instead of the global
 * Clario360 aperture mark.
 *
 * The root layout wires the Clario360 icons through `metadata.icons`
 * (`src/app/layout.tsx`), but the lex shell layout is a client component and
 * cannot export metadata — so the per-suite swap is a client-side
 * `<link rel="icon">` swap: on mount every icon link is snapshotted and
 * pointed at the Watheeq tile; on unmount (navigating lex → another suite)
 * the original hrefs are restored.
 *
 * - SSR-safe: only touches `document` inside the effect, with an extra guard.
 * - StrictMode-safe / idempotent: a module-level mount count means the
 *   ORIGINAL attributes are snapshotted exactly once per swap epoch — a
 *   double-invoked effect (mount → cleanup → mount) or a nested consumer can
 *   never capture the already-swapped href as the "original".
 */

import { useEffect } from 'react';

/** Served from `public/brand/` — the official gavel badge tile, squared. */
export const WATHEEQ_FAVICON_HREF = '/brand/watheeq-favicon.svg';

interface IconLinkSnapshot {
  link: HTMLLinkElement;
  /** Raw attribute values (`null` = attribute absent) so restore is exact. */
  href: string | null;
  type: string | null;
  /** The hook created this link (page had no icon link at all) — remove it. */
  created: boolean;
}

let mountCount = 0;
let snapshots: IconLinkSnapshot[] = [];

function swapToWatheeqFavicon(): void {
  // `rel~="icon"` matches both `rel="icon"` and legacy `rel="shortcut icon"`.
  const links = Array.from(
    document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]'),
  );

  if (links.length === 0) {
    const link = document.createElement('link');
    link.rel = 'icon';
    link.setAttribute('href', WATHEEQ_FAVICON_HREF);
    link.setAttribute('type', 'image/svg+xml');
    document.head.appendChild(link);
    snapshots = [{ link, href: null, type: null, created: true }];
    return;
  }

  snapshots = links.map((link) => ({
    link,
    href: link.getAttribute('href'),
    type: link.getAttribute('type'),
    created: false,
  }));

  for (const link of links) {
    link.setAttribute('href', WATHEEQ_FAVICON_HREF);
    link.setAttribute('type', 'image/svg+xml');
  }
}

function restoreOriginalFavicon(): void {
  for (const { link, href, type, created } of snapshots) {
    if (created) {
      link.remove();
      continue;
    }
    if (href === null) link.removeAttribute('href');
    else link.setAttribute('href', href);
    if (type === null) link.removeAttribute('type');
    else link.setAttribute('type', type);
  }
  snapshots = [];
}

/**
 * Swaps the document favicon to the Watheeq gavel badge tile while mounted and
 * restores the original icons on unmount. Mount once from the lex shell
 * layout; additional consumers are ref-counted and harmless.
 */
export function useWatheeqFavicon(): void {
  useEffect(() => {
    if (typeof document === 'undefined') return undefined;

    mountCount += 1;
    if (mountCount === 1) swapToWatheeqFavicon();

    return () => {
      mountCount -= 1;
      if (mountCount === 0) restoreOriginalFavicon();
    };
  }, []);
}
