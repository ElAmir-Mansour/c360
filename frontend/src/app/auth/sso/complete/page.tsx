'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, CheckCircle2, ShieldCheck } from 'lucide-react';

import {
  AuthActionStrip,
  AuthLoadingState,
  AuthPageIntro,
} from '@/components/auth/auth-page-primitives';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useBilingual } from '@/components/providers/locale-provider';
import { setAccessToken } from '@/lib/auth';
import { API_ENDPOINTS, ROUTES } from '@/lib/constants';
import { safePostAuthRedirect } from '@/lib/safe-redirect';

import { SSO_COMPLETE_LABELS } from './sso-complete-labels';

// Completion page for the enterprise-SSO redirect. The iam/lex SSO callback
// handlers (sso_handler.go) redirect the browser to the configured
// SSO_SUCCESS_REDIRECT_URL carrying the issued tokens in the URL FRAGMENT
// (#access_token=…&token_type=…[&refresh_token=…]) — the fragment never
// reaches any server, so this must be consumed client-side.
//
// Flow:
//  1. Read + parse location.hash exactly once, then immediately scrub the
//     fragment from the address bar/history so tokens cannot linger there.
//  2. When a refresh token is present, persist the session through the BFF
//     (POST /api/auth/session — the same body shape auth-store's
//     storeSessionInBFF sends) so httpOnly cookies back the session, then
//     HARD-navigate to the safe post-auth target (a full load lets the app
//     bootstrap from the fresh cookies).
//  3. When the fragment carries only an access token (the backend's current
//     shape), the BFF session route cannot be used (it requires both tokens);
//     fall back to the in-memory token + a client-side navigation — the same
//     convention as the OAuth /callback page.

type Phase =
  /** Parsing the fragment / storing the session (initial state). */
  | 'completing'
  /** Session stored; navigation in flight. */
  | 'success'
  /** No access_token in the fragment. */
  | 'missing'
  /** BFF session persistence failed. */
  | 'failed';

export default function SsoCompletePage() {
  const labels = useBilingual(SSO_COMPLETE_LABELS);
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>('completing');

  // The fragment is scrubbed as a side effect below, so the effect must run
  // exactly once even under React StrictMode's dev double-invocation.
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    const rawHash = window.location.hash;
    const fragment = new URLSearchParams(
      rawHash.startsWith('#') ? rawHash.slice(1) : rawHash,
    );
    const accessToken = fragment.get('access_token');
    const refreshToken = fragment.get('refresh_token');

    // Attacker-controllable query param — sanitized to a same-origin,
    // non-auth-page path before any navigation.
    const search = new URLSearchParams(window.location.search);
    const redirectTarget = safePostAuthRedirect(search.get('redirect'));

    // Scrub the token-bearing fragment from the URL/history immediately —
    // before any async work — so it cannot be recovered from history entries
    // or accidentally shared.
    if (rawHash) {
      window.history.replaceState(
        null,
        '',
        window.location.pathname + window.location.search,
      );
    }

    if (!accessToken) {
      setPhase('missing');
      return;
    }

    void (async () => {
      try {
        if (refreshToken) {
          // Mirror auth-store storeSessionInBFF's body shape: the BFF sets the
          // httpOnly access/refresh cookies. `remember` is omitted (session
          // cookies), matching a non-"remember me" login.
          const resp = await fetch(API_ENDPOINTS.BFF_SESSION, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              access_token: accessToken,
              refresh_token: refreshToken,
            }),
          });
          if (!resp.ok) {
            setPhase('failed');
            return;
          }
          setPhase('success');
          // Full load: cookies are set, so the app shell bootstraps the
          // session server/BFF-side on arrival.
          window.location.replace(redirectTarget);
          return;
        }

        // Access-token-only fragment: keep the token in memory (never web
        // storage) and navigate client-side so it survives the transition.
        setAccessToken(accessToken);
        setPhase('success');
        router.replace(redirectTarget);
      } catch {
        setPhase('failed');
      }
    })();
  }, [router]);

  if (phase === 'completing' || phase === 'success') {
    const isSuccess = phase === 'success';
    return (
      <div className="space-y-8">
        <AuthPageIntro
          badge={isSuccess ? labels.successBadge : labels.completingBadge}
          badgeIcon={isSuccess ? CheckCircle2 : ShieldCheck}
          title={isSuccess ? labels.successTitle : labels.completingTitle}
          description={
            isSuccess ? labels.successDescription : labels.completingDescription
          }
        />
        <AuthLoadingState
          label={isSuccess ? labels.successDescription : labels.completingTitle}
          detail={isSuccess ? undefined : labels.completingDetail}
        />
      </div>
    );
  }

  const errorMessage = phase === 'missing' ? labels.missingToken : labels.sessionFailed;

  return (
    <div className="space-y-8">
      <AuthPageIntro
        badge={labels.errorBadge}
        badgeIcon={AlertCircle}
        title={labels.errorTitle}
        description={labels.errorDescription}
      />
      <Alert
        variant="destructive"
        role="alert"
        className="border-error-100 bg-error-50 text-error-700 [&>svg]:text-error-500"
      >
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>{errorMessage}</AlertDescription>
      </Alert>
      <AuthActionStrip
        description={labels.actionDescription}
        href={ROUTES.LOGIN}
        cta={labels.backToLogin}
      />
    </div>
  );
}
