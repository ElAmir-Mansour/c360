'use client';

import { useCallback, useState } from 'react';

import { isApiError, type ApiError } from '@/types/api';

// Magic-link / email-OTP fallback (capability #6).
//
// This is a frontend-complete, gracefully-degrading hook. The backend
// magic-link endpoints may not exist yet — when the BFF route or gateway
// answers with 404/501, the hook reports `unavailable` so the UI
// can hide the feature instead of surfacing a hard error.
//
// Client talks ONLY to the BFF route handlers via `fetch` + relative URL +
// `credentials:'include'` (never the axios `api` instance, which targets the
// gateway base URL). The BFF forwards to the gateway and degrades on its own.

// BFF endpoints owned by this feature (new route files, no collisions).
const MAGIC_LINK_REQUEST_ENDPOINT = '/api/auth/magic-link/request';
const MAGIC_LINK_VERIFY_ENDPOINT = '/api/auth/magic-link/verify';

/** Status codes that mean "the backend has not shipped this capability yet". */
const UNAVAILABLE_STATUSES = new Set([404, 501]);

export interface MagicLinkRequestResult {
  /** True when the request was accepted and a link/OTP dispatch was requested. */
  sent: boolean;
  /**
   * True when the capability is not wired up on the backend (404/501/network).
   * The UI should hide or disable the magic-link affordance when this is true.
   */
  unavailable: boolean;
}

export interface MagicLinkVerifyResult {
  /** True when verification succeeded and the session was established. */
  verified: boolean;
  /** True when the capability is not wired up on the backend. */
  unavailable: boolean;
  /** When the backend requires a second factor after the link, surface it. */
  requiresMFA?: boolean;
  mfaToken?: string;
}

interface UseMagicLinkReturn {
  /** True while either request or verify is in flight. */
  isLoading: boolean;
  /**
   * True once a non-2xx/404/501/network response is observed, signalling the
   * caller to hide the feature. Sticky for the lifetime of the hook instance.
   */
  isUnavailable: boolean;
  /** Last human-readable error (cleared on the next call), or null. */
  error: string | null;
  /** Request a magic link / email OTP for the given address. */
  requestMagicLink: (email: string) => Promise<MagicLinkRequestResult>;
  /** Verify a magic-link token (from the emailed link or pasted OTP). */
  verifyMagicLink: (token: string) => Promise<MagicLinkVerifyResult>;
  /** Reset transient error/loading state (does not un-stick unavailability). */
  reset: () => void;
}

function isUnavailableStatus(status: number): boolean {
  // Treat status 0 (network/CORS failure) as "feature unavailable" too.
  return status === 0 || UNAVAILABLE_STATUSES.has(status);
}

/**
 * Best-effort parse of an error payload from the BFF/gateway into an ApiError.
 * Falls back to a generic shape so the hook never throws on malformed bodies.
 */
function toApiError(status: number, body: unknown): ApiError {
  const record =
    typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
  const message =
    typeof record['error'] === 'string'
      ? (record['error'] as string)
      : typeof record['message'] === 'string'
        ? (record['message'] as string)
        : `Request failed with status ${status}`;
  const code =
    typeof record['code'] === 'string' ? (record['code'] as string) : `HTTP_${status}`;
  return { status, code, message };
}

async function readJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

export function useMagicLink(): UseMagicLinkReturn {
  const [isLoading, setIsLoading] = useState(false);
  const [isUnavailable, setIsUnavailable] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = useCallback(() => {
    setIsLoading(false);
    setError(null);
  }, []);

  const requestMagicLink = useCallback(
    async (email: string): Promise<MagicLinkRequestResult> => {
      setIsLoading(true);
      setError(null);
      try {
        const res = await fetch(MAGIC_LINK_REQUEST_ENDPOINT, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email }),
        });

        if (isUnavailableStatus(res.status)) {
          setIsUnavailable(true);
          return { sent: false, unavailable: true };
        }

        if (!res.ok) {
          const apiError = toApiError(res.status, await readJson(res));
          // Mirror forgot-password: never disclose whether the email exists.
          // A non-2xx that isn't an availability signal is still treated as
          // "sent" from the user's perspective to avoid enumeration leaks,
          // unless it is a clear client misuse (rate limiting).
          if (apiError.status === 429) {
            setError('Too many requests. Please wait a moment and try again.');
            return { sent: false, unavailable: false };
          }
          return { sent: true, unavailable: false };
        }

        return { sent: true, unavailable: false };
      } catch {
        // Network/CORS/throw → treat as unavailable, hide the feature.
        setIsUnavailable(true);
        return { sent: false, unavailable: true };
      } finally {
        setIsLoading(false);
      }
    },
    [],
  );

  const verifyMagicLink = useCallback(
    async (token: string): Promise<MagicLinkVerifyResult> => {
      setIsLoading(true);
      setError(null);
      try {
        const res = await fetch(MAGIC_LINK_VERIFY_ENDPOINT, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        });

        if (isUnavailableStatus(res.status)) {
          setIsUnavailable(true);
          return { verified: false, unavailable: true };
        }

        const body = await readJson(res);

        if (!res.ok) {
          const apiError = toApiError(res.status, body);
          setError(
            apiError.status === 410 || apiError.code === 'TOKEN_EXPIRED'
              ? 'This sign-in link has expired. Request a new one to continue.'
              : 'This sign-in link is invalid. Request a new one to continue.',
          );
          return { verified: false, unavailable: false };
        }

        const record =
          typeof body === 'object' && body !== null
            ? (body as Record<string, unknown>)
            : {};
        const requiresMFA = record['requires_mfa'] === true;
        const mfaToken =
          typeof record['mfa_token'] === 'string'
            ? (record['mfa_token'] as string)
            : undefined;

        return {
          verified: !requiresMFA,
          unavailable: false,
          requiresMFA,
          mfaToken,
        };
      } catch (err) {
        if (isApiError(err) && isUnavailableStatus(err.status)) {
          setIsUnavailable(true);
          return { verified: false, unavailable: true };
        }
        setIsUnavailable(true);
        return { verified: false, unavailable: true };
      } finally {
        setIsLoading(false);
      }
    },
    [],
  );

  return {
    isLoading,
    isUnavailable,
    error,
    requestMagicLink,
    verifyMagicLink,
    reset,
  };
}
