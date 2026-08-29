'use client';

import { useEffect, useState } from 'react';
import { SUITE_ROUTE_SEGMENTS } from '@/config/navigation';

const STORAGE_KEY = 'clario360.sticky-suite';

const isSuiteSegment = (segment: string): boolean =>
  (SUITE_ROUTE_SEGMENTS as readonly string[]).includes(segment);

function readStored(): string {
  try {
    return window.sessionStorage.getItem(STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

/**
 * Sticky suite context for the app shell. While the user works inside a product
 * suite, the GLOBAL routes launched from its shell (the shared workspace under
 * /workflows and /admin/workflows, /files, /notifications, /admin, settings, …)
 * keep that suite's navigation scope and branding instead of falling back to
 * the all-suites platform view. Entering another suite replaces the context;
 * visiting the All-Suites hub (/ or /dashboard) clears it — that is the
 * explicit "leave the suite" gesture (the suite switcher's All Suites entry
 * links there).
 *
 * Returns the EFFECTIVE suite segment for presentation: the route's own suite
 * segment when inside a suite, the remembered one on global routes, '' on the
 * hub (or when nothing is remembered). Session-scoped so a new tab starts
 * unscoped. Hydration-safe: the first render after a hard reload uses the
 * route-derived value and the remembered segment applies after mount.
 */
export function useStickySuiteSegment(pathname: string | null): string {
  const segment = (pathname ?? '').split('/').filter(Boolean)[0] ?? '';
  const inSuite = isSuiteSegment(segment);
  const onHub = segment === '' || segment === 'dashboard';
  const [remembered, setRemembered] = useState('');

  useEffect(() => {
    if (inSuite) {
      try {
        window.sessionStorage.setItem(STORAGE_KEY, segment);
      } catch {
        // Storage unavailable — sticky context degrades to route-derived only.
      }
      setRemembered(segment);
    } else if (onHub) {
      try {
        window.sessionStorage.removeItem(STORAGE_KEY);
      } catch {
        // Storage unavailable — nothing to clear.
      }
      setRemembered('');
    } else {
      setRemembered(readStored());
    }
  }, [segment, inSuite, onHub]);

  if (inSuite) return segment;
  if (onHub) return '';
  return remembered;
}
