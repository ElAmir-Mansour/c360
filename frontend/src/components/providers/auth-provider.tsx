'use client';

import React, { useEffect } from 'react';
import { useAuthStore } from '@/stores/auth-store';
import { decodeJWTPayload, getAccessToken } from '@/lib/auth';
import { expireSession, initAuthSync } from '@/lib/session-expiry';
import { refreshAccessToken } from '@/lib/session-refresh';
import { Spinner } from '@/components/ui/spinner';
import { Logo } from '@/components/brand/logo';

interface AuthProviderProps {
  children: React.ReactNode;
  hydrateOnMount?: boolean;
}

// How often the watchdog checks whether the access token needs renewing.
const RENEWAL_WATCHDOG_INTERVAL_MS = 30_000;

// Renew this far ahead of expiry. Access tokens live ~15 min, so a 5-minute
// lead leaves four watchdog ticks to land the rotation before anything can 401.
// It also keeps renewal well away from the moment of expiry, so a slow network
// or a backgrounded tab can't strand the user on a dead token.
const RENEWAL_LEAD_SECONDS = 5 * 60;

export function AuthProvider({ children, hydrateOnMount = true }: AuthProviderProps) {
  const isHydrated = useAuthStore((s) => s.isHydrated);
  const refreshSession = useAuthStore((s) => s.refreshSession);
  const markHydrated = useAuthStore((s) => s.markHydrated);

  // Wire cross-tab auth propagation once, as early as possible: if a peer tab
  // expires or logs out, this tab follows without waiting for its own request.
  useEffect(() => {
    initAuthSync();
  }, []);

  // Hydrate session on mount
  useEffect(() => {
    if (hydrateOnMount) {
      void refreshSession();
      return;
    }
    markHydrated();
  }, [hydrateOnMount, markHydrated, refreshSession]);

  // Defensive: any code path that still dispatches the legacy session-expired
  // event gets the same terminal outcome (clear + cross-tab logout + redirect).
  useEffect(() => {
    const handler = () => expireSession();
    window.addEventListener('clario360:session-expired', handler);
    return () => window.removeEventListener('clario360:session-expired', handler);
  }, []);

  // Keep an authenticated browser session alive by rotating its short-lived
  // access token ahead of expiry. The BFF validates the httpOnly refresh
  // cookie; a user is signed out only when that longer-lived session is no
  // longer valid. There is no client-side idle timeout and no expiry prompt —
  // the session simply renews for as long as the refresh cookie holds.
  useEffect(() => {
    const renewIfNeeded = async () => {
      const token = getAccessToken();
      if (!token) return;
      const payload = decodeJWTPayload(token);
      // An unreadable token isn't proof the session is dead — the refresh
      // cookie is the source of truth, so ask for a new one instead of
      // logging the user out on a parse failure.
      const exp = typeof payload?.['exp'] === 'number' ? (payload['exp'] as number) : 0;
      if (exp > Date.now() / 1000 + RENEWAL_LEAD_SECONDS) return;
      // Serialized + deduped in lib/session-refresh: this can never race the
      // axios 401 interceptor into refresh-token reuse detection.
      const result = await refreshAccessToken();
      // Only a definitive backend rejection of an ALREADY-expired token ends
      // the session here. A transient failure (network / gateway blip) retries
      // on the next tick, and a terminal result on a still-valid token lets the
      // remaining lifetime play out (later ticks keep retrying).
      if (result.status === 'terminal' && exp <= Date.now() / 1000) {
        expireSession();
      }
    };

    const onFocus = () => void renewIfNeeded();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void renewIfNeeded();
    };
    const interval = setInterval(() => void renewIfNeeded(), RENEWAL_WATCHDOG_INTERVAL_MS);

    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  if (!isHydrated) {
    return (
      <div className="fixed inset-0 flex flex-col items-center justify-center bg-auth-teal">
        <div className="mb-6 flex flex-col items-center gap-2.5 text-center">
          <Logo variant="wordmark" tone="onDark" className="h-8 w-auto" title="Clario360" />
          <p className="text-overline uppercase tracking-caps-xwide text-brand-accent-400">
            The Enterprise Intelligence Platform
          </p>
        </div>
        <Spinner size="lg" className="text-brand-accent-500" />
      </div>
    );
  }

  return <>{children}</>;
}
