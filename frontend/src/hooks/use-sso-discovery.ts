'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * SSO discovery by email domain (capability #7) — graceful.
 *
 * `useSsoDiscovery()` exposes a debounced `discover(email)` that:
 *   1. Extracts the domain from the email (everything after the last `@`).
 *   2. GETs the BFF route `/api/auth/sso/discover?domain=...` (relative URL +
 *      `credentials: 'include'`, never the axios `api` instance — that targets
 *      the gateway base URL, not the Next.js BFF).
 *   3. Resolves to `{ provider, authorizeUrl }` when the org has enterprise SSO,
 *      or `null` when there's no mapping / the feature is unavailable.
 *
 * Graceful degradation: any 404 (no mapping), 501 (backend not built), non-2xx,
 * malformed payload, or network error resolves to `null` and clears state, so
 * the UI can simply hide the SSO CTA. It never throws.
 *
 * The debounce (~400ms) coalesces keystrokes; in-flight requests are aborted
 * when a newer `discover()` call supersedes them, so only the latest email's
 * result is ever applied.
 */

const DEBOUNCE_MS = 400;
const BFF_DISCOVER_PATH = '/api/auth/sso/discover';

export interface SsoDiscovery {
  provider: string;
  authorizeUrl: string;
}

export interface UseSsoDiscoveryResult {
  /** Debounced. Pass the current email; domain is extracted internally. */
  discover: (email: string) => void;
  /** Cancels any pending debounce + in-flight request and clears state. */
  reset: () => void;
  /** Latest successful discovery, or null when none / unavailable. */
  discovery: SsoDiscovery | null;
  /** True while a discovery request is in flight. */
  isDiscovering: boolean;
}

/**
 * Extracts a normalized email domain, or null when the input is not a plausibly
 * complete email (no `@`, empty/blank domain, or domain without a dot).
 */
export function extractEmailDomain(email: string): string | null {
  const trimmed = email.trim().toLowerCase();
  const at = trimmed.lastIndexOf('@');
  if (at <= 0 || at === trimmed.length - 1) return null;
  const domain = trimmed.slice(at + 1);
  // Require at least one dot so we don't fire on half-typed domains ("acme").
  if (!domain.includes('.')) return null;
  // Reject obviously-incomplete domains ending in a dot ("acme.").
  if (domain.endsWith('.')) return null;
  return domain;
}

function normalize(raw: unknown): SsoDiscovery | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const provider = obj['provider'];
  const authorizeUrl = obj['authorizeUrl'];
  if (
    typeof provider !== 'string' ||
    provider.length === 0 ||
    typeof authorizeUrl !== 'string' ||
    authorizeUrl.length === 0
  ) {
    return null;
  }
  return { provider, authorizeUrl };
}

export function useSsoDiscovery(): UseSsoDiscoveryResult {
  const [discovery, setDiscovery] = useState<SsoDiscovery | null>(null);
  const [isDiscovering, setIsDiscovering] = useState(false);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Tracks which domain is "current" so a slow earlier request can't clobber
  // the result of a later one (last-write-wins keyed by domain).
  const activeDomainRef = useRef<string | null>(null);
  const mountedRef = useRef(true);

  const cancelPending = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
  }, []);

  const reset = useCallback(() => {
    cancelPending();
    activeDomainRef.current = null;
    if (mountedRef.current) {
      setDiscovery(null);
      setIsDiscovering(false);
    }
  }, [cancelPending]);

  const runDiscovery = useCallback(async (domain: string) => {
    const controller = new AbortController();
    abortRef.current = controller;
    activeDomainRef.current = domain;

    if (mountedRef.current) setIsDiscovering(true);

    let result: SsoDiscovery | null = null;
    try {
      const res = await fetch(
        `${BFF_DISCOVER_PATH}?domain=${encodeURIComponent(domain)}`,
        {
          method: 'GET',
          credentials: 'include',
          headers: { Accept: 'application/json' },
          signal: controller.signal,
        },
      );
      // 404 (no mapping), 501 (not built), or any other non-2xx => null.
      if (res.ok) {
        const data = (await res.json()) as unknown;
        result = normalize(data);
      }
    } catch {
      // Aborted request or network error => treat as no discovery.
      result = null;
    }

    // Ignore stale responses: a newer discover() may have changed the domain.
    if (controller.signal.aborted || activeDomainRef.current !== domain) {
      return;
    }
    if (!mountedRef.current) return;

    setDiscovery(result);
    setIsDiscovering(false);
    abortRef.current = null;
  }, []);

  const discover = useCallback(
    (email: string) => {
      cancelPending();

      const domain = extractEmailDomain(email);
      if (!domain) {
        // Not a usable domain yet — clear any prior result without firing.
        activeDomainRef.current = null;
        if (mountedRef.current) {
          setDiscovery(null);
          setIsDiscovering(false);
        }
        return;
      }

      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        void runDiscovery(domain);
      }, DEBOUNCE_MS);
    },
    [cancelPending, runDiscovery],
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      cancelPending();
    };
  }, [cancelPending]);

  return { discover, reset, discovery, isDiscovering };
}
