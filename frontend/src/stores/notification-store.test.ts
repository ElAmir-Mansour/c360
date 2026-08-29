import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useNotificationStore } from './notification-store';
import * as api from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';
import type { Notification } from '@/types/models';

vi.mock('@/lib/api', () => ({
  apiGet: vi.fn(),
}));

const mockedApiGet = vi.mocked(api.apiGet);

function buildNotification(overrides: Partial<Notification> = {}): Notification {
  return {
    id: overrides.id ?? 'n-1',
    type: overrides.type,
    title: overrides.title ?? 'Backfilled',
    body: overrides.body ?? '',
    category: overrides.category ?? 'system',
    priority: overrides.priority ?? 'low',
    read: overrides.read ?? false,
    read_at: overrides.read_at ?? null,
    action_url: overrides.action_url ?? null,
    data: overrides.data ?? null,
    created_at: overrides.created_at ?? new Date().toISOString(),
  };
}

function mockServer(count: number, notifications: Notification[]) {
  mockedApiGet.mockImplementation(((endpoint: string) =>
    endpoint === API_ENDPOINTS.NOTIFICATIONS_UNREAD_COUNT
      ? Promise.resolve({ count })
      : Promise.resolve({ data: notifications })) as typeof api.apiGet);
}

describe('notification-store backfill', () => {
  beforeEach(() => {
    mockedApiGet.mockReset();
    useNotificationStore.setState({
      unreadCount: 0,
      recentNotifications: [],
      isInitialized: false,
    });
  });

  it('reconciles unread count and recent list on backfill even when already initialized', async () => {
    // Simulate a client that already loaded once and then reconnected.
    useNotificationStore.setState({ isInitialized: true, unreadCount: 0, recentNotifications: [] });
    mockServer(3, [buildNotification({ id: 'missed-1' })]);

    await useNotificationStore.getState().backfill();

    expect(mockedApiGet).toHaveBeenCalled();
    expect(useNotificationStore.getState().unreadCount).toBe(3);
    expect(useNotificationStore.getState().recentNotifications).toHaveLength(1);
    expect(useNotificationStore.getState().recentNotifications[0]?.id).toBe('missed-1');
  });

  it('fetchInitialData stays guarded by isInitialized (no duplicate fetch)', async () => {
    useNotificationStore.setState({ isInitialized: true });

    await useNotificationStore.getState().fetchInitialData();

    expect(mockedApiGet).not.toHaveBeenCalled();
  });

  it('clamps a negative unread count to zero', async () => {
    mockServer(-5, []);

    await useNotificationStore.getState().backfill();

    expect(useNotificationStore.getState().unreadCount).toBe(0);
  });
});
