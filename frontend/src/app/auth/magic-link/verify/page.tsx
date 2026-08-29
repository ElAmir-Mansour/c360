'use client';

import { useEffect, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Fingerprint, MailCheck } from 'lucide-react';

import {
  AuthActionStrip,
  AuthLoadingState,
  AuthPageIntro,
} from '@/components/auth/auth-page-primitives';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useBilingual } from '@/components/providers/locale-provider';
import { useMagicLink } from '@/hooks/use-magic-link';
import { ROUTES } from '@/lib/constants';
import { safePostAuthRedirect } from '@/lib/safe-redirect';

import { MAGIC_LINK_VERIFY_LABELS } from './magic-link-verify-labels';

// The landing page for the emailed passwordless sign-in link. The iam service
// mails {APP_URL}/auth/magic-link/verify?token=... (magic_link_service.go);
// this page redeems the token against the BFF (POST /api/auth/magic-link/verify
// via useMagicLink), which establishes the httpOnly session cookies itself.
//
// On success we HARD-navigate (window.location.replace) to the post-auth
// target: the auth layout mounts AuthRuntime with hydrateOnMount={false}, so a
// full page load is what lets the app bootstrap the session from the fresh
// cookies — a client-side router push would land with an unhydrated store.

type Phase =
  /** Redeeming the token (also the initial state before the effect runs). */
  | 'verifying'
  /** Session established; hard redirect in flight. */
  | 'success'
  /** Token missing from the URL entirely. */
  | 'missing'
  /** Token rejected by the backend (invalid / already used / expired). */
  | 'invalid'
  /** Capability not shipped/enabled (BFF signalled 404/501/network). */
  | 'unavailable'
  /** Token accepted but the account requires a second factor. */
  | 'mfa';

export default function MagicLinkVerifyPage() {
  const labels = useBilingual(MAGIC_LINK_VERIFY_LABELS);
  const { verifyMagicLink } = useMagicLink();
  const [phase, setPhase] = useState<Phase>('verifying');

  // Magic-link tokens are SINGLE-USE: React 18 StrictMode double-invokes
  // effects in dev, and redeeming twice would consume the token and then
  // report it invalid. The ref guarantees exactly one redemption attempt.
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    // Read token + redirect straight off the URL (not useSearchParams) so the
    // page needs no Suspense boundary and the values are captured exactly once.
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');
    // Attacker-controllable query param — sanitized to a same-origin,
    // non-auth-page path (safePostAuthRedirect) before any navigation.
    const redirectTarget = safePostAuthRedirect(params.get('redirect'));

    if (!token) {
      setPhase('missing');
      return;
    }

    // Scrub the single-use token from the address bar / history before the
    // async hop so it cannot be recovered via history or copied links.
    const scrubbed = new URLSearchParams(params);
    scrubbed.delete('token');
    const query = scrubbed.toString();
    window.history.replaceState(
      null,
      '',
      window.location.pathname + (query ? `?${query}` : ''),
    );

    void (async () => {
      const result = await verifyMagicLink(token);
      if (result.unavailable) {
        setPhase('unavailable');
        return;
      }
      if (result.requiresMFA) {
        // The password flow owns the MFA step (login-form). The mfa_token is
        // deliberately NOT threaded through a redirect — direct the user to
        // complete sign-in from the login page instead of leaking auth
        // material through URLs.
        setPhase('mfa');
        return;
      }
      if (result.verified) {
        setPhase('success');
        window.location.replace(redirectTarget);
        return;
      }
      setPhase('invalid');
    })();
  }, [verifyMagicLink]);

  if (phase === 'verifying') {
    return (
      <div className="space-y-8">
        <AuthPageIntro
          badge={labels.verifyingBadge}
          badgeIcon={MailCheck}
          title={labels.verifyingTitle}
          description={labels.verifyingDescription}
        />
        <AuthLoadingState label={labels.verifyingTitle} detail={labels.verifyingDetail} />
      </div>
    );
  }

  if (phase === 'success') {
    return (
      <div className="space-y-8">
        <AuthPageIntro
          badge={labels.successBadge}
          badgeIcon={CheckCircle2}
          title={labels.successTitle}
          description={labels.successDescription}
        />
        <AuthLoadingState label={labels.successDescription} />
      </div>
    );
  }

  if (phase === 'mfa') {
    return (
      <div className="space-y-8">
        <AuthPageIntro
          badge={labels.mfaBadge}
          badgeIcon={Fingerprint}
          title={labels.mfaTitle}
          description={labels.mfaDescription}
        />
        <AuthActionStrip
          description={labels.actionDescription}
          href={ROUTES.LOGIN}
          cta={labels.backToLogin}
        />
      </div>
    );
  }

  // Error states: missing / invalid / unavailable.
  const errorMessage =
    phase === 'missing'
      ? labels.missingToken
      : phase === 'unavailable'
        ? labels.unavailable
        : labels.invalidOrExpired;

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
