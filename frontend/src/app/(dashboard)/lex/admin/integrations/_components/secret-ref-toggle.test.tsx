import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import { SecretRefToggle, type SecretRefValue } from './secret-ref-toggle';
import { integrationLabels } from '../_labels';
import { governanceLabels } from '../_lib/governance-labels';
import { REDACTED_SENTINEL } from '@/lib/lex/integrations';

const STORED_PLAINTEXT = 'literal-secret-never-rendered';

/**
 * Controlled host mirroring how the DynamicConnectorForm owns the value. The
 * toggle reseeds its local mode from `value` identity, so seeding an external
 * reference string is the way to land the control in reference mode.
 */
function Harness({
  initial = REDACTED_SENTINEL,
  initialDays = 0,
  onEmit,
}: {
  initial?: unknown;
  initialDays?: number;
  onEmit?: (v: SecretRefValue) => void;
}) {
  const [value, setValue] = useState<unknown>(initial);
  const [days, setDays] = useState(initialDays);
  return (
    <SecretRefToggle
      id="client_secret"
      value={value}
      rotateEveryDays={days}
      disabled={false}
      onChange={(next) => {
        setValue(next.value);
        setDays(next.rotateEveryDays);
        onEmit?.(next);
      }}
    />
  );
}

describe('SecretRefToggle', () => {
  it('masks a stored literal secret and never renders plaintext', () => {
    const { container } = renderWithQuery(<Harness initial={REDACTED_SENTINEL} />);

    expect(screen.getByText(integrationLabels.en.secretSet)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: integrationLabels.en.secretReplace }),
    ).toBeInTheDocument();
    // Neither the sentinel nor any plaintext value reaches the rendered DOM.
    expect(container.innerHTML).not.toContain(STORED_PLAINTEXT);
    expect(container.innerHTML).not.toContain(REDACTED_SENTINEL);
    expect(screen.queryByDisplayValue(REDACTED_SENTINEL)).toBeNull();
  });

  it('begins replace and emits an empty literal (never resubmits the sentinel as the secret)', async () => {
    const user = userEvent.setup();
    const emitted: SecretRefValue[] = [];
    renderWithQuery(<Harness onEmit={(v) => emitted.push(v)} />);

    await user.click(screen.getByRole('button', { name: integrationLabels.en.secretReplace }));
    expect(emitted.at(-1)).toMatchObject({ value: '', provider: 'none' });
  });

  it('displays a stored external reference verbatim (references are non-secret)', () => {
    renderWithQuery(<Harness initial="kms://alias/lex-najiz-key" />);

    // Reference mode shows the ref string in the (text) input — it is not a secret.
    expect(screen.getByDisplayValue('kms://alias/lex-najiz-key')).toBeInTheDocument();
    expect(screen.getByText(governanceLabels.en.refStoredNote)).toBeInTheDocument();
  });

  it('flags a malformed reference with aria-invalid and the invalid hint', async () => {
    const user = userEvent.setup();
    // Seed with a valid ref so the control is in reference mode, then corrupt it.
    renderWithQuery(<Harness initial="kms://alias/seed" />);

    const input = screen.getByDisplayValue('kms://alias/seed');
    await user.clear(input);
    await user.type(input, 'not-a-valid-ref');

    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText(governanceLabels.en.refInvalid)).toBeInTheDocument();
  });

  it('accepts a well-formed vault reference and reports the provider', async () => {
    const user = userEvent.setup();
    const emitted: SecretRefValue[] = [];
    renderWithQuery(<Harness initial="vault://secret/lex#a" onEmit={(v) => emitted.push(v)} />);

    const input = screen.getByDisplayValue('vault://secret/lex#a');
    await user.clear(input);
    await user.type(input, 'vault://secret/lex/najiz#client_secret');

    expect(input).toHaveAttribute('aria-invalid', 'false');
    expect(emitted.at(-1)).toMatchObject({
      value: 'vault://secret/lex/najiz#client_secret',
      provider: 'vault',
    });
  });

  it('renders the Arabic/RTL surface and labels the toggle', () => {
    renderWithQuery(<Harness />, { locale: 'ar' });
    expect(
      screen.getByRole('switch', { name: governanceLabels.ar.refToggleLabel }),
    ).toBeInTheDocument();
  });
});
