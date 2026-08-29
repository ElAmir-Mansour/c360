import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  checkBreachedPassword,
  isBreachResolved,
  type BreachCheckResult,
} from './breached-password';

// Known SHA-1 of "password" (uppercase): 5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8
// prefix = "5BAA6", suffix = "1E4C9B93F3F0682250B6CF8331B7EE68FD8"
const PASSWORD_PREFIX = '5BAA6';
const PASSWORD_SUFFIX = '1E4C9B93F3F0682250B6CF8331B7EE68FD8';

function mockFetchText(status: number, body: string) {
  return vi.fn(async () =>
    Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      text: async () => body,
    } as unknown as Response),
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('checkBreachedPassword', () => {
  it('test_emptyPassword_shortCircuits: returns not-breached without fetch', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const result = await checkBreachedPassword('');
    expect(result).toEqual({ breached: false, count: 0 });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('test_sendsOnlyPrefix: never transmits the plaintext or full hash', async () => {
    const fetchSpy = mockFetchText(200, `${PASSWORD_SUFFIX}:42`);
    vi.stubGlobal('fetch', fetchSpy);

    await checkBreachedPassword('password');

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const firstCall = fetchSpy.mock.calls[0] as unknown[];
    const calledUrl = String(firstCall[0]);
    expect(calledUrl).toContain(`prefix=${PASSWORD_PREFIX}`);
    // The plaintext and the full hash/suffix must NOT appear in the request URL.
    expect(calledUrl).not.toContain('password');
    expect(calledUrl).not.toContain(PASSWORD_SUFFIX);
  });

  it('test_matchingSuffix_breached: suffix present with positive count', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetchText(200, `0000000000000000000000000000000000A:1\n${PASSWORD_SUFFIX}:42`),
    );
    const result = await checkBreachedPassword('password');
    expect(isBreachResolved(result)).toBe(true);
    expect(result).toEqual({ breached: true, count: 42 });
  });

  it('test_suffixCaseInsensitive: lowercase upstream suffix still matches', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetchText(200, `${PASSWORD_SUFFIX.toLowerCase()}:7`),
    );
    const result = await checkBreachedPassword('password');
    expect(result).toEqual({ breached: true, count: 7 });
  });

  it('test_noMatch_notBreached: suffix absent from range', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetchText(200, 'FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF:3'),
    );
    const result = await checkBreachedPassword('password');
    expect(result).toEqual({ breached: false, count: 0 });
  });

  it('test_501_unavailable: BFF stub (no upstream) degrades gracefully', async () => {
    vi.stubGlobal('fetch', mockFetchText(501, ''));
    const result = await checkBreachedPassword('password');
    expect(result).toEqual({ unavailable: true });
    expect(isBreachResolved(result)).toBe(false);
  });

  it('test_networkError_unavailable: fetch throw degrades gracefully', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down');
      }),
    );
    const result = await checkBreachedPassword('password');
    expect(result).toEqual({ unavailable: true });
  });

  it('test_noSubtleCrypto_unavailable: missing Web Crypto degrades gracefully', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    vi.stubGlobal('crypto', {} as Crypto);
    const result: BreachCheckResult = await checkBreachedPassword('password');
    expect(result).toEqual({ unavailable: true });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
