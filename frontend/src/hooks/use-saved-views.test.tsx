/**
 * useSavedViews — server persistence (#12) regression tests.
 *
 * The load-bearing guarantee: server mode is OPT-IN. Callers that pass no
 * `persistence` keep the exact localStorage behaviour, and a server-mode hook
 * never touches the `views:<routeKey>` blobs of OTHER namespaces (nor its
 * own — server views live on the backend; only the tiny per-user
 * `views:<routeKey>:my-default` marker is device-local).
 */

import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SavedViewsBar } from '@/components/shared/saved-views-bar';
import {
  createSavedView,
  deleteSavedView,
  listSavedViews,
  updateSavedView,
  type ServerSavedView,
} from '@/lib/lex/saved-views';
import { useSavedViews } from './use-saved-views';

const authState = vi.hoisted(() => ({
  userId: 'user-1' as string | null,
  perms: new Set<string>(),
  roleSlug: 'legal-director' as string | null,
  personaLoading: false,
}));

vi.mock('@/lib/lex/saved-views', () => ({
  listSavedViews: vi.fn(),
  createSavedView: vi.fn(),
  updateSavedView: vi.fn(),
  deleteSavedView: vi.fn(),
}));

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    user: authState.userId ? { id: authState.userId } : null,
    hasPermission: (p: string) => authState.perms.has(p),
  }),
}));

vi.mock('@/lib/lex/use-lex-context', () => ({
  useLexContext: () => ({
    activeRole: authState.roleSlug ? { slug: authState.roleSlug } : null,
    loading: authState.personaLoading,
  }),
}));

const mockList = vi.mocked(listSavedViews);
const mockCreate = vi.mocked(createSavedView);
const mockUpdate = vi.mocked(updateSavedView);
const mockDelete = vi.mocked(deleteSavedView);

function serverRow(overrides: Partial<ServerSavedView> = {}): ServerSavedView {
  return {
    id: 'sv-1',
    tenant_id: 'tenant-1',
    owner_user_id: 'user-1',
    namespace: 'lex-contracts',
    name: 'Expiring soon',
    scope: 'personal',
    role_slug: null,
    payload: { filters: { status: 'active' } },
    created_at: '2026-07-01T00:00:00Z',
    updated_at: '2026-07-01T00:00:00Z',
    ...overrides,
  };
}

const SERVER_PERSISTENCE = { mode: 'server' as const, namespace: 'lex-contracts' };

beforeEach(() => {
  window.localStorage.clear();
  vi.clearAllMocks();
  authState.userId = 'user-1';
  authState.perms = new Set();
  authState.roleSlug = 'legal-director';
  authState.personaLoading = false;
  mockList.mockResolvedValue([]);
});

describe('useSavedViews — local mode (default, no persistence prop)', () => {
  it('persists to views:<routeKey> in localStorage and never calls the server client', async () => {
    const { result } = renderHook(() => useSavedViews('lex-matters'));
    await waitFor(() => expect(result.current.hydrated).toBe(true));

    act(() => {
      result.current.saveView('Alpha', { filters: { status: 'open' } });
    });

    expect(result.current.views).toHaveLength(1);
    expect(result.current.mode).toBe('local');
    const blob = window.localStorage.getItem('views:lex-matters');
    expect(blob).not.toBeNull();
    expect(JSON.parse(blob as string)).toEqual([
      { id: 'alpha', name: 'Alpha', filters: { status: 'open' } },
    ]);

    expect(mockList).not.toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockDelete).not.toHaveBeenCalled();
  });
});

