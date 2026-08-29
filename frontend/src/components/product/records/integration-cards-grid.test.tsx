import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Mail, MessagesSquare, ServerCog } from 'lucide-react';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import {
  IntegrationCardsGrid,
  type IntegrationDescriptor,
} from './integration-cards-grid';
import { sampleIntegrations } from './records.gallery';

const oneOfEach: IntegrationDescriptor[] = [
  {
    id: 'slack',
    name: 'Slack',
    category: 'Notifications',
    description: 'Post recovery alerts to channels.',
    status: 'connected',
    icon: MessagesSquare,
    lastConnectedAt: '2026-06-14T09:48:58Z',
  },
  {
    id: 'email',
    name: 'Email',
    category: 'Notifications',
    description: 'Send digests to a distribution list.',
    status: 'available',
    icon: Mail,
  },
  {
    id: 'servicenow',
    name: 'ServiceNow',
    category: 'Ticketing',
    description: 'Sync runs to change records.',
    status: 'error',
    icon: ServerCog,
    errorDetail: 'OAuth token expired — re-authorize the connection.',
  },
];

describe('IntegrationCardsGrid', () => {
  it('renders one card per integration with its name as a heading', () => {
    renderWithQuery(<IntegrationCardsGrid integrations={sampleIntegrations} />);
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(sampleIntegrations.length);
    expect(screen.getByRole('heading', { name: 'Slack' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'PagerDuty' })).toBeInTheDocument();
  });

  it('renders each status variant with the right chip and action label', () => {
    renderWithQuery(<IntegrationCardsGrid integrations={oneOfEach} />);

    // Status chips.
    expect(screen.getByText('Connected')).toBeInTheDocument();
    expect(screen.getByText('Available')).toBeInTheDocument();
    expect(screen.getByText('Error')).toBeInTheDocument();

    // Per-status primary action labels.
    expect(screen.getByRole('button', { name: /Configure — Slack/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Connect — Email/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Fix connection — ServiceNow/ })).toBeInTheDocument();
  });

  it('surfaces the error detail for an errored connector', () => {
    renderWithQuery(<IntegrationCardsGrid integrations={oneOfEach} />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('OAuth token expired — re-authorize the connection.');
  });

  it('shows the last-delivered time for a connected connector', () => {
    renderWithQuery(<IntegrationCardsGrid integrations={oneOfEach} />);
    expect(screen.getByText('Last delivered')).toBeInTheDocument();
  });

  it('invokes onConfigure with the descriptor when an action is activated', async () => {
    const user = userEvent.setup();
    const onConfigure = vi.fn();
    renderWithQuery(
      <IntegrationCardsGrid integrations={oneOfEach} onConfigure={onConfigure} />,
    );

    await user.click(screen.getByRole('button', { name: /Connect — Email/ }));
    expect(onConfigure).toHaveBeenCalledTimes(1);
    expect(onConfigure).toHaveBeenCalledWith(expect.objectContaining({ id: 'email' }));
  });

  it('renders an empty state when there are no integrations', () => {
    renderWithQuery(<IntegrationCardsGrid integrations={[]} />);
    expect(screen.getByText('No integrations')).toBeInTheDocument();
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument();
  });

  it('resolves bilingual labels under the Arabic (RTL) locale', () => {
    renderWithQuery(
      <IntegrationCardsGrid
        integrations={oneOfEach}
        labels={{ statusConnected: 'متصل', actionConnect: 'ربط' }}
      />,
      { locale: 'ar' },
    );
    expect(screen.getByText('متصل')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /ربط — Email/ })).toBeInTheDocument();
  });
});
