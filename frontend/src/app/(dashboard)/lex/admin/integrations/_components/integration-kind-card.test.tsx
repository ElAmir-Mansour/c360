import { describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import { IntegrationKindCard } from './integration-kind-card';
import { labels as integrationsListLabels } from '../_lib/integrations-i18n';
import type { IntegrationEndpoint, IntegrationHealth } from '@/lib/lex/integrations';

const t = integrationsListLabels.en;

const endpoint: IntegrationEndpoint = {
  id: 'ep-najiz-1',
  tenant_id: 'tenant-1',
  kind: 'najiz',
  code: 'najiz-prod',
  name: 'Najiz production',
  description: 'MoJ Takamul',
  status: 'active',
  config: { api_key: 'leaky-secret-value' },
  metadata: {},
  encrypted: true,
  last_checked_at: '2026-06-25T09:00:00Z',
  last_error: null,
  created_at: '2026-05-01T09:00:00Z',
  updated_at: '2026-06-20T09:00:00Z',
};

function baseProps() {
  return {
    health: new Map<string, IntegrationHealth>(),
    locale: 'en' as const,
    direction: 'ltr' as const,
    labels: t,
    canWrite: true,
    endpointHref: (id: string) => `/lex/admin/integrations/${id}`,
    configureHref: '/lex/admin/integrations/new?kind=najiz',
  };
}

describe('IntegrationKindCard', () => {
  it('renders a gov-gated badge for a gov-gated kind', () => {
    renderWithQuery(
      <IntegrationKindCard {...baseProps()} kind="najiz" endpoints={[endpoint]} />,
    );

    expect(screen.getByText(t.govGated)).toBeInTheDocument();
    expect(screen.getByText('Najiz production')).toBeInTheDocument();
  });

  it('does NOT render a gov-gated badge for a non-gated kind', () => {
    renderWithQuery(
      <IntegrationKindCard
        {...baseProps()}
        kind="email"
        endpoints={[{ ...endpoint, kind: 'email', name: 'SMTP' }]}
      />,
    );

    expect(screen.queryByText(t.govGated)).toBeNull();
  });

  it('renders an empty-state CTA for a kind with no connectors', () => {
    renderWithQuery(
      <IntegrationKindCard {...baseProps()} kind="email" endpoints={[]} />,
    );

    expect(screen.getByText(t.configureFirst)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: new RegExp(t.configure, 'i') })).toBeInTheDocument();
  });

  it('hides the Configure CTA for read-only operators', () => {
    renderWithQuery(
      <IntegrationKindCard {...baseProps()} canWrite={false} kind="email" endpoints={[]} />,
    );

    expect(screen.queryByRole('link', { name: new RegExp(t.configure, 'i') })).toBeNull();
  });

  it('never renders a secret config value in the DOM', () => {
    renderWithQuery(
      <IntegrationKindCard {...baseProps()} kind="najiz" endpoints={[endpoint]} />,
    );

    expect(document.body.textContent).not.toContain('leaky-secret-value');
  });

  it('toggles the whole kind via the select-all checkbox when selectable', async () => {
    const onSelectKind = vi.fn();
    const user = userEvent.setup();
    renderWithQuery(
      <IntegrationKindCard
        {...baseProps()}
        kind="najiz"
        endpoints={[endpoint]}
        selectable
        selectedIds={new Set()}
        onSelectKind={onSelectKind}
      />,
    );

    await user.click(screen.getByRole('checkbox', { name: t.bulkSelectAll }));
    expect(onSelectKind).toHaveBeenCalledWith(['ep-najiz-1'], true);
  });

  it('renders the connector count for the kind', () => {
    renderWithQuery(
      <IntegrationKindCard {...baseProps()} kind="najiz" endpoints={[endpoint]} />,
    );

    expect(screen.getByText(t.connectorsCount(1))).toBeInTheDocument();
  });
});
