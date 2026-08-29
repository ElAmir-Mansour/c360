import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import { integrationLabels } from '../_labels';
import { extensibilityLabels } from '../_lib/extensibility-labels';
import { FieldMapper } from './field-mapper';

const en = integrationLabels.en;

/** Controlled wrapper mirroring the parent connector form's persistence. */
function ControlledMapper({
  initial = {},
  onEmit,
}: {
  initial?: unknown;
  onEmit?: (m: Record<string, string>) => void;
}) {
  const [value, setValue] = useState<unknown>(initial);
  return (
    <FieldMapper
      value={value}
      onChange={(m) => {
        setValue(m);
        onEmit?.(m);
      }}
    />
  );
}

describe('FieldMapper', () => {
  it('renders an empty state when nothing is mapped', () => {
    renderWithQuery(<FieldMapper value={{}} onChange={() => undefined} />);
    expect(screen.getByText(en.mapperEmpty)).toBeInTheDocument();
    // The required lex target (External ID) is always shown.
    expect(screen.getByText(en.mapperLexExternalId)).toBeInTheDocument();
  });

  it('maps a source field onto a lex target and emits a normalized, trimmed object', async () => {
    const user = userEvent.setup();
    const emitted: Record<string, string>[] = [];
    const { container } = renderWithQuery(<ControlledMapper onEmit={(m) => emitted.push(m)} />);

    const externalIdInput = container.querySelector<HTMLInputElement>('#map-externalId')!;
    await user.type(externalIdInput, '  employeeNumber  ');

    await waitFor(() => {
      const last = emitted.at(-1);
      expect(last).toBeDefined();
      // Trimmed and not lost.
      expect(last?.externalId).toBe('employeeNumber');
    });
  });

  it('preserves an existing mapping (no data loss) and clears an optional row', async () => {
    const user = userEvent.setup();
    let latest: Record<string, string> = {};
    const { container } = renderWithQuery(
      <ControlledMapper
        initial={{ externalId: 'employeeNumber', manager: 'mgr' }}
        onEmit={(m) => (latest = m)}
      />,
    );

    // Both prefilled values are rendered in their inputs (no loss on round-trip).
    expect(container.querySelector('#map-externalId')).toHaveValue('employeeNumber');
    expect(container.querySelector('#map-manager')).toHaveValue('mgr');

    // Clear the optional manager row.
    const removeButtons = screen.getAllByRole('button', { name: en.mapperRemoveRow });
    await user.click(removeButtons[0]);
    await waitFor(() => {
      expect(latest.manager).toBeUndefined();
      expect(latest.externalId).toBe('employeeNumber');
    });
  });

  it('toggles to raw JSON mode and back', async () => {
    const user = userEvent.setup();
    const { container } = renderWithQuery(<ControlledMapper initial={{ externalId: 'employeeNumber' }} />);

    await user.click(screen.getByRole('button', { name: new RegExp(en.mapperRawToggle, 'i') }));
    expect(screen.getByRole('textbox')).toHaveValue(JSON.stringify({ externalId: 'employeeNumber' }, null, 2));

    await user.click(screen.getByRole('button', { name: new RegExp(en.mapperGuidedToggle, 'i') }));
    expect(container.querySelector('#map-externalId')).toBeInTheDocument();
  });

  it('flags invalid raw JSON with the dedicated invalid-JSON message (not the duplicate-source copy)', async () => {
    const user = userEvent.setup();
    renderWithQuery(<ControlledMapper initial={{ externalId: 'employeeNumber' }} />);

    await user.click(screen.getByRole('button', { name: new RegExp(en.mapperRawToggle, 'i') }));
    const textarea = screen.getByRole('textbox');
    await user.clear(textarea);
    await user.type(textarea, '{{ not valid json');

    // The semantically-correct invalid-JSON message is shown.
    expect(await screen.findByText(extensibilityLabels.en.mapperInvalidJson)).toBeInTheDocument();
    // ...and never the wrong "duplicate source" copy.
    expect(screen.queryByText(en.mapperDuplicateSource)).not.toBeInTheDocument();
  });

  it('renders the Arabic surface under the ar locale', () => {
    const { container } = renderWithQuery(
      <div dir="rtl">
        <FieldMapper value={{}} onChange={() => undefined} />
      </div>,
      { locale: 'ar' },
    );
    expect(screen.getByText(integrationLabels.ar.mapperLexExternalId)).toBeInTheDocument();
    expect(container.querySelector('[dir="rtl"]')).not.toBeNull();
  });
});
