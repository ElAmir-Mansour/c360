import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { gatewayFetch } from '@/lib/bff-proxy';
import { GET } from './route';

vi.mock('@/lib/bff-proxy', () => ({
  buildForwardHeaders: vi.fn(() => ({ Accept: 'application/json' })),
  gatewayFetch: vi.fn(),
  safeJson: vi.fn(async (response: Response) => response.json()),
}));

function request(path: string): NextRequest {
  return new NextRequest(new URL(path, 'http://localhost:3000'));
}

describe('GET /api/auth/sso/discover', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns an empty 200 response when the domain is missing', async () => {
    const response = await GET(request('/api/auth/sso/discover'));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      provider: null,
      authorizeUrl: null,
    });
    expect(gatewayFetch).not.toHaveBeenCalled();
  });

  it('treats upstream 404 no-mapping as an empty 200 response', async () => {
    vi.mocked(gatewayFetch).mockResolvedValue({
      ok: false,
      networkError: false,
      status: 404,
      response: new Response(null, { status: 404 }),
    });

    const response = await GET(
      request('/api/auth/sso/discover?domain=ApexBank.Demo'),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      provider: null,
      authorizeUrl: null,
    });
    expect(gatewayFetch).toHaveBeenCalledWith(
      '/api/v1/auth/sso/discover?domain=apexbank.demo',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('normalizes a mapped upstream provider response', async () => {
    vi.mocked(gatewayFetch).mockResolvedValue({
      ok: true,
      status: 200,
      response: Response.json({
        provider: 'saml',
        authorize_url: 'https://idp.example.test/sso',
      }),
    });

    const response = await GET(
      request('/api/auth/sso/discover?domain=clario.dev'),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      provider: 'saml',
      authorizeUrl: 'https://idp.example.test/sso',
    });
  });
});
