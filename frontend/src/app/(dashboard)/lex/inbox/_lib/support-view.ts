import type { SupportView } from '../_components/support-requests-panel';

export type InboxView = 'decisions' | SupportView;

/** Sanitize notification deep links and fail closed when support is not granted. */
export function resolveInboxView(
  requested: string | null | undefined,
  canViewSupport: boolean,
): InboxView {
  if (
    canViewSupport &&
    (requested === 'incoming' || requested === 'sent' || requested === 'history')
  ) {
    return requested;
  }
  return 'decisions';
}

