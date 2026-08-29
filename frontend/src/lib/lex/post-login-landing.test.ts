import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { LexMeResponse } from './types';

const { fetchLexMeMock } = vi.hoisted(() => ({ fetchLexMeMock: vi.fn() }));

vi.mock('./me', () => ({
  fetchLexMe: fetchLexMeMock,
  switchLexPersona: vi.fn(),
}));

import { resolvePostLoginLanding } from './post-login-landing';

function meWith(overrides: Partial<LexMeResponse>): LexMeResponse {
  return {
    active_legal_role: {
      slug: 'legal-officer',
      name_en: 'Legal Officer',
      name_ar: 'موظف قانوني',
      tier: 'Legal',
      org_unit: null,
      escalation_level: 0,
    },
    available_legal_roles: [],
    effective_permissions: [],
    permission_version: 'v1',
    persona_landing: '/lex/my-work',
    capabilities: {},
    access_state: 'READY',
    ...overrides,
  };
}

describe('resolvePostLoginLanding', () => {
  beforeEach(() => {
    fetchLexMeMock.mockReset();
  });

  it('honours an explicit (non-default) redirect WITHOUT fetching /lex/me', async () => {
    const result = await resolvePostLoginLanding({ redirectTo: '/cyber/alerts' });
    expect(result).toBe('/cyber/alerts');
    expect(fetchLexMeMock).not.toHaveBeenCalled();
  });

  it('upgrades the bare /dashboard default to the persona landing for a legal user', async () => {
    // persona_landing /lex/my-work is not a built route → falls back to /lex.
    fetchLexMeMock.mockResolvedValue(meWith({ persona_landing: '/lex/my-work' }));
    const result = await resolvePostLoginLanding({ redirectTo: '/dashboard' });
    expect(result).toBe('/lex');
  });

  it('routes to the persona landing when it IS a built route', async () => {
    fetchLexMeMock.mockResolvedValue(meWith({ persona_landing: '/lex/cases' }));
    const result = await resolvePostLoginLanding({ redirectTo: '/dashboard' });
    expect(result).toBe('/lex/cases');
  });

  it('leaves a non-legal user on /dashboard (NO_LEX_ROLE_ASSIGNED)', async () => {
    fetchLexMeMock.mockResolvedValue(
      meWith({ access_state: 'NO_LEX_ROLE_ASSIGNED', active_legal_role: null }),
    );
    const result = await resolvePostLoginLanding({ redirectTo: '/dashboard' });
    expect(result).toBe('/dashboard');
  });

  it('falls back to the supplied redirect when /lex/me fails (never rejects)', async () => {
    fetchLexMeMock.mockRejectedValue({ status: 403, code: 'NO_LEX_ENTITLEMENT' });
    const result = await resolvePostLoginLanding({ redirectTo: '/dashboard' });
    expect(result).toBe('/dashboard');
  });
});
