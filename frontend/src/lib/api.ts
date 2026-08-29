import axios, {
  AxiosError,
  InternalAxiosRequestConfig,
  AxiosResponse,
} from 'axios';
import { getAccessToken } from '@/lib/auth';
import { expireSession } from '@/lib/session-expiry';
import { refreshAccessToken } from '@/lib/session-refresh';
import { getActiveImpersonationToken } from '@/stores/impersonation-store';
import { getCSRFToken, requiresCSRF, CSRF_HEADER } from '@/lib/csrf';
import { getApiUrl } from '@/lib/env';
import { LOCALE_COOKIE_NAME } from '@/lib/i18n';
import type {
  ApiError,
  EntitlementRequiredEventDetail,
  PermissionDeniedEventDetail,
} from '@/types/api';

const API_URL = getApiUrl();
export const ENTITLEMENT_REQUIRED_EVENT = 'clario360:entitlement-required';
export const PERMISSION_DENIED_EVENT = 'clario360:permission-denied';

// Intentionally global: ALL backend list endpoints use Go's url.Values which
// reads repeated keys (type=sigma&type=threshold), not Axios's default bracket
// format (type[]=sigma&type[]=threshold). Every call through this instance —
// cyber rules, alerts, assets, threats, etc. — hits a splitQueryValues helper
// that requires the repeat format. Do not use a per-request override.
const api = axios.create({
  baseURL: API_URL,
  // Browser axios timeout — the OUTERMOST rung of the AI drafting/analysis
  // timeout ladder, so it must sit at/above every inner budget or it aborts a
  // call the backend would have completed. The old 60s ceiling sat BELOW the 90s
  // drafting budget and killed long-tail (>60s) generations mid-flight even when
  // the backend succeeded. Inside-out the ladder is:
  //   1. provider http.Client.Timeout — the governed LLM call (may bind tightest
  //      on buffered generators; the SSE clause stream sets no client deadline).
  //   2. LEX_LLM_TIMEOUT ~60s — lex drafting budget (drafter.go / clause_stream.go).
  //   3. GW_PROXY_TIMEOUT_SEC — gateway per-route proxy timeout (75s today; the
  //      lex route is raised to ~120s so it clears the 60s budget — see F18).
  //   4. lex SERVER_WRITE_TIMEOUT 150s.
  //   5. this timeout (browser) — kept at 150s so the browser is the last to give
  //      up and always surfaces the backend's own error/504 rather than an
  //      ECONNABORTED on a request the backend would have completed.
  timeout: 150000,
  paramsSerializer: {
    indexes: null, // repeat format: arr=a&arr=b (not arr[]=a&arr[]=b)
  },
});

// ── Request interceptor ──────────────────────────────────────────────────────

// Read the in-app locale preference (written by the theme/locale switcher). The
// app locale lives in the non-httpOnly `clario360_locale` cookie so both this
// client and the server can read it; browser only.
function readLocaleCookie(): string | null {
  if (typeof document === 'undefined') return null;
  const row = document.cookie
    .split('; ')
    .find((entry) => entry.startsWith(`${LOCALE_COOKIE_NAME}=`));
  if (!row) return null;
  const value = decodeURIComponent(row.slice(LOCALE_COOKIE_NAME.length + 1)).trim();
  return value || null;
}

