/**
 * useWatheeqFavicon — tab-icon swap for Watheeq surfaces (/lex).
 *
 * The load-bearing guarantees: mounting swaps every `<link rel~="icon">` to
 * the gavel badge tile, unmounting restores the ORIGINAL attributes exactly
 * (navigating lex → another suite brings the Clario360 aperture mark back),
 * and a StrictMode double-invoked effect never captures the already-swapped
 * href as the "original".
 */

import { StrictMode } from 'react';
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useWatheeqFavicon, WATHEEQ_FAVICON_HREF } from './use-brand-favicon';

/** Recreates the two icon links the root layout's `metadata.icons` emits. */
function seedRootLayoutIcons(): void {
  document
    .querySelectorAll('link[rel~="icon"]')
    .forEach((link) => link.remove());

  const svg = document.createElement('link');
  svg.rel = 'icon';
  svg.setAttribute('href', '/icon.svg');
  svg.setAttribute('type', 'image/svg+xml');
  document.head.appendChild(svg);

  const ico = document.createElement('link');
  ico.rel = 'icon';
  ico.setAttribute('href', '/favicon.ico');
  ico.setAttribute('sizes', 'any'); // NB: no `type` attribute
  document.head.appendChild(ico);
}

function iconLinks(): HTMLLinkElement[] {
  return Array.from(
    document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]'),
  );
}

describe('useWatheeqFavicon', () => {
  beforeEach(() => {
    seedRootLayoutIcons();
  });

  it('swaps every icon link to the Watheeq tile on mount and restores the originals on unmount', () => {
    const { unmount } = renderHook(() => useWatheeqFavicon());

    const swapped = iconLinks();
    expect(swapped).toHaveLength(2);
    for (const link of swapped) {
      expect(link.getAttribute('href')).toBe(WATHEEQ_FAVICON_HREF);
      expect(link.getAttribute('type')).toBe('image/svg+xml');
    }

    unmount();

    const [svg, ico] = iconLinks();
    expect(svg.getAttribute('href')).toBe('/icon.svg');
    expect(svg.getAttribute('type')).toBe('image/svg+xml');
    expect(ico.getAttribute('href')).toBe('/favicon.ico');
    // The .ico link had no `type` — restore must remove the attribute, not
    // leave a stale `image/svg+xml` behind.
    expect(ico.hasAttribute('type')).toBe(false);
    expect(ico.getAttribute('sizes')).toBe('any');
  });

  it('is idempotent under StrictMode double-effects (never snapshots the swapped href as original)', () => {
    const { unmount } = renderHook(() => useWatheeqFavicon(), {
      wrapper: StrictMode,
    });

    for (const link of iconLinks()) {
      expect(link.getAttribute('href')).toBe(WATHEEQ_FAVICON_HREF);
    }

    unmount();

    const [svg, ico] = iconLinks();
    expect(svg.getAttribute('href')).toBe('/icon.svg');
    expect(ico.getAttribute('href')).toBe('/favicon.ico');
    expect(ico.hasAttribute('type')).toBe(false);
  });

  it('ref-counts overlapping consumers: the icon stays swapped until the last unmounts', () => {
    const first = renderHook(() => useWatheeqFavicon());
    const second = renderHook(() => useWatheeqFavicon());

    first.unmount();
    for (const link of iconLinks()) {
      expect(link.getAttribute('href')).toBe(WATHEEQ_FAVICON_HREF);
    }

    second.unmount();
    expect(iconLinks()[0].getAttribute('href')).toBe('/icon.svg');
  });

  it('creates a link when the page has none, and removes it on unmount', () => {
    document
      .querySelectorAll('link[rel~="icon"]')
      .forEach((link) => link.remove());

    const { unmount } = renderHook(() => useWatheeqFavicon());

    const created = iconLinks();
    expect(created).toHaveLength(1);
    expect(created[0].getAttribute('href')).toBe(WATHEEQ_FAVICON_HREF);
    expect(created[0].getAttribute('type')).toBe('image/svg+xml');

    unmount();
    expect(iconLinks()).toHaveLength(0);
  });
});
