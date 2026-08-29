import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import {
  CUSTOM_SPEC_CONFIG_KEY,
  REDACTED_SENTINEL,
  type CustomConnectorSpec,
  type IntegrationEndpoint,
} from '@/lib/lex/integrations';
import { extensibilityLabels } from '../_lib/extensibility-labels';
import { CustomConnectorBuilder, classifyBaseUrl } from './custom-connector-builder';

const { createIntegrationMock, testConnectionMock, showApiErrorMock, showSuccessMock } =
  vi.hoisted(() => ({
    createIntegrationMock: vi.fn(),
    testConnectionMock: vi.fn(),
    showApiErrorMock: vi.fn(),
    showSuccessMock: vi.fn(),
  }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/lex/admin/integrations/new',
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
}));

vi.mock('@/lib/toast', () => ({
  showSuccess: showSuccessMock,
  showApiError: showApiErrorMock,
  showBackendError: vi.fn(),
}));

vi.mock('@/lib/lex/integrations', async () => {
  const actual = await vi.importActual<typeof import('@/lib/lex/integrations')>(
    '@/lib/lex/integrations',
  );
  return {
    ...actual,
    createIntegration: createIntegrationMock,
    lexIntegrationsApi: {
      ...actual.lexIntegrationsApi,
      testConnection: testConnectionMock,
    },
  };
});

const en = extensibilityLabels.en;

/** The primary Save/Create button (text differs create vs edit). */
function saveButton(): HTMLElement {
  const btn = screen
    .getAllByRole('button')
    .find((b) => /Create integration|Save changes|Creating/i.test(b.textContent ?? ''));
  if (!btn) throw new Error('save button not found');
  return btn;
}

const createdEndpoint: IntegrationEndpoint = {
  id: 'cust-1',
  tenant_id: 'tenant-1',
  kind: 'custom',
  code: 'custom',
  name: 'My API',
  description: '',
  status: 'planned',
  config: {},
  metadata: {},
  created_at: '2026-06-01T00:00:00Z',
  updated_at: '2026-06-01T00:00:00Z',
};

/** An existing endpoint whose stored secret arrives masked (write-only path). */
const SECRET_VALUE = 'super-secret-bearer-token-123';
function endpointWithMaskedSecret(): IntegrationEndpoint {
  const spec: CustomConnectorSpec = {
    base_url: 'https://api.example.com',
    request: { method: 'GET', path: '/v1/records', headers: {}, body_template: '' },
    // Secret arrives MASKED from the registry — never the real value.
    auth: { type: 'bearer', token: REDACTED_SENTINEL },
    response_mapping: { records_path: 'data', field_map: {} },
    pagination: { type: 'none', param: '' },
  };
  return {
    ...createdEndpoint,
    id: 'cust-edit',
    name: 'Edit me',
    config: { [CUSTOM_SPEC_CONFIG_KEY]: spec },
  };
}

beforeEach(() => {
  createIntegrationMock.mockReset();
  testConnectionMock.mockReset();
  showApiErrorMock.mockReset();
  showSuccessMock.mockReset();
  createIntegrationMock.mockResolvedValue(createdEndpoint);
  testConnectionMock.mockResolvedValue({ reachable: true, detail: 'HTTP 200' });
});

