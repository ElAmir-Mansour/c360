'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiGet, apiPost } from '@/lib/api';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import {
  type LexBilingual,
  resolveLexBilingual,
} from '@/app/(dashboard)/lex/_lib/lex-i18n';
import type { AppLocale } from '@/lib/i18n';

/** Bilingual fallback surfaced via the `error` state when no message is present. */
const LOAD_ERROR_FALLBACK: LexBilingual<string> = {
  en: 'Failed to load Lex access context.',
  ar: 'تعذّر تحميل سياق صلاحيات الوصول إلى وثيق.',
};

/**
 * Lex persona/access context consumed by the access-denied UX and the route
 * guard (§4 Effective Lex Session Contract, §15 Access-Denied UX).
 *
 * This is a SELF-CONTAINED reader for `GET /api/v1/lex/me` scoped to the
 * access-guard surface. It intentionally does NOT define a React context /
 * provider (that surface is owned elsewhere): the access-denied page needs the
 * active legal role + the list of available legal roles to render a helpful
 * "Switch persona" affordance, and it fetches that on demand. Backend remains
 * the security boundary; this only powers UX copy + the persona switch.
 *
 * The suite API returns a `{ data: ... }` envelope, so every read unwraps `.data`
 * exactly like the rest of the lex frontend (see org-audit-api.ts).
 */

/** §4 LegalRoleSummary. */
export interface LegalRoleSummary {
  slug: string;
  name_en: string;
  name_ar: string;
  tier: 'Business' | 'Legal' | 'Oversight' | 'Admin' | string;
  org_unit: string | null;
  escalation_level: number;
}

export type LexAccessState = 'READY' | 'NO_LEX_ROLE_ASSIGNED' | string;

/** §4 LexMeResponse (the fields the access UX needs). */
export interface LexMeResponse {
  tenant_id: string;
  user_id: string;
  active_legal_role: LegalRoleSummary | null;
  available_legal_roles: LegalRoleSummary[];
  effective_permissions: string[];
  permission_version: string;
  persona_landing: string;
  capabilities: Record<string, boolean>;
  access_state: LexAccessState;
}

const LEX_ME_ENDPOINT = '/api/v1/lex/me';
const LEX_PERSONA_ENDPOINT = '/api/v1/lex/persona';

/** Unwrap the suite API `{ data }` envelope, tolerating a bare object too. */
function unwrap<T>(payload: unknown): T {
  if (
    payload &&
    typeof payload === 'object' &&
    'data' in (payload as Record<string, unknown>)
  ) {
    return (payload as { data: T }).data;
  }
  return payload as T;
}

export interface UseLexAccessResult {
  me: LexMeResponse | null;
  isLoading: boolean;
  /** True once the first /me read has settled (success or failure). */
  isResolved: boolean;
  error: string | null;
  /** Re-fetch /me. */
  refresh: () => Promise<void>;
  /**
   * Switch the active legal persona (§15 "Switch persona"). Resolves to the
   * refreshed /me on success; throws on 403 PERSONA_NOT_AVAILABLE / network.
   */
  switchPersona: (roleSlug: string) => Promise<LexMeResponse>;
}

/**
 * Read the caller's Lex persona context. `enabled=false` skips the network
 * call entirely (used by the guard while still deciding whether the user is
 * even authenticated/unpermitted, so we never fetch for a permitted route).
 */
export function useLexAccess(enabled = true): UseLexAccessResult {
  const [me, setMe] = useState<LexMeResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isResolved, setIsResolved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  // Track the active locale in a ref so `refresh` (and the error fallback it
  // builds) stays identity-stable and does not re-fetch /me on a locale toggle.
  const { locale } = useLocaleOrDefault();
  const localeRef = useRef<AppLocale>(locale);
  localeRef.current = locale;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const payload = await apiGet<unknown>(LEX_ME_ENDPOINT);
      if (!mounted.current) return;
      setMe(unwrap<LexMeResponse>(payload));
    } catch (err) {
      if (!mounted.current) return;
      setError(extractMessage(err, localeRef.current));
    } finally {
      if (mounted.current) {
        setIsLoading(false);
        setIsResolved(true);
      }
    }
  }, []);

  const switchPersona = useCallback(async (roleSlug: string) => {
    const payload = await apiPost<unknown>(LEX_PERSONA_ENDPOINT, {
      role_slug: roleSlug,
    });
    const next = unwrap<LexMeResponse>(payload);
    if (mounted.current) setMe(next);
    return next;
  }, []);

  useEffect(() => {
    if (!enabled) {
      setIsResolved(true);
      return;
    }
    void refresh();
  }, [enabled, refresh]);

  return { me, isLoading, isResolved, error, refresh, switchPersona };
}

function extractMessage(err: unknown, locale: AppLocale): string {
  if (err && typeof err === 'object' && 'message' in err) {
    return String((err as { message: unknown }).message);
  }
  return resolveLexBilingual(LOAD_ERROR_FALLBACK, locale);
}
