import { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Unit test for the query hooks added to `use-dr-queries.ts` for the recovery
 * tier / sites / objective-fit build agents.
 *
 * These prove REAL wiring (not stubs): each hook calls the matching
 * `@/lib/clario-dr` fetch fn and registers the exact `['clario-dr', ...]` query
 * key the cross-route cache + mutation invalidations rely on. The key strings
 * are asserted explicitly so a later rename cannot silently break sharing.
 */

vi.mock('@/lib/clario-dr', () => ({
  fetchDRRecoveryTiers: vi.fn(),
  fetchDRSites: vi.fn(),
  fetchDRSite: vi.fn(),
  fetchDRGroups: vi.fn(),
  fetchDRGroup: vi.fn(),
  fetchDRGroupMembers: vi.fn(),
  fetchDRGroupNetworkMappings: vi.fn(),
  fetchDRStreams: vi.fn(),
  fetchDRStream: vi.fn(),
  fetchDRStreamRPO: vi.fn(),
}));

import * as drApi from '@/lib/clario-dr';
import {
  useDRGroup,
  useDRGroupMembers,
  useDRGroupNetworkMappings,
  useDRGroups,
  useDRRecoveryTiers,
  useDRSite,
  useDRSites,
  useDRStream,
  useDRStreamRPO,
  useDRStreams,
} from './use-dr-queries';

const api = vi.mocked(drApi);

function makeWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useDRRecoveryTiers', () => {
  it('fetches recovery tier profiles under the recovery-tiers key', async () => {
    api.fetchDRRecoveryTiers.mockResolvedValue([{ tier: 'tier-0' }] as never);
    const { queryClient, wrapper } = makeWrapper();
    const { result } = renderHook(() => useDRRecoveryTiers(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.fetchDRRecoveryTiers).toHaveBeenCalledTimes(1);
    expect(
      queryClient.getQueryData(['clario-dr', 'recovery-tiers']),
    ).toEqual([{ tier: 'tier-0' }]);
  });
});