describe('useSavedViews — server mode', () => {
  it('leaves the localStorage fallback of OTHER namespaces untouched', async () => {
    // A different route's local-mode blob, seeded before server mode mounts.
    const foreignBlob = JSON.stringify([
      { id: 'mine', name: 'Mine', filters: { assignee: 'me' }, isDefault: true },
    ]);
    window.localStorage.setItem('views:lex-matters', foreignBlob);

    mockList.mockResolvedValue([serverRow()]);
    mockCreate.mockResolvedValue(
      serverRow({ id: 'sv-2', name: 'High risk', payload: { filters: { risk_level: 'high' } } }),
    );

    const { result } = renderHook(() =>
      useSavedViews('lex-contracts', SERVER_PERSISTENCE),
    );
    await waitFor(() => expect(result.current.hydrated).toBe(true));
    expect(mockList).toHaveBeenCalledWith('lex-contracts');
    expect(result.current.mode).toBe('server');

    // Exercise create + my-default marker (the only local write server mode makes).
    act(() => {
      result.current.saveView('High risk', { filters: { risk_level: 'high' } });
    });
    await waitFor(() =>
      expect(result.current.views.some((v) => v.id === 'sv-2')).toBe(true),
    );
    act(() => {
      result.current.setDefaultView('sv-1');
    });

    // Server namespace owns NO views:<routeKey> blob…
    expect(window.localStorage.getItem('views:lex-contracts')).toBeNull();
    // …only the per-user default marker under a distinct key.
    expect(window.localStorage.getItem('views:lex-contracts:my-default')).toBe('sv-1');
    // The other namespace's blob is byte-identical.
    expect(window.localStorage.getItem('views:lex-matters')).toBe(foreignBlob);

    // And a local-mode hook on that other namespace still reads it verbatim.
    const local = renderHook(() => useSavedViews('lex-matters'));
    await waitFor(() => expect(local.result.current.hydrated).toBe(true));
    expect(local.result.current.views).toEqual([
      { id: 'mine', name: 'Mine', filters: { assignee: 'me' }, isDefault: true },
    ]);
    expect(local.result.current.defaultView?.id).toBe('mine');
  });

  it("resolves the caller's role default on mount (shared view, matching role_slug)", async () => {
    mockList.mockResolvedValue([
      serverRow(),
      serverRow({
        id: 'sv-role',
        name: 'Director queue',
        scope: 'team',
        owner_user_id: 'someone-else',
        role_slug: 'legal-director',
        payload: { filters: { status: 'under_review' } },
      }),
    ]);

    const { result } = renderHook(() =>
      useSavedViews('lex-contracts', SERVER_PERSISTENCE),
    );
    await waitFor(() => expect(result.current.hydrated).toBe(true));

    expect(result.current.defaultView?.id).toBe('sv-role');
    expect(result.current.defaultView?.isDefault).toBe(true);
    // Not owned and no lex:catalog:manage → read-only for this caller.
    expect(result.current.views.find((v) => v.id === 'sv-role')?.canEdit).toBe(false);
    // The device-local "my default" marker overrides the role default.
    act(() => {
      result.current.setDefaultView('sv-1');
    });
    expect(result.current.defaultView?.id).toBe('sv-1');
  });

  it('rolls back an optimistic create and refetches when the server rejects (conflict-safe)', async () => {
    mockList.mockResolvedValue([serverRow()]);
    mockCreate.mockRejectedValue(new Error('409 CONFLICT'));

    const { result } = renderHook(() =>
      useSavedViews('lex-contracts', SERVER_PERSISTENCE),
    );
    await waitFor(() => expect(result.current.hydrated).toBe(true));
    expect(mockList).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.saveView('Dupe', { filters: { status: 'draft' } });
    });
    // Optimistic chip appears immediately…
    expect(result.current.views.some((v) => v.name === 'Dupe' && v.pending)).toBe(true);

    // …then the rejection removes it and triggers a conflict-safe refetch.
    await waitFor(() => expect(mockList).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(result.current.views.some((v) => v.name === 'Dupe')).toBe(false),
    );
    expect(result.current.views.map((v) => v.id)).toEqual(['sv-1']);
  });
});

describe('SavedViewsBar — server mode smoke', () => {
  it('shows a loading state, then chips, and auto-applies the role default on mount', async () => {
    mockList.mockResolvedValue([
      serverRow(),
      serverRow({
        id: 'sv-role',
        name: 'Director queue',
        scope: 'team',
        owner_user_id: 'someone-else',
        role_slug: 'legal-director',
        payload: { filters: { status: 'under_review' } },
      }),
    ]);
    const onApply = vi.fn();

    render(
      <SavedViewsBar
        routeKey="lex-contracts"
        persistence={SERVER_PERSISTENCE}
        activeFilters={{}}
        onApply={onApply}
      />,
    );

    // Skeleton while the first fetch is in flight (never the "empty" copy).
    expect(screen.getByRole('status')).toBeInTheDocument();

    // Chips render once hydrated; the role default is auto-applied exactly once.
    await waitFor(() =>
      expect(screen.getByTitle(/Director queue/)).toBeInTheDocument(),
    );
    expect(screen.getByTitle(/Expiring soon/)).toBeInTheDocument();
    await waitFor(() => expect(onApply).toHaveBeenCalledTimes(1));
    expect(onApply).toHaveBeenCalledWith(
      { status: 'under_review' },
      expect.objectContaining({ id: 'sv-role', isDefault: true, scope: 'team' }),
    );
  });
});