describe('CustomConnectorBuilder', () => {
  it('blocks save and shows required errors until name, code, and base URL are filled', async () => {
    const user = userEvent.setup();
    renderWithQuery(<CustomConnectorBuilder />);

    await user.click(saveButton());
    // Required messaging surfaces and no request is fired.
    expect(await screen.findByText(en.builderBaseUrlRequired)).toBeInTheDocument();
    expect(createIntegrationMock).not.toHaveBeenCalled();
  });

  it('creates a custom connector with a trimmed declarative spec payload', async () => {
    const user = userEvent.setup();
    renderWithQuery(<CustomConnectorBuilder />);

    await user.type(screen.getByLabelText(/name/i, { selector: '#custom-name' }), 'My API');
    await user.type(screen.getByPlaceholderText('custom'), 'my_api');
    await user.type(
      screen.getByPlaceholderText(en.builderBaseUrlPlaceholder),
      '  https://api.example.com  ',
    );

    await user.click(saveButton());

    await waitFor(() => expect(createIntegrationMock).toHaveBeenCalledTimes(1));
    const payload = createIntegrationMock.mock.calls[0][0];
    expect(payload.kind).toBe('custom');
    expect(payload.name).toBe('My API');
    const spec = payload.config[CUSTOM_SPEC_CONFIG_KEY] as CustomConnectorSpec;
    // Trimmed on serialize.
    expect(spec.base_url).toBe('https://api.example.com');
    expect(showSuccessMock).toHaveBeenCalled();
  });

  it('toasts on a save failure (no unhandled rejection)', async () => {
    createIntegrationMock.mockRejectedValueOnce(new Error('boom'));
    const user = userEvent.setup();
    renderWithQuery(<CustomConnectorBuilder />);

    await user.type(screen.getByLabelText(/name/i, { selector: '#custom-name' }), 'My API');
    await user.type(screen.getByPlaceholderText('custom'), 'my_api');
    await user.type(screen.getByPlaceholderText(en.builderBaseUrlPlaceholder), 'https://api.example.com');

    await user.click(saveButton());

    await waitFor(() => expect(showApiErrorMock).toHaveBeenCalledTimes(1));
  });

  it('renders a stored secret WRITE-ONLY — the real secret value never appears in the DOM', async () => {
    const { container } = renderWithQuery(
      <CustomConnectorBuilder endpoint={endpointWithMaskedSecret()} />,
    );

    // The masked "set" affordance and a Replace control are shown.
    expect(screen.getByText(en.builderSecretSet)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: en.builderSecretReplace })).toBeInTheDocument();

    // The real secret value and the redaction sentinel must NOT be in the DOM.
    expect(container.innerHTML).not.toContain(SECRET_VALUE);
    expect(container.innerHTML).not.toContain(REDACTED_SENTINEL);
    // No input is pre-populated with the sentinel or the secret.
    for (const input of Array.from(container.querySelectorAll('input'))) {
      expect(input.value).not.toBe(REDACTED_SENTINEL);
      expect(input.value).not.toBe(SECRET_VALUE);
    }
  });

  it('keeps the stored secret (sends the sentinel) when an untouched edit is saved', async () => {
    const user = userEvent.setup();
    renderWithQuery(<CustomConnectorBuilder endpoint={endpointWithMaskedSecret()} />);

    const saveButton = screen.getAllByRole('button').find((b) => /Save|Create|Build/i.test(b.textContent ?? ''));
    await user.click(saveButton!);

    await waitFor(() => expect(createIntegrationMock).toHaveBeenCalledTimes(1));
    const spec = createIntegrationMock.mock.calls[0][0].config[CUSTOM_SPEC_CONFIG_KEY] as CustomConnectorSpec;
    // The redaction sentinel passes through unchanged so the backend keeps the secret.
    expect(spec.auth.token).toBe(REDACTED_SENTINEL);
  });

  it('blocks save for an SSRF-prone / insecure / invalid base URL', async () => {
    const user = userEvent.setup();
    renderWithQuery(<CustomConnectorBuilder />);

    await user.type(screen.getByLabelText(/name/i, { selector: '#custom-name' }), 'My API');
    await user.type(screen.getByPlaceholderText('custom'), 'my_api');
    // Loopback target — must be rejected before any request.
    await user.type(screen.getByPlaceholderText(en.builderBaseUrlPlaceholder), 'http://localhost:8080');

    await user.click(saveButton());
    // The field is flagged and no create request fires.
    await waitFor(() =>
      expect(screen.getByPlaceholderText(en.builderBaseUrlPlaceholder)).toHaveAttribute(
        'aria-invalid',
        'true',
      ),
    );
    // The dedicated per-verdict guard copy is shown (here: plain-HTTP insecure),
    // not the generic "required" fallback.
    expect(screen.getByText(en.builderBaseUrlInsecure)).toBeInTheDocument();
    expect(screen.queryByText(en.builderBaseUrlRequired)).not.toBeInTheDocument();
    expect(createIntegrationMock).not.toHaveBeenCalled();
  });

  it('renders the Arabic/RTL surface under the ar locale', async () => {
    const { container } = renderWithQuery(<CustomConnectorBuilder />, { locale: 'ar' });
    expect(await screen.findByText(extensibilityLabels.ar.builderTitle)).toBeInTheDocument();
    expect(container.querySelector('[dir="rtl"]')).not.toBeNull();
  });
});

describe('classifyBaseUrl (SSRF / URL guard)', () => {
  it('accepts a public https URL', () => {
    expect(classifyBaseUrl('https://api.example.com')).toBe('ok');
    expect(classifyBaseUrl('  https://api.example.com/v1  ')).toBe('ok');
  });

  it('rejects empty, malformed, and credentialed URLs', () => {
    expect(classifyBaseUrl('')).toBe('empty');
    expect(classifyBaseUrl('not a url')).toBe('invalid');
    expect(classifyBaseUrl('ftp://example.com')).toBe('invalid');
    expect(classifyBaseUrl('https://user:pass@example.com')).toBe('invalid');
  });

  it('flags plain HTTP as insecure', () => {
    expect(classifyBaseUrl('http://api.example.com')).toBe('insecure');
  });

  it('flags loopback, link-local, metadata, and RFC1918 hosts as private', () => {
    expect(classifyBaseUrl('https://localhost')).toBe('private');
    expect(classifyBaseUrl('https://127.0.0.1')).toBe('private');
    expect(classifyBaseUrl('https://10.0.0.5')).toBe('private');
    expect(classifyBaseUrl('https://192.168.1.1')).toBe('private');
    expect(classifyBaseUrl('https://169.254.169.254')).toBe('private');
    expect(classifyBaseUrl('https://172.16.0.1')).toBe('private');
    expect(classifyBaseUrl('https://metadata.google.internal')).toBe('private');
    expect(classifyBaseUrl('https://svc.internal')).toBe('private');
  });

  it('does not over-block public 172.x addresses outside the private range', () => {
    expect(classifyBaseUrl('https://172.32.0.1')).toBe('ok');
    expect(classifyBaseUrl('https://172.15.0.1')).toBe('ok');
  });
});
