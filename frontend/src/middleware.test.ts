import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';
import { middleware } from '@/middleware';
import { COOKIES } from '@/lib/constants';

function base64Url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function token(expOffsetSeconds = 3600): string {
  const exp = Math.floor(Date.now() / 1000) + expOffsetSeconds;
  return `${base64Url({ alg: 'none', typ: 'JWT' })}.${base64Url({ exp })}.signature`;
}

function request(path: string, accessToken?: string): NextRequest {
  const headers = new Headers();
  if (accessToken) {
    headers.set('cookie', `${COOKIES.ACCESS}=${accessToken}`);
  }
  return new NextRequest(new URL(path, 'http://localhost:3000'), { headers });
}

function rewrittenPath(response: Response): string | null {
  const rewrite = response.headers.get('x-middleware-rewrite');
  return rewrite ? new URL(rewrite).pathname : null;
}

/**
 * Build a request as it arrives after nginx: the socket/host resolves to the
 * internal loopback (`127.0.0.1:3010`) but the proxy forwards the public host
 * and scheme via `X-Forwarded-Host` / `X-Forwarded-Proto`.
 */
function proxiedRequest(
  path: string,
  opts: {
    forwardedHost: string;
    forwardedProto: string;
    accessToken?: string;
  },
): NextRequest {
  const headers = new Headers();
  headers.set('host', '127.0.0.1:3010');
  headers.set('x-forwarded-host', opts.forwardedHost);
  headers.set('x-forwarded-proto', opts.forwardedProto);
  if (opts.accessToken) {
    headers.set('cookie', `${COOKIES.ACCESS}=${opts.accessToken}`);
  }
  // The Node server is reached on the internal loopback origin.
  return new NextRequest(new URL(path, 'http://127.0.0.1:3010'), { headers });
}

describe('middleware public/app platform boundary', () => {
  it.each(['/platform', '/platform/workflow'])(
    'rewrites authenticated %s to the internal console while preserving browser URL',
    async (path) => {
      const response = await middleware(request(path, token()));

      expect(response.headers.get('location')).toBeNull();
      expect(rewrittenPath(response)).toBe(`/console${path}`);
    },
  );

  it.each(['/platform', '/platform/workflow'])(
    'lets unauthenticated %s continue to the public marketing route',
    async (path) => {
      const response = await middleware(request(path));

      expect(response.headers.get('location')).toBeNull();
      expect(response.headers.get('x-middleware-rewrite')).toBeNull();
    },
  );

  it.each(['/console/platform', '/console/platform/workflow'])(
    'protects direct internal console access at %s',
    async (path) => {
      const response = await middleware(request(path));
      const location = response.headers.get('location');

      expect(response.status).toBe(307);
      expect(location).not.toBeNull();
      expect(new URL(location as string).pathname).toBe('/login');
      expect(new URL(location as string).searchParams.get('redirect')).toBe(path);
    },
  );

  it.each(['/not-a-real-marketing-route', '/missing/public/page'])(
    'lets unknown public-looking route %s continue to Next.js 404 handling',
    async (path) => {
      const response = await middleware(request(path));

      expect(response.headers.get('location')).toBeNull();
      expect(response.headers.get('x-middleware-rewrite')).toBeNull();
    },
  );

  it.each(['/dashboard/missing', '/cyber/missing', '/dr/missing'])(
    'keeps authenticated app prefix %s protected',
    async (path) => {
      const response = await middleware(request(path));
      const location = response.headers.get('location');

      expect(response.status).toBe(307);
      expect(location).not.toBeNull();
      expect(new URL(location as string).pathname).toBe('/login');
      expect(new URL(location as string).searchParams.get('redirect')).toBe(path);
    },
  );

  it('serves the public marketing home at / for anonymous visitors', async () => {
    const response = await middleware(request('/'));

    expect(response.headers.get('location')).toBeNull();
    expect(response.headers.get('x-middleware-rewrite')).toBeNull();
  });

  it('redirects authenticated / requests to the dashboard', async () => {
    const response = await middleware(request('/', token()));
    const location = response.headers.get('location');

    expect(response.status).toBe(307);
    expect(location).not.toBeNull();
    expect(new URL(location as string).pathname).toBe('/dashboard');
  });

  it('redirects an unauthenticated proxied request to the PUBLIC origin, not the internal loopback', async () => {
    const response = await middleware(
      proxiedRequest('/dashboard', {
        forwardedHost: 'devops.ofpsplatform.com',
        forwardedProto: 'https',
      }),
    );

    const location = response.headers.get('location');
    expect(response.status).toBe(307);
    expect(location).not.toBeNull();

    const url = new URL(location as string);
    // Public origin reconstructed from X-Forwarded-Host / X-Forwarded-Proto…
    expect(url.origin).toBe('https://devops.ofpsplatform.com');
    expect(url.host).not.toContain('127.0.0.1');
    expect(url.host).not.toContain('3010');
    // …and the post-login redirect query is preserved.
    expect(url.pathname).toBe('/login');
    expect(url.searchParams.get('redirect')).toBe('/dashboard');
  });

  it('redirects an authenticated proxied / request to the dashboard on the PUBLIC origin', async () => {
    const response = await middleware(
      proxiedRequest('/', {
        forwardedHost: 'devops.ofpsplatform.com',
        forwardedProto: 'https',
        accessToken: token(),
      }),
    );

    const location = response.headers.get('location');
    expect(response.status).toBe(307);
    expect(location).not.toBeNull();

    const url = new URL(location as string);
    expect(url.origin).toBe('https://devops.ofpsplatform.com');
    expect(url.pathname).toBe('/dashboard');
  });

  it('does not call the refresh endpoint when a valid access token is present', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    await middleware(request('/platform/observability', token()));

    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
