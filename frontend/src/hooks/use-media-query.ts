'use client';

import { useState, useEffect } from 'react';

export function useMediaQuery(query: string): boolean {
  // Read the real match on the first client render so the wrong layout (e.g.
  // the desktop sidebar on mobile) never flashes for a frame; SSR stays false.
  const [matches, setMatches] = useState(() =>
    typeof window === 'undefined' ? false : window.matchMedia(query).matches,
  );

  useEffect(() => {
    const media = window.matchMedia(query);
    setMatches(media.matches);

    const listener = (e: MediaQueryListEvent) => setMatches(e.matches);
    media.addEventListener('change', listener);
    return () => media.removeEventListener('change', listener);
  }, [query]);

  return matches;
}

export function useIsMobile(): boolean {
  return useMediaQuery('(max-width: 767px)');
}

export function useIsTablet(): boolean {
  return useMediaQuery('(min-width: 768px) and (max-width: 1279px)');
}

export function useIsDesktop(): boolean {
  return useMediaQuery('(min-width: 1280px)');
}
