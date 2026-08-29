import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { RecoverProductView } from '@/types/recover';

// Mock the cookie store and env so the server module resolves a token + base URL.
let mockAccessToken: string | undefined = 'tok-123';
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === 'clario360_access' && mockAccessToken
        ? { value: mockAccessToken }
        : undefined,
  }),
}));
vi.mock('@/lib/env', () => ({
  getServerApiUrl: () => 'http://gateway.test',
}));

import {
  fetchRecoverProducts,
  resolveRecoverGuard,
  isRecoverSubSolutionSlug,
} from './products.server';

function productView(active: Record<string, boolean>): RecoverProductView {
  return {
    product: 'recover',
    label: 'Clario Recover',
    sub_solutions: (['it-dr', 'cloud-dr', 'cyber-recovery'] as const).map((id) => ({
      id,
      label: id,
      value_prop: 'vp',
      entitlement_key: `recover.${id}`,
      entitlement: { key: `recover.${id}`, active: active[id] ?? false, activated: false, reason: active[id] ? '' : 'plan does not include this' },
      capabilities: [],
    })),
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const fetchMock = vi.fn();

beforeEach(() => {
  mockAccessToken = 'tok-123';
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('isRecoverSubSolutionSlug', () => {
  it('accepts the three contract slugs and rejects others', () => {
    expect(isRecoverSubSolutionSlug('it-dr')).toBe(true);
    expect(isRecoverSubSolutionSlug('cloud-dr')).toBe(true);
    expect(isRecoverSubSolutionSlug('cyber-recovery')).toBe(true);
    expect(isRecoverSubSolutionSlug('bogus')).toBe(false);
    expect(isRecoverSubSolutionSlug('dr')).toBe(false);
  });
});

describe('fetchRecoverProducts', () => {
  it('forwards the access cookie as a bearer to the products endpoint', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: productView({ 'it-dr': true }) }));

    const outcome = await fetchRecoverProducts();

    expect(outcome.status).toBe('ok');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://gateway.test/api/recover/products');
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: 'Bearer tok-123',
    });
  });

  it('reports unauthenticated when no session cookie is present', async () => {
    mockAccessToken = undefined;
    const outcome = await fetchRecoverProducts();
    expect(outcome.status).toBe('unauthenticated');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('maps a 401 to unauthenticated', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'unauthorized' }, 401));
    expect((await fetchRecoverProducts()).status).toBe('unauthenticated');
  });

  it('maps a 503 (licensing outage) to unavailable — fail closed', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'entitlement_unavailable' }, 503));
    const outcome = await fetchRecoverProducts();
    expect(outcome.status).toBe('unavailable');
  });

  it('maps a network error to unavailable — fail closed', async () => {
    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    expect((await fetchRecoverProducts()).status).toBe('unavailable');
  });

  it('treats a malformed body as unavailable rather than granting access', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: { product: 'recover' } }));
    expect((await fetchRecoverProducts()).status).toBe('unavailable');
  });
});

describe('resolveRecoverGuard — server-side entitlement enforcement', () => {
  it('GRANTS access to a licensed sub-solution', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: productView({ 'it-dr': true }) }));
    const decision = await resolveRecoverGuard('it-dr');
    expect(decision.status).toBe('granted');
    if (decision.status === 'granted') {
      expect(decision.subSolution.id).toBe('it-dr');
    }
  });

  it('DENIES (rejects) an unlicensed sub-solution — not merely hidden', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: productView({ 'it-dr': true }) }));
    const decision = await resolveRecoverGuard('cloud-dr');
    expect(decision.status).toBe('denied');
    if (decision.status === 'denied') {
      expect(decision.subSolution?.entitlement.active).toBe(false);
      expect(decision.subSolution?.entitlement.reason).toContain('plan does not include');
    }
  });

  it('DENIES when the slug is absent from the product view', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        data: { product: 'recover', label: 'Clario Recover', sub_solutions: [] },
      }),
    );
    const decision = await resolveRecoverGuard('it-dr');
    expect(decision.status).toBe('denied');
  });

  it('fails CLOSED (unavailable) on a licensing outage — never silently grants', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'entitlement_unavailable' }, 503));
    const decision = await resolveRecoverGuard('it-dr');
    expect(decision.status).toBe('unavailable');
  });

  it('reports unauthenticated when there is no session', async () => {
    mockAccessToken = undefined;
    const decision = await resolveRecoverGuard('it-dr');
    expect(decision.status).toBe('unauthenticated');
  });
});
