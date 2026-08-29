'use client';

import * as React from 'react';
import {
  TOUR_LAUNCH_EVENT,
  consumeTourLaunchRequest,
  isTourDone,
  type TourLaunchDetail,
} from './tour-storage';

export interface UseFirstRunTourOptions {
  /** Auto-open the tour once for sessions that never completed/dismissed it. */
  autoOffer?: boolean;
  /** Delay before the auto-offer so the page settles first (default 900ms). */
  offerDelayMs?: number;
}

/**
 * Controls a {@link Tour}'s `open` state for the common "first-run" pattern:
 *
 *  - auto-offers exactly once per browser profile (gated on the persisted
 *    `tour:<id>:done` key — completing OR skipping the tour sets it);
 *  - honors pending `launchTour(id)` requests recorded before navigation (the
 *    user-menu "Show tour" path from another page);
 *  - reopens immediately on a `launchTour(id)` fired while mounted.
 */
export function useFirstRunTour(
  id: string,
  { autoOffer = true, offerDelayMs = 900 }: UseFirstRunTourOptions = {},
): { open: boolean; setOpen: (open: boolean) => void } {
  const [open, setOpen] = React.useState(false);

  // Mount: explicit relaunch requests always win; otherwise offer once.
  React.useEffect(() => {
    if (consumeTourLaunchRequest(id)) {
      setOpen(true);
      return;
    }
    if (!autoOffer || isTourDone(id)) return;
    const timer = window.setTimeout(() => setOpen(true), offerDelayMs);
    return () => window.clearTimeout(timer);
  }, [autoOffer, id, offerDelayMs]);

  // Live relaunch (e.g. "Show tour" clicked while already on this page).
  React.useEffect(() => {
    const onLaunch = (event: Event) => {
      const detail = (event as CustomEvent<TourLaunchDetail>).detail;
      if (detail?.id !== id) return;
      // The request flag was also persisted for the navigation path — consume
      // it so the next visit does not spuriously reopen the tour.
      consumeTourLaunchRequest(id);
      setOpen(true);
    };
    window.addEventListener(TOUR_LAUNCH_EVENT, onLaunch);
    return () => window.removeEventListener(TOUR_LAUNCH_EVENT, onLaunch);
  }, [id]);

  return { open, setOpen };
}
