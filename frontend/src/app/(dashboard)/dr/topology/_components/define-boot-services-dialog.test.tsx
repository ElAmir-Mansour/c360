import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import { DefineBootServicesDialog } from './define-boot-services-dialog';

/**
 * Define-boot-services dialog tests.
 *
 * Proves the dialog builds a REAL {@link DRCreateBootServicesRequest} from a
 * zod-valid form and calls `onDefine` with that exact payload (numeric fields are
 * coerced and only sent when supplied; `depends_on` free-text is parsed to a
 * `string[]`; the probe-kind default `tcp` — a real `internal/dr/bootgraph`
 * token — rides along), that a blank service name blocks submission, and includes
 * an Arabic / RTL render asserting the MSA copy. `next/navigation` is globally
 * mocked by the test setup.
 */

describe('DefineBootServicesDialog', () => {
  it('calls onDefine with the zod-valid DRCreateBootServicesRequest payload', async () => {
    const user = userEvent.setup();
    const onDefine = vi.fn();

    renderWithQuery(
      <DefineBootServicesDialog open onOpenChange={vi.fn()} onDefine={onDefine} submitting={false} />,
    );

    await user.type(screen.getByPlaceholderText('e.g. postgres-primary'), 'postgres-primary');
    await user.type(
      screen.getByPlaceholderText('e.g. http://api.recovery:8080/healthz'),
      'db.recovery:5432',
    );

    // Probe kind: switch the default (tcp) explicitly via the Radix select.
    await user.click(screen.getByRole('combobox', { name: /Health probe/i }));
    const listbox = await screen.findByRole('listbox');
    await user.click(within(listbox).getByRole('option', { name: 'TCP connect' }));

    // Boot timeout (3rd spinbutton: expect-status, boot-timeout, health-retries).
    const numericInputs = screen.getAllByRole('spinbutton');
    await user.type(numericInputs[1], '30');

    // depends_on free text → parsed to string[].
    await user.type(screen.getByPlaceholderText('e.g. postgres-primary, cache'), 'cache, queue');

    await user.click(screen.getByRole('button', { name: 'Save boot services' }));

    await waitFor(() => expect(onDefine).toHaveBeenCalledTimes(1));
    expect(onDefine).toHaveBeenCalledWith({
      services: [
        {
          name: 'postgres-primary',
          probe_kind: 'tcp',
          probe_target: 'db.recovery:5432',
          boot_timeout_seconds: 30,
          depends_on: ['cache', 'queue'],
        },
      ],
    });
  });

  it('blocks submission and does not call onDefine when the service name is blank', async () => {
    const user = userEvent.setup();
    const onDefine = vi.fn();

    renderWithQuery(
      <DefineBootServicesDialog open onOpenChange={vi.fn()} onDefine={onDefine} submitting={false} />,
    );

    // Probe target filled but name blank — zod must reject.
    await user.type(
      screen.getByPlaceholderText('e.g. http://api.recovery:8080/healthz'),
      'db.recovery:5432',
    );
    await user.click(screen.getByRole('button', { name: 'Save boot services' }));

    expect(await screen.findByText('Enter a service name.')).toBeInTheDocument();
    expect(onDefine).not.toHaveBeenCalled();
  });

  it('renders the full MSA Arabic surface for locale "ar" (RTL)', () => {
    renderWithQuery(
      <DefineBootServicesDialog open onOpenChange={vi.fn()} onDefine={vi.fn()} submitting={false} />,
      { locale: 'ar' },
    );

    expect(screen.getByText('تعريف خدمات الإقلاع')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'إلغاء' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'حفظ خدمات الإقلاع' })).toBeInTheDocument();
  });
});
