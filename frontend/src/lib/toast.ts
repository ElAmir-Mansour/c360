import { toast } from 'sonner';
import { createElement } from 'react';
import type { Notification } from '@/types/models';
import { getNotificationIcon } from '@/lib/notification-utils';
import { truncate } from '@/lib/utils';
import { parseApiError } from '@/lib/format';

// Re-export the raw sonner instance so call sites can use a single import
// surface for both the curated helpers below and ad-hoc toasts.
export { toast };

export function showSuccess(title: string, description?: string): void {
  toast.success(title, { description, duration: 4000 });
}

export function showError(title: string, description?: string): void {
  toast.error(title, { description, duration: 6000 });
}

export function showWarning(title: string, description?: string): void {
  toast.warning(title, { description, duration: 5000 });
}

export function showInfo(title: string, description?: string): void {
  toast.info(title, { description, duration: 4000 });
}

export function showNotificationToast(notification: Notification): void {
  const Icon = getNotificationIcon(notification);
  toast(notification.title, {
    description: truncate(notification.body, 100),
    icon: createElement(Icon, { className: 'h-4 w-4' }),
    duration: 6000,
    action: notification.action_url
      ? {
          label: 'View',
          onClick: () => {
            if (typeof window !== 'undefined') {
              window.location.href = notification.action_url!;
            }
          },
        }
      : undefined,
  });
}

export function showApiError(error: unknown): void {
  let message = 'An unexpected error occurred.';
  if (error && typeof error === 'object' && 'message' in error) {
    message = (error as { message: string }).message;
  }
  toast.error('Error', { description: message, duration: 6000 });
}

/**
 * Surfaces a backend error as a toast, using the shared `parseApiError` so
 * AxiosError / nested `{ error: { message } }` / flat `{ message }` envelopes
 * all resolve to a sensible string. Prefer this over `showApiError` for
 * fetch/axios failures.
 */
export function showBackendError(error: unknown, title = 'Error'): void {
  toast.error(title, { description: parseApiError(error), duration: 6000 });
}

/** Dismiss a specific toast by id, or all toasts when no id is given. */
export function dismissToast(id?: string | number): void {
  toast.dismiss(id);
}

/**
 * Promise-driven toast (loading → success/error) using sonner's `toast.promise`.
 * The error branch funnels through `parseApiError` for consistent messaging.
 */
export function showPromiseToast<T>(
  promise: Promise<T>,
  messages: {
    loading: string;
    success: string | ((data: T) => string);
    error?: string | ((error: unknown) => string);
  },
): void {
  toast.promise(promise, {
    loading: messages.loading,
    success: messages.success,
    error: messages.error ?? ((err: unknown) => parseApiError(err)),
  });
}
