import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { LexMeResponse } from './types';

// ── Mocks ──────────────────────────────────────────────────────────────────
const { fetchLexMeMock, switchLexPersonaMock } = vi.hoisted(() => ({
  fetchLexMeMock: vi.fn(),
  switchLexPersonaMock: vi.fn(),
}));

vi.mock('./me', () => ({
  fetchLexMe: fetchLexMeMock,
  switchLexPersona: switchLexPersonaMock,
}));

import { LexContextProvider, useLexContext } from './use-lex-context';
import {
  getExternalPermissions,
  clearExternalPermissions,
  _resetPermissionsCache,
} from '@/stores/auth-store';

// Director persona: holds two roles so the switcher path is exercised.
const directorMe: LexMeResponse = {
  active_legal_role: {
    slug: 'legal-director',
    name_en: 'Legal Director',
    name_ar: 'مدير الإدارة القانونية',
    tier: 'Legal',
    org_unit: 'legal',
    escalation_level: 2,
  },
  available_legal_roles: [
    {
      slug: 'legal-director',
      name_en: 'Legal Director',
      name_ar: 'مدير الإدارة القانونية',
      tier: 'Legal',
      org_unit: 'legal',
      escalation_level: 2,
    },
    {
      slug: 'legal-auditor',
      name_en: 'Compliance Auditor',
      name_ar: 'مدقق الامتثال',
      tier: 'Oversight',
      org_unit: 'audit',
      escalation_level: 0,
    },
  ],
  effective_permissions: [
    'lex:case:view',
    'lex:case:approve',
    'lex:contract:view',
    'workflow:read',
    'workflow:task',
  ],
  permission_version: 'v-director',
  persona_landing: '/lex/command-center',
  capabilities: { can_handle_cases: true, can_approve_cases: true },
  access_state: 'READY',
};

const auditorMe: LexMeResponse = {
  active_legal_role: directorMe.available_legal_roles[1],
  available_legal_roles: directorMe.available_legal_roles,
  effective_permissions: [
    'lex:audit:read',
    'lex:report:read',
    'workflow:read',
    'workflow:task',
  ],
  permission_version: 'v-auditor',
  persona_landing: '/lex/compliance',
  capabilities: { can_audit: true },
  access_state: 'READY',
};

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      {/* forceEnabled bypasses the auth-store gating so the context fetches offline. */}
      <LexContextProvider forceEnabled>{children}</LexContextProvider>
    </QueryClientProvider>
  );
  return Wrapper;
}

describe('useLexContext', () => {
  beforeEach(() => {
    fetchLexMeMock.mockReset();
    switchLexPersonaMock.mockReset();
    clearExternalPermissions();
    _resetPermissionsCache();
  });

  afterEach(() => {
    clearExternalPermissions();
    _resetPermissionsCache();
  });

  it('fetches /lex/me, exposes the persona context, and hydrates effective_permissions', async () => {
    fetchLexMeMock.mockResolvedValue(directorMe);
    const { result } = renderHook(() => useLexContext(), { wrapper: makeWrapper() });

    await waitFor(() => expect(result.current.activeRole?.slug).toBe('legal-director'));

    expect(result.current.availableRoles).toHaveLength(2);
    expect(result.current.accessState).toBe('READY');
    expect(result.current.personaLanding).toBe('/lex/command-center');
    expect(result.current.effectivePermissions).toContain('lex:case:approve');

    // CRITICAL: effective_permissions were merged into the auth-store source.
    await waitFor(() =>
      expect(getExternalPermissions()).toEqual(
        expect.arrayContaining([
          'lex:case:view',
          'lex:case:approve',
          'lex:contract:view',
          'workflow:read',
          'workflow:task',
        ]),
      ),
    );
  });

  it('switchPersona POSTs /persona, refreshes the context, and re-hydrates perms', async () => {
    fetchLexMeMock.mockResolvedValue(directorMe);
    switchLexPersonaMock.mockResolvedValue(auditorMe);

    const { result } = renderHook(() => useLexContext(), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.activeRole?.slug).toBe('legal-director'));

    let returned: LexMeResponse | undefined;
    await act(async () => {
      returned = await result.current.switchPersona('legal-auditor');
    });

    expect(switchLexPersonaMock).toHaveBeenCalledWith('legal-auditor');
    expect(returned?.active_legal_role?.slug).toBe('legal-auditor');

    // Context now reflects the new persona…
    await waitFor(() => expect(result.current.activeRole?.slug).toBe('legal-auditor'));
    expect(result.current.personaLanding).toBe('/lex/compliance');

    // …and the merged perms swapped to the new persona's effective set.
    await waitFor(() =>
      expect(getExternalPermissions()).toEqual(
        expect.arrayContaining(['lex:audit:read', 'lex:report:read']),
      ),
    );
    expect(getExternalPermissions()).not.toContain('lex:case:approve');
  });

  it('exposes NO_LEX_ROLE_ASSIGNED and hydrates no perms for a non-legal user', async () => {
    fetchLexMeMock.mockResolvedValue({
      active_legal_role: null,
      available_legal_roles: [],
      effective_permissions: [],
      permission_version: '',
      persona_landing: '/dashboard',
      capabilities: {},
      access_state: 'NO_LEX_ROLE_ASSIGNED',
    } satisfies LexMeResponse);

    const { result } = renderHook(() => useLexContext(), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.accessState).toBe('NO_LEX_ROLE_ASSIGNED'));

    expect(result.current.activeRole).toBeNull();
    expect(getExternalPermissions()).toEqual([]);
  });
});
