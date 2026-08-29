'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Fingerprint, KeyRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';
import { useT } from '@/components/providers/locale-provider';
import { deviceTrustHeader } from '@/hooks/use-device-trust';
import {
  useAuthStore,
  type LoginResult,
  type PasskeyAssertion,
} from '@/stores/auth-store';

// PASSKEY BUTTON (cluster A3 #1 + #3).
//
// #3 Gating: no passkey ENROLLMENT ceremony exists yet, so no user can actually
// hold a usable credential. The button therefore probes the WebAuthn options
// endpoint on mount and renders ONLY when the probe returns usable credentials
// (non-empty allowCredentials and no error/no-credentials signal). Every other
// outcome — 404/501, network error, malformed options, empty allowCredentials,
// a distinct no-credentials error — keeps the button hidden and notifies the
// parent via onUnavailable, so nobody ever sees a button that cannot work.
// The component stays enrollment-ready: once an enrollment ceremony ships and
// the options endpoint starts returning credentials, the button appears again
// with zero code changes.
//
// #1 Remember-me: the login ceremony runs through the auth store's
// loginWithPasskey so the remember flag (passed as a prop from the login form)
// rides to the BFF verify route, which sets persistent vs session cookies.
//
// The WebAuthn wire helpers below are intentionally local: the equivalents in
// hooks/use-passkey.ts are module-private and that file is owned by another
// workstream this batch.

const WEBAUTHN_OPTIONS_ENDPOINT = '/api/auth/webauthn/options';

// ── base64url helpers (no deps) ──────────────────────────────────────────────

function base64UrlToArrayBuffer(value: string): ArrayBuffer {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

function arrayBufferToBase64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// PublicKeyCredentialRequestOptions JSON from the BFF (challenge / ids are
// base64url strings) → the binary shape the WebAuthn API expects.
interface RequestOptionsJSON {
  challenge?: string;
  timeout?: number;
  rpId?: string;
  userVerification?: UserVerificationRequirement;
  allowCredentials?: Array<{
    id: string;
    type: 'public-key';
    transports?: AuthenticatorTransport[];
  }>;
  // Distinct no-credentials / error signals some backends put in a 2xx body.
  error?: unknown;
  code?: unknown;
}

function decodeRequestOptions(
  json: RequestOptionsJSON,
): PublicKeyCredentialRequestOptions {
  return {
    challenge: base64UrlToArrayBuffer(json.challenge as string),
    timeout: json.timeout,
    rpId: json.rpId,
    userVerification: json.userVerification,
    allowCredentials: json.allowCredentials?.map((cred) => ({
      id: base64UrlToArrayBuffer(cred.id),
      type: cred.type,
      transports: cred.transports,
    })),
  };
}

// Serialize the assertion to the base64url wire shape the verify endpoint wants.
function serializeAssertion(credential: PublicKeyCredential): PasskeyAssertion {
  const response = credential.response as AuthenticatorAssertionResponse;
  return {
    id: credential.id,
    rawId: arrayBufferToBase64Url(credential.rawId),
    type: credential.type as 'public-key',
    response: {
      clientDataJSON: arrayBufferToBase64Url(response.clientDataJSON),
      authenticatorData: arrayBufferToBase64Url(response.authenticatorData),
      signature: arrayBufferToBase64Url(response.signature),
      userHandle: response.userHandle
        ? arrayBufferToBase64Url(response.userHandle)
        : null,
    },
  };
}

// ── options fetch (shared by the mount probe and the click ceremony) ─────────

type OptionsFetchResult =
  | { ok: true; options: PublicKeyCredentialRequestOptions }
  | {
      ok: false;
      reason:
        | 'network'
        | 'not-implemented'
        | 'options-failed'
        | 'options-malformed'
        | 'no-credentials';
    };

async function fetchUsableRequestOptions(email?: string): Promise<OptionsFetchResult> {
  let resp: Response;
  try {
    resp = await fetch(WEBAUTHN_OPTIONS_ENDPOINT, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...deviceTrustHeader() },
      body: JSON.stringify(email ? { email } : {}),
    });
  } catch {
    return { ok: false, reason: 'network' };
  }

  // 404 (route missing) / 501 (gateway not wired) → unavailable.
  if (resp.status === 404 || resp.status === 501) {
    return { ok: false, reason: 'not-implemented' };
  }
  if (!resp.ok) {
    return { ok: false, reason: 'options-failed' };
  }

  let json: RequestOptionsJSON;
  try {
    json = (await resp.json()) as RequestOptionsJSON;
  } catch {
    return { ok: false, reason: 'options-malformed' };
  }

  if (!json || typeof json !== 'object') {
    return { ok: false, reason: 'options-malformed' };
  }
  // A 2xx body carrying an error / no-credentials code is a distinct
  // "this account has nothing enrolled" signal — not usable options.
  if (typeof json.error === 'string' || json.code === 'NO_CREDENTIALS') {
    return { ok: false, reason: 'no-credentials' };
  }
  if (typeof json.challenge !== 'string' || json.challenge.length === 0) {
    return { ok: false, reason: 'options-malformed' };
  }
  // #3 — empty/missing allowCredentials means no enrolled credential can answer
  // this challenge (no enrollment ceremony exists yet), so the button would be
  // a guaranteed dead end. Hide it.
  if (!Array.isArray(json.allowCredentials) || json.allowCredentials.length === 0) {
    return { ok: false, reason: 'no-credentials' };
  }

  try {
    return { ok: true, options: decodeRequestOptions(json) };
  } catch {
    return { ok: false, reason: 'options-malformed' };
  }
}

