import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  useImpersonationStore,
  getActiveImpersonationToken,
} from './impersonation-store';

const FUTURE = () => new Date(Date.now() + 10 * 60_000).toISOString();
const PAST = () => new Date(Date.now() - 60_000).toISOString();

// Reset the singleton store between tests so state never leaks across cases.
function resetStore() {
  useImpersonationStore.setState({
    token: null,
    tenantId: null,
    tenantName: null,
    userId: null,
    expiresAt: null,
    active: false,
  });
}

describe('impersonation-store', () => {
  beforeEach(() => {
    resetStore();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('defaults to an inactive, empty grant', () => {
    const s = useImpersonationStore.getState();
    expect(s.active).toBe(false);
    expect(s.token).toBeNull();
    expect(s.tenantId).toBeNull();
    expect(s.tenantName).toBeNull();
    expect(s.userId).toBeNull();
    expect(s.expiresAt).toBeNull();
  });

  describe('start', () => {
    it('sets the full grant and flips active to true', () => {
      const expiresAt = FUTURE();
      useImpersonationStore.getState().start({
        token: 'imp-token-abc',
        tenantId: 'tenant-1',
        tenantName: 'Acme Corp',
        userId: 'user-9',
        expiresAt,
      });

      const s = useImpersonationStore.getState();
      expect(s.active).toBe(true);
      expect(s.token).toBe('imp-token-abc');
      expect(s.tenantId).toBe('tenant-1');
      expect(s.tenantName).toBe('Acme Corp');
      expect(s.userId).toBe('user-9');
      expect(s.expiresAt).toBe(expiresAt);
    });

    it('coalesces optional tenantName/userId to null when omitted', () => {
      useImpersonationStore.getState().start({
        token: 'imp-token',
        tenantId: 'tenant-2',
        expiresAt: FUTURE(),
      });

      const s = useImpersonationStore.getState();
      expect(s.active).toBe(true);
      expect(s.tenantName).toBeNull();
      expect(s.userId).toBeNull();
      expect(s.tenantId).toBe('tenant-2');
    });
  });

  describe('stop', () => {
    it('clears every field back to the inactive initial state', () => {
      const { start, stop } = useImpersonationStore.getState();
      start({
        token: 'imp-token',
        tenantId: 'tenant-1',
        tenantName: 'Acme Corp',
        userId: 'user-9',
        expiresAt: FUTURE(),
      });
      expect(useImpersonationStore.getState().active).toBe(true);

      stop();

      const s = useImpersonationStore.getState();
      expect(s.active).toBe(false);
      expect(s.token).toBeNull();
      expect(s.tenantId).toBeNull();
      expect(s.tenantName).toBeNull();
      expect(s.userId).toBeNull();
      expect(s.expiresAt).toBeNull();
    });
  });

  describe('getActiveImpersonationToken', () => {
    it('returns null when no grant is active', () => {
      expect(getActiveImpersonationToken()).toBeNull();
    });

    it('returns the token for an active, unexpired grant', () => {
      useImpersonationStore.getState().start({
        token: 'live-token',
        tenantId: 'tenant-1',
        expiresAt: FUTURE(),
      });
      expect(getActiveImpersonationToken()).toBe('live-token');
    });

    it('returns null once the grant has expired (stale token never sent)', () => {
      useImpersonationStore.getState().start({
        token: 'expired-token',
        tenantId: 'tenant-1',
        expiresAt: PAST(),
      });
      expect(getActiveImpersonationToken()).toBeNull();
    });

    it('treats expiry as a hard wall-clock boundary', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-06-22T12:00:00.000Z'));

      useImpersonationStore.getState().start({
        token: 'ttl-token',
        tenantId: 'tenant-1',
        expiresAt: '2026-06-22T12:05:00.000Z',
      });
      expect(getActiveImpersonationToken()).toBe('ttl-token');

      // Advance past the hard TTL.
      vi.setSystemTime(new Date('2026-06-22T12:05:01.000Z'));
      expect(getActiveImpersonationToken()).toBeNull();
    });

    it('returns null when active but token is missing', () => {
      useImpersonationStore.setState({
        active: true,
        token: null,
        expiresAt: FUTURE(),
      });
      expect(getActiveImpersonationToken()).toBeNull();
    });
  });
});
