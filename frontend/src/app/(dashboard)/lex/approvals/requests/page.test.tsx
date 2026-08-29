import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

import ApprovalQueuePage from './page';

vi.mock('../../_guards/lex-route-guard', () => ({
  LexRouteGuard: ({ children, route }: { children: ReactNode; route: string }) => (
    <div data-route={route}>{children}</div>
  ),
}));

vi.mock('../../inbox/_components/lex-inbox-content', () => ({
  LexInboxContent: () => <div>Unified actor-scoped decisions</div>,
}));

vi.mock('../../service-desk/_components/request-inbox-page', () => ({
  RequestInboxContent: ({ mode }: { mode: string }) => (
    <div>Filtered request queue: {mode}</div>
  ),
}));

vi.mock('@/components/providers/locale-provider', () => ({
  useLocaleOrDefault: () => ({ locale: 'en', direction: 'ltr' }),
}));

describe('ApprovalQueuePage', () => {
  it('keeps the unified decision queue as the default so case-intake approvals are included', () => {
    const { container } = render(<ApprovalQueuePage />);

    expect(screen.getByText('Unified actor-scoped decisions')).toBeInTheDocument();
    expect(container.firstElementChild).toHaveAttribute(
      'data-route',
      '/lex/approvals/requests',
    );
  });

  it('exposes the filtered, bulk-capable request approval queue', async () => {
    const user = userEvent.setup();
    render(<ApprovalQueuePage />);

    await user.click(screen.getByRole('tab', { name: 'Request approvals' }));

    expect(screen.getByText('Filtered request queue: approvals')).toBeInTheDocument();
    expect(screen.queryByText('Unified actor-scoped decisions')).not.toBeInTheDocument();
  });
});
