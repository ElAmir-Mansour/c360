import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LocaleProvider } from '@/components/providers/locale-provider';
import { getLocaleDirection, type AppLocale } from '@/lib/i18n';
import { getMessages } from '@/lib/i18n/messages';
import { useNotificationStore } from '@/stores/notification-store';
import type { Notification } from '@/types/models';
import { NotificationDropdown } from './notification-dropdown';

const notificationActions = vi.hoisted(() => ({
  markAsRead: vi.fn(async () => undefined),
  markAllAsRead: vi.fn(async () => undefined),
}));

vi.mock('@/hooks/use-notification-actions', () => ({
  useNotificationActions: () => notificationActions,
}));

function renderDropdown(locale: AppLocale = 'en') {
  return render(
    <LocaleProvider
      locale={locale}
      direction={getLocaleDirection(locale)}
      messages={getMessages(locale)}
    >
      <NotificationDropdown />
    </LocaleProvider>,
  );
}

function notification(overrides: Partial<Notification> = {}): Notification {
  return {
    id: 'notification-1',
    title: 'Approval required',
    body: 'A contract is waiting for review.',
    category: 'legal',
    priority: 'high',
    read: false,
    created_at: new Date(Date.now() - 60_000).toISOString(),
    ...overrides,
  };
}

describe('NotificationDropdown', () => {
  beforeEach(() => {
    notificationActions.markAsRead.mockClear();
    notificationActions.markAllAsRead.mockClear();
    useNotificationStore.setState({
      unreadCount: 0,
      recentNotifications: [],
      connectionStatus: 'disconnected',
      reconnectAttempt: 0,
      nextRetryAt: null,
      reconnectToken: 0,
      isInitialized: true,
    });
  });

  it('keeps the trigger free of nested interactive controls and restores focus on Escape', async () => {
    const user = userEvent.setup();
    useNotificationStore.setState({ unreadCount: 3 });
    renderDropdown();

    const trigger = screen.getByRole('button', { name: 'Notifications (3 unread)' });
    expect(trigger.querySelector('button, [role="button"]')).toBeNull();

    await user.click(trigger);
    const dialog = screen.getByRole('dialog', { name: 'Notifications' });
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveFocus();
    expect(dialog.className).toContain('end-0');
    expect(screen.getByRole('button', { name: 'Mark all read' })).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('localizes notification chrome, numbers, relative time, and direction in Arabic', async () => {
    const user = userEvent.setup();
    useNotificationStore.setState({
      unreadCount: 2,
      recentNotifications: [notification()],
      connectionStatus: 'connected',
    });
    renderDropdown('ar');

    const trigger = screen.getByRole('button', { name: 'الإشعارات (٢ غير مقروءة)' });
    expect(trigger.parentElement).toHaveAttribute('dir', 'rtl');

    await user.click(trigger);
    expect(screen.getByRole('dialog', { name: 'الإشعارات' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'تعليم الكل كمقروء' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'عرض كل الإشعارات' })).toBeInTheDocument();
    expect(screen.getByText(/\u0642\u0628\u0644|\u0645\u0646\u0630/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Approval required/ }).className).toContain('text-start');
  });
});
