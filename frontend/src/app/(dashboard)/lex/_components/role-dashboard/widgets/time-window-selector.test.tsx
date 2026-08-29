import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { useState } from 'react';

import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderWithQuery } from '@/__tests__/utils/render-with-query';

import {
  TimeWindowSelector,
  type DashboardWindow,
  type TimeWindowSelectorProps,
} from './time-window-selector';

/**
 * Stateful harness for the sequences that need the caller to actually commit
 * each change — the component is controlled, so a spy-only render cannot move
 * past the first step.
 */
function ControlledSelector({
  initial,
  onChange,
}: {
  initial: DashboardWindow;
  onChange: TimeWindowSelectorProps['onChange'];
}) {
  const [value, setValue] = useState<DashboardWindow>(initial);

  return (
    <TimeWindowSelector
      value={value}
      onChange={(next) => {
        setValue(next);
        onChange(next);
      }}
    />
  );
}

function group(): HTMLElement {
  return screen.getByRole('radiogroup', { name: 'Select dashboard time window' });
}

describe('TimeWindowSelector', () => {
  it('renders the three fixed windows as radios inside a labelled group', () => {
    renderWithQuery(<TimeWindowSelector value="today" onChange={vi.fn()} />);

    const radios = within(group()).getAllByRole('radio');

    expect(radios).toHaveLength(3);
    expect(radios.map((radio) => radio.getAttribute('data-window'))).toEqual([
      'today',
      '7d',
      '30d',
    ]);
    expect(radios.map((radio) => radio.textContent)).toEqual([
      'Today',
      '7 Days',
      '30 Days',
    ]);
    expect(screen.getByText('Dashboard time window')).toBeVisible();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('exposes the selected window through aria-checked, its name, and the tab order', () => {
    renderWithQuery(<TimeWindowSelector value="7d" onChange={vi.fn()} />);

    const radios = within(group()).getAllByRole('radio');

    expect(radios.map((radio) => radio.getAttribute('aria-checked'))).toEqual([
      'false',
      'true',
      'false',
    ]);
    expect(radios.map((radio) => radio.tabIndex)).toEqual([-1, 0, -1]);
    expect(screen.getByRole('radio', { name: '7 Days, selected' })).toBe(radios[1]);
    expect(screen.getByRole('radio', { name: 'Today' })).toBe(radios[0]);
    expect(screen.getByRole('radio', { name: '30 Days' })).toBe(radios[2]);
  });

  it('reports a clicked window without adopting it', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderWithQuery(<TimeWindowSelector value="today" onChange={onChange} />);

    await user.click(screen.getByRole('radio', { name: '30 Days' }));

    expect(onChange).toHaveBeenCalledExactlyOnceWith('30d');
    // Controlled only: the rendered selection still follows the prop.
    expect(screen.getByRole('radio', { name: 'Today, selected' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  it('selects the focused window with Space and Enter', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderWithQuery(<TimeWindowSelector value="today" onChange={onChange} />);

    screen.getByRole('radio', { name: '7 Days' }).focus();
    await user.keyboard(' ');
    await user.keyboard('{Enter}');

    expect(onChange.mock.calls).toEqual([['7d'], ['7d']]);
  });

  it('moves and selects with arrow keys, wrapping in logical order', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderWithQuery(<ControlledSelector initial="today" onChange={onChange} />);

    // The roving tab order enters at the checked chip.
    await user.tab();
    expect(screen.getByRole('radio', { name: 'Today, selected' })).toHaveFocus();

    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('radio', { name: '7 Days, selected' })).toHaveFocus();

    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('radio', { name: '30 Days, selected' })).toHaveFocus();

    // Forward from the last option wraps to the first.
    await user.keyboard('{ArrowDown}');
    await user.keyboard('{ArrowUp}');

    expect(onChange.mock.calls).toEqual([['7d'], ['30d'], ['today'], ['30d']]);
    expect(screen.getByRole('radio', { name: '30 Days, selected' })).toHaveFocus();
  });

  it('mirrors the physical arrow keys and renders Arabic-Indic day counts in ar', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderWithQuery(<ControlledSelector initial="today" onChange={onChange} />, {
      locale: 'ar',
    });

    const radios = within(
      screen.getByRole('radiogroup', { name: 'اختيار النطاق الزمني للوحة المعلومات' }),
    ).getAllByRole('radio');

    expect(radios.map((radio) => radio.textContent)).toEqual([
      'اليوم',
      '٧ أيام',
      '٣٠ يومًا',
    ]);
    expect(screen.getByText('النطاق الزمني للوحة المعلومات')).toBeVisible();
    expect(radios[0]).toHaveAccessibleName('اليوم، محدد');

    radios[0].focus();
    // Under RTL the physical ArrowLeft advances and ArrowRight retreats.
    await user.keyboard('{ArrowLeft}');
    expect(screen.getByRole('radio', { name: '٧ أيام، محدد' })).toHaveFocus();

    await user.keyboard('{ArrowRight}');
    await user.keyboard('{ArrowRight}');

    expect(onChange.mock.calls).toEqual([['7d'], ['today'], ['30d']]);
    expect(screen.getByRole('radio', { name: '٣٠ يومًا، محدد' })).toHaveFocus();
  });

  it('stays presentation-only, token-bound, and free of physical-direction CSS', () => {
    const componentSource = readFileSync(
      join(
        process.cwd(),
        'src/app/(dashboard)/lex/_components/role-dashboard/widgets/time-window-selector.tsx',
      ),
      'utf8',
    );
    const styleSource = readFileSync(
      join(
        process.cwd(),
        'src/app/(dashboard)/lex/_components/role-dashboard/widgets/time-window-selector.module.css',
      ),
      'utf8',
    );
    const sources = `${componentSource}\n${styleSource}`;

    expect(sources).not.toMatch(/#[\da-f]{3,8}/i);
    expect(styleSource).not.toMatch(/box-shadow/i);
    expect(styleSource).not.toMatch(/(?:margin|padding|inset|border)-(?:left|right)/i);
    expect(styleSource).not.toMatch(/text-align:\s*(?:left|right)/i);
    expect(componentSource).not.toMatch(/\b(?:ml|mr|pl|pr)-/);
    // No embedded copy: every rendered string comes from the catalogue.
    expect(componentSource).not.toMatch(/>[ \t]*[A-Za-z][^<{\r\n]*</);
    // No transport, and no ownership of the window it renders.
    expect(componentSource).not.toMatch(
      /\bfetch\(|axios|useQuery|useState|useReducer|useRoleDashboardData/,
    );
  });
});
