import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { InternalAxiosRequestConfig } from 'axios';

// The request interceptor in lib/api.ts reads two non-hook accessors to decide
// which bearer to attach:
//   getActiveImpersonationToken() (impersonation-store)  — preferred when active
//   getAccessToken()             (auth)                  — normal fallback
// We mock both seams, then drive the real interceptor and assert the resulting
// Authorization header.
const getActiveImpersonationToken = vi.fn<() => string | null>(() => null);
const getAccessToken = vi.fn<() => string | null>(() => null);

vi.mock('@/stores/impersonation-store', () => ({
  getActiveImpersonationToken: () => getActiveImpersonationToken(),
}));

vi.mock('@/lib/auth', () => ({
  getAccessToken: () => getAccessToken(),
  setAccessToken: vi.fn(),
  clearAccessToken: vi.fn(),
}));

// CSRF is irrelevant to the auth-header assertions; keep it inert.
vi.mock('@/lib/csrf', () => ({
  getCSRFToken: () => null,
  requiresCSRF: () => false,
  CSRF_HEADER: 'X-CSRF-Token',
}));

vi.mock('@/lib/env', () => ({
  getApiUrl: () => 'http://localhost:8080',
}));

// Import after mocks so the interceptor closes over the mocked accessors.
import api from './api';
import { ENTITLEMENT_REQUIRED_EVENT } from './api';
import { AxiosHeaders } from 'axios';

// The interceptor is registered as the first request fulfilled handler.
type FulfilledFn = (
  config: InternalAxiosRequestConfig,
) => InternalAxiosRequestConfig;
type RejectedFn = (error: unknown) => Promise<never>;

function runRequestInterceptor(
  partial: Partial<InternalAxiosRequestConfig> = {},
): InternalAxiosRequestConfig {
  const handler = (api.interceptors.request as unknown as {
    handlers: Array<{ fulfilled: FulfilledFn } | null>;
  }).handlers.find((h) => h && typeof h.fulfilled === 'function');

  if (!handler) throw new Error('request interceptor not registered');

  const config = {
    headers: new AxiosHeaders(),
    method: 'get',
    url: '/api/v1/anything',
    ...partial,
  } as InternalAxiosRequestConfig;

  return handler.fulfilled(config);
}

function runResponseErrorInterceptor(error: unknown): Promise<never> {
  const handler = (api.interceptors.response as unknown as {
    handlers: Array<{ rejected?: RejectedFn } | null>;
  }).handlers.find((h) => h && typeof h.rejected === 'function');

  if (!handler?.rejected) throw new Error('response error interceptor not registered');
  return handler.rejected(error);
}

describe('lib/api request interceptor — impersonation-aware bearer', () => {
  beforeEach(() => {
    getActiveImpersonationToken.mockReset().mockReturnValue(null);
    getAccessToken.mockReset().mockReturnValue(null);
  });

  it('uses the normal access token when no impersonation grant is active', () => {
    getActiveImpersonationToken.mockReturnValue(null);
    getAccessToken.mockReturnValue('normal-access-token');

    const config = runRequestInterceptor();

    expect(config.headers.Authorization).toBe('Bearer normal-access-token');
    expect(getActiveImpersonationToken).toHaveBeenCalled();
  });

  it('uses the impersonation token when a grant is active (overrides access token)', () => {
    getActiveImpersonationToken.mockReturnValue('impersonation-token');
    getAccessToken.mockReturnValue('normal-access-token');

    const config = runRequestInterceptor();

    expect(config.headers.Authorization).toBe('Bearer impersonation-token');
  });

  it('does not fall through to the access token while impersonating', () => {
    getActiveImpersonationToken.mockReturnValue('impersonation-token');
    getAccessToken.mockReturnValue('normal-access-token');

    runRequestInterceptor();

    // The nullish-coalescing short-circuits before getAccessToken is consulted.
    expect(getAccessToken).not.toHaveBeenCalled();
  });

  it('sets no Authorization header when neither token exists', () => {
    getActiveImpersonationToken.mockReturnValue(null);
    getAccessToken.mockReturnValue(null);

    const config = runRequestInterceptor();

    expect(config.headers.Authorization).toBeUndefined();
  });

  it('always stamps a request id regardless of token source', () => {
    getAccessToken.mockReturnValue('normal-access-token');
    const config = runRequestInterceptor();
    expect(config.headers['X-Request-ID']).toBeTruthy();
  });
});

describe('lib/api response interceptor — entitlement upsell metadata', () => {
  beforeEach(() => {
    getActiveImpersonationToken.mockReset().mockReturnValue(null);
    getAccessToken.mockReset().mockReturnValue(null);
  });

  it('preserves 402 entitlement metadata and dispatches an upsell event', async () => {
    const listener = vi.fn();
    window.addEventListener(ENTITLEMENT_REQUIRED_EVENT, listener);

    await expect(
      runResponseErrorInterceptor({
        config: { url: '/api/v1/lex/contracts' },
        response: {
          status: 402,
          data: {
            error: {
              code: 'ENTITLEMENT_REQUIRED',
              message: 'your plan does not include this feature',
              request_id: 'req-1',
              plan_required: 'app.watheeq',
              upgrade_url: '/register?suites=lex&plan=trial',
            },
          },
        },
      }),
    ).rejects.toMatchObject({
      status: 402,
      code: 'ENTITLEMENT_REQUIRED',
      plan_required: 'app.watheeq',
      upgrade_url: '/register?suites=lex&plan=trial',
    });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0]?.[0]).toMatchObject({
      detail: {
        plan_required: 'app.watheeq',
        upgrade_url: '/register?suites=lex&plan=trial',
      },
    });

    window.removeEventListener(ENTITLEMENT_REQUIRED_EVENT, listener);
  });
});
