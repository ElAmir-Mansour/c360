import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import { IntegrationEndpointRow, tallySteps } from './integration-endpoint-row';
import { labels as integrationsListLabels } from '../_lib/integrations-i18n';
import type { IntegrationEndpoint, TestResult } from '@/lib/lex/integrations';

const t = integrationsListLabels.en;

const endpoint: IntegrationEndpoint = {
  id: 'ep-1',
  tenant_id: 'tenant-1',
  kind: 'najiz',
  code: 'najiz-prod',
  name: 'Najiz production',
  description: '',
  status: 'active',
  config: { api_key: 'top-secret-value' },
  metadata: {},
  encrypted: true,
  last_checked_at: '2026-06-25T09:00:00Z',
  last_error: null,
  created_at: '2026-05-01T09:00:00Z',
  updated_at: '2026-06-20T09:00:00Z',
};

function baseProps() {
  return {
    endpoint,
    href: '/lex/admin/integrations/ep-1',
    locale: 'en' as const,
    direction: 'ltr' as const,
    labels: t,
    canWrite: true,
  };
}

describe('tallySteps', () => {
  it('returns null for no steps', () => {
    expect(tallySteps(undefined)).toBeNull();
    expect(tallySteps([])).toBeNull();
  });

  it('tallies ok / warn / fail counts', () => {
    const tally = tallySteps([
      { key: 'dns', label: { ar: '', en: 'DNS' }, status: 'ok' },
      { key: 'auth', label: { ar: '', en: 'Auth' }, status: 'warn' },
      { key: 'scope', label: { ar: '', en: 'Scope' }, status: 'fail' },
    ]);
    expect(tally).toEqual({ total: 3, ok: 1, warn: 1, fail: 1, skip: 0 });
  });
});

describe('IntegrationEndpointRow', () => {
  it('renders the endpoint name + code and links to the detail surface', () => {
    renderWithQuery(<IntegrationEndpointRow {...baseProps()} />);

    expect(screen.getByText('Najiz production')).toBeInTheDocument();
    expect(screen.getByText('najiz-prod')).toBeInTheDocument();
    expect(screen.getByRole('link')).toHaveAttribute('href', '/lex/admin/integrations/ep-1');
  });

  it('never renders the secret config value', () => {
    renderWithQuery(<IntegrationEndpointRow {...baseProps()} />);
    expect(document.body.textContent).not.toContain('top-secret-value');
  });

  it('fires onTest when the Test quick-action is clicked', async () => {
    const onTest = vi.fn();
    const user = userEvent.setup();
    renderWithQuery(<IntegrationEndpointRow {...baseProps()} onTest={onTest} />);

    await user.click(screen.getByRole('button', { name: new RegExp(t.test, 'i') }));
    expect(onTest).toHaveBeenCalledTimes(1);
  });

  it('disables the Test action while a probe is in flight', () => {
    renderWithQuery(<IntegrationEndpointRow {...baseProps()} testing onTest={vi.fn()} />);
    expect(screen.getByRole('button', { name: new RegExp(t.testing, 'i') })).toBeDisabled();
  });

  it('hides the Test action for read-only operators', () => {
    renderWithQuery(<IntegrationEndpointRow {...baseProps()} canWrite={false} />);
    expect(screen.queryByRole('button', { name: new RegExp(t.test, 'i') })).toBeNull();
  });

  it('exposes an accessible selection checkbox label when selectable', async () => {
    const onSelectChange = vi.fn();
    const user = userEvent.setup();
    renderWithQuery(
      <IntegrationEndpointRow
        {...baseProps()}
        selectable
        onSelectChange={onSelectChange}
      />,
    );

    const checkbox = screen.getByRole('checkbox', {
      name: `${t.selectRow}: Najiz production`,
    });
    await user.click(checkbox);
    expect(onSelectChange).toHaveBeenCalledWith(true);
  });

  it('summarizes the last test as a failed-steps badge', () => {
    const lastTest: TestResult = {
      endpoint_id: 'ep-1',
      reachable: false,
      detail: 'auth failed',
      sample_count: 0,
      latency_millis: 12,
      steps: [
        { key: 'dns', label: { ar: '', en: 'DNS' }, status: 'ok' },
        { key: 'auth', label: { ar: '', en: 'Auth' }, status: 'fail' },
      ],
    };
    renderWithQuery(<IntegrationEndpointRow {...baseProps()} lastTest={lastTest} />);

    expect(screen.getByText(t.testFailedSteps(1))).toBeInTheDocument();
  });
});