api.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    // Attach access token (in-memory only — never localStorage).
    // When a platform operator has an active "view as tenant" grant, send the
    // short-TTL impersonation token instead so downstream calls are attributed
    // to the impersonated (read-only) session. Falls back to the normal token
    // when no grant is active or it has expired (see impersonation-store).
    const token = getActiveImpersonationToken() ?? getAccessToken();
    if (token && config.headers) {
      config.headers.Authorization = `Bearer ${token}`;
    }

    // Generate a unique request ID for tracing
    if (config.headers) {
      const reqId =
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : Math.random().toString(36).slice(2);
      config.headers['X-Request-ID'] = reqId;
    }

    // Set Content-Type only when body is present and not FormData
    if (
      config.data !== undefined &&
      config.data !== null &&
      !(config.data instanceof FormData) &&
      config.headers
    ) {
      config.headers['Content-Type'] = 'application/json';
    }

    // Attach CSRF token for state-changing methods (POST, PUT, PATCH, DELETE)
    if (config.method && requiresCSRF(config.method) && config.headers) {
      const csrfToken = getCSRFToken();
      if (csrfToken) {
        config.headers[CSRF_HEADER] = csrfToken;
      }
    }

    // Forward the in-app locale so the backend localizes error/UI copy to the
    // language toggle, not the browser's Accept-Language. ResolveLocale
    // (suiteapi/locale.go) prefers X-Locale over Accept-Language, so this makes
    // the app toggle authoritative for server-rendered messages.
    if (config.headers) {
      const locale = readLocaleCookie();
      if (locale) {
        config.headers['X-Locale'] = locale;
      }
    }

    return config;
  },
  (error: unknown) => Promise.reject(error),
);

// ── Token refresh queue (promise-based mutex) ────────────────────────────────

let isRefreshing = false;
let refreshSubscribers: Array<(token: string) => void> = [];
let refreshRejecters: Array<(err: unknown) => void> = [];

function subscribeTokenRefresh(onRefreshed: (token: string) => void, onFailed: (err: unknown) => void): void {
  refreshSubscribers.push(onRefreshed);
  refreshRejecters.push(onFailed);
}

function onRefreshSuccess(newToken: string): void {
  refreshSubscribers.forEach((cb) => cb(newToken));
  refreshSubscribers = [];
  refreshRejecters = [];
}

function onRefreshFailure(err: unknown): void {
  refreshRejecters.forEach((cb) => cb(err));
  refreshSubscribers = [];
  refreshRejecters = [];
}

// ── Response interceptor ─────────────────────────────────────────────────────

api.interceptors.response.use(
  (response: AxiosResponse) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & {
      _retry?: boolean;
    };

    // ── 401 handling ──────────────────────────────────────────────────────
    if (error.response?.status === 401) {
      const url = originalRequest?.url ?? '';

      // If the refresh route itself failed → the session is unrecoverable.
      // expireSession() clears the token + cookies, notifies every other open
      // tab (cross-tab logout), and hard-redirects this tab to /login carrying
      // the current location as `redirect` and `reason=session_expired`.
      if (url.includes('/api/auth/refresh') || url.includes('/api/v1/auth/refresh')) {
        expireSession();
        return rejectApiError(error);
      }

      // Login failures are intentional 401s — don't retry
      if (url.includes('/api/v1/auth/login')) {
        return rejectApiError(error);
      }

      // Already retried — don't retry again
      if (originalRequest._retry) {
        return rejectApiError(error);
      }

      if (isRefreshing) {
        // Queue this request until the ongoing refresh completes
        return new Promise<AxiosResponse>((resolve, reject) => {
          subscribeTokenRefresh(
            (newToken) => {
              if (originalRequest.headers) {
                originalRequest.headers.Authorization = `Bearer ${newToken}`;
              }
              resolve(api(originalRequest));
            },
            (err) => reject(err),
          );
        });
      }

      originalRequest._retry = true;
      isRefreshing = true;

      try {
        // Refresh via the shared serialized helper (lib/session-refresh), NOT a
        // direct POST. The backend rotates refresh tokens single-use and treats
        // a replay as theft — revoking every session for the user — so this must
        // never run concurrently with the auth watchdog's renewal.
        // `force` bypasses the cooldown: a 401 means the token we hold is bad
        // even if it was minted seconds ago.
        const result = await refreshAccessToken(true);

        if (result.status === 'terminal') {
          // Refresh cookie gone or rejected → the session is genuinely over.
          // Clear + broadcast to all tabs + hard-redirect (see session-expiry).
          onRefreshFailure(error);
          expireSession();
          return rejectApiError(error);
        }

        if (result.status === 'transient') {
          // The refresh didn't land (network blip, gateway 5xx, rate limit) but
          // the session may be perfectly alive. Fail THIS request — and flush
          // the queued ones — without logging the user out; the watchdog or the
          // next 401 retries the rotation.
          onRefreshFailure(error);
          return rejectApiError(error);
        }

        onRefreshSuccess(result.token);

        if (originalRequest.headers) {
          originalRequest.headers.Authorization = `Bearer ${result.token}`;
        }
        return api(originalRequest);
      } catch (refreshError) {
        // refreshAccessToken never throws; treat the unexpected as transient —
        // a logout must only ever come from a definitive backend rejection.
        onRefreshFailure(refreshError);
        return rejectApiError(error);
      } finally {
        isRefreshing = false;
      }
    }

    // ── Error transformation ──────────────────────────────────────────────
    return rejectApiError(error);
  },
);

