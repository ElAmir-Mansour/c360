/**
 * Persistence + cross-surface launch plumbing for the spotlight {@link Tour}.
 *
 * - Dismissal is persisted per tour id under `tour:<id>:done` (localStorage) so
 *   a tour is auto-offered at most once per browser profile.
 * - `launchTour(id)` is the single relaunch entry point (e.g. the user menu's
 *   "Show tour"). It works from anywhere: it records a one-shot launch request
 *   in sessionStorage (consumed by the tour host after navigation) AND fires a
 *   window event (picked up immediately when the host is already mounted).
 *
 * All storage access is try/catch-guarded — private browsing modes and locked
 * down storage must never break the shell.
 */

export const TOUR_LAUNCH_EVENT = 'clario360:tour:launch';

export interface TourLaunchDetail {
  id: string;
}

const doneKey = (id: string) => `tour:${id}:done`;
const launchKey = (id: string) => `tour:${id}:launch`;

/** Whether the tour was completed or dismissed before. Fails closed (true) when
 * storage is unavailable so broken storage never causes repeat auto-offers. */
export function isTourDone(id: string): boolean {
  if (typeof window === 'undefined') return true;
  try {
    return window.localStorage.getItem(doneKey(id)) === '1';
  } catch {
    return true;
  }
}

export function markTourDone(id: string): void {
  try {
    window.localStorage.setItem(doneKey(id), '1');
  } catch {
    /* non-fatal */
  }
}

/** Clears the persisted dismissal so the tour auto-offers again (debug/QA). */
export function resetTourDone(id: string): void {
  try {
    window.localStorage.removeItem(doneKey(id));
  } catch {
    /* non-fatal */
  }
}

/**
 * Request that tour `id` opens. Safe to call from any page: if the tour host is
 * mounted it opens immediately (window event); otherwise the sessionStorage
 * flag is consumed by the host on its next mount (e.g. after navigating to the
 * dashboard).
 */
export function launchTour(id: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(launchKey(id), '1');
  } catch {
    /* non-fatal — the event path below still covers the mounted-host case */
  }
  window.dispatchEvent(
    new CustomEvent<TourLaunchDetail>(TOUR_LAUNCH_EVENT, { detail: { id } }),
  );
}

/** One-shot read of a pending launch request (clears it when present). */
export function consumeTourLaunchRequest(id: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    if (window.sessionStorage.getItem(launchKey(id)) === '1') {
      window.sessionStorage.removeItem(launchKey(id));
      return true;
    }
  } catch {
    /* non-fatal */
  }
  return false;
}
