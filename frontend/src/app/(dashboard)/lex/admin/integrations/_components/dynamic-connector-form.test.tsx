import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import { DynamicConnectorForm, type ConnectorSubmit } from './dynamic-connector-form';
import { integrationLabels } from '../_labels';
import type { FieldSpec, IntegrationEndpoint } from '@/lib/lex/integrations';

const t = integrationLabels.en;

// Plaintext secret that must NEVER surface in the rendered DOM. The endpoint
// arrives masked (sentinel only) — we stash the real value nowhere the form reads.
const REAL_SECRET = 'super-secret-client-value-DO-NOT-LEAK';

const { getSchemaMock } = vi.hoisted(() => ({
  getSchemaMock: vi.fn(),
}));

vi.mock('@/lib/lex/integrations', async () => {
  const actual = await vi.importActual<typeof import('@/lib/lex/integrations')>(
    '@/lib/lex/integrations',
  );
  return {
    ...actual,
    getSchema: getSchemaMock,
  };
});

const stringSpec: FieldSpec = {
  key: 'base_url',
  label: { en: 'Base URL', ar: 'الرابط الأساسي' },
  type: 'url',
  required: true,
  secret: false,
};

const enumSpec: FieldSpec = {
  key: 'environment',
  label: { en: 'Environment', ar: 'البيئة' },
  type: 'enum',
  required: false,
  secret: false,
  enum: ['production', 'sandbox'],
};

const boolSpec: FieldSpec = {
  key: 'verify_tls',
  label: { en: 'Verify TLS', ar: 'تحقق TLS' },
  type: 'bool',
  required: false,
  secret: false,
  default: 'true',
};

const secretSpec: FieldSpec = {
  key: 'client_secret',
  label: { en: 'Client secret', ar: 'سر العميل' },
  type: 'secret',
  required: true,
  secret: true,
};

const SCHEMA: FieldSpec[] = [stringSpec, enumSpec, boolSpec, secretSpec];

const editEndpoint: IntegrationEndpoint = {
  id: 'ep-1',
  tenant_id: 't-1',
  kind: 'najiz',
  code: 'najiz-prod',
  name: 'Najiz Production',
  description: 'MoJ connector',
  status: 'active',
  // Masked config: the secret key collapses to the redaction sentinel; the real
  // secret value is intentionally absent from anything the form can read.
  config: { base_url: 'https://najiz.example.sa', client_secret: '__redacted__' },
  metadata: {},
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

beforeEach(() => {
  getSchemaMock.mockReset();
  getSchemaMock.mockResolvedValue(SCHEMA);
});

describe('DynamicConnectorForm — schema-driven rendering', () => {
  it('renders one control per schema field (string/enum/bool/secret)', async () => {
    renderWithQuery(
      <DynamicConnectorForm kind="najiz" onSubmit={vi.fn()} onCancel={vi.fn()} />,
    );

    // Identity fields are always present.
    expect(await screen.findByLabelText(/Display name/i)).toBeInTheDocument();

    // One control per schema field, by label.
    expect(await screen.findByLabelText(/Base URL/i)).toBeInTheDocument();
    expect(screen.getByText('Environment')).toBeInTheDocument();
    expect(screen.getByText('Verify TLS')).toBeInTheDocument();
    expect(screen.getByText('Client secret')).toBeInTheDocument();
  });

  it('surfaces an error state with retry when the schema fetch fails', async () => {
    getSchemaMock.mockRejectedValue(new Error('schema down'));
    renderWithQuery(
      <DynamicConnectorForm kind="najiz" onSubmit={vi.fn()} onCancel={vi.fn()} />,
    );

    expect(await screen.findByText(t.schemaMissingTitle)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retry|try again|إعادة/i })).toBeInTheDocument();
  });
});

describe('DynamicConnectorForm — SECRET SAFETY (write-only)', () => {
  it('masks a stored secret and never exposes the real value in the DOM', async () => {
    const { container } = renderWithQuery(
      <DynamicConnectorForm
        kind="najiz"
        endpoint={editEndpoint}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    // Wait for the schema + reseed.
    await screen.findByLabelText(/Base URL/i);

    // The masked "•••••• (set)" affordance is shown with a Replace button.
    expect(await screen.findByText(t.secretSet)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: t.secretReplace })).toBeInTheDocument();

    // CRITICAL: neither the real secret nor the redaction sentinel is in the DOM
    // as a visible value or input value.
    expect(container.innerHTML).not.toContain(REAL_SECRET);
    expect(container.innerHTML).not.toContain('__redacted__');
    expect(screen.queryByDisplayValue(REAL_SECRET)).toBeNull();
    expect(screen.queryByDisplayValue('__redacted__')).toBeNull();
  });

  it('Replace reveals an EMPTY write-only password input (not the secret)', async () => {
    const user = userEvent.setup();
    const { container } = renderWithQuery(
      <DynamicConnectorForm
        kind="najiz"
        endpoint={editEndpoint}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    await screen.findByText(t.secretSet);
    await user.click(screen.getByRole('button', { name: t.secretReplace }));

    // The newly-revealed input is a password field and is empty — never seeded
    // with the stored secret or sentinel.
    const pwd = await screen.findByPlaceholderText(t.secretEnterNew);
    expect(pwd).toHaveAttribute('type', 'password');
    expect((pwd as HTMLInputElement).value).toBe('');
    expect(container.innerHTML).not.toContain(REAL_SECRET);
    expect(container.innerHTML).not.toContain('__redacted__');
  });

  it('passes the redaction sentinel through UNCHANGED on save when the secret is untouched', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn<(submit: ConnectorSubmit) => void>();
    renderWithQuery(
      <DynamicConnectorForm
        kind="najiz"
        endpoint={editEndpoint}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );

    await screen.findByText(t.secretSet);
    // Save without touching the secret.
    await user.click(screen.getByRole('button', { name: t.save }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    const submitted = onSubmit.mock.calls[0][0];
    expect(submitted.mode).toBe('update');
    if (submitted.mode === 'update') {
      // The untouched secret stays as the sentinel so the backend merge keeps the
      // stored value — we never resubmit a masked value as a real secret.
      expect(submitted.payload.config?.client_secret).toBe('__redacted__');
    }
  });
});

describe('DynamicConnectorForm — validation + a11y', () => {
  it('blocks submit and flags the required name when empty', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    renderWithQuery(
      <DynamicConnectorForm kind="najiz" onSubmit={onSubmit} onCancel={vi.fn()} />,
    );

    await screen.findByLabelText(/Base URL/i);
    await user.click(screen.getByRole('button', { name: t.create }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(await screen.findByText(t.formRequired)).toBeInTheDocument();
  });

  it('renders accessible labelled identity controls and a submit button', async () => {
    renderWithQuery(
      <DynamicConnectorForm kind="najiz" onSubmit={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(await screen.findByLabelText(/Display name/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: t.create })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: t.cancel })).toBeInTheDocument();
  });
});