function rejectApiError(error: AxiosError): Promise<never> {
  const apiError = buildApiError(error);
  dispatchEntitlementRequired(apiError);
  dispatchPermissionDenied(apiError, error.config?.method);
  return Promise.reject(apiError);
}

function buildApiError(error: AxiosError): ApiError {
  if (!error.response) {
    if (error.code === 'ECONNABORTED') {
      return {
        status: 408,
        code: 'TIMEOUT',
        message: 'Request timed out. Please try again.',
      };
    }
    return {
      status: 0,
      code: 'NETWORK_ERROR',
      message: 'Unable to connect to server. Please check your connection.',
    };
  }

  const body = error.response.data as Record<string, unknown> | null;
  const status = error.response.status;
  const nestedError =
    body?.['error'] && typeof body['error'] === 'object'
      ? (body['error'] as Record<string, unknown>)
      : null;
  const nestedDetails =
    nestedError?.['details'] && typeof nestedError['details'] === 'object'
      ? (nestedError['details'] as Record<string, unknown>)
      : null;
  const bodyDetails =
    body?.['details'] && typeof body['details'] === 'object'
      ? (body['details'] as Record<string, unknown>)
      : null;
  const fallbackMessage =
    typeof body?.['error'] === 'string' ? (body['error'] as string) : undefined;
  const planRequired = firstString(
    nestedError?.['plan_required'],
    body?.['plan_required'],
    nestedDetails?.['plan_required'],
    bodyDetails?.['plan_required'],
  );
  const upgradeUrl = firstString(
    nestedError?.['upgrade_url'],
    body?.['upgrade_url'],
    nestedDetails?.['upgrade_url'],
    bodyDetails?.['upgrade_url'],
  );
  const requiredPermission = firstString(
    nestedError?.['required_permission'],
    body?.['required_permission'],
  );
  const requiredPermissions =
    (Array.isArray(nestedError?.['required_permissions'])
      ? (nestedError?.['required_permissions'] as string[])
      : undefined) ??
    (Array.isArray(body?.['required_permissions'])
      ? (body?.['required_permissions'] as string[])
      : undefined);

  return {
    status,
    code:
      (nestedError?.['code'] as string | undefined) ??
      (body?.['code'] as string | undefined) ??
      `HTTP_${status}`,
    message:
      (nestedError?.['message'] as string | undefined) ??
      (body?.['message'] as string | undefined) ??
      fallbackMessage ??
      `Request failed with status ${status}`,
    details:
      (nestedError?.['details'] as Record<string, string[]> | undefined) ??
      (body?.['details'] as Record<string, string[]> | undefined) ??
      undefined,
    errors:
      (Array.isArray(nestedError?.['errors'])
        ? (nestedError?.['errors'] as ApiError['errors'])
        : undefined) ??
      (Array.isArray(body?.['errors'])
        ? (body?.['errors'] as ApiError['errors'])
        : undefined) ??
      undefined,
    request_id:
      (nestedError?.['request_id'] as string | undefined) ??
      (body?.['request_id'] as string | undefined) ??
      undefined,
    plan_required: planRequired,
    upgrade_url: upgradeUrl,
    required_permission: requiredPermission,
    required_permissions: requiredPermissions,
  };
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value;
    }
    if (Array.isArray(value)) {
      const nested = firstString(...value);
      if (nested) return nested;
    }
  }
  return undefined;
}

