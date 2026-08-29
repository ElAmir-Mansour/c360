// Central, framework-agnostic session termination + cross-tab propagation.
//
// A session dies when the refresh token is gone/expired and a refresh cannot
// re-establish it. When that happens we want a single, deterministic outcome:
// clear the in-memory token, drop the httpOnly cookies, tell every other open
// tab, and hard-redirect this tab to /login — so the user is logged out of ALL
// pages, not stranded on a stale view or a generic error boundary.
//
// This module is the ONE place that decides "the session is over". The Axios
// interceptor (on a terminal 401) and the AuthProvider watchdog (proactive
// expiry check) both funnel through `expireSession()`; manual logout funnels
// through `broadcastLogout()`. Cross-tab delivery uses BroadcastChannel with a
// `storage`-event fallback for browsers/embeddings without it.

import { clearAccessToken } from '@/lib/auth';
import { API_ENDPOINTS } from '@/lib/constants';

const CHANNEL_NAME = 'clario360:auth';
const STORAGE_KEY = 'clario360:auth-broadcast';

type AuthBroadcast = { type: 'session-expired' } | { type: 'logout' };

// Auth surfaces where a dead session is expected — never bounce or loop here.
const AUTH_ROUTE_PREFIXES = [
  '/login',
  '/register',
  '/forgot-password',
  '/reset-password',
  '/verify-email',
  '/verify',
  '/invite',
  '/callback',
  '/setup',
] as const;

function onAuthSurface(pathname: string): boolean {
  return AUTH_ROUTE_PREFIXES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  );
}

// Once we start tearing down we must not fire a second redirect — concurrent
// 401s and an inbound broadcast can all land in the same tick. Reset naturally
// on the next page load (module state is fresh after navigation).
let terminating = false;

let channel: BroadcastChannel | null = null;

function getChannel(): BroadcastChannel | null {
  if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') {
    return null;
  }
  if (!channel) {
    try {
      channel = new BroadcastChannel(CHANNEL_NAME);
    } catch {
      channel = null;
    }
  }
  return channel;
}

function broadcast(msg: AuthBroadcast): void {
  const ch = getChannel();
  if (ch) {
    try {
      ch.postMessage(msg);
    } catch {
      /* ignore — fall through to the storage fallback below */
    }
  }
  // storage-event fallback: covers contexts without BroadcastChannel and is a
  // harmless duplicate otherwise (a nonce guarantees the event fires even when
  // the same message type repeats). Write-then-remove so nothing persists.
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...msg, n: Date.now() }));
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* localStorage may be unavailable (private mode / sandbox) — ignore */
  }
}

function clearCookies(): void {
  // Best-effort DELETE of the BFF httpOnly cookies. Fire-and-forget: the
  // redirect must not wait on it, and login will overwrite them anyway.
  if (typeof fetch !== 'undefined') {
    void fetch(API_ENDPOINTS.BFF_SESSION, { method: 'DELETE' }).catch(() => {});
  }
}

function redirectToLogin(reason?: string): void {
  if (typeof window === 'undefined') return;
  const { pathname, search } = window.location;
  if (onAuthSurface(pathname)) return;
  const params = new URLSearchParams();
  params.set('redirect', pathname + search);
  if (reason) params.set('reason', reason);
  window.location.href = `/login?${params.toString()}`;
}

/**
 * Terminate the session in THIS tab and propagate to every other tab.
 *
 * Call the moment the session is known to be unrecoverable (refresh returned
 * 401, or the access token expired and a refresh could not re-establish it).
 * Idempotent — extra calls while a redirect is pending are no-ops. On an auth
 * surface it only clears in-memory state (no redirect/broadcast loop).
 */
export function expireSession(): void {
  if (typeof window === 'undefined') return;
  if (onAuthSurface(window.location.pathname)) {
    clearAccessToken();
    return;
  }
  if (terminating) return;
  terminating = true;

  clearAccessToken();
  clearCookies();
  broadcast({ type: 'session-expired' });
  redirectToLogin('session_expired');
}

/**
 * Announce a manual logout to all OTHER tabs. The initiating tab performs its
 * own redirect via the auth store's logout(); peers pick this up and follow.
 */
export function broadcastLogout(): void {
  broadcast({ type: 'logout' });
}

let syncInitialized = false;

/**
 * Wire cross-tab auth propagation. Safe to call repeatedly (idempotent).
 * A peer that expires or logs out shares the same cookies as this tab, so an
 * inbound message means this tab's session is over too — clear and redirect,
 * WITHOUT re-broadcasting (which would ping-pong across tabs).
 */
export function initAuthSync(): void {
  if (typeof window === 'undefined' || syncInitialized) return;
  syncInitialized = true;

  const handle = (msg: AuthBroadcast) => {
    if (terminating) return;

    if (msg.type === 'session-expired') {
      terminating = true;
      clearAccessToken();
      redirectToLogin('session_expired');
      return;
    }

    if (msg.type === 'logout') {
      terminating = true;
      clearAccessToken();
      if (!onAuthSurface(window.location.pathname)) {
        // Manual logout elsewhere → clean /login, no expiry banner.
        window.location.href = '/login';
      }
    }
  };

  const ch = getChannel();
  if (ch) {
    ch.onmessage = (event: MessageEvent) => handle(event.data as AuthBroadcast);
  }

  // storage fallback (and belt-and-suspenders on top of BroadcastChannel).
  window.addEventListener('storage', (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY || !event.newValue) return;
    try {
      handle(JSON.parse(event.newValue) as AuthBroadcast);
    } catch {
      /* malformed — ignore */
    }
  });
}
