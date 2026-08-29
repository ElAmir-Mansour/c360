import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import { ActivityTimeline } from './activity-timeline';
import type { ActivityEntry } from '@/lib/lex/integrations';
import { detailOpsLabels } from '../_lib/detail-ops-labels';

const { getActivityResultMock } = vi.hoisted(() => ({
  getActivityResultMock: vi.fn(),
}));

vi.mock('@/lib/lex/integrations', async () => {
  const actual = await vi.importActual<typeof import('@/lib/lex/integrations')>(
    '@/lib/lex/integrations',
  );
  return {
    ...actual,
    getActivityResult: getActivityResultMock,
  };
});

const en = detailOpsLabels.en;

const entry: ActivityEntry = {
  actor: 'Lina Operator',
  action: 'integration.secret.rotated',
  at: '2026-06-20T10:00:00Z',
  detail: { field: 'api_key', rotated: true },
};

beforeEach(() => {
  getActivityResultMock.mockReset();
});

describe('ActivityTimeline', () => {
  it('renders the audit entries with a humanized action and actor', async () => {
    getActivityResultMock.mockResolvedValue({ entries: [entry], degraded: false });
    renderWithQuery(<ActivityTimeline endpointId="ep-1" />);

    expect(await screen.findByText('Integration · Secret · Rotated')).toBeInTheDocument();
    expect(screen.getByText('Lina Operator')).toBeInTheDocument();
  });

  it('shows an empty state when there is no activity', async () => {
    getActivityResultMock.mockResolvedValue({ entries: [], degraded: false });
    renderWithQuery(<ActivityTimeline endpointId="ep-1" />);

    expect(await screen.findByText(en.activityEmpty)).toBeInTheDocument();
  });

  it('shows an unavailable state when the activity read is degraded', async () => {
    getActivityResultMock.mockResolvedValue({ entries: [], degraded: true });
    renderWithQuery(<ActivityTimeline endpointId="ep-1" />);

    expect(await screen.findByText(en.opsError)).toBeInTheDocument();
    expect(screen.queryByText(en.activityEmpty)).not.toBeInTheDocument();
  });

  it('reveals a secret-free detail bag on expand and never renders a raw secret value', async () => {
    const user = userEvent.setup();
    getActivityResultMock.mockResolvedValue({ entries: [entry], degraded: false });
    renderWithQuery(<ActivityTimeline endpointId="ep-1" />);

    await screen.findByText('Integration · Secret · Rotated');
    // The detail bag only carries the field name, never a secret value.
    await user.click(screen.getByRole('button', { name: en.activityShowDetail }));

    expect(await screen.findByText(/"api_key"/)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('sk_live');
  });

  it('renders the Arabic/RTL surface under the ar locale', async () => {
    getActivityResultMock.mockResolvedValue({ entries: [entry], degraded: false });
    const { container } = renderWithQuery(<ActivityTimeline endpointId="ep-1" />, { locale: 'ar' });

    // The timeline list carries the document direction.
    await screen.findByText('Integration · Secret · Rotated');
    expect(container.querySelector('[dir="rtl"]')).not.toBeNull();
  });
});
