/**
 * URL + envelope + error-classification contract for the Lex AI assistant
 * client (LEX-LD-GAP-DESIGN §G4).
 *
 * Mirrors `request-approval-policies.test.ts`: `@/lib/api` is mocked at the
 * source so every call's URL, params and unwrapping are asserted directly.
 *
 * The classification half matters more than usual here. The assistant is the
 * one dashboard surface a deployment may not have AT ALL — `LEX_AI_ENABLED=false`
 * leaves `/lex/ai/*` unmounted, so its absence arrives as a 404 rather than a
 * feature-flag payload. Reading that 404 as an ordinary failure would put a
 * broken panel on every dashboard in every environment that has not turned the
 * assistant on.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

const { apiGetMock, apiPostMock } = vi.hoisted(() => ({
  apiGetMock: vi.fn(),
  apiPostMock: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  default: { get: vi.fn() },
  apiGet: apiGetMock,
  apiPost: apiPostMock,
}));

const {
  askLexAi,
  getLexAiSession,
  isLexAiProviderOffline,
  isLexAiRefusal,
  isLexAiSurfaceAbsent,
  isLexAiUngrounded,
  listLexAiSessions,
} = await import('./ai-client');

const BASE = '/api/v1/lex/ai';

function apiError(status: number, code: string) {
  return { status, code, message: 'boom' };
}

describe('Lex AI client — URL and envelope contract', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('lists sessions from the suite envelope, unbounded by default', async () => {
    const sessions = [{ id: 'session-1', title: 'Renewals' }];
    apiGetMock.mockResolvedValue({ data: { sessions } });

    const result = await listLexAiSessions();

    expect(apiGetMock).toHaveBeenCalledWith(`${BASE}/sessions`, undefined);
    expect(result.sessions).toEqual(sessions);
  });

  it('passes an explicit session limit through as a query param', async () => {
    apiGetMock.mockResolvedValue({ data: { sessions: [] } });

    await listLexAiSessions(5);

    expect(apiGetMock).toHaveBeenCalledWith(`${BASE}/sessions`, { limit: 5 });
  });

  it('reads one transcript by id, encoding the path segment', async () => {
    const transcript = { session: { id: 'a/b' }, messages: [] };
    apiGetMock.mockResolvedValue({ data: transcript });

    const result = await getLexAiSession('a/b');

    expect(apiGetMock).toHaveBeenCalledWith(`${BASE}/sessions/a%2Fb`, undefined);
    expect(result).toEqual(transcript);
  });

  it('posts a new-conversation turn WITHOUT a session id, and unwraps the result', async () => {
    apiPostMock.mockResolvedValue({ data: { session_id: 'session-9', answer: 'ok' } });

    const result = await askLexAi({ message: 'Which contracts expire?' });

    // Omitted, not sent as null: the server mints the id for a first turn.
    expect(apiPostMock).toHaveBeenCalledWith(`${BASE}/chat`, {
      message: 'Which contracts expire?',
    });
    expect(result.session_id).toBe('session-9');
  });

  it('threads a follow-up turn onto the open conversation', async () => {
    apiPostMock.mockResolvedValue({ data: { session_id: 'session-9' } });

    await askLexAi({ session_id: 'session-9', message: 'And the renewals?' });

    expect(apiPostMock).toHaveBeenCalledWith(`${BASE}/chat`, {
      message: 'And the renewals?',
      session_id: 'session-9',
    });
  });
});

describe('Lex AI client — error classification', () => {
  it('treats an unmounted route and a missing permission as an absent surface', () => {
    // LEX_AI_ENABLED=false → the routes are never registered → 404.
    expect(isLexAiSurfaceAbsent(apiError(404, 'NOT_FOUND'))).toBe(true);
    // No lex:ai:use → RequirePermission → 403.
    expect(isLexAiSurfaceAbsent(apiError(403, 'FORBIDDEN'))).toBe(true);
  });

  it('does NOT absorb a real outage as an absent surface', () => {
    // A network failure is a retryable fault of a surface this deployment HAS;
    // silently deleting the panel for it would hide a live incident.
    expect(isLexAiSurfaceAbsent({ status: 0, code: 'NETWORK_ERROR', message: 'x' })).toBe(false);
    expect(isLexAiSurfaceAbsent(apiError(500, 'INTERNAL_ERROR'))).toBe(false);
    expect(isLexAiSurfaceAbsent(apiError(503, 'AI_UNAVAILABLE'))).toBe(false);
    expect(isLexAiSurfaceAbsent(new Error('boom'))).toBe(false);
  });

  it('separates an unkeyed environment, a refusal, and an ungrounded caller', () => {
    expect(isLexAiProviderOffline(apiError(503, 'AI_UNAVAILABLE'))).toBe(true);
    expect(isLexAiProviderOffline(apiError(500, 'INTERNAL_ERROR'))).toBe(false);

    expect(isLexAiRefusal(apiError(422, 'AI_REFUSED'))).toBe(true);
    expect(isLexAiRefusal(apiError(400, 'VALIDATION_ERROR'))).toBe(false);

    expect(isLexAiUngrounded(apiError(403, 'FORBIDDEN'))).toBe(true);
    expect(isLexAiUngrounded(apiError(422, 'AI_REFUSED'))).toBe(false);
  });
});
