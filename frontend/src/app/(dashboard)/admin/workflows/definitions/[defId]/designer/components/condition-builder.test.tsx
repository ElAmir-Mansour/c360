import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import {
  ConditionBuilder,
  coerceScalar,
  coerceArray,
  coerceConditionValue,
  type EditableCondition,
} from './condition-builder';

describe('condition-builder value coercion', () => {
  it('coerceScalar: numbers, booleans, strings, and empty', () => {
    expect(coerceScalar('42')).toBe(42);
    expect(coerceScalar('-3.5')).toBe(-3.5);
    expect(coerceScalar('true')).toBe(true);
    expect(coerceScalar('false')).toBe(false);
    expect(coerceScalar('hello')).toBe('hello');
    expect(coerceScalar('  7  ')).toBe(7);
    expect(coerceScalar('')).toBe('');
    // Not a clean number -> string.
    expect(coerceScalar('1,2')).toBe('1,2');
  });

  it('coerceArray: splits and coerces each element', () => {
    expect(coerceArray('a, b, c')).toEqual(['a', 'b', 'c']);
    expect(coerceArray('1, 2, 3')).toEqual([1, 2, 3]);
    expect(coerceArray('true, x, 4')).toEqual([true, 'x', 4]);
    expect(coerceArray('')).toEqual([]);
  });

  it('coerceConditionValue: array for in/notIn, scalar otherwise, undefined for no-value ops', () => {
    expect(coerceConditionValue('in', '1, 2')).toEqual([1, 2]);
    expect(coerceConditionValue('notIn', 'a, b')).toEqual(['a', 'b']);
    expect(coerceConditionValue('gt', '10')).toBe(10);
    expect(coerceConditionValue('eq', 'true')).toBe(true);
    expect(coerceConditionValue('truthy', 'ignored')).toBeUndefined();
    expect(coerceConditionValue('isSet', 'ignored')).toBeUndefined();
  });
});

describe('ConditionBuilder component', () => {
  it('renders all 13 canonical operators (plus legacy) in the dropdown', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const conditions: EditableCondition[] = [{ field: 'amount', operator: 'eq', value: '' }];
    renderWithQuery(
      <ConditionBuilder<EditableCondition>
        conditions={conditions}
        onChange={onChange}
        hideLogic
      />,
    );

    await user.click(screen.getByLabelText('Condition operator'));
    // A representative sample of the canonical 13 operators.
    expect(screen.getByText('not in')).toBeInTheDocument(); // notIn
    expect(screen.getByText('is truthy')).toBeInTheDocument(); // truthy
    expect(screen.getByText('is set')).toBeInTheDocument(); // isSet
    expect(screen.getByText('is empty')).toBeInTheDocument(); // isEmpty
    expect(screen.getByText('contains')).toBeInTheDocument();
  });

  it('coerces a numeric value for the gt operator on input', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const conditions: EditableCondition[] = [{ field: 'amount', operator: 'gt', value: '' }];
    renderWithQuery(
      <ConditionBuilder<EditableCondition>
        conditions={conditions}
        onChange={onChange}
        hideLogic
      />,
    );

    await user.type(screen.getByLabelText('Condition value'), '5');

    const last = onChange.mock.calls.at(-1)?.[0] as EditableCondition[];
    expect(last[0].value).toBe(5);
    expect(typeof last[0].value).toBe('number');
  });

  it('coerces a comma list into an array for the in operator', async () => {
    const user = userEvent.setup();
    let conditions: EditableCondition[] = [{ field: 'tag', operator: 'in', value: '' }];
    const onChange = vi.fn((next: EditableCondition[]) => {
      conditions = next;
    });
    const { rerender } = renderWithQuery(
      <ConditionBuilder<EditableCondition>
        conditions={conditions}
        onChange={onChange}
        hideLogic
      />,
    );

    const input = screen.getByLabelText('Condition value');
    await user.type(input, 'a');
    rerender(
      <ConditionBuilder<EditableCondition>
        conditions={conditions}
        onChange={onChange}
        hideLogic
      />,
    );

    const last = onChange.mock.calls.at(-1)?.[0] as EditableCondition[];
    expect(Array.isArray(last[0].value)).toBe(true);
    expect(last[0].value).toEqual(['a']);
  });

  it('hides the value input for the truthy (no-value) operator', () => {
    const onChange = vi.fn();
    const conditions: EditableCondition[] = [{ field: 'active', operator: 'truthy' }];
    renderWithQuery(
      <ConditionBuilder<EditableCondition>
        conditions={conditions}
        onChange={onChange}
        hideLogic
      />,
    );

    expect(screen.queryByLabelText('Condition value')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Condition field')).toBeInTheDocument();
  });
});
