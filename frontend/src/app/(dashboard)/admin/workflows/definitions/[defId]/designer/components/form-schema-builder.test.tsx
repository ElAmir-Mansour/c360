import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { FormSchemaBuilder } from './form-schema-builder';
import type { FormField } from '@/types/forms';
import { renderWithQuery as render } from '@/__tests__/utils/render-with-query';

/**
 * Render with REAL React state so the latest onChange result feeds back into the
 * component on every keystroke (the builder is a fully-controlled component, so
 * a plain closure would lose intermediate edits). A spy mirrors the state into
 * `latest` for assertions.
 */
function renderControlled(initial: FormField[]) {
  const onChange = vi.fn();
  const latest = { value: initial };
  const Wrapper = () => {
    const [fields, setFields] = useState<FormField[]>(initial);
    return (
      <FormSchemaBuilder
        fields={fields}
        onChange={(next) => {
          latest.value = next;
          onChange(next);
          setFields(next);
        }}
      />
    );
  };
  const utils = render(<Wrapper />);
  return { onChange, getCurrent: () => latest.value, ...utils };
}

describe('FormSchemaBuilder canonical authoring', () => {
  it('authors a canonical field: AR+EN label, into the FormField object', async () => {
    const user = userEvent.setup();
    const initial: FormField[] = [
      { name: 'reason', type: 'text', label: { ar: '', en: '' }, required: false },
    ];
    const { onChange, getCurrent } = renderControlled(initial);

    await user.type(screen.getByLabelText('Label Arabic'), 'السبب');
    await user.type(screen.getByLabelText('Label English'), 'Reason');

    const field = getCurrent()[0];
    expect(field.label).toEqual({ ar: 'السبب', en: 'Reason' });
    expect(field.name).toBe('reason');
    expect(field.type).toBe('text');
    expect(onChange).toHaveBeenCalled();
  });

  it('emits a canonical FormOption[] with bilingual labels for option-backed types', async () => {
    const user = userEvent.setup();
    const initial: FormField[] = [
      {
        name: 'decision',
        type: 'select',
        label: { ar: 'القرار', en: 'Decision' },
        required: true,
        options: [{ value: 'approve', label: { ar: '', en: '' } }],
      },
    ];
    const { getCurrent } = renderControlled(initial);

    await user.type(screen.getByLabelText('Option 1 label Arabic'), 'موافقة');
    await user.type(screen.getByLabelText('Option 1 label English'), 'Approve');

    const field = getCurrent()[0];
    expect(field.options).toEqual([
      { value: 'approve', label: { ar: 'موافقة', en: 'Approve' } },
    ]);
  });

  it('adds a validation rule with an optional bilingual message', async () => {
    const user = userEvent.setup();
    const initial: FormField[] = [
      { name: 'code', type: 'text', label: { ar: 'الرمز', en: 'Code' }, required: false },
    ];
    const { getCurrent } = renderControlled(initial);

    // Add a minLength rule via the rule dropdown.
    await user.click(screen.getByLabelText('Add validation rule'));
    await user.click(screen.getByText('Min length'));

    // Set the numeric param and a bilingual error message.
    await user.clear(screen.getByLabelText('Rule minLength param'));
    await user.type(screen.getByLabelText('Rule minLength param'), '3');
    await user.type(screen.getByLabelText('Rule minLength message Arabic'), 'قصير جداً');
    await user.type(screen.getByLabelText('Rule minLength message English'), 'Too short');

    const field = getCurrent()[0];
    expect(field.validation).toBeDefined();
    expect(field.validation?.[0]?.kind).toBe('minLength');
    expect(field.validation?.[0]?.param).toBe(3);
    expect(field.validation?.[0]?.message).toEqual({ ar: 'قصير جداً', en: 'Too short' });
  });

  it('authors a visibleWhen condition referencing another field', async () => {
    const user = userEvent.setup();
    const initial: FormField[] = [
      {
        name: 'details',
        type: 'textarea',
        label: { ar: 'التفاصيل', en: 'Details' },
        required: false,
      },
      {
        name: 'needs_detail',
        type: 'boolean',
        label: { ar: 'يحتاج تفاصيل', en: 'Needs detail' },
        required: false,
      },
    ];
    const { getCurrent } = renderControlled(initial);

    // Field 0 (details) is expanded by default; add a Visible When condition.
    // The "Add Condition" button under the first field's Visible When section.
    await user.click(screen.getAllByRole('button', { name: /add condition/i })[0]);

    // Fill in the condition: needs_detail truthy.
    await user.type(screen.getAllByLabelText('Condition field')[0], 'needs_detail');
    await user.click(screen.getAllByLabelText('Condition operator')[0]);
    await user.click(screen.getByText('is truthy'));

    const field = getCurrent()[0];
    expect(field.visibleWhen).toBeDefined();
    expect(field.visibleWhen?.[0]).toMatchObject({
      field: 'needs_detail',
      operator: 'truthy',
    });
  });

  it('all 17 field types are selectable', async () => {
    const user = userEvent.setup();
    const initial: FormField[] = [
      { name: 'f', type: 'text', label: { ar: 'ح', en: 'F' }, required: false },
    ];
    renderControlled(initial);

    await user.click(screen.getByLabelText('Field type'));
    // Spot-check the non-legacy canonical types are present.
    expect(screen.getByText('Multi-select')).toBeInTheDocument();
    expect(screen.getByText('Combobox')).toBeInTheDocument();
    expect(screen.getByText('Date Range')).toBeInTheDocument();
    expect(screen.getByText('Currency')).toBeInTheDocument();
    expect(screen.getByText('Section (layout)')).toBeInTheDocument();
  });
});