interface PasskeyButtonProps {
  /**
   * Optional email hint passed to the WebAuthn options request. Omit for
   * usernameless / discoverable-credential flows.
   */
  email?: string;
  /**
   * (A3 #1) Remember-me choice forwarded through the passkey verify flow so the
   * BFF sets persistent (true) vs session (false/omitted) cookies.
   */
  remember?: boolean;
  /**
   * Called after a successful ceremony with the login result (mirrors the
   * password login result shape). The parent decides where to navigate or
   * whether to continue into the MFA step.
   */
  onSuccess: (result: LoginResult) => void;
  /**
   * Called when passkeys are not usable — the platform lacks WebAuthn support,
   * the endpoint is missing, the probe found no enrolled credentials, or a
   * ceremony hit a hard failure. The parent can hide the button entirely.
   */
  onUnavailable?: (reason?: string) => void;
  className?: string;
  label?: string;
  density?: 'default' | 'compact';
}

export function PasskeyButton({
  email,
  remember = false,
  onSuccess,
  onUnavailable,
  className,
  label,
  density = 'default',
}: PasskeyButtonProps) {
  const t = useT();
  const loginWithPasskey = useAuthStore((s) => s.loginWithPasskey);
  const [error, setError] = useState<string | null>(null);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  // #3 — render nothing until the mount probe confirms usable credentials.
  const [usable, setUsable] = useState(false);
  const resolvedLabel = label ?? t('auth.passkey.signInLabel');

  const isSupported = useMemo(
    () =>
      typeof window !== 'undefined' &&
      typeof window.PublicKeyCredential !== 'undefined' &&
      typeof navigator !== 'undefined' &&
      typeof navigator.credentials !== 'undefined' &&
      typeof navigator.credentials.get === 'function',
    [],
  );

  // Refs so the one-shot probe effect never re-fires on prop identity churn
  // (the parent re-creates onUnavailable each render, and email changes as the
  // user types — a per-keystroke probe would spam challenge issuance).
  const onUnavailableRef = useRef(onUnavailable);
  onUnavailableRef.current = onUnavailable;
  const probeEmailRef = useRef(email);
  probeEmailRef.current = email;

  useEffect(() => {
    if (!isSupported) {
      onUnavailableRef.current?.('unsupported');
      return;
    }
    let cancelled = false;
    void fetchUsableRequestOptions(probeEmailRef.current).then((probe) => {
      if (cancelled) return;
      if (probe.ok) {
        setUsable(true);
      } else {
        onUnavailableRef.current?.(probe.reason);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [isSupported]);

  // Hard gate (#3): render only when WebAuthn exists AND the probe confirmed
  // usable credentials — never a button that cannot work.
  if (!isSupported || !usable) {
    return null;
  }

  const handleClick = async () => {
    setError(null);
    setIsAuthenticating(true);
    try {
      // Fetch FRESH options — the probe's challenge may be expired or consumed.
      const fresh = await fetchUsableRequestOptions(email);
      if (!fresh.ok) {
        setUsable(false);
        onUnavailable?.(fresh.reason);
        return;
      }

      // Invoke the authenticator. NotAllowedError (user cancelled / timed out)
      // is a soft, retryable outcome; anything else hides the affordance.
      let credential: PublicKeyCredential | null;
      try {
        credential = (await navigator.credentials.get({
          publicKey: fresh.options,
        })) as PublicKeyCredential | null;
      } catch (err) {
        if (err instanceof DOMException && err.name === 'NotAllowedError') {
          setError(t('auth.passkey.cancelled'));
          return;
        }
        setUsable(false);
        onUnavailable?.('ceremony-failed');
        return;
      }
      if (!credential) {
        setUsable(false);
        onUnavailable?.('no-credential');
        return;
      }

      // (A3 #1) Verify through the auth store so the remember flag reaches the
      // BFF verify route (persistent vs session cookies).
      try {
        const result = await loginWithPasskey(serializeAssertion(credential), {
          remember,
        });
        onSuccess(result);
      } catch (err) {
        const code =
          err && typeof err === 'object' && 'code' in err
            ? (err as { code?: string }).code
            : undefined;
        if (code === 'PASSKEY_UNAVAILABLE') {
          setUsable(false);
          onUnavailable?.('not-implemented');
        } else {
          // A real credential whose assertion was rejected — a failed attempt,
          // not an unavailable capability. Keep the button for a retry.
          setError(t('auth.passkeyGate.failed'));
        }
      }
    } finally {
      setIsAuthenticating(false);
    }
  };

  return (
    <div className={cn('space-y-2', className)}>
      <Button
        type="button"
        variant="outline"
        disabled={isAuthenticating}
        onClick={handleClick}
        aria-label={resolvedLabel}
        className={cn(
          'group w-full justify-center font-semibold transition-all hover:text-primary focus-visible:ring-2 focus-visible:ring-ring/[0.35]',
          density === 'compact'
            ? 'h-12 gap-2 rounded-lg border-primary/15 bg-white px-2 text-[14px] font-medium text-muted-foreground shadow-none hover:border-primary/[0.35] hover:bg-primary/[0.06] dark:bg-card'
            : 'h-11 gap-2.5 rounded-2xl border-primary/20 bg-foreground/5 px-3 text-[13px] text-foreground shadow-sm hover:border-primary/40 hover:bg-primary/[0.08]',
        )}
      >
        {isAuthenticating ? (
          <>
            <Spinner size="sm" />
            <span className="min-w-0 text-center leading-4">{t('auth.passkey.authenticating')}</span>
          </>
        ) : (
          <>
            <span
              className={cn(
                'flex items-center justify-center bg-primary/12 text-foreground/70 transition-colors group-hover:bg-primary/15 group-hover:text-primary',
                density === 'compact' ? 'h-5 w-5 rounded-lg' : 'h-6 w-6 rounded-xl',
              )}
            >
              <Fingerprint className="h-3.5 w-3.5" aria-hidden />
            </span>
            <span className="min-w-0 text-center leading-4">{resolvedLabel}</span>
            {density === 'default' ? (
              <KeyRound
                className="h-3.5 w-3.5 text-foreground/40 transition-colors group-hover:text-primary"
                aria-hidden
              />
            ) : null}
          </>
        )}
      </Button>

      {error ? (
        <p role="alert" className="text-center text-[12px] text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