describe('useDRSites', () => {
  it('fetches protected sites under the sites key', async () => {
    api.fetchDRSites.mockResolvedValue([{ id: 'site-1' }] as never);
    const { queryClient, wrapper } = makeWrapper();
    const { result } = renderHook(() => useDRSites(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.fetchDRSites).toHaveBeenCalledTimes(1);
    expect(queryClient.getQueryData(['clario-dr', 'sites'])).toEqual([
      { id: 'site-1' },
    ]);
  });
});

describe('useDRSite', () => {
  it('fetches a single site under the site/:id key when an id is present', async () => {
    api.fetchDRSite.mockResolvedValue({ id: 'site-7' } as never);
    const { queryClient, wrapper } = makeWrapper();
    const { result } = renderHook(() => useDRSite('site-7'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.fetchDRSite).toHaveBeenCalledWith('site-7');
    expect(queryClient.getQueryData(['clario-dr', 'site', 'site-7'])).toEqual({
      id: 'site-7',
    });
  });

  it('stays disabled (never fetches) while the site id is null', async () => {
    const { result } = renderHook(() => useDRSite(null), {
      wrapper: makeWrapper().wrapper,
    });

    expect(result.current.fetchStatus).toBe('idle');
    expect(api.fetchDRSite).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Provisioning query hooks (groups / members / streams / network mappings).
// ---------------------------------------------------------------------------

describe('useDRGroups', () => {
  it('fetches consistency groups under the groups key', async () => {
    api.fetchDRGroups.mockResolvedValue([{ id: 'group-1' }] as never);
    const { queryClient, wrapper } = makeWrapper();
    const { result } = renderHook(() => useDRGroups(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.fetchDRGroups).toHaveBeenCalledTimes(1);
    expect(queryClient.getQueryData(['clario-dr', 'groups'])).toEqual([
      { id: 'group-1' },
    ]);
  });
});

describe('useDRGroup', () => {
  it('fetches a single group under the group/:id key when an id is present', async () => {
    api.fetchDRGroup.mockResolvedValue({ id: 'group-7' } as never);
    const { queryClient, wrapper } = makeWrapper();
    const { result } = renderHook(() => useDRGroup('group-7'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.fetchDRGroup).toHaveBeenCalledWith('group-7');
    expect(queryClient.getQueryData(['clario-dr', 'group', 'group-7'])).toEqual({
      id: 'group-7',
    });
  });

  it('stays disabled while the group id is null', () => {
    const { result } = renderHook(() => useDRGroup(null), {
      wrapper: makeWrapper().wrapper,
    });
    expect(result.current.fetchStatus).toBe('idle');
    expect(api.fetchDRGroup).not.toHaveBeenCalled();
  });
});

describe('useDRGroupMembers', () => {
  it('fetches members under the group-members/:groupId key when a group id is present', async () => {
    api.fetchDRGroupMembers.mockResolvedValue([
      { group_id: 'group-1', site_id: 'site-1', boot_order: 0 },
    ] as never);
    const { queryClient, wrapper } = makeWrapper();
    const { result } = renderHook(() => useDRGroupMembers('group-1'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.fetchDRGroupMembers).toHaveBeenCalledWith('group-1');
    expect(
      queryClient.getQueryData(['clario-dr', 'group-members', 'group-1']),
    ).toEqual([{ group_id: 'group-1', site_id: 'site-1', boot_order: 0 }]);
  });

  it('stays disabled while the group id is null', () => {
    const { result } = renderHook(() => useDRGroupMembers(null), {
      wrapper: makeWrapper().wrapper,
    });
    expect(result.current.fetchStatus).toBe('idle');
    expect(api.fetchDRGroupMembers).not.toHaveBeenCalled();
  });
});

describe('useDRGroupNetworkMappings', () => {
  it('fetches mappings under the group-network-mappings/:groupId key when a group id is present', async () => {
    api.fetchDRGroupNetworkMappings.mockResolvedValue([
      { id: 'nm-1', group_id: 'group-1', profile: 'isolated' },
    ] as never);
    const { queryClient, wrapper } = makeWrapper();
    const { result } = renderHook(() => useDRGroupNetworkMappings('group-1'), {
      wrapper,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.fetchDRGroupNetworkMappings).toHaveBeenCalledWith('group-1');
    expect(
      queryClient.getQueryData(['clario-dr', 'group-network-mappings', 'group-1']),
    ).toEqual([{ id: 'nm-1', group_id: 'group-1', profile: 'isolated' }]);
  });

  it('stays disabled while the group id is null', () => {
    const { result } = renderHook(() => useDRGroupNetworkMappings(null), {
      wrapper: makeWrapper().wrapper,
    });
    expect(result.current.fetchStatus).toBe('idle');
    expect(api.fetchDRGroupNetworkMappings).not.toHaveBeenCalled();
  });
});

describe('useDRStreams', () => {
  it('fetches replication streams under the streams key', async () => {
    api.fetchDRStreams.mockResolvedValue([{ id: 'stream-1' }] as never);
    const { queryClient, wrapper } = makeWrapper();
    const { result } = renderHook(() => useDRStreams(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.fetchDRStreams).toHaveBeenCalledTimes(1);
    expect(queryClient.getQueryData(['clario-dr', 'streams'])).toEqual([
      { id: 'stream-1' },
    ]);
  });
});

describe('useDRStream', () => {
  it('fetches a single stream under the stream/:id key when an id is present', async () => {
    api.fetchDRStream.mockResolvedValue({ id: 'stream-7' } as never);
    const { queryClient, wrapper } = makeWrapper();
    const { result } = renderHook(() => useDRStream('stream-7'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.fetchDRStream).toHaveBeenCalledWith('stream-7');
    expect(queryClient.getQueryData(['clario-dr', 'stream', 'stream-7'])).toEqual({
      id: 'stream-7',
    });
  });

  it('stays disabled while the stream id is null', () => {
    const { result } = renderHook(() => useDRStream(null), {
      wrapper: makeWrapper().wrapper,
    });
    expect(result.current.fetchStatus).toBe('idle');
    expect(api.fetchDRStream).not.toHaveBeenCalled();
  });
});

describe('useDRStreamRPO', () => {
  it('fetches live RPO under the stream-rpo/:id key when a stream id is present', async () => {
    api.fetchDRStreamRPO.mockResolvedValue({
      stream_id: 'stream-3',
      rpo_seconds: 12,
    } as never);
    const { queryClient, wrapper } = makeWrapper();
    const { result } = renderHook(() => useDRStreamRPO('stream-3'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.fetchDRStreamRPO).toHaveBeenCalledWith('stream-3');
    expect(
      queryClient.getQueryData(['clario-dr', 'stream-rpo', 'stream-3']),
    ).toEqual({ stream_id: 'stream-3', rpo_seconds: 12 });
  });

  it('stays disabled while the stream id is null', () => {
    const { result } = renderHook(() => useDRStreamRPO(null), {
      wrapper: makeWrapper().wrapper,
    });
    expect(result.current.fetchStatus).toBe('idle');
    expect(api.fetchDRStreamRPO).not.toHaveBeenCalled();
  });
});