function dispatchEntitlementRequired(error: ApiError): void {
  if (
    typeof window === 'undefined' ||
    error.status !== 402 ||
    error.code !== 'ENTITLEMENT_REQUIRED'
  ) {
    return;
  }

  const detail: EntitlementRequiredEventDetail = {
    status: error.status,
    code: error.code,
    message: error.message,
    request_id: error.request_id,
    plan_required: error.plan_required,
    upgrade_url: error.upgrade_url,
  };
  window.dispatchEvent(new CustomEvent(ENTITLEMENT_REQUIRED_EVENT, { detail }));
}

// dispatchPermissionDenied surfaces a friendly "you don't have permission" toast
// for an authorization failure (403 FORBIDDEN). It fires ONLY for user-initiated
// MUTATIONS (POST/PUT/PATCH/DELETE) — a clicked action like instantiating a
// workflow — not for background GET polls / list loads (badge counters, etc.),
// which would otherwise spam toasts; those are handled by nav/suite scoping and
// page-level empty states. The detail carries the required permission so the UI
// can name the missing privilege and suggest who to contact.
function dispatchPermissionDenied(error: ApiError, method?: string): void {
  if (
    typeof window === 'undefined' ||
    error.status !== 403 ||
    error.code !== 'FORBIDDEN'
  ) {
    return;
  }
  const m = (method ?? 'get').toLowerCase();
  if (m === 'get' || m === 'head') {
    return;
  }
  const detail: PermissionDeniedEventDetail = {
    status: error.status,
    code: error.code,
    message: error.message,
    request_id: error.request_id,
    required_permission: error.required_permission,
    required_permissions: error.required_permissions,
  };
  window.dispatchEvent(new CustomEvent(PERMISSION_DENIED_EVENT, { detail }));
}

// ── Typed helpers ─────────────────────────────────────────────────────────────

export async function apiGet<T>(url: string, params?: Record<string, unknown> | object): Promise<T> {
  const response = await api.get<T>(url, { params });
  return response.data;
}

/**
 * Fetch a binary document (e.g. a regulator-ready CSV/PDF evidence export) as a
 * Blob with the authenticated request pipeline (Bearer token, CSRF, entitlement
 * handling) intact. The access token lives only in memory, so a plain anchor
 * download cannot authenticate; this routes the download through the same axios
 * instance and returns the Blob plus the server-suggested filename so the caller
 * can trigger a real client-side download.
 */
export async function apiGetBlob(
  url: string,
  params?: Record<string, unknown> | object,
): Promise<{ blob: Blob; filename: string | null }> {
  const response = await api.get<Blob>(url, { params, responseType: 'blob' });
  const disposition = response.headers['content-disposition'] as string | undefined;
  let filename: string | null = null;
  if (disposition) {
    const match = /filename="?([^"]+)"?/.exec(disposition);
    if (match) {
      filename = match[1];
    }
  }
  return { blob: response.data, filename };
}

export async function apiPost<T>(url: string, data?: unknown): Promise<T> {
  const response = await api.post<T>(url, data);
  return response.data;
}

export async function apiPut<T>(url: string, data?: unknown): Promise<T> {
  const response = await api.put<T>(url, data);
  return response.data;
}

export async function apiPatch<T>(url: string, data?: unknown): Promise<T> {
  const response = await api.patch<T>(url, data);
  return response.data;
}

export async function apiDelete<T>(url: string): Promise<T> {
  const response = await api.delete<T>(url);
  return response.data;
}

export async function apiUpload<T>(
  url: string,
  file: File,
  fields?: Record<string, string>,
  onUploadProgress?: (percent: number) => void,
): Promise<T> {
  const form = new FormData();
  form.append('file', file);
  if (fields) {
    Object.entries(fields).forEach(([k, v]) => form.append(k, v));
  }
  const response = await api.post<T>(url, form, {
    onUploadProgress: onUploadProgress
      ? (e) => {
          if (e.total) {
            onUploadProgress(Math.round((e.loaded * 100) / e.total));
          }
        }
      : undefined,
  });
  return response.data;
}

export default api;
